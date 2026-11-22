//! `POST /api/tasks/upload?id=<area>/<slug>`: a file from the page becomes an asset of the task.
//!
//! `kind=video|image|screenshot` puts it into the folder of its kind below `assets/` (the engine's `attach` with
//! `kind`); without it the asset lies in `assets/` itself. Another word is refused here: the folder is never the
//! page's to name.
//!
//! A paired phone attaches to an open task of a released area, and a photo or a voice note (`kind=image|audio`, nothing
//! else) to a meeting of a released area (`device_target`); a plan, a project or a learning path stays the PC's.
//!
//! The body is the file as it is, streamed to disk under a name the hub gives it, in a folder of the hub's own below its
//! configuration; the engine takes it from there (`from: upload`) and the hub removes it afterwards, whatever came of
//! it. The size is limited ([`MAX_UPLOAD_BYTES`], `413 too_large`, asked up front when the size is known and counted
//! while the body streams in) and so is the type: the ending of the name must be on the allow-list of its kind
//! ([`extension_allowed`], `415 unsupported_type`); the disk is asked for the room up front when the size is known.
//! The name the person sees travels in `X-Upload-Name`, percent-encoded; a name with a control character or a `..`
//! part is refused (`400 bad_name`, [`refused_name`]), any other is cleaned here to what the engine takes as an asset
//! name.

use std::io::Write as _;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use super::*;

/// A transfer that sends nothing for this long is over: the guard sets no time on this route.
const STALLED_AFTER: Duration = Duration::from_secs(60);
/// A file from this size on is refused by GitHub on a push: a vault that is a Git repository is told, not stopped.
const LARGE_FOR_GIT: u64 = 100 * 1024 * 1024;
/// The longest asset name: a file name has room for 255 bytes, and the slug's folder is in the path as well.
const MAX_NAME_BYTES: usize = 120;
/// The largest file one upload takes (ASVS 5.0 V5.2.1): a video of the camera fits, a disk image does not.
pub(super) const MAX_UPLOAD_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// A file left behind by a hub that was killed is gone after this long.
const LEFTOVER_AFTER: Duration = Duration::from_secs(24 * 60 * 60);

/// The file while it is on its way; it goes when this does, also when the request is abandoned.
struct Incoming {
    path: PathBuf,
}

impl Drop for Incoming {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// A file name the hub gives: unique here, and nothing of it comes from the page.
fn fresh_name() -> String {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis());
    format!(
        "u{millis}-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}

/// Percent-decoding of the name the page sends. What does not decode stays as it is; the name is cleaned afterwards.
fn percent_decoded(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = (bytes[i] == b'%')
            .then(|| text.get(i + 1..i + 3))
            .flatten()
            .and_then(|h| u8::from_str_radix(h, 16).ok());
        if let Some(byte) = hex {
            out.push(byte);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// A name the hub does not even clean: a control character (C0, DEL, C1: a NUL cuts a name short in some systems, a
/// newline splits a log line), a character that only formats text (a right-to-left override makes `gpj.exe` read as
/// `exe.jpg`), or a `..` part of a path. A plain separator is no reason (a client may send `C:\\dir\\file.txt`; the last
/// part is the name, see [`clean_name`]).
fn refused_name(name: &str) -> bool {
    let formatting = |c: char| {
        matches!(c,
            '\u{200b}'..='\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2060}'..='\u{2064}' | '\u{2066}'..='\u{2069}' | '\u{feff}')
    };
    name.chars().any(|c| c.is_control() || formatting(c))
        || name.split(['/', '\\']).any(|part| part == "..")
}

const IMAGES: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "avif", "heic", "heif", "bmp", "tif", "tiff", "svg",
];
const SCREENSHOTS: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp"];
const VIDEOS: &[&str] = &["mp4", "m4v", "mov", "webm", "mkv", "avi", "ogv", "3gp"];
const AUDIOS: &[&str] = &[
    "m4a", "mp3", "aac", "ogg", "oga", "opus", "wav", "flac", "weba", "webm", "mp4", "3gp", "amr",
];
/// Documents, data and archives a person attaches to a task. Nothing a system runs when it is opened (`exe`, `bat`,
/// `cmd`, `com`, `scr`, `msi`, `ps1`, `vbs`, `jar`, `lnk`, `sh`, `apk`, `dll`) and nothing a browser runs (`html`, `htm`,
/// `xhtml`, `js`, `mjs`): they are not on any list, so they are refused.
const DOCUMENTS: &[&str] = &[
    "pdf", "txt", "md", "markdown", "log", "csv", "tsv", "json", "jsonl", "yaml", "yml", "toml",
    "xml", "ini", "conf", "diff", "patch", "sql", "ics", "vcf", "eml", "rtf", "odt", "ods", "odp",
    "doc", "docx", "xls", "xlsx", "ppt", "pptx", "zip", "gz", "tgz", "tar", "7z",
];

/// Is the ending of the (cleaned) `name` one the hub takes? With a `kind` the ending must be one of that kind's (a
/// `.pdf` is no `image`); without, one of the documents or of any kind. A name with no ending is refused.
fn extension_allowed(name: &str, kind: Option<&str>) -> bool {
    let Some((_, ext)) = name.rsplit_once('.') else {
        return false;
    };
    let ext = ext.to_ascii_lowercase();
    let ext = ext.as_str();
    match kind {
        Some("image") => IMAGES.contains(&ext),
        Some("screenshot") => SCREENSHOTS.contains(&ext),
        Some("video") => VIDEOS.contains(&ext),
        Some("audio") => AUDIOS.contains(&ext),
        _ => [DOCUMENTS, IMAGES, VIDEOS, AUDIOS]
            .iter()
            .any(|list| list.contains(&ext)),
    }
}

fn too_large() -> Response {
    error_body(
        StatusCode::PAYLOAD_TOO_LARGE,
        "too_large",
        "the file is larger than the hub takes",
    )
}

/// What the engine takes as an asset name: the last part of a path, letters and digits of any language and `_ . -`, no
/// `..`, starting with a letter, a digit or `_`, not ending in a dot. Nothing left of it: `upload`.
fn clean_name(name: &str) -> String {
    let cleaned = clean_chars(name);
    // `nul` and its like are devices on Windows, whatever comes after the first dot: the engine refuses them.
    let device = cleaned.split('.').next().unwrap_or("").to_ascii_lowercase();
    let numbered = device
        .strip_prefix("com")
        .or_else(|| device.strip_prefix("lpt"))
        .is_some_and(|n| n.len() == 1 && n.as_bytes()[0].is_ascii_digit());
    if numbered || matches!(device.as_str(), "con" | "prn" | "aux" | "nul") {
        return format!("_{cleaned}");
    }
    cleaned
}

fn clean_chars(name: &str) -> String {
    let last = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let mut out = String::new();
    for c in last.trim().chars() {
        let keep = c.is_alphanumeric() || matches!(c, '_' | '.' | '-');
        let c = if keep { c } else { '-' };
        // Two dots in a row are what the engine refuses, and they say nothing in a name.
        if c == '.' && out.ends_with('.') {
            continue;
        }
        out.push(c);
    }
    let out = out.trim_start_matches(['.', '-']).trim_end_matches('.');
    let mut short = String::new();
    // The end stays: it is the kind of the file.
    let (stem, ext) = match out.rsplit_once('.') {
        Some((stem, ext)) if ext.len() <= 16 && !stem.is_empty() => (stem, Some(ext)),
        _ => (out, None),
    };
    let room = MAX_NAME_BYTES - ext.map_or(0, |e| e.len() + 1);
    for c in stem.chars() {
        if short.len() + c.len_utf8() > room {
            break;
        }
        short.push(c);
    }
    let short = short.trim_end_matches('.');
    if short.is_empty() {
        return "upload".to_owned();
    }
    match ext {
        Some(ext) => format!("{short}.{ext}"),
        None => short.to_owned(),
    }
}

/// Remove what a hub that was killed left in the folder.
pub(super) fn sweep_leftovers(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|at| at.elapsed().ok())
            .is_some_and(|age| age > LEFTOVER_AFTER);
        if old {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

fn too_little_room() -> Response {
    error_body(
        StatusCode::INSUFFICIENT_STORAGE,
        "disk_full",
        "there is no room for the file on the disk of the hub",
    )
}

/// The file in the hub's folder, written as it arrives. With a known size the room is taken first, so that a disk that
/// is too small says so before the transfer.
#[allow(clippy::result_large_err)]
async fn receive(
    dir: PathBuf,
    size: Option<u64>,
    max: u64,
    body: Body,
) -> Result<(Incoming, u64), Response> {
    let failed = |e: std::io::Error| {
        if e.kind() == std::io::ErrorKind::StorageFull {
            too_little_room()
        } else {
            eprintln!("upload: {e}");
            error_body(
                StatusCode::INTERNAL_SERVER_ERROR,
                "upload_failed",
                "the file could not be written",
            )
        }
    };
    let (mut file, incoming) = tokio::task::spawn_blocking(move || {
        std::fs::create_dir_all(&dir)?;
        let path = dir.join(fresh_name());
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)?;
        let incoming = Incoming { path };
        if let Some(size) = size {
            file.set_len(size)?;
        }
        Ok::<_, std::io::Error>((file, incoming))
    })
    .await
    .map_err(|_| too_little_room())?
    .map_err(failed)?;

    let mut stream = body.into_data_stream();
    let mut written = 0u64;
    loop {
        let next = std::future::poll_fn(|cx| Pin::new(&mut stream).poll_next(cx));
        let chunk = match tokio::time::timeout(STALLED_AFTER, next).await {
            Err(_) => {
                return Err(error_body(
                    StatusCode::REQUEST_TIMEOUT,
                    "upload_stalled",
                    "the transfer stopped",
                ));
            }
            Ok(None) => break,
            Ok(Some(Err(_))) => {
                return Err(error_body(
                    StatusCode::BAD_REQUEST,
                    "upload_broken",
                    "the transfer broke off",
                ));
            }
            Ok(Some(Ok(chunk))) => chunk,
        };
        written += chunk.len() as u64;
        // A body without a size, or with a false one, is counted as it comes: it stops at the limit.
        if written > max {
            return Err(too_large());
        }
        file = tokio::task::spawn_blocking(move || file.write_all(&chunk).map(|()| file))
            .await
            .map_err(|_| too_little_room())?
            .map_err(failed)?;
    }
    // Fewer bytes than were announced is a transfer that broke off, whatever the connection says.
    if size.is_some_and(|s| s != written) {
        return Err(error_body(
            StatusCode::BAD_REQUEST,
            "upload_broken",
            "the transfer broke off",
        ));
    }
    tokio::task::spawn_blocking(move || file.flush())
        .await
        .map_err(|_| too_little_room())?
        .map_err(failed)?;
    Ok((incoming, written))
}

/// The kinds of an asset the engine has a folder for (`attach` with `kind`): `audio` since tasks.nvim@53c694e (a
/// recording of a meeting, `assets/audio/`). `board` is not one: a board is saved with `board_save`, never uploaded.
const KINDS: [&str; 4] = ["video", "image", "screenshot", "audio"];

/// The kind the page asked for: none, one of [`KINDS`], or `Err` for another word.
fn asked_kind(value: Option<&str>) -> Result<Option<&'static str>, ()> {
    match value {
        None => Ok(None),
        Some(word) => KINDS
            .iter()
            .find(|kind| **kind == word)
            .map(|kind| Some(*kind))
            .ok_or(()),
    }
}

/// The `attach` of an upload; `exact` and `kind` only when asked (an engine before them would not know the keys).
fn attach_op(
    id: &str,
    upload: &str,
    name: &str,
    exact: bool,
    kind: Option<&str>,
) -> serde_json::Value {
    let mut op =
        json!({ "op": "attach", "id": id, "from": "upload", "upload": upload, "name": name });
    if exact {
        op["exact"] = json!(true);
    }
    if let Some(kind) = kind {
        op["kind"] = json!(kind);
    }
    op
}

/// For a phone: is there no open task under `id`? The engine's `attach` takes a plan, a project, a learning path or a
/// meeting of that name when no open task has it; of those only a meeting is released for devices, and only for a photo
/// or a voice note (`device_target`). The engine's `not_found` for the task is `true`; any other failure is the answer
/// to send (fail closed).
// The error is the answer to send, as everywhere in this file: a response is large, and rare.
#[allow(clippy::result_large_err)]
async fn no_open_task(st: &Shared, id: &str) -> Result<bool, Response> {
    match ask_as(st, true, Calls::Task, Some(&json!({ "id": id }))).await {
        Ok(_) => Ok(false),
        Err(response) if response.status() == StatusCode::NOT_FOUND => Ok(true),
        Err(response) => Err(response),
    }
}

/// What a phone attaches to under `id`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DeviceTarget {
    /// An open task: any kind.
    Task,
    /// A meeting, with a photo or a voice note (`kind=image|audio`).
    Meeting,
    /// Anything else the engine's `attach` would take (a plan, a project, a learning path, a meeting with another kind),
    /// or nothing: refused, or left to the engine's own `not_found`.
    Other,
}

/// The kinds a phone may attach to a meeting: a photo and a voice note of the minutes.
fn kind_for_meeting(kind: Option<&str>) -> bool {
    matches!(kind, Some("image" | "audio"))
}

/// For a phone: what `id` names, asked of the engine (fail closed: a failure is the answer to send). A meeting counts
/// only for a photo or a voice note; the meeting is not asked of for another kind.
#[allow(clippy::result_large_err)]
async fn device_target(
    st: &Shared,
    id: &str,
    kind: Option<&str>,
) -> Result<DeviceTarget, Response> {
    if !no_open_task(st, id).await? {
        return Ok(DeviceTarget::Task);
    }
    if kind_for_meeting(kind) && super::meetings::is_meeting(st, id).await? {
        return Ok(DeviceTarget::Meeting);
    }
    Ok(DeviceTarget::Other)
}

pub(super) async fn upload(
    State(st): State<Arc<Shared>>,
    caller: Option<axum::Extension<Caller>>,
    RawQuery(query): RawQuery,
    headers: HeaderMap,
    body: Body,
) -> Response {
    let params = match parse_query(query.as_deref(), &["id", "exact", "kind"]) {
        Ok(p) => p,
        Err(why) => return error_body(StatusCode::BAD_REQUEST, "bad_query", why),
    };
    // `exact=1`: a name the task already has is `exists`, not a second asset under a counter. Asked by a client that
    // sends a file again when the answer was lost (the queue of the phone page); the desktop page keeps the counter.
    let exact = match params.get("exact").map(String::as_str) {
        None | Some("0") => false,
        Some("1") => true,
        Some(_) => return error_body(StatusCode::BAD_REQUEST, "bad_query", "exact is 0 or 1"),
    };
    let Ok(kind) = asked_kind(params.get("kind").map(String::as_str)) else {
        return error_body(
            StatusCode::BAD_REQUEST,
            "bad_query",
            "kind is video, image, screenshot or audio",
        );
    };
    let Some(id) = params.get("id").filter(|id| valid_task_id(id)).cloned() else {
        return error_body(
            StatusCode::BAD_REQUEST,
            "bad_id",
            "id must be <area>/<slug>",
        );
    };
    let rt = st.rt();
    let device = is_device(caller.as_deref());
    // A phone attaches only to a task of a released area (MOB-02); another is not there for it.
    if device && !device_cut::released_id(&rt.classes, &id) {
        return not_found();
    }
    let Some(dir) = rt.upload_dir.as_deref().cloned() else {
        return error_body(
            StatusCode::NOT_FOUND,
            "not_available",
            "this hub takes no files",
        );
    };
    let Ok(Some(raw_name)) = single(&headers, &UPLOAD_NAME) else {
        return error_body(
            StatusCode::BAD_REQUEST,
            "bad_name",
            "X-Upload-Name names the file",
        );
    };
    let decoded = percent_decoded(&raw_name);
    if refused_name(&decoded) {
        return error_body(
            StatusCode::BAD_REQUEST,
            "bad_name",
            "the name has a control character or a .. part",
        );
    }
    let name = clean_name(&decoded);
    if !extension_allowed(&name, kind) {
        return error_body(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "unsupported_type",
            "the hub takes no file of this type here",
        );
    }
    let size = match single(&headers, &header::CONTENT_LENGTH) {
        Ok(Some(text)) => text.parse::<u64>().ok(),
        _ => None,
    };
    if size.is_some_and(|size| size > MAX_UPLOAD_BYTES) {
        return too_large();
    }
    if !st.post_limit.allow() {
        return too_many();
    }
    // A phone attaches to a task, or a photo or a voice note to a meeting, nothing else (`device_target`): for anything
    // else the dry run below tells "nothing there" (its refusal, as before) from "there, but not for a phone"
    // (`not_for_devices`), before any byte of the file is taken. Asked behind the limit of writes, so a flood of uploads
    // costs the engine nothing.
    let target = if device {
        match device_target(&st, &id, kind).await {
            Ok(target) => Some(target),
            Err(response) => return response,
        }
    } else {
        None
    };
    // Asked before the transfer: a task that is gone or read-only should not cost the whole file first. Nothing is read
    // in a dry run, so the file need not be there yet.
    let look = json!({
        "dry_run": true,
        "ops": [attach_op(&id, "pending", &name, exact, kind)],
        "upload_dir": dir.to_string_lossy(),
    });
    let refused = match ask_as(&st, device, Calls::Ops, Some(&look)).await {
        Ok(reply) => {
            let doc = serde_json::from_str::<serde_json::Value>(&reply.text).ok();
            let good = doc.is_some_and(|d| d["results"][0]["ok"] == serde_json::Value::Bool(true));
            (!good).then_some(reply.text)
        }
        Err(response) => return response,
    };
    if let Some(text) = refused {
        if device {
            return device_result(&st, &text, &[]);
        }
        return json_response(StatusCode::OK, text, None);
    }
    if target == Some(DeviceTarget::Other) {
        return error_body(
            StatusCode::FORBIDDEN,
            "not_for_devices",
            "a phone attaches only to a task, and a photo or a voice note to a meeting",
        );
    }
    let (incoming, written) = match receive(dir.clone(), size, MAX_UPLOAD_BYTES, body).await {
        Ok(done) => done,
        Err(response) => return response,
    };
    // The file was meant for the vault that was read when it was sent.
    if st.rt().vault != rt.vault {
        return error_body(
            StatusCode::CONFLICT,
            "vault_changed",
            "another vault was chosen while the file was on its way: nothing was attached",
        );
    }
    // The transfer may have taken minutes: a task finished meanwhile leaves its id to a plan or meeting of that name, a
    // meeting gone meanwhile to a plan or a task. What the phone attaches to must be what it was asked for.
    if let Some(asked) = target {
        match device_target(&st, &id, kind).await {
            Ok(now) if now == asked => {}
            Ok(_) => {
                return error_body(
                    StatusCode::NOT_FOUND,
                    "not_found",
                    "the task is no longer open: nothing was attached",
                )
            }
            Err(response) => return response,
        }
    }
    let Some(file_name) = incoming.path.file_name().and_then(|n| n.to_str()) else {
        return error_body(
            StatusCode::INTERNAL_SERVER_ERROR,
            "upload_failed",
            "the file could not be written",
        );
    };
    let request = json!({
        "ops": [attach_op(&id, file_name, &name, exact, kind)],
        "upload_dir": dir.to_string_lossy(),
    });
    // A large file takes its time to copy, longer than the engine of the page may take for a question, and the page must
    // not wait for it: it goes to an engine process of its own.
    let answered = match &rt.upload_engine {
        Some(engine) => match engine().await {
            Ok(engine) => engine
                .call(Calls::Ops, Some(&request))
                .await
                .map_err(|e| engine_failure(if device { quiet_for_device(e) } else { e })),
            Err(why) => {
                eprintln!("upload: {why}");
                Err(error_body(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "engine_unavailable",
                    "the engine is not ready",
                ))
            }
        },
        None => ask_as(&st, device, Calls::Ops, Some(&request)).await,
    };
    let reply = match answered {
        Ok(reply) => reply,
        Err(response) => {
            st.rt().store.request_rescan();
            return response;
        }
    };
    drop(incoming);
    settle_write(&st, &reply.text).await;
    // A phone is told what became of its file, in the words of `tasks.result` it may know (MOB-02).
    if device {
        return device_result(&st, &reply.text, &[]);
    }
    let large_for_git = written >= LARGE_FOR_GIT
        && rt
            .vault
            .as_ref()
            .is_some_and(|vault| vault.join(".git").exists());
    if !large_for_git {
        return json_response(StatusCode::OK, reply.text, None);
    }
    let mut doc: serde_json::Value = match serde_json::from_str(&reply.text) {
        Ok(doc) => doc,
        Err(_) => return json_response(StatusCode::OK, reply.text, None),
    };
    doc["large_for_git"] = serde_json::Value::Bool(true);
    json_response(StatusCode::OK, doc.to_string(), None)
}

/// The header with the name of the file.
static UPLOAD_NAME: header::HeaderName = header::HeaderName::from_static("x-upload-name");

#[cfg(test)]
mod tests {
    use super::{
        asked_kind, attach_op, clean_name, extension_allowed, kind_for_meeting, percent_decoded,
        receive, refused_name,
    };

    #[test]
    fn a_name_with_a_control_character_or_a_way_up_is_refused() {
        for bad in [
            "a\0.png",
            "a\n.png",
            "a\r\nX: y.png",
            "a\u{7f}.png",
            "a\u{85}.png",
            "a\u{202e}gpj.exe",
            "../x.png",
            "a/../x.png",
            "..\\x.png",
            "..",
            "a\tb.png",
        ] {
            assert!(refused_name(bad), "{bad:?}");
        }
        for good in [
            "a.png",
            "C:\\dir\\a.png",
            "/tmp/a.png",
            "Übersicht.md",
            "a..b.txt",
            ".hidden",
        ] {
            assert!(!refused_name(good), "{good:?}");
        }
        // The percent-encoded form is judged after it is decoded.
        assert!(refused_name(&percent_decoded("a%00.png")));
        assert!(refused_name(&percent_decoded("%2e%2e%2fx.png")));
    }

    #[test]
    fn the_ending_of_a_name_is_on_the_list_of_its_kind() {
        for (name, kind) in [
            ("a.pdf", None),
            ("A.PDF", None),
            ("a.png", None),
            ("a.m4a", None),
            ("a.png", Some("image")),
            ("a.png", Some("screenshot")),
            ("a.webm", Some("video")),
            ("a.webm", Some("audio")),
            ("a.m4a", Some("audio")),
            ("a.tar.gz", None),
        ] {
            assert!(extension_allowed(name, kind), "{name} {kind:?}");
        }
        for (name, kind) in [
            ("a.exe", None),
            ("a.bat", None),
            ("a.ps1", None),
            ("a.html", None),
            ("a.htm", None),
            ("a.js", None),
            ("a.sh", None),
            ("a.lnk", None),
            ("a.dll", None),
            ("noending", None),
            ("upload", None),
            ("a.exe", Some("image")),
            ("a.pdf", Some("image")),
            ("a.svg", Some("screenshot")),
            ("a.mp4", Some("image")),
            ("a.png", Some("audio")),
            ("a.png", Some("video")),
            ("a.pdf", Some("audio")),
        ] {
            assert!(!extension_allowed(name, kind), "{name} {kind:?}");
        }
    }

    /// A body that sends more than the limit is stopped, whatever its header says (here: none).
    #[tokio::test]
    async fn a_body_over_the_limit_is_stopped_as_it_comes() {
        let dir = std::env::temp_dir().join(format!("upload-limit-{}", std::process::id()));
        let body = axum::body::Body::from(vec![0u8; 100]);
        let over = receive(dir.clone(), None, 99, body).await;
        assert_eq!(over.err().map(|r| r.status().as_u16()), Some(413));
        let body = axum::body::Body::from(vec![0u8; 100]);
        let exact = receive(dir.clone(), None, 100, body).await;
        assert_eq!(exact.ok().map(|(_, n)| n), Some(100));
        let left = std::fs::read_dir(&dir).map_or(0, Iterator::count);
        assert_eq!(left, 0, "a file that was refused or dropped is gone");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_meeting_takes_from_a_phone_a_photo_and_a_voice_note_only() {
        assert!(kind_for_meeting(Some("image")));
        assert!(kind_for_meeting(Some("audio")));
        for other in [
            None,
            Some("video"),
            Some("screenshot"),
            Some("board"),
            Some(""),
        ] {
            assert!(!kind_for_meeting(other), "{other:?}");
        }
    }

    #[test]
    fn a_kind_is_one_of_the_engines_or_refused() {
        assert_eq!(asked_kind(None), Ok(None));
        for kind in ["video", "image", "screenshot", "audio"] {
            assert_eq!(asked_kind(Some(kind)), Ok(Some(kind)));
        }
        for other in [
            "", "videos", "Video", "../x", "assets", "file", "board", "audios",
        ] {
            assert_eq!(asked_kind(Some(other)), Err(()), "{other:?}");
        }
    }

    #[test]
    fn the_op_names_a_kind_only_when_one_was_asked() {
        let plain = attach_op("a/b", "u1", "x.bin", false, None);
        assert!(plain.get("kind").is_none() && plain.get("exact").is_none());
        let video = attach_op("a/b", "u1", "x.webm", true, Some("video"));
        assert_eq!(video["kind"], "video");
        assert_eq!(video["exact"], true);
    }

    #[test]
    fn a_name_is_what_the_engine_takes_as_an_asset() {
        assert_eq!(clean_name("report.pdf"), "report.pdf");
        assert_eq!(clean_name("My Report (2).pdf"), "My-Report--2-.pdf");
        assert_eq!(clean_name(r"C:\Users\me\secret.txt"), "secret.txt");
        assert_eq!(clean_name("../../etc/passwd"), "passwd");
        assert_eq!(clean_name("..hidden"), "hidden");
        assert_eq!(clean_name("a..b.txt"), "a.b.txt");
        assert_eq!(clean_name("trailing."), "trailing");
        assert_eq!(clean_name("Übersicht.md"), "Übersicht.md");
        assert_eq!(clean_name("a\u{85}b"), "a-b");
        for device in ["aux.h", "NUL", "con", "COM1.txt", "lpt9"] {
            assert_eq!(clean_name(device), format!("_{device}"));
        }
        assert_eq!(clean_name("console.log"), "console.log");
        assert_eq!(clean_name("com10.txt"), "com10.txt");
        for nothing in ["", "...", "---", "/", " "] {
            assert_eq!(clean_name(nothing), "upload", "{nothing:?}");
        }
        let long = format!("{}.tar", "x".repeat(400));
        let short = clean_name(&long);
        assert!(short.len() <= 120, "{}", short.len());
        assert!(short.ends_with(".tar"));
    }

    #[test]
    fn a_name_comes_percent_encoded() {
        assert_eq!(percent_decoded("a%20b.txt"), "a b.txt");
        assert_eq!(percent_decoded("%C3%9Cbersicht.md"), "Übersicht.md");
        assert_eq!(percent_decoded("100%"), "100%");
        assert_eq!(percent_decoded("%zz"), "%zz");
    }
}
