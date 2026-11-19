//! Meetings in the hub (concept 6): the invitation of a meeting as iCalendar (`ics`), its preview picture (`thumb`) and
//! what the hub keeps for both outside the vault: the `SEQUENCE` of each invitation and the cache of the previews.
//!
//! The engine reads the meeting files; this only turns an entry of `tasks.meeting` into a file for a calendar, and a
//! picture below the meeting's folder into a small one. Nothing here writes into a vault.

use std::collections::BTreeMap;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use jiff::civil::Date;
use jiff::tz::TimeZone;
use jiff::Timestamp;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::classes::Shown;
use crate::schedule::{self, Start};

/// The edge of a preview: it fits into a square of this many pixels.
pub const THUMB_PX: u32 = 96;
/// The largest picture a preview is made of.
const MAX_RASTER_BYTES: u64 = 20 * 1024 * 1024;
/// The largest drawing of a board that is handed on as it is.
const MAX_SVG_BYTES: u64 = 2 * 1024 * 1024;
/// The most pixels a picture may have on either edge, and the most memory decoding it may take.
const MAX_EDGE: u32 = 12_000;
const MAX_DECODE_BYTES: u64 = 256 * 1024 * 1024;
/// The most previews kept in the cache (a few KB each).
const MAX_THUMBS: usize = 1000;
/// The most invitations whose sequence is kept; beyond, the ones not asked for longest are forgotten.
const MAX_SEQUENCES: usize = 5000;

/// What the hub keeps for the meetings of its vaults, beside its settings: the folder of the previews and the sequences
/// of the invitations. Both are the hub's, never a vault's.
#[derive(Debug)]
pub struct MeetingFiles {
    /// The cache of the previews; none: each preview is made anew.
    pub thumbs: Option<PathBuf>,
    sequences: Mutex<Sequences>,
    /// The address to join of an `internal` meeting may leave the hub (the settings' `meetings.internal_links`, the
    /// same switch as the one of the scheduler's mails).
    pub internal_links: bool,
    /// The zone of the hub: the one of a meeting that names none (the system's; a test sets its own).
    pub zone: TimeZone,
}

/// The zone of this PC; UTC when the system names none the database knows.
fn system_zone() -> TimeZone {
    TimeZone::try_system().unwrap_or(TimeZone::UTC)
}

impl MeetingFiles {
    /// The files below `dir` (the settings folder): `cache/thumbs/` and `ics-sequence.json`.
    #[must_use]
    pub fn in_dir(dir: &Path, internal_links: bool) -> Self {
        Self {
            thumbs: Some(dir.join("cache").join("thumbs")),
            sequences: Mutex::new(Sequences::open(Some(dir.join("ics-sequence.json")))),
            internal_links,
            zone: system_zone(),
        }
    }

    /// Nothing kept (a test, a hub without a settings folder).
    #[must_use]
    pub fn none(internal_links: bool) -> Self {
        Self {
            thumbs: None,
            sequences: Mutex::new(Sequences::open(None)),
            internal_links,
            zone: system_zone(),
        }
    }

    /// The sequence of the invitation `uid` whose meeting stands at `stand`.
    pub fn sequence(&self, uid: &str, stand: &str) -> u32 {
        self.sequences.lock().map_or(0, |mut s| s.next(uid, stand))
    }
}

// ── the sequence of an invitation ───────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
struct Kept {
    /// A hash over what a calendar must take as a change (time, place, status).
    stand: String,
    seq: u32,
    /// How often an export was asked for in all, when this one was last: the oldest are forgotten first.
    #[serde(default)]
    used: u64,
}

/// The `SEQUENCE` of each invitation (RFC 5545 3.8.7.4): 0 for the first export, one more for each export after the
/// meeting was changed (moved, cancelled, another place). Kept in a file of the hub, so it only ever grows.
#[derive(Debug, Default)]
struct Sequences {
    path: Option<PathBuf>,
    kept: BTreeMap<String, Kept>,
    asked: u64,
}

impl Sequences {
    fn open(path: Option<PathBuf>) -> Self {
        let kept: BTreeMap<String, Kept> = path
            .as_ref()
            .and_then(|p| std::fs::read(p).ok())
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        let asked = kept.values().map(|k| k.used).max().unwrap_or(0);
        Self { path, kept, asked }
    }

    fn next(&mut self, uid: &str, stand: &str) -> u32 {
        self.asked += 1;
        let asked = self.asked;
        let entry = self.kept.entry(uid.to_owned()).or_insert_with(|| Kept {
            stand: stand.to_owned(),
            seq: 0,
            used: asked,
        });
        if entry.stand != stand {
            entry.stand = stand.to_owned();
            entry.seq = entry.seq.saturating_add(1);
        }
        entry.used = asked;
        let seq = entry.seq;
        while self.kept.len() > MAX_SEQUENCES {
            let oldest = self
                .kept
                .iter()
                .min_by_key(|(_, k)| k.used)
                .map(|(id, _)| id.clone());
            match oldest {
                Some(id) => self.kept.remove(&id),
                None => break,
            };
        }
        self.save();
        seq
    }

    /// A file that cannot be written loses nothing but the count of the next start: said, not fatal.
    fn save(&self) {
        let Some(path) = &self.path else {
            return;
        };
        let write = || -> std::io::Result<()> {
            if let Some(dir) = path.parent() {
                std::fs::create_dir_all(dir)?;
            }
            let tmp = path.with_extension("json.tmp");
            std::fs::write(&tmp, serde_json::to_vec_pretty(&self.kept)?)?;
            std::fs::rename(&tmp, path)
        };
        if let Err(e) = write() {
            eprintln!("note: the sequences of the invitations were not kept: {e}");
        }
    }
}

// ── the invitation ──────────────────────────────────────────────────────────

/// Why a meeting gives no invitation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IcsRefusal {
    /// The data class of its area keeps it in the hub (`private`, or not classified: fail closed).
    NotReleased,
    /// It has no beginning a calendar can take (no valid date, a zone no database knows).
    NoTime,
}

/// What an invitation is made of: the entry and the participants of `tasks.meeting`, and what the hub knows.
#[derive(Debug)]
pub struct Invitation<'a> {
    /// `<vault>:<id>`: the same for every export of the meeting.
    pub uid: &'a str,
    pub sequence: u32,
    /// When the file is made (`DTSTAMP`).
    pub now: Timestamp,
    /// The `meeting` of `tasks.meeting`.
    pub entry: &'a Value,
    /// The `participants` of `tasks.meeting`.
    pub participants: &'a Value,
    /// The class the meeting's area is shown with.
    pub shown: Shown,
    /// The address to join of an `internal` meeting may leave the hub.
    pub internal_links: bool,
    /// The zone of the hub: the one of a meeting that names none.
    pub zone: &'a TimeZone,
}

/// What a calendar must take as a change of the meeting (RFC 5545: the time, and the status); the place as well, which
/// a person would want to see moved. Its hash is kept, not the meeting.
#[must_use]
pub fn stand_of(entry: &Value) -> String {
    let part = |key: &str| entry[key].as_str().unwrap_or_default().to_owned();
    let all_day = entry["all_day"].as_bool() == Some(true);
    let stand = serde_json::json!([
        part("starts_at"),
        part("ends_at"),
        all_day,
        part("tz"),
        part("status"),
        part("location"),
        part("online"),
    ]);
    hex(&Sha256::digest(stand.to_string().as_bytes()))
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes.iter().fold(String::new(), |mut s, b| {
        let _ = write!(s, "{b:02x}");
        s
    })
}

/// The invitation as an iCalendar file (RFC 5545) with one `VEVENT`: CRLF lines, folded at 75 octets.
///
/// What leaves the hub follows the class of the area, fail closed (concept 4.9): nothing for a `private` or
/// unclassified area; title, time, place and service for an `internal` one, its address to join only with
/// `internal_links`; organizer and participants (with an address) for a `public` one only. No `METHOD`: the file is a
/// calendar entry to take in, not a request sent to anyone.
///
/// # Errors
///
/// [`IcsRefusal`] when the class keeps the meeting in the hub or it has no time a calendar can take.
pub fn ics(inv: &Invitation<'_>) -> Result<String, IcsRefusal> {
    if !matches!(inv.shown, Shown::Public | Shown::Internal) {
        return Err(IcsRefusal::NotReleased);
    }
    let meeting = schedule::meeting_of(inv.entry).ok_or(IcsRefusal::NoTime)?;
    let zone = schedule::zone_of(&meeting, inv.zone).ok_or(IcsRefusal::NoTime)?;
    let mut lines: Vec<String> = vec![
        "BEGIN:VCALENDAR".to_owned(),
        "VERSION:2.0".to_owned(),
        "PRODID:-//WKDSteve//tasks-desktop//EN".to_owned(),
        "CALSCALE:GREGORIAN".to_owned(),
        "BEGIN:VEVENT".to_owned(),
        format!("UID:{}", text(inv.uid)),
        format!("DTSTAMP:{}", utc(inv.now)),
        format!("SEQUENCE:{}", inv.sequence),
    ];
    match meeting.start {
        Start::AllDay(first) => {
            let last = inv.entry["ends_at"]
                .as_str()
                .and_then(schedule::day_of)
                .filter(|last| *last >= first)
                .unwrap_or(first);
            // The end of a day's event is the day after (RFC 5545 3.6.1).
            let after = last.tomorrow().map_err(|_| IcsRefusal::NoTime)?;
            lines.push(format!("DTSTART;VALUE=DATE:{}", day(first)));
            lines.push(format!("DTEND;VALUE=DATE:{}", day(after)));
        }
        Start::At(wall) => {
            let begins = schedule::instant(wall, &zone).ok_or(IcsRefusal::NoTime)?;
            lines.push(format!("DTSTART:{}", utc(begins)));
            if let Some(ends) = meeting
                .end
                .and_then(|end| schedule::instant(end, &zone))
                .filter(|ends| *ends >= begins)
            {
                lines.push(format!("DTEND:{}", utc(ends)));
            }
        }
    }
    lines.push(format!("SUMMARY:{}", text(&one_line(&inv.entry["title"]))));
    let location = one_line(&inv.entry["location"]);
    if !location.is_empty() {
        lines.push(format!("LOCATION:{}", text(&location)));
    }
    let link_ok = inv.shown == Shown::Public || inv.internal_links;
    let join = meeting
        .online
        .as_deref()
        .filter(|_| link_ok)
        .and_then(schedule::plain_link);
    let mut description: Vec<String> = Vec::new();
    if let Some(summary) = inv.entry["summary"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
    {
        description.push(summary.trim().to_owned());
    }
    if meeting.online.is_some() {
        let service = service_name(meeting.online_service.as_deref().unwrap_or("link"));
        description.push(match &join {
            Some(link) => format!("{service}: {link}"),
            None => service.to_owned(),
        });
    }
    if !description.is_empty() {
        lines.push(format!("DESCRIPTION:{}", text(&description.join("\n"))));
    }
    if let Some(link) = &join {
        lines.push(format!("URL:{link}"));
    }
    match inv.entry["status"].as_str() {
        Some("cancelled") => lines.push("STATUS:CANCELLED".to_owned()),
        Some("planned" | "done") => lines.push("STATUS:CONFIRMED".to_owned()),
        _ => {}
    }
    if inv.shown == Shown::Public {
        lines.extend(people(inv.participants));
    }
    lines.push("END:VEVENT".to_owned());
    lines.push("END:VCALENDAR".to_owned());
    Ok(lines.iter().map(|l| fold(l)).collect())
}

/// `ORGANIZER` (the first participant with the role of one and an address) and an `ATTENDEE` for every other
/// participant with an address; one without an address has no place in a calendar's list.
fn people(participants: &Value) -> Vec<String> {
    let list = participants.as_array().map_or(&[][..], Vec::as_slice);
    let with_mail: Vec<(&str, &str, &str)> = list
        .iter()
        .filter_map(|p| {
            let mail = p["email"].as_str().filter(|m| plain_mail(m))?;
            Some((
                p["name"].as_str().unwrap_or_default(),
                mail,
                p["role"].as_str().unwrap_or_default(),
            ))
        })
        .collect();
    let organizer = with_mail.iter().position(|(_, _, role)| {
        matches!(
            role.trim().to_lowercase().as_str(),
            "organisator" | "organisatorin" | "organizer" | "organiser"
        )
    });
    let mut out = Vec::new();
    if let Some(i) = organizer {
        let (name, mail, _) = with_mail[i];
        out.push(format!("ORGANIZER{}:mailto:{mail}", common_name(name)));
    }
    for (i, (name, mail, role)) in with_mail.iter().enumerate() {
        if Some(i) == organizer {
            continue;
        }
        let optional = role.trim().eq_ignore_ascii_case("optional");
        out.push(format!(
            "ATTENDEE{};ROLE={}:mailto:{mail}",
            common_name(name),
            if optional {
                "OPT-PARTICIPANT"
            } else {
                "REQ-PARTICIPANT"
            }
        ));
    }
    out
}

/// `;CN="..."`, or nothing for no name: a parameter value cannot hold a double quote or a control character.
fn common_name(name: &str) -> String {
    let clean: String = name
        .chars()
        .filter(|c| !c.is_control() && *c != '"')
        .collect();
    let clean = clean.trim();
    if clean.is_empty() {
        String::new()
    } else {
        format!(";CN=\"{clean}\"")
    }
}

/// An address that may stand behind `mailto:` as it is: one `@`, nothing that ends the value or the line.
fn plain_mail(mail: &str) -> bool {
    mail.len() <= 254
        && mail.matches('@').count() == 1
        && !mail.starts_with('@')
        && !mail.ends_with('@')
        && mail.chars().all(|c| {
            !c.is_control() && !c.is_whitespace() && !matches!(c, ':' | ';' | ',' | '"' | '<' | '>')
        })
}

/// A value of the entry on one line, whole (a calendar shows the title as written, not cut like a mail's subject).
fn one_line(value: &Value) -> String {
    let words: Vec<&str> = value
        .as_str()
        .unwrap_or_default()
        .split_whitespace()
        .collect();
    words.join(" ")
}

/// The name a service is told by.
fn service_name(service: &str) -> &'static str {
    match service {
        "teams" => "Microsoft Teams",
        "zoom" => "Zoom",
        "meet" => "Google Meet",
        "webex" => "Webex",
        "jitsi" => "Jitsi",
        _ => "Online",
    }
}

/// A `TEXT` value (RFC 5545 3.3.11): backslash, semicolon, comma and line break escaped, other control characters out.
fn text(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            ';' => out.push_str("\\;"),
            ',' => out.push_str("\\,"),
            '\n' => out.push_str("\\n"),
            c if c.is_control() => {}
            c => out.push(c),
        }
    }
    out
}

/// A moment in UTC: `20261124T130000Z`.
fn utc(at: Timestamp) -> String {
    at.strftime("%Y%m%dT%H%M%SZ").to_string()
}

/// A day: `20261124`.
fn day(d: Date) -> String {
    d.strftime("%Y%m%d").to_string()
}

/// One content line with its CRLF, folded so no line is longer than 75 octets (RFC 5545 3.1), never inside a character.
fn fold(line: &str) -> String {
    let mut out = String::with_capacity(line.len() + line.len() / 70 * 3 + 2);
    let mut width = 0;
    for c in line.chars() {
        let len = c.len_utf8();
        if width + len > 75 {
            out.push_str("\r\n ");
            width = 1;
        }
        out.push(c);
        width += len;
    }
    out.push_str("\r\n");
    out
}

// ── the preview ─────────────────────────────────────────────────────────────

/// What a preview is made of.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ThumbSource {
    /// A picture (PNG, JPEG, WebP): made small.
    Raster(PathBuf),
    /// The drawing of a board: handed on as it is, a drawing has no pixels to save.
    Svg(PathBuf),
}

/// The picture of a meeting's preview, below its folder: its `cover` (the name the engine gives it from now on) or
/// `image` (the old name, read as the same), else the first picture of its boards (`assets/boards/`). `None`: it has
/// none, or the file is not one of its own (outside its folder, through a link, too large).
#[must_use]
pub fn thumb_source(vault: &Path, entry: &Value) -> Option<ThumbSource> {
    if entry["folder"] != true {
        return None;
    }
    let file = entry["file"].as_str().filter(|f| plain_relative(f))?;
    let folder = vault.join(file).parent()?.to_path_buf();
    let named = ["cover", "image"]
        .iter()
        .filter_map(|key| entry[*key].as_str())
        .find(|p| p.starts_with("assets/"));
    let boards = || {
        let assets = entry["assets"].as_array()?;
        let mut boards: Vec<&str> = assets
            .iter()
            .filter_map(Value::as_str)
            .filter(|a| a.starts_with("assets/boards/"))
            .collect();
        boards.sort_unstable();
        // A picture before a drawing: a picture is made small, a drawing is sent whole.
        boards
            .iter()
            .find(|a| kind_of(a) == Some(Kind::Raster))
            .or_else(|| boards.iter().find(|a| kind_of(a) == Some(Kind::Svg)))
            .copied()
    };
    let rel = named.or_else(boards)?;
    let kind = kind_of(rel)?;
    if !plain_relative(rel) {
        return None;
    }
    let path = inside(vault, &folder, &folder.join(rel))?;
    let size = std::fs::metadata(&path).ok()?.len();
    match kind {
        Kind::Raster if size <= MAX_RASTER_BYTES => Some(ThumbSource::Raster(path)),
        Kind::Svg if size <= MAX_SVG_BYTES => Some(ThumbSource::Svg(path)),
        _ => None,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Raster,
    Svg,
}

fn kind_of(path: &str) -> Option<Kind> {
    let ext = path.rsplit_once('.')?.1.to_ascii_lowercase();
    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "webp" => Some(Kind::Raster),
        "svg" => Some(Kind::Svg),
        _ => None,
    }
}

/// A path relative to a folder, with plain parts only: no `..`, no root, no drive, no backslash.
fn plain_relative(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 512
        && !path.starts_with('/')
        && !path.contains('\\')
        && !path.contains(':')
        && path.split('/').all(|part| {
            !part.is_empty() && part != "." && part != ".." && !part.chars().any(char::is_control)
        })
}

/// `path` when it is a file below `folder`, and `folder` one below `vault`, once every link is followed; `None`
/// otherwise. A meeting's folder that is a link out of the vault is no way to the files there.
fn inside(vault: &Path, folder: &Path, path: &Path) -> Option<PathBuf> {
    let vault = std::fs::canonicalize(vault).ok()?;
    let folder = std::fs::canonicalize(folder).ok()?;
    let path = std::fs::canonicalize(path).ok()?;
    (folder.starts_with(&vault) && path.starts_with(&folder) && path.is_file()).then_some(path)
}

/// Why no preview was made.
#[derive(Debug)]
pub enum ThumbError {
    /// The file is no picture this hub reads, or a broken one.
    NotAPicture,
    Io(std::io::Error),
}

/// The preview of a picture: at most [`THUMB_PX`] on its longer edge (a smaller one stays as it is), as PNG. Kept in
/// `cache` under the picture's path, size and time of change, so the same picture is made small once.
///
/// # Errors
///
/// [`ThumbError`] when the file cannot be read or is no picture.
pub fn thumb_png(source: &Path, cache: Option<&Path>) -> Result<Vec<u8>, ThumbError> {
    let meta = std::fs::metadata(source).map_err(ThumbError::Io)?;
    let changed = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_nanos());
    let key = hex(&Sha256::digest(
        format!("{}|{}|{changed}|{THUMB_PX}", source.display(), meta.len()).as_bytes(),
    ));
    let kept = cache.map(|dir| dir.join(format!("{key}.png")));
    if let Some(bytes) = kept.as_ref().and_then(|p| std::fs::read(p).ok()) {
        return Ok(bytes);
    }
    if meta.len() > MAX_RASTER_BYTES {
        return Err(ThumbError::NotAPicture);
    }
    let bytes = std::fs::read(source).map_err(ThumbError::Io)?;
    let png = make_small(&bytes)?;
    if let (Some(path), Some(dir)) = (&kept, cache) {
        let keep = || -> std::io::Result<()> {
            std::fs::create_dir_all(dir)?;
            let tmp = path.with_extension(format!("{}.tmp", std::process::id()));
            std::fs::write(&tmp, &png)?;
            std::fs::rename(&tmp, path)
        };
        match keep() {
            Ok(()) => prune(dir, MAX_THUMBS, path),
            Err(e) => eprintln!("note: a preview was not kept: {e}"),
        }
    }
    Ok(png)
}

/// Keep at most `max` previews in `dir`: the ones changed longest ago go first, never `newest` (the one just made).
/// Each changed picture leaves its old preview behind, so without this the cache would only grow.
fn prune(dir: &Path, max: usize, newest: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut kept: Vec<(std::time::SystemTime, PathBuf)> = entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "png") && p != newest)
        .filter_map(|p| Some((std::fs::metadata(&p).ok()?.modified().ok()?, p)))
        .collect();
    // `max` counts the newest one as well.
    let Some(over) = (kept.len() + 1).checked_sub(max).filter(|n| *n > 0) else {
        return;
    };
    kept.sort();
    for (_, path) in kept.into_iter().take(over) {
        let _ = std::fs::remove_file(path);
    }
}

/// `bytes` (PNG, JPEG or WebP, told by their first bytes, not by a name) made small and written as PNG.
fn make_small(bytes: &[u8]) -> Result<Vec<u8>, ThumbError> {
    let mut reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| ThumbError::NotAPicture)?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_EDGE);
    limits.max_image_height = Some(MAX_EDGE);
    limits.max_alloc = Some(MAX_DECODE_BYTES);
    reader.limits(limits);
    let picture = reader.decode().map_err(|_| ThumbError::NotAPicture)?;
    let small = if picture.width() > THUMB_PX || picture.height() > THUMB_PX {
        picture.thumbnail(THUMB_PX, THUMB_PX)
    } else {
        picture
    };
    let mut out = Cursor::new(Vec::new());
    small
        .write_to(&mut out, image::ImageFormat::Png)
        .map_err(|_| ThumbError::NotAPicture)?;
    Ok(out.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn vienna() -> TimeZone {
        TimeZone::get("Europe/Vienna").unwrap()
    }

    fn entry() -> Value {
        json!({
            "id": "work/sync-mit-rick-2026-11-24",
            "area": "work",
            "title": "Sync mit Rick: Tosca, Installation; Teil 1",
            "status": "planned",
            "date": "2026-11-24",
            "time": "14:00",
            "end": "15:00",
            "all_day": false,
            "starts_at": "2026-11-24T14:00",
            "ends_at": "2026-11-24T15:00",
            "location": "Raum 3.14",
            "online": "https://teams.microsoft.com/l/meetup-join/abc",
            "online_service": "teams",
            "summary": "Die Installation besprechen",
            "valid": true,
        })
    }

    fn people_json() -> Value {
        json!([
            { "n": 1, "name": "Rick \"R\" Sanchez", "email": "rick@example.org", "role": "Organisator", "present": false },
            { "n": 2, "name": "Morty", "email": "morty@example.org", "role": "optional", "present": false },
            { "n": 3, "name": "Ich", "present": true },
            { "n": 4, "name": "Bad", "email": "bad;x@example.org", "present": false },
        ])
    }

    fn invitation<'a>(
        entry: &'a Value,
        people: &'a Value,
        shown: Shown,
        internal_links: bool,
        zone: &'a TimeZone,
    ) -> Invitation<'a> {
        Invitation {
            uid: "tasks-vault:work/sync-mit-rick-2026-11-24",
            sequence: 3,
            now: "2026-11-19T17:00:00Z".parse().unwrap(),
            entry,
            participants: people,
            shown,
            internal_links,
            zone,
        }
    }

    fn parsed(ics: &str) -> icalendar::Calendar {
        ics.parse::<icalendar::Calendar>()
            .unwrap_or_else(|e| panic!("not iCalendar: {e}\n{ics}"))
    }

    fn event(cal: &icalendar::Calendar) -> &icalendar::Event {
        let events: Vec<_> = cal
            .components
            .iter()
            .filter_map(icalendar::CalendarComponent::as_event)
            .collect();
        assert_eq!(events.len(), 1, "{cal:?}");
        events[0]
    }

    fn prop<'a>(ev: &'a icalendar::Event, name: &str) -> Option<&'a str> {
        use icalendar::Component as _;
        ev.property_value(name)
    }

    fn all<'a>(ev: &'a icalendar::Event, name: &str) -> Vec<&'a icalendar::Property> {
        use icalendar::Component as _;
        ev.multi_properties()
            .get(name)
            .map(|v| v.iter().collect())
            .unwrap_or_default()
    }

    fn summary_of(ev: &icalendar::Event) -> String {
        use icalendar::Component as _;
        ev.get_summary().expect("SUMMARY").to_owned()
    }

    fn description_of(ev: &icalendar::Event) -> String {
        use icalendar::Component as _;
        ev.get_description().expect("DESCRIPTION").to_owned()
    }

    #[test]
    fn a_public_meeting_is_one_event_a_parser_reads_with_its_people() {
        let (e, p, z) = (entry(), people_json(), vienna());
        let ics = ics(&invitation(&e, &p, Shown::Public, false, &z)).unwrap();
        assert!(ics.ends_with("END:VCALENDAR\r\n"), "{ics}");
        assert!(
            ics.split("\r\n").all(|l| l.len() <= 75),
            "a line is longer than 75 octets:\n{ics}"
        );
        let cal = parsed(&ics);
        let ev = event(&cal);
        assert_eq!(
            prop(ev, "UID"),
            Some("tasks-vault:work/sync-mit-rick-2026-11-24")
        );
        assert_eq!(prop(ev, "SEQUENCE"), Some("3"));
        assert_eq!(prop(ev, "DTSTAMP"), Some("20261119T170000Z"));
        // 14:00 in Vienna in November is 13:00 UTC.
        assert_eq!(prop(ev, "DTSTART"), Some("20261124T130000Z"));
        assert_eq!(prop(ev, "DTEND"), Some("20261124T140000Z"));
        assert_eq!(summary_of(ev), "Sync mit Rick: Tosca, Installation; Teil 1");
        assert_eq!(prop(ev, "LOCATION"), Some("Raum 3.14"));
        assert_eq!(
            prop(ev, "URL"),
            Some("https://teams.microsoft.com/l/meetup-join/abc")
        );
        assert_eq!(prop(ev, "STATUS"), Some("CONFIRMED"));
        let description = description_of(ev);
        assert_eq!(
            description,
            "Die Installation besprechen\nMicrosoft Teams: https://teams.microsoft.com/l/meetup-join/abc"
        );
        assert_eq!(prop(ev, "ORGANIZER"), Some("mailto:rick@example.org"));
        assert!(
            ics.contains("ORGANIZER;CN=\"Rick R Sanchez\":mailto:rick@example.org"),
            "{ics}"
        );
        let attendees = all(ev, "ATTENDEE");
        assert_eq!(attendees.len(), 1, "{ics}");
        assert_eq!(attendees[0].value(), "mailto:morty@example.org");
        assert!(ics.contains("ROLE=OPT-PARTICIPANT"), "{ics}");
        assert!(
            !ics.contains("bad;x"),
            "an address that is not plain stays out:\n{ics}"
        );
    }

    #[test]
    fn an_internal_meeting_names_no_people_and_its_link_only_when_released() {
        let (e, p, z) = (entry(), people_json(), vienna());
        let ics = ics(&invitation(&e, &p, Shown::Internal, false, &z)).unwrap();
        let ev_cal = parsed(&ics);
        let ev = event(&ev_cal);
        assert!(prop(ev, "SUMMARY").is_some());
        assert_eq!(prop(ev, "LOCATION"), Some("Raum 3.14"));
        assert_eq!(prop(ev, "URL"), None);
        assert_eq!(prop(ev, "ORGANIZER"), None);
        assert!(all(ev, "ATTENDEE").is_empty());
        assert!(!ics.contains("teams.microsoft.com"), "{ics}");
        assert!(!ics.contains("example.org"), "{ics}");
        // The service is told, the address is not.
        assert!(ics.contains("Microsoft Teams"), "{ics}");
        let released = super::ics(&invitation(&e, &p, Shown::Internal, true, &z)).unwrap();
        let cal = parsed(&released);
        let ev = event(&cal);
        assert_eq!(
            prop(ev, "URL"),
            Some("https://teams.microsoft.com/l/meetup-join/abc")
        );
        assert_eq!(
            prop(ev, "ORGANIZER"),
            None,
            "the release is for the link alone"
        );
    }

    #[test]
    fn a_private_or_unclassified_meeting_gives_no_invitation() {
        let (e, p, z) = (entry(), people_json(), vienna());
        for shown in [Shown::Private, Shown::Unclassified] {
            assert_eq!(
                ics(&invitation(&e, &p, shown, true, &z)).unwrap_err(),
                IcsRefusal::NotReleased
            );
        }
    }

    #[test]
    fn an_all_day_meeting_ends_the_day_after_its_last_and_a_cancelled_one_says_so() {
        let mut e = entry();
        e["all_day"] = json!(true);
        e["starts_at"] = json!("2026-11-24");
        e["ends_at"] = json!("2026-11-25");
        e["status"] = json!("cancelled");
        let (p, z) = (json!([]), vienna());
        let ics = ics(&invitation(&e, &p, Shown::Public, false, &z)).unwrap();
        let cal = parsed(&ics);
        let ev = event(&cal);
        assert_eq!(prop(ev, "DTSTART"), Some("20261124"));
        assert_eq!(prop(ev, "DTEND"), Some("20261126"));
        assert!(ics.contains("DTSTART;VALUE=DATE:20261124\r\n"), "{ics}");
        assert_eq!(prop(ev, "STATUS"), Some("CANCELLED"));
    }

    #[test]
    fn the_zone_of_the_meeting_counts_over_the_zone_of_the_hub() {
        let mut e = entry();
        e["tz"] = json!("America/New_York");
        let (p, z) = (json!([]), vienna());
        let ics = ics(&invitation(&e, &p, Shown::Public, false, &z)).unwrap();
        let cal = parsed(&ics);
        // 14:00 in New York in November is 19:00 UTC.
        assert_eq!(prop(event(&cal), "DTSTART"), Some("20261124T190000Z"));
        e["tz"] = json!("Mars/Olympus");
        assert_eq!(
            super::ics(&invitation(&e, &p, Shown::Public, false, &z)).unwrap_err(),
            IcsRefusal::NoTime
        );
        let mut undated = entry();
        undated.as_object_mut().unwrap().remove("starts_at");
        assert_eq!(
            super::ics(&invitation(&undated, &p, Shown::Public, false, &z)).unwrap_err(),
            IcsRefusal::NoTime
        );
    }

    #[test]
    fn long_lines_are_folded_between_characters_and_unfold_to_the_text() {
        let mut e = entry();
        let title = "Längerer Titel mit Umlauten äöü "
            .repeat(8)
            .trim()
            .to_owned();
        e["title"] = json!(title);
        let (p, z) = (json!([]), vienna());
        let ics = ics(&invitation(&e, &p, Shown::Public, false, &z)).unwrap();
        assert!(ics.split("\r\n").all(|l| l.len() <= 75), "{ics}");
        assert!(ics.contains("\r\n "), "{ics}");
        let cal = parsed(&ics);
        assert_eq!(summary_of(event(&cal)), title);
    }

    #[test]
    fn text_values_escape_what_ends_them_and_drop_control_characters() {
        assert_eq!(
            text("a;b,c\\d\ne\u{7}f"),
            "a\\;b\\,c\\\\d\\ne".to_owned() + "f"
        );
    }

    #[test]
    fn the_sequence_grows_with_a_change_of_the_meeting_only_and_is_kept() {
        let dir = hub_testkit::scratch::Scratch::new("ics-sequence");
        let path = dir.join("ics-sequence.json");
        let mut e = entry();
        let first = stand_of(&e);
        {
            let mut s = Sequences::open(Some(path.clone()));
            assert_eq!(s.next("v:a/b", &first), 0);
            assert_eq!(s.next("v:a/b", &first), 0, "the same meeting again");
            e["summary"] = json!("another text is no change for a calendar");
            assert_eq!(s.next("v:a/b", &stand_of(&e)), 0);
            e["starts_at"] = json!("2026-11-24T15:00");
            assert_eq!(s.next("v:a/b", &stand_of(&e)), 1, "moved");
            assert_eq!(s.next("v:c/d", &first), 0, "another meeting counts alone");
        }
        let mut again = Sequences::open(Some(path));
        assert_eq!(again.next("v:a/b", &stand_of(&e)), 1, "kept over a start");
        e["status"] = json!("cancelled");
        assert_eq!(again.next("v:a/b", &stand_of(&e)), 2, "cancelled");
    }

    #[test]
    fn the_sequences_kept_are_bounded_and_the_oldest_go_first() {
        let mut s = Sequences::open(None);
        for i in 0..=MAX_SEQUENCES {
            s.next(&format!("v:a/m{i}"), "x");
        }
        assert_eq!(s.kept.len(), MAX_SEQUENCES);
        assert!(!s.kept.contains_key("v:a/m0"));
        assert!(s.kept.contains_key(&format!("v:a/m{MAX_SEQUENCES}")));
    }

    // ── preview ──

    fn png(w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbImage::from_pixel(w, h, image::Rgb([200, 30, 30]));
        let mut out = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(img)
            .write_to(&mut out, image::ImageFormat::Png)
            .unwrap();
        out.into_inner()
    }

    fn jpeg(w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbImage::from_pixel(w, h, image::Rgb([10, 120, 30]));
        let mut out = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(img)
            .write_to(&mut out, image::ImageFormat::Jpeg)
            .unwrap();
        out.into_inner()
    }

    fn size_of(png: &[u8]) -> (u32, u32) {
        let img = image::load_from_memory_with_format(png, image::ImageFormat::Png).unwrap();
        (img.width(), img.height())
    }

    /// A vault with a meeting in its folder form; returns the vault and the entry the engine would give.
    fn meeting_folder(dir: &Path) -> (PathBuf, Value) {
        let vault = dir.join("vault");
        let folder = vault.join("work/MEETINGS/m");
        std::fs::create_dir_all(folder.join("assets/images")).unwrap();
        std::fs::create_dir_all(folder.join("assets/boards")).unwrap();
        std::fs::write(folder.join("m.md"), "---\ntitle: m\n---\n").unwrap();
        let entry = json!({
            "id": "work/m",
            "file": "work/MEETINGS/m/m.md",
            "folder": true,
            "assets": [],
        });
        (vault, entry)
    }

    #[test]
    fn a_picture_is_made_96_pixels_on_its_longer_edge_and_kept_in_the_cache() {
        let dir = hub_testkit::scratch::Scratch::new("thumb-cache");
        let (vault, mut e) = meeting_folder(&dir);
        let source = vault.join("work/MEETINGS/m/assets/images/cover.jpg");
        std::fs::write(&source, jpeg(640, 320)).unwrap();
        e["image"] = json!("assets/images/cover.jpg");
        let Some(ThumbSource::Raster(path)) = thumb_source(&vault, &e) else {
            panic!("no picture");
        };
        let cache = dir.join("cache");
        let small = thumb_png(&path, Some(&cache)).unwrap();
        assert_eq!(size_of(&small), (96, 48));
        let kept: Vec<_> = std::fs::read_dir(&cache).unwrap().collect();
        assert_eq!(kept.len(), 1, "one preview in the cache");
        assert!(!cache.starts_with(&vault));
        // Asked again: from the cache (the picture itself is gone meanwhile, its stamp stays the same file's).
        assert_eq!(thumb_png(&path, Some(&cache)).unwrap(), small);
        // A small picture stays as small as it is.
        std::fs::write(&source, png(40, 20)).unwrap();
        let again = thumb_png(&path, Some(&cache)).unwrap();
        assert_eq!(size_of(&again), (40, 20), "a changed file is a new preview");
    }

    #[test]
    fn the_cache_keeps_at_most_its_bound_and_drops_the_oldest_first() {
        let dir = hub_testkit::scratch::Scratch::new("thumb-bound");
        let cache = dir.join("cache");
        std::fs::create_dir_all(&cache).unwrap();
        let long_ago =
            std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_000_000);
        for i in 0..MAX_THUMBS {
            let path = cache.join(format!("old{i:04}.png"));
            std::fs::write(&path, b"x").unwrap();
            let file = std::fs::File::options().write(true).open(&path).unwrap();
            file.set_modified(long_ago + std::time::Duration::from_secs(i as u64))
                .unwrap();
        }
        let source = dir.join("p.png");
        std::fs::write(&source, png(200, 100)).unwrap();
        thumb_png(&source, Some(&cache)).unwrap();
        let names: Vec<String> = std::fs::read_dir(&cache)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names.len(), MAX_THUMBS);
        assert!(
            !names.contains(&"old0000.png".to_owned()),
            "the oldest went"
        );
        assert!(names.contains(&"old0001.png".to_owned()));
        assert!(
            names.iter().any(|n| !n.starts_with("old")),
            "the new one is kept"
        );
    }

    #[test]
    fn cover_is_read_before_image_and_a_board_when_there_is_neither() {
        let dir = hub_testkit::scratch::Scratch::new("thumb-names");
        let (vault, mut e) = meeting_folder(&dir);
        let folder = vault.join("work/MEETINGS/m");
        std::fs::write(folder.join("assets/images/a.png"), png(10, 10)).unwrap();
        std::fs::write(folder.join("assets/images/b.png"), png(10, 10)).unwrap();
        std::fs::write(folder.join("assets/boards/z.svg"), "<svg/>").unwrap();
        std::fs::write(folder.join("assets/boards/y.png"), png(10, 10)).unwrap();
        e["assets"] = json!([
            "assets/boards/z.svg",
            "assets/boards/y.png",
            "assets/images/a.png"
        ]);
        let canon = |p: &str| std::fs::canonicalize(folder.join(p)).unwrap();
        assert_eq!(
            thumb_source(&vault, &e),
            Some(ThumbSource::Raster(canon("assets/boards/y.png"))),
            "a board's picture before its drawing"
        );
        e["assets"] = json!(["assets/boards/z.svg"]);
        assert_eq!(
            thumb_source(&vault, &e),
            Some(ThumbSource::Svg(canon("assets/boards/z.svg")))
        );
        e["image"] = json!("assets/images/a.png");
        assert_eq!(
            thumb_source(&vault, &e),
            Some(ThumbSource::Raster(canon("assets/images/a.png")))
        );
        e["cover"] = json!("assets/images/b.png");
        assert_eq!(
            thumb_source(&vault, &e),
            Some(ThumbSource::Raster(canon("assets/images/b.png")))
        );
    }

    #[test]
    fn nothing_outside_the_meeting_s_folder_is_read() {
        let dir = hub_testkit::scratch::Scratch::new("thumb-outside");
        let (vault, mut e) = meeting_folder(&dir);
        std::fs::write(vault.join("work/secret.png"), png(10, 10)).unwrap();
        std::fs::write(dir.join("outside.png"), png(10, 10)).unwrap();
        for bad in [
            "assets/../../secret.png",
            "assets/images/../../../secret.png",
            "/etc/passwd.png",
            "assets\\..\\..\\secret.png",
            "C:/outside.png",
            "assets/images/missing.png",
            "assets/images/note.txt",
        ] {
            e["cover"] = json!(bad);
            e["image"] = json!(bad);
            assert_eq!(thumb_source(&vault, &e), None, "{bad}");
        }
        let mut wrong_file = e.clone();
        wrong_file["cover"] = json!("assets/images/a.png");
        wrong_file["file"] = json!("../outside/m.md");
        assert_eq!(thumb_source(&vault, &wrong_file), None);
        let mut not_folder = e;
        not_folder["folder"] = json!(false);
        assert_eq!(thumb_source(&vault, &not_folder), None);
    }

    /// A link at `at` to `target` (a folder when `dir`); `false` where this system lets no one make one (Windows
    /// without developer mode).
    fn link(target: &Path, at: &Path, dir: bool) -> bool {
        #[cfg(unix)]
        let made = {
            let _ = dir;
            std::os::unix::fs::symlink(target, at)
        };
        #[cfg(windows)]
        let made = if dir {
            std::os::windows::fs::symlink_dir(target, at)
        } else {
            std::os::windows::fs::symlink_file(target, at)
        };
        made.is_ok()
    }

    #[test]
    fn a_link_out_of_the_folder_is_not_followed() {
        let dir = hub_testkit::scratch::Scratch::new("thumb-link");
        let (vault, mut e) = meeting_folder(&dir);
        std::fs::write(dir.join("outside.png"), png(10, 10)).unwrap();
        if !link(
            &dir.join("outside.png"),
            &vault.join("work/MEETINGS/m/assets/images/l.png"),
            false,
        ) {
            println!("n/a  this system makes no symbolic links");
            return;
        }
        e["cover"] = json!("assets/images/l.png");
        assert_eq!(thumb_source(&vault, &e), None);
    }

    #[test]
    fn a_meeting_folder_that_is_a_link_out_of_the_vault_is_not_read() {
        let dir = hub_testkit::scratch::Scratch::new("thumb-folder-link");
        let (vault, mut e) = meeting_folder(&dir);
        // The folder of the meeting lies outside the vault; the vault has only a link to it.
        let outside = dir.join("elsewhere");
        std::fs::create_dir_all(outside.join("assets/images")).unwrap();
        std::fs::write(outside.join("assets/images/c.png"), png(10, 10)).unwrap();
        std::fs::write(outside.join("l.md"), "---\ntitle: l\n---\n").unwrap();
        if !link(&outside, &vault.join("work/MEETINGS/l"), true) {
            println!("n/a  this system makes no symbolic links");
            return;
        }
        e["file"] = json!("work/MEETINGS/l/l.md");
        e["cover"] = json!("assets/images/c.png");
        assert_eq!(thumb_source(&vault, &e), None);
        // The same picture in a folder of the vault is read.
        let inside = vault.join("work/MEETINGS/m/assets/images/c.png");
        std::fs::write(&inside, png(10, 10)).unwrap();
        e["file"] = json!("work/MEETINGS/m/m.md");
        assert!(thumb_source(&vault, &e).is_some());
    }

    #[test]
    fn a_file_that_is_no_picture_is_refused_whatever_its_name() {
        let dir = hub_testkit::scratch::Scratch::new("thumb-bad");
        let path = dir.join("fake.png");
        std::fs::write(&path, b"<svg onload=alert(1)/>").unwrap();
        assert!(matches!(
            thumb_png(&path, None),
            Err(ThumbError::NotAPicture)
        ));
    }
}
