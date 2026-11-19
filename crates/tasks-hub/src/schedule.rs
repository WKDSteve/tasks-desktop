//! The scheduler of the hub (concept "Meetings" 4.7, decision F7): one planner for the notices that are due at a time,
//! the ones before a meeting begins (its `notify`, or the default of the vault), the one after a meeting ended
//! ("enter the result or finish it?") and the reminders of tasks that name a time of day (`remind` with `remind_at`).
//! The reminders without a time stay in the one notice of the day (`crate::notices`).
//!
//! This module only says what is due when, and remembers what was sent; the job of the runtime (`server::schedule`)
//! reads the snapshot and the meetings, asks [`plan`], keeps only what [`Memory::take`] hands out and sends it.
//!
//! **Time.** The engine says the times as they are written (`starts_at` as `YYYY-MM-DDTHH:MM`, `tz` an IANA name or
//! none); it knows no zone. Here a written time becomes an instant: in the zone of the meeting when it names one, else
//! in the zone of the hub (the system's, like `remind_at`). A time the clock skips (02:30 on the day the clocks go
//! forward) is the instant after the gap (03:30), a time the clock shows twice (02:30 on the day they go back) is the
//! first (jiff's "compatible" rule, as RFC 5545 and Temporal do). `-15m` is fifteen real minutes before the instant;
//! `-1d@18:00` is 18:00 on the day before, in the zone of the meeting.
//!
//! **Due.** A notice before a meeting is due from its time on until the meeting begins: one that was missed (the hub
//! was off) is sent late, as long as the meeting has not begun, else dropped. Of several missed ones of a meeting only
//! the latest goes (the others are only marked). The notice after the end is due for [`AFTER_END_FOR`] after the end
//! of a planned meeting with a time (an all-day meeting gets none). A reminder at a time is due from that time until
//! the end of its day. Only a `planned` meeting tells anything: `cancelled` and `done` tell nothing.
//!
//! **Memory.** What was sent is kept outside the vault (`schedule.json` in the settings folder of the hub), per vault,
//! as keys of `kind | id | the meeting's time as written | the instant`: a meeting that is moved has other keys and so
//! gets its notices at the new times; the same notice is never sent twice, also not after a restart. Keys long past
//! are forgotten.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use jiff::civil::{Date, DateTime, Time};
use jiff::tz::TimeZone;
use jiff::{SignedDuration, Timestamp};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::classes::Shown;
use crate::mail::{Lang, Message};

/// The kind of the notice before a meeting (the phone subscribes to it by this name).
pub const MEETING: &str = "meeting";
/// The kind of the notice after a meeting ended.
pub const MEETING_END: &str = "meeting_end";
/// The kind of a reminder at a time of day: the kind of the day's reminders, here with the id of the task.
pub const REMIND: &str = crate::notices::REMIND;

/// The most entries of a `notify` list (the engine's limit).
pub const MAX_NOTIFY: usize = 5;
/// The most days a notice may be before its meeting (the engine's limit).
pub const MAX_NOTIFY_DAYS: i64 = 30;
/// The notices of a meeting with a time that names none, when the settings name none.
pub const DEFAULT_NOTIFY: &[&str] = &["-15m"];
/// How long after the end of a meeting the question after it may still go out.
pub const AFTER_END_FOR: SignedDuration = SignedDuration::from_hours(12);
/// How long a key of a sent notice is kept after its instant: longer than any notice may be before its meeting.
const KEEP_FOR: SignedDuration = SignedDuration::from_hours(24 * (MAX_NOTIFY_DAYS + 10));
/// The most keys kept per vault; beyond it the oldest go.
const MAX_KEYS: usize = 10_000;

/// One entry of `notify`: minutes before the beginning, or a time of day some days before (0: the day itself).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Notify {
    Before { minutes: i64 },
    DayAt { days: i64, at: Time },
}

/// Read one entry as the settings name it (`-15m`, `-2h`, `-1d@18:00`, `-0d@08:00`), with the engine's rules: `None`
/// for anything else.
#[must_use]
pub fn parse_notify(spec: &str) -> Option<Notify> {
    let spec = spec.trim().to_ascii_lowercase();
    let rest = spec.strip_prefix('-')?;
    if let Some((days, at)) = rest.split_once("d@") {
        let days = number(days)?;
        let at = time_of(at)?;
        return (days <= MAX_NOTIFY_DAYS).then_some(Notify::DayAt { days, at });
    }
    let (n, unit) = rest.split_at(rest.len().checked_sub(1)?);
    let minutes = number(n)?.checked_mul(match unit {
        "m" => 1,
        "h" => 60,
        _ => return None,
    })?;
    (1..=MAX_NOTIFY_DAYS * 24 * 60)
        .contains(&minutes)
        .then_some(Notify::Before { minutes })
}

/// A list of entries as the settings name it: `None` when one of them is none or there are more than [`MAX_NOTIFY`].
#[must_use]
pub fn parse_notify_list(specs: &[String]) -> Option<Vec<Notify>> {
    if specs.len() > MAX_NOTIFY {
        return None;
    }
    specs.iter().map(|s| parse_notify(s)).collect()
}

fn number(text: &str) -> Option<i64> {
    (!text.is_empty() && text.len() <= 6 && text.bytes().all(|b| b.is_ascii_digit()))
        .then(|| text.parse().ok())
        .flatten()
}

/// `HH:MM` as a time of day.
fn time_of(text: &str) -> Option<Time> {
    if !crate::notices::valid_time(text) {
        return None;
    }
    let (h, m) = text.split_once(':')?;
    Time::new(h.parse().ok()?, m.parse().ok()?, 0, 0).ok()
}

/// `YYYY-MM-DD` as a day.
fn day_of(text: &str) -> Option<Date> {
    let b = text.as_bytes();
    let plain = b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && [0, 1, 2, 3, 5, 6, 8, 9]
            .iter()
            .all(|&i| b[i].is_ascii_digit());
    if !plain {
        return None;
    }
    Date::new(
        text[..4].parse().ok()?,
        text[5..7].parse().ok()?,
        text[8..].parse().ok()?,
    )
    .ok()
}

/// `YYYY-MM-DDTHH:MM` as a wall time.
fn wall_of(text: &str) -> Option<DateTime> {
    let (day, time) = text.split_once('T')?;
    Some(day_of(day)?.to_datetime(time_of(time)?))
}

/// The instant of a wall time in `zone`: after a gap for a time the clock skips, the first for one it shows twice.
fn instant(wall: DateTime, zone: &TimeZone) -> Option<Timestamp> {
    zone.to_ambiguous_timestamp(wall).compatible().ok()
}

/// When a meeting begins as written.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Start {
    At(DateTime),
    AllDay(Date),
}

/// A meeting as the scheduler needs it, read from an entry of `tasks.meetings`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Meeting {
    pub id: String,
    pub area: String,
    pub title: String,
    /// `status: planned` and a valid file: only such a meeting tells anything.
    pub planned: bool,
    pub start: Start,
    /// The end as written (a meeting with a time).
    pub end: Option<DateTime>,
    /// The zone the times are written in, as written; none: the hub's.
    pub tz: Option<String>,
    /// The meeting's own notices; empty: the default of the vault.
    pub notify: Vec<Notify>,
    pub notify_to: Vec<String>,
    pub location: Option<String>,
    pub online: Option<String>,
    pub online_service: Option<String>,
    /// The meeting's time as written (`starts_at`, `ends_at`, `tz`): part of the keys of what was sent.
    stand: String,
}

/// A reminder of a task at a time of day (`remind` and `remind_at`), open or finished.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reminder {
    pub id: String,
    pub area: String,
    pub title: String,
    pub day: Date,
    pub at: Time,
    pub to: Vec<String>,
}

/// What the scheduler plans with.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Inputs {
    pub meetings: Vec<Meeting>,
    pub reminders: Vec<Reminder>,
}

fn text(v: &Value, key: &str) -> Option<String> {
    v[key].as_str().map(str::to_owned)
}

fn addresses(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|list| {
            list.iter()
                .filter_map(Value::as_str)
                .filter(|a| crate::mail::valid_address(a))
                .take(10)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

/// The area of an entry: its `area`, else the first part of its id.
fn area_of(v: &Value, id: &str) -> String {
    text(v, "area")
        .or_else(|| id.split_once('/').map(|(a, _)| a.to_owned()))
        .unwrap_or_default()
}

/// One entry of `notify` as the engine normalised it (`{ spec, before_min }` or `{ spec, days_before, at }`).
fn notify_entry(v: &Value) -> Option<Notify> {
    if let Some(minutes) = v["before_min"].as_i64() {
        return (1..=MAX_NOTIFY_DAYS * 24 * 60)
            .contains(&minutes)
            .then_some(Notify::Before { minutes });
    }
    let days = v["days_before"].as_i64()?;
    let at = time_of(v["at"].as_str()?)?;
    (0..=MAX_NOTIFY_DAYS)
        .contains(&days)
        .then_some(Notify::DayAt { days, at })
}

/// A meeting entry of `tasks.meetings`; `None` for one without an id or a time the scheduler can read.
#[must_use]
pub fn meeting_of(v: &Value) -> Option<Meeting> {
    let id = text(v, "id")?;
    let starts_at = v["starts_at"].as_str()?;
    let all_day = v["all_day"].as_bool() == Some(true);
    let start = if all_day {
        Start::AllDay(day_of(starts_at)?)
    } else {
        Start::At(wall_of(starts_at)?)
    };
    let ends_at = v["ends_at"].as_str().unwrap_or_default();
    let tz = text(v, "tz");
    Some(Meeting {
        area: area_of(v, &id),
        title: crate::mail::one_line(v["title"].as_str().unwrap_or_default()),
        planned: v["status"] == "planned" && v["valid"] != false,
        start,
        end: if all_day { None } else { wall_of(ends_at) },
        notify: v["notify"]
            .as_array()
            .map(|l| l.iter().filter_map(notify_entry).take(MAX_NOTIFY).collect())
            .unwrap_or_default(),
        notify_to: addresses(&v["notify_to"]),
        location: text(v, "location")
            .map(|l| crate::mail::one_line(&l))
            .filter(|l| !l.is_empty()),
        online: text(v, "online"),
        online_service: text(v, "online_service"),
        stand: format!(
            "{starts_at}|{ends_at}|{}",
            tz.as_deref().unwrap_or_default()
        ),
        tz,
        id,
    })
}

/// The reminders at a time of day of a `tasks.snapshot`: the open tasks with `remind` and `remind_at`, and the
/// finished ones of `reminders`.
#[must_use]
pub fn reminders_of(snapshot: &Value) -> Vec<Reminder> {
    let list = |key: &str| snapshot[key].as_array().map_or(&[][..], Vec::as_slice);
    list("tasks")
        .iter()
        .chain(list("reminders"))
        .filter_map(|t| {
            let id = text(t, "id")?;
            Some(Reminder {
                area: area_of(t, &id),
                title: crate::mail::one_line(t["title"].as_str().unwrap_or_default()),
                day: day_of(t["remind"].as_str()?)?,
                at: time_of(t["remind_at"].as_str()?)?,
                to: addresses(&t["remind_to"]),
                id,
            })
        })
        .collect()
}

/// How the scheduler plans for one vault.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rules {
    /// The notices of a meeting with a time that names none of its own (an all-day one gets none).
    pub notify: Vec<Notify>,
    /// Ask after the end of a planned meeting whether to enter the result or finish it.
    pub after_end: bool,
}

impl Default for Rules {
    fn default() -> Self {
        Self {
            notify: DEFAULT_NOTIFY
                .iter()
                .filter_map(|s| parse_notify(s))
                .collect(),
            after_end: true,
        }
    }
}

/// A notice that is due.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Due {
    pub kind: &'static str,
    pub id: String,
    pub area: String,
    /// The instant it is for.
    pub at: Timestamp,
    /// What stands for exactly this notice in the memory.
    key: String,
}

/// A notice that will be due from `at` until `until`.
struct Candidate {
    due: Due,
    until: Timestamp,
}

fn candidate(
    kind: &'static str,
    id: &str,
    area: &str,
    stand: &str,
    at: Timestamp,
    until: Timestamp,
) -> Candidate {
    Candidate {
        due: Due {
            kind,
            id: id.to_owned(),
            area: area.to_owned(),
            at,
            key: format!("{kind}|{id}|{stand}|{}", at.as_second()),
        },
        until,
    }
}

/// The zone of a meeting: its own, or the hub's; `None` for a name no database knows (then it tells nothing: a
/// notice at a wrong time is worse than none).
fn zone_of(meeting: &Meeting, hub: &TimeZone) -> Option<TimeZone> {
    match &meeting.tz {
        None => Some(hub.clone()),
        Some(name) => TimeZone::get(name).ok(),
    }
}

/// Every notice of `inputs`, with the time it is due from and until.
fn candidates(inputs: &Inputs, zone: &TimeZone, rules: &Rules) -> Vec<Candidate> {
    let mut out = Vec::new();
    for m in inputs.meetings.iter().filter(|m| m.planned) {
        let Some(mz) = zone_of(m, zone) else {
            continue;
        };
        let (wall, day, timed) = match m.start {
            Start::At(wall) => (wall, wall.date(), true),
            Start::AllDay(day) => (day.to_datetime(Time::midnight()), day, false),
        };
        let Some(begins) = instant(wall, &mz) else {
            continue;
        };
        let specs = if !m.notify.is_empty() {
            m.notify.as_slice()
        } else if timed {
            rules.notify.as_slice()
        } else {
            &[]
        };
        for spec in specs {
            let at = match *spec {
                Notify::Before { minutes } => {
                    begins.checked_sub(SignedDuration::from_mins(minutes)).ok()
                }
                Notify::DayAt { days, at } => day
                    .checked_sub(jiff::Span::new().days(days))
                    .ok()
                    .and_then(|d| instant(d.to_datetime(at), &mz)),
            };
            if let Some(at) = at.filter(|at| *at < begins) {
                out.push(candidate(MEETING, &m.id, &m.area, &m.stand, at, begins));
            }
        }
        if rules.after_end
            && let Some(ends) = m.end.and_then(|end| instant(end, &mz))
            && let Ok(until) = ends.checked_add(AFTER_END_FOR)
        {
            out.push(candidate(
                MEETING_END,
                &m.id,
                &m.area,
                &m.stand,
                ends,
                until,
            ));
        }
    }
    for r in &inputs.reminders {
        let stand = format!("{}T{}", r.day, r.at.strftime("%H:%M"));
        let at = instant(r.day.to_datetime(r.at), zone);
        let until = r
            .day
            .tomorrow()
            .ok()
            .and_then(|d| instant(d.to_datetime(Time::midnight()), zone));
        if let (Some(at), Some(until)) = (at, until) {
            out.push(candidate(REMIND, &r.id, &r.area, &stand, at, until));
        }
    }
    out
}

/// The notices of `inputs` that are due at `now` (`zone`: the hub's), each once, the earliest first. Whether one was
/// sent already is the [`Memory`]'s.
#[must_use]
pub fn plan(inputs: &Inputs, now: Timestamp, zone: &TimeZone, rules: &Rules) -> Vec<Due> {
    let mut seen = BTreeSet::new();
    let mut due: Vec<Due> = candidates(inputs, zone, rules)
        .into_iter()
        .filter(|c| c.due.at <= now && now < c.until)
        .map(|c| c.due)
        .filter(|d| seen.insert(d.key.clone()))
        .collect();
    due.sort_by(|a, b| (a.at, &a.id, a.kind).cmp(&(b.at, &b.id, b.kind)));
    due
}

/// The next instant after `now` a notice of `inputs` becomes due: the job need not look before it.
#[must_use]
pub fn next_after(
    inputs: &Inputs,
    now: Timestamp,
    zone: &TimeZone,
    rules: &Rules,
) -> Option<Timestamp> {
    candidates(inputs, zone, rules)
        .into_iter()
        .map(|c| c.due.at)
        .filter(|at| *at > now)
        .min()
}

/// The keys of what was sent, per vault, with the instant each was for (in seconds).
#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct State {
    schema: u32,
    vaults: BTreeMap<String, BTreeMap<String, i64>>,
}

/// The schema of `schedule.json`; a file of another is a first look.
const SCHEMA: u32 = 1;
/// The most bytes of `schedule.json` that are read.
const MAX_FILE: u64 = 4 * 1024 * 1024;

/// What the scheduler has sent, kept in a file outside the vault.
#[derive(Debug)]
pub struct Memory {
    path: Option<PathBuf>,
    state: Mutex<State>,
}

impl Memory {
    /// What was sent, from `path` (`None`: in memory only). A file that is missing, too large or not one of these is
    /// forgotten: only what is due now goes out (a notice before a meeting only until the meeting begins).
    #[must_use]
    pub fn open(path: Option<PathBuf>) -> Self {
        let state = path.as_deref().and_then(read).unwrap_or(State {
            schema: SCHEMA,
            vaults: BTreeMap::new(),
        });
        Self {
            path,
            state: Mutex::new(state),
        }
    }

    /// The notices of `due` that were not sent for `vault` yet: of each meeting or task and kind only the latest (the
    /// earlier ones were missed and are only marked). All of them are kept as sent before they are returned; what is
    /// long past is forgotten. Reads and writes the file: call it off the async workers.
    pub fn take(&self, vault: &str, due: Vec<Due>, now: Timestamp) -> Vec<Due> {
        self.change(|state| {
            let sent = state.vaults.entry(vault.to_owned()).or_default();
            let fresh: Vec<Due> = due
                .into_iter()
                .filter(|d| !sent.contains_key(&d.key))
                .collect();
            for d in &fresh {
                sent.insert(d.key.clone(), d.at.as_second());
            }
            let horizon = now
                .checked_sub(KEEP_FOR)
                .map_or(i64::MIN, Timestamp::as_second);
            sent.retain(|_, at| *at >= horizon);
            if sent.len() > MAX_KEYS {
                let mut by_age: Vec<(i64, String)> =
                    sent.iter().map(|(k, at)| (*at, k.clone())).collect();
                by_age.sort();
                for (_, key) in by_age.into_iter().take(sent.len() - MAX_KEYS) {
                    sent.remove(&key);
                }
            }
            // Of several notices of one item and kind the latest is the one that says the most now.
            let mut latest: BTreeMap<(&'static str, String), Due> = BTreeMap::new();
            for d in fresh {
                let slot = latest
                    .entry((d.kind, d.id.clone()))
                    .or_insert_with(|| d.clone());
                if d.at > slot.at {
                    *slot = d;
                }
            }
            let mut out: Vec<Due> = latest.into_values().collect();
            out.sort_by(|a, b| (a.at, &a.id, a.kind).cmp(&(b.at, &b.id, b.kind)));
            out
        })
    }

    /// Take back notices of `vault` that reached nobody: the next look hands them out again (while they are due).
    pub fn unsent(&self, vault: &str, due: &[Due]) {
        if due.is_empty() {
            return;
        }
        self.change(|state| {
            if let Some(sent) = state.vaults.get_mut(vault) {
                for d in due {
                    sent.remove(&d.key);
                }
            }
        });
    }

    fn change<T: Default>(&self, f: impl FnOnce(&mut State) -> T) -> T {
        let Ok(mut state) = self.state.lock() else {
            return T::default();
        };
        let before = state.clone();
        state.schema = SCHEMA;
        let out = f(&mut state);
        if *state != before
            && let Some(path) = &self.path
            && let Err(e) = write(path, &state)
        {
            // As for notices.json: the state in memory is right, only a restart may send such a notice again.
            eprintln!("note: {} cannot be written: {e}", path.display());
        }
        out
    }
}

fn read(path: &Path) -> Option<State> {
    if std::fs::metadata(path).ok()?.len() > MAX_FILE {
        return None;
    }
    let state: State = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    (state.schema == SCHEMA).then_some(state)
}

fn write(path: &Path, state: &State) -> std::io::Result<()> {
    let text = serde_json::to_string(state).map_err(std::io::Error::other)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, path)
}

/// The scheduler of a hub: what it sent, how it plans for each vault, its zone and its clock.
pub struct Scheduler {
    pub memory: Memory,
    /// The rules of a vault, by its canonical folder; a vault not in it plans with `default`.
    pub by_vault: BTreeMap<String, Rules>,
    pub default: Rules,
    /// The address to join of an `internal` meeting may go into a mail.
    pub internal_links: bool,
    pub lang: Lang,
    /// The zone of the hub: the system's.
    pub zone: TimeZone,
    /// The clock (a test sets its own).
    pub clock: Box<dyn Fn() -> Timestamp + Send + Sync>,
}

impl Scheduler {
    /// A scheduler with the system's zone and clock, the default rules and what was sent kept in `path`.
    #[must_use]
    pub fn new(path: Option<PathBuf>) -> Self {
        Self {
            memory: Memory::open(path),
            by_vault: BTreeMap::new(),
            default: Rules::default(),
            internal_links: false,
            lang: Lang::En,
            // An unknown zone of the system is said: jiff then plans in UTC, and the notices come at other times.
            zone: TimeZone::try_system().unwrap_or_else(|e| {
                eprintln!(
                    "note: the time zone of this PC is unknown ({e}); notices are planned in UTC"
                );
                TimeZone::UTC
            }),
            clock: Box::new(Timestamp::now),
        }
    }

    /// The rules of the vault at the canonical folder `vault`.
    #[must_use]
    pub fn rules(&self, vault: &str) -> &Rules {
        self.by_vault.get(vault).unwrap_or(&self.default)
    }

    /// Now, by its clock.
    #[must_use]
    pub fn now(&self) -> Timestamp {
        (self.clock)()
    }
}

impl std::fmt::Debug for Scheduler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Scheduler")
            .field("by_vault", &self.by_vault)
            .field("default", &self.default)
            .finish_non_exhaustive()
    }
}

/// The window of days the meetings are asked for at `now`: from the day before (a meeting that just ended) to as far
/// ahead as a notice may be.
#[must_use]
pub fn window(now: Timestamp, zone: &TimeZone) -> (Date, Date) {
    let today = now.to_zoned(zone.clone()).date();
    (
        today.yesterday().unwrap_or(today),
        today
            .checked_add(jiff::Span::new().days(MAX_NOTIFY_DAYS + 1))
            .unwrap_or(today),
    )
}

/// What a notice says, for a mail (a push carries only its kind and id, the phone reads the rest over its paired
/// way). Built from the class of the area, fail closed: nothing for a private or unclassified area; the address to
/// join only for a `public` one, or an `internal` one when the settings release it (`internal_links`). Participants
/// are never in a notice.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Content {
    pub title: String,
    /// The day and time, in the zone of the hub (and as written when the meeting names another zone).
    pub when: String,
    pub location: Option<String>,
    /// The service of the address (`teams`, `zoom`, ...), told even when the address itself is not.
    pub service: Option<String>,
    /// The address to join (http or https), when the class releases it.
    pub join: Option<String>,
    /// The id to open it by.
    pub open: String,
    /// The question after the end of a meeting.
    pub ask_result: bool,
}

/// An address to join that may go into a mail: http or https, one line, not endless.
fn plain_link(link: &str) -> Option<String> {
    let lower = link.to_ascii_lowercase();
    let ok = (lower.starts_with("https://") || lower.starts_with("http://"))
        && link.len() <= 2000
        && !link.chars().any(|c| c.is_control() || c.is_whitespace());
    ok.then(|| link.to_owned())
}

fn local(at: Timestamp, zone: &TimeZone) -> String {
    at.to_zoned(zone.clone())
        .strftime("%Y-%m-%d %H:%M")
        .to_string()
}

/// What `due` says, from `inputs`; `None` when the item is gone or its area is not released.
#[must_use]
pub fn content(
    inputs: &Inputs,
    due: &Due,
    zone: &TimeZone,
    shown: Shown,
    internal_links: bool,
    lang: Lang,
) -> Option<Content> {
    if !matches!(shown, Shown::Public | Shown::Internal) {
        return None;
    }
    if due.kind == REMIND {
        let r = inputs.reminders.iter().find(|r| r.id == due.id)?;
        return Some(Content {
            title: r.title.clone(),
            when: local(due.at, zone),
            location: None,
            service: None,
            join: None,
            open: r.id.clone(),
            ask_result: false,
        });
    }
    let m = inputs.meetings.iter().find(|m| m.id == due.id)?;
    let mz = zone_of(m, zone)?;
    let when = match m.start {
        Start::AllDay(day) => format!(
            "{day} ({})",
            if lang == Lang::De {
                "ganztägig"
            } else {
                "all day"
            }
        ),
        Start::At(wall) => {
            let begins = instant(wall, &mz)?;
            let mut when = local(begins, zone);
            if let Some(end) = m.end.and_then(|e| instant(e, &mz)) {
                when.push('-');
                when.push_str(&end.to_zoned(zone.clone()).strftime("%H:%M").to_string());
            }
            // The time as written, when it is another one in the zone of the meeting.
            if let Some(tz) = &m.tz
                && mz.to_offset(begins) != zone.to_offset(begins)
            {
                when.push_str(&format!(" ({} {tz})", wall.strftime("%H:%M")));
            }
            when
        }
    };
    let link_ok = shown == Shown::Public || internal_links;
    Some(Content {
        title: m.title.clone(),
        when,
        location: m.location.clone(),
        service: m.online.as_ref().and(m.online_service.clone()),
        join: m.online.as_deref().filter(|_| link_ok).and_then(plain_link),
        open: m.id.clone(),
        ask_result: due.kind == MEETING_END,
    })
}

/// The name a service is told by.
fn service_name(service: &str) -> &str {
    match service {
        "teams" => "Microsoft Teams",
        "zoom" => "Zoom",
        "meet" => "Google Meet",
        "webex" => "Webex",
        "jitsi" => "Jitsi",
        _ => "Online",
    }
}

/// The mails of `due` (one to each address the item names: `notify_to` of a meeting, `remind_to` of a task), or none.
#[must_use]
pub fn mails(
    inputs: &Inputs,
    due: &Due,
    zone: &TimeZone,
    shown: Shown,
    internal_links: bool,
    lang: Lang,
) -> Vec<Message> {
    let to: &[String] = if due.kind == REMIND {
        inputs
            .reminders
            .iter()
            .find(|r| r.id == due.id)
            .map_or(&[], |r| r.to.as_slice())
    } else {
        inputs
            .meetings
            .iter()
            .find(|m| m.id == due.id)
            .map_or(&[], |m| m.notify_to.as_slice())
    };
    if to.is_empty() {
        return Vec::new();
    }
    let Some(c) = content(inputs, due, zone, shown, internal_links, lang) else {
        return Vec::new();
    };
    let de = lang == Lang::De;
    // `when` starts with the day and, for a meeting with a time, the time of day; an all-day one has none.
    let day = c.when.get(..10).unwrap_or_default();
    let clock = c.when.get(11..16).filter(|t| crate::notices::valid_time(t));
    let subject = match (due.kind, clock) {
        (MEETING_END, _) if de => format!("Meeting vorbei: {}", c.title),
        (MEETING_END, _) => format!("Meeting over: {}", c.title),
        (MEETING, None) if de => format!("Meeting am {day}: {}", c.title),
        (MEETING, None) => format!("Meeting on {day}: {}", c.title),
        (MEETING, Some(clock)) if de => format!("Meeting um {clock}: {}", c.title),
        (MEETING, Some(clock)) => format!("Meeting at {clock}: {}", c.title),
        (_, clock) => {
            let clock = clock.unwrap_or_default();
            if de {
                format!("Erinnerung um {clock}: {}", c.title)
            } else {
                format!("Reminder at {clock}: {}", c.title)
            }
        }
    };
    let mut text = format!("{}\n{}\n", c.title, c.when);
    if let Some(place) = &c.location {
        text.push_str(&format!("{}: {place}\n", if de { "Ort" } else { "Place" }));
    }
    if let Some(service) = &c.service {
        text.push_str(&format!(
            "{}: {}\n",
            if de { "Dienst" } else { "Service" },
            service_name(service)
        ));
    }
    if let Some(join) = &c.join {
        text.push_str(&format!(
            "{}: {join}\n",
            if de { "Beitreten" } else { "Join" }
        ));
    }
    text.push_str(&format!(
        "{}: {} (tasks-desktop)\n",
        if de { "Öffnen" } else { "Open" },
        c.open
    ));
    if c.ask_result {
        text.push_str(if de {
            "\nErgebnis eintragen oder abschließen?\n"
        } else {
            "\nEnter the result or finish it?\n"
        });
    }
    to.iter()
        .map(|to| Message {
            to: to.clone(),
            subject: subject.clone(),
            text: text.clone(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn vienna() -> TimeZone {
        TimeZone::get("Europe/Vienna").unwrap()
    }

    /// An instant given as the wall time of Vienna.
    fn at(text: &str) -> Timestamp {
        instant(wall_of(text).unwrap(), &vienna()).unwrap()
    }

    fn utc(text: &str) -> Timestamp {
        text.parse().unwrap()
    }

    fn meeting(id: &str, starts_at: &str, ends_at: &str, extra: Value) -> Value {
        let mut v = json!({
            "id": id, "area": id.split('/').next().unwrap(), "title": format!("Title of {id}"),
            "status": "planned", "valid": true, "all_day": false,
            "starts_at": starts_at, "ends_at": ends_at, "notify": [],
        });
        if let Value::Object(extra) = extra {
            for (k, x) in extra {
                v[k] = x;
            }
        }
        v
    }

    fn inputs(meetings: &[Value]) -> Inputs {
        Inputs {
            meetings: meetings.iter().filter_map(meeting_of).collect(),
            reminders: Vec::new(),
        }
    }

    fn shown(due: &[Due]) -> Vec<(&'static str, String, String)> {
        due.iter()
            .map(|d| (d.kind, d.id.clone(), local(d.at, &vienna())))
            .collect()
    }

    fn one(kind: &'static str, id: &str, when: &str) -> (&'static str, String, String) {
        (kind, id.to_owned(), when.to_owned())
    }

    /// The hub at `now`: what it plans, minus what the memory sent already.
    fn look(memory: &Memory, inputs: &Inputs, now: Timestamp) -> Vec<Due> {
        memory.take("v", plan(inputs, now, &vienna(), &Rules::default()), now)
    }

    #[test]
    fn notify_specs_are_read_as_the_engine_reads_them() {
        assert_eq!(parse_notify("-15m"), Some(Notify::Before { minutes: 15 }));
        assert_eq!(parse_notify(" -2H "), Some(Notify::Before { minutes: 120 }));
        assert_eq!(
            parse_notify("-1d@18:00"),
            Some(Notify::DayAt {
                days: 1,
                at: Time::new(18, 0, 0, 0).unwrap()
            })
        );
        assert_eq!(
            parse_notify("-0d@08:00"),
            Some(Notify::DayAt {
                days: 0,
                at: Time::new(8, 0, 0, 0).unwrap()
            })
        );
        assert_eq!(
            parse_notify("-43200m"),
            Some(Notify::Before { minutes: 43_200 })
        );
        for bad in [
            "15m",
            "-0m",
            "-43201m",
            "-1x",
            "-d@08:00",
            "-31d@08:00",
            "-1d@8:00",
            "-1d",
            "",
            "-",
            "-m",
            "+5m",
        ] {
            assert_eq!(parse_notify(bad), None, "{bad}");
        }
        let six: Vec<String> = (1..=6).map(|n| format!("-{n}m")).collect();
        assert_eq!(parse_notify_list(&six), None);
        assert_eq!(parse_notify_list(&six[..5]).map(|l| l.len()), Some(5));
        assert_eq!(parse_notify_list(&["-5m".into(), "soon".into()]), None);
    }

    #[test]
    fn a_meeting_is_told_at_its_notices_once_and_a_missed_one_only_before_it_begins() {
        let m = inputs(&[meeting(
            "a/sync",
            "2026-11-24T14:00",
            "2026-11-24T15:00",
            json!({ "notify": [{ "spec": "-15m", "before_min": 15 }, { "spec": "-1d@18:00", "days_before": 1, "at": "18:00" }] }),
        )]);
        let memory = Memory::open(None);
        assert!(
            look(&memory, &m, at("2026-11-23T17:59")).is_empty(),
            "not yet"
        );
        assert_eq!(
            shown(&look(&memory, &m, at("2026-11-23T18:00"))),
            [one(MEETING, "a/sync", "2026-11-23 18:00")]
        );
        assert!(look(&memory, &m, at("2026-11-23T18:05")).is_empty(), "once");
        assert!(look(&memory, &m, at("2026-11-24T13:44")).is_empty());
        assert_eq!(
            shown(&look(&memory, &m, at("2026-11-24T13:50"))),
            [one(MEETING, "a/sync", "2026-11-24 13:45")],
            "five minutes late: still before the beginning"
        );
        assert!(
            look(&memory, &m, at("2026-11-24T13:55")).is_empty(),
            "doubled looks tell nothing twice"
        );

        // The hub was off at both times: the latest one goes, once, the earlier one is only marked.
        let late = Memory::open(None);
        assert_eq!(
            shown(&look(&late, &m, at("2026-11-24T13:59"))),
            [one(MEETING, "a/sync", "2026-11-24 13:45")]
        );
        assert!(look(&late, &m, at("2026-11-24T13:59")).is_empty());

        // Off until the meeting began: nothing is told before it any more.
        let after = Memory::open(None);
        assert!(look(&after, &m, at("2026-11-24T14:00")).is_empty());
        assert!(look(&after, &m, at("2026-11-24T14:30")).is_empty());
    }

    #[test]
    fn a_moved_meeting_is_told_at_the_new_time() {
        let memory = Memory::open(None);
        let first = inputs(&[meeting(
            "a/m",
            "2026-11-24T14:00",
            "2026-11-24T15:00",
            json!({}),
        )]);
        assert_eq!(
            shown(&look(&memory, &first, at("2026-11-24T13:45"))),
            [one(MEETING, "a/m", "2026-11-24 13:45")],
            "the default of the vault: -15m"
        );
        // Moved to 16:00: the notice of the old time does not count for the new one.
        let moved = inputs(&[meeting(
            "a/m",
            "2026-11-24T16:00",
            "2026-11-24T17:00",
            json!({}),
        )]);
        assert!(look(&memory, &moved, at("2026-11-24T14:00")).is_empty());
        assert_eq!(
            shown(&look(&memory, &moved, at("2026-11-24T15:45"))),
            [one(MEETING, "a/m", "2026-11-24 15:45")]
        );
        // Moved closer, into the past of its notice: told at once, since it has not begun.
        let memory = Memory::open(None);
        let soon = inputs(&[meeting(
            "a/m",
            "2026-11-24T14:05",
            "2026-11-24T15:00",
            json!({}),
        )]);
        assert!(look(&memory, &first, at("2026-11-24T13:40")).is_empty());
        assert_eq!(
            shown(&look(&memory, &soon, at("2026-11-24T13:55"))),
            [one(MEETING, "a/m", "2026-11-24 13:50")]
        );
        // Moved by another zone only (the same wall time in London is one hour later here).
        let zoned = inputs(&[meeting(
            "a/m",
            "2026-11-24T14:05",
            "2026-11-24T15:00",
            json!({ "tz": "Europe/London" }),
        )]);
        assert_eq!(
            shown(&look(&memory, &zoned, at("2026-11-24T14:50"))),
            [one(MEETING, "a/m", "2026-11-24 14:50")]
        );
    }

    #[test]
    fn a_cancelled_a_done_or_a_broken_meeting_tells_nothing() {
        let memory = Memory::open(None);
        let now = at("2026-11-24T13:50");
        for extra in [
            json!({ "status": "cancelled" }),
            json!({ "status": "done" }),
            json!({ "status": null }),
            json!({ "valid": false }),
            json!({ "tz": "Mars/Olympus" }),
        ] {
            let m = inputs(&[meeting(
                "a/x",
                "2026-11-24T14:00",
                "2026-11-24T15:00",
                extra.clone(),
            )]);
            assert!(look(&memory, &m, now).is_empty(), "{extra}");
            assert!(
                look(&memory, &m, at("2026-11-24T15:05")).is_empty(),
                "no question after it: {extra}"
            );
        }
        // Cancelled after its notice was planned: nothing at the time.
        let planned = inputs(&[meeting(
            "a/y",
            "2026-11-24T14:00",
            "2026-11-24T15:00",
            json!({}),
        )]);
        assert_eq!(
            next_after(
                &planned,
                at("2026-11-24T13:00"),
                &vienna(),
                &Rules::default()
            ),
            Some(at("2026-11-24T13:45"))
        );
        let cancelled = inputs(&[meeting(
            "a/y",
            "2026-11-24T14:00",
            "2026-11-24T15:00",
            json!({ "status": "cancelled" }),
        )]);
        assert!(look(&memory, &cancelled, at("2026-11-24T13:45")).is_empty());
        assert_eq!(
            next_after(
                &cancelled,
                at("2026-11-24T13:00"),
                &vienna(),
                &Rules::default()
            ),
            None
        );
    }

    #[test]
    fn after_the_end_a_planned_meeting_asks_once_and_not_forever() {
        let m = inputs(&[meeting(
            "a/m",
            "2026-11-24T14:00",
            "2026-11-24T15:00",
            json!({}),
        )]);
        let memory = Memory::open(None);
        look(&memory, &m, at("2026-11-24T13:45"));
        assert!(look(&memory, &m, at("2026-11-24T14:59")).is_empty());
        assert_eq!(
            shown(&look(&memory, &m, at("2026-11-24T15:00"))),
            [one(MEETING_END, "a/m", "2026-11-24 15:00")]
        );
        assert!(look(&memory, &m, at("2026-11-24T16:00")).is_empty());
        // Missed by more than the window (the hub was off overnight): not asked any more.
        let next_day = Memory::open(None);
        assert!(look(&next_day, &m, at("2026-11-25T09:00")).is_empty());
        // Switched off in the settings; an all-day meeting never asks.
        let off = Rules {
            after_end: false,
            ..Rules::default()
        };
        assert!(plan(&m, at("2026-11-24T15:01"), &vienna(), &off).is_empty());
        let all_day = inputs(&[meeting(
            "a/d",
            "2026-11-24",
            "2026-11-24",
            json!({ "all_day": true }),
        )]);
        assert!(plan(
            &all_day,
            at("2026-11-25T00:01"),
            &vienna(),
            &Rules::default()
        )
        .is_empty());
    }

    #[test]
    fn an_all_day_meeting_has_no_default_but_its_own_notices() {
        let plain = inputs(&[meeting(
            "a/d",
            "2026-11-24",
            "2026-11-24",
            json!({ "all_day": true }),
        )]);
        assert_eq!(
            next_after(&plain, at("2026-11-20T00:00"), &vienna(), &Rules::default()),
            None
        );
        let own = inputs(&[meeting(
            "a/d",
            "2026-11-24",
            "2026-11-24",
            json!({ "all_day": true, "notify": [{ "spec": "-1d@18:00", "days_before": 1, "at": "18:00" }, { "spec": "-0d@08:00", "days_before": 0, "at": "08:00" }] }),
        )]);
        let memory = Memory::open(None);
        assert_eq!(
            shown(&look(&memory, &own, at("2026-11-23T18:00"))),
            [one(MEETING, "a/d", "2026-11-23 18:00")]
        );
        // 08:00 of the day is after its beginning (midnight): an all-day meeting has begun by then.
        assert!(look(&memory, &own, at("2026-11-24T08:00")).is_empty());
    }

    #[test]
    fn the_clocks_going_forward_or_back_move_no_notice_to_a_wrong_time() {
        let memory = Memory::open(None);
        // Vienna, 2026-03-29: 02:00 CET becomes 03:00 CEST. 02:30 does not exist: it is 03:30 CEST (01:30 UTC).
        let gap = inputs(&[meeting(
            "a/gap",
            "2026-03-29T02:30",
            "2026-03-29T03:30",
            json!({}),
        )]);
        assert_eq!(
            next_after(&gap, utc("2026-03-29T00:00Z"), &vienna(), &Rules::default()),
            Some(utc("2026-03-29T01:15Z")),
            "fifteen real minutes before 03:30 CEST"
        );
        // -2h across the change: two real hours, 23:30 UTC (00:30 CET).
        let two = Rules {
            notify: vec![Notify::Before { minutes: 120 }],
            after_end: false,
        };
        assert_eq!(
            next_after(&gap, utc("2026-03-28T00:00Z"), &vienna(), &two),
            Some(utc("2026-03-28T23:30Z"))
        );
        // The day before at 18:00 is in winter time (17:00 UTC), the meeting at 10:00 in summer time (08:00 UTC).
        let day_before = inputs(&[meeting(
            "a/sun",
            "2026-03-29T10:00",
            "2026-03-29T11:00",
            json!({ "notify": [{ "spec": "-1d@18:00", "days_before": 1, "at": "18:00" }] }),
        )]);
        assert_eq!(
            shown(&look(&memory, &day_before, utc("2026-03-28T17:00Z"))),
            [one(MEETING, "a/sun", "2026-03-28 18:00")]
        );
        assert_eq!(
            next_after(
                &day_before,
                utc("2026-03-28T17:00Z"),
                &vienna(),
                &Rules::default()
            ),
            Some(utc("2026-03-29T09:00Z")),
            "then the question after its end, 11:00 CEST"
        );
        // 2026-10-25: 03:00 CEST becomes 02:00 CET. 02:30 is shown twice: the first one counts (00:30 UTC).
        let fold = inputs(&[meeting(
            "a/fold",
            "2026-10-25T02:30",
            "2026-10-25T03:30",
            json!({}),
        )]);
        assert_eq!(
            next_after(
                &fold,
                utc("2026-10-24T22:00Z"),
                &vienna(),
                &Rules::default()
            ),
            Some(utc("2026-10-25T00:15Z"))
        );
        assert_eq!(
            shown(&look(&memory, &fold, utc("2026-10-25T00:15Z"))),
            [one(MEETING, "a/fold", "2026-10-25 02:15")]
        );
        // After the second 02:15 (01:15 UTC) nothing more: told once.
        assert!(look(&memory, &fold, utc("2026-10-25T01:15Z")).is_empty());
    }

    #[test]
    fn a_reminder_at_a_time_is_told_once_from_its_time_until_the_end_of_its_day() {
        let doc = json!({
            "tasks": [
                { "id": "a/t", "area": "a", "title": "Call", "remind": "2026-11-24", "remind_at": "09:30", "remind_to": ["me@example.org", "bad address"] },
                { "id": "a/plain", "area": "a", "title": "Day only", "remind": "2026-11-24" },
                { "id": "a/odd", "area": "a", "title": "Odd", "remind": "soon", "remind_at": "09:30" },
            ],
            "reminders": [{ "id": "a/done", "area": "a", "title": "Done one", "remind": "2026-11-24", "remind_at": "10:00" }],
        });
        let i = Inputs {
            meetings: Vec::new(),
            reminders: reminders_of(&doc),
        };
        assert_eq!(i.reminders.len(), 2);
        assert_eq!(i.reminders[0].to, ["me@example.org"]);
        let memory = Memory::open(None);
        assert!(look(&memory, &i, at("2026-11-24T09:29")).is_empty());
        assert_eq!(
            shown(&look(&memory, &i, at("2026-11-24T09:30"))),
            [one(REMIND, "a/t", "2026-11-24 09:30")]
        );
        // Missed (the hub was off): told late on the same day, not the next one.
        assert_eq!(
            shown(&look(&memory, &i, at("2026-11-24T23:00"))),
            [one(REMIND, "a/done", "2026-11-24 10:00")]
        );
        let next_day = Memory::open(None);
        assert!(look(&next_day, &i, at("2026-11-25T00:00")).is_empty());
        // Moved to another time: told again at the new one.
        let mut moved = i.clone();
        moved.reminders[0].at = Time::new(11, 0, 0, 0).unwrap();
        assert_eq!(
            shown(&look(&memory, &moved, at("2026-11-24T23:30"))),
            [one(REMIND, "a/t", "2026-11-24 11:00")]
        );
    }

    #[test]
    fn a_notice_that_reached_nobody_is_handed_out_again_and_what_was_sent_outlives_a_restart() {
        let dir = hub_testkit::scratch::Scratch::new("schedule-memory");
        let path = dir.join("schedule.json");
        let m = inputs(&[meeting(
            "a/m",
            "2026-11-24T14:00",
            "2026-11-24T15:00",
            json!({}),
        )]);
        let memory = Memory::open(Some(path.clone()));
        let told = look(&memory, &m, at("2026-11-24T13:45"));
        assert_eq!(told.len(), 1);
        memory.unsent("v", &told);
        assert_eq!(look(&memory, &m, at("2026-11-24T13:46")).len(), 1);
        let again = Memory::open(Some(path.clone()));
        assert!(
            look(&again, &m, at("2026-11-24T13:47")).is_empty(),
            "not after a restart"
        );
        assert!(
            again
                .take(
                    "w",
                    plan(&m, at("2026-11-24T13:47"), &vienna(), &Rules::default()),
                    at("2026-11-24T13:47")
                )
                .len()
                == 1,
            "another vault keeps its own"
        );
        // Long past is forgotten; a broken file is a first look.
        again.take("v", Vec::new(), at("2027-02-01T00:00"));
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(!text.contains("\"v\":{\"meeting"), "{text}");
        std::fs::write(&path, "{").unwrap();
        assert_eq!(
            look(&Memory::open(Some(path)), &m, at("2026-11-24T13:48")).len(),
            1
        );
    }

    fn mail_of(
        i: &Inputs,
        due: &Due,
        shown: Shown,
        internal_links: bool,
        lang: Lang,
    ) -> Vec<Message> {
        mails(i, due, &vienna(), shown, internal_links, lang)
    }

    #[test]
    fn a_mail_says_title_time_place_and_service_and_the_class_decides_on_the_link() {
        let i = inputs(&[meeting(
            "a/m",
            "2026-11-24T08:00",
            "2026-11-24T09:00",
            json!({
                "title": "Sync\r\nBcc: x@evil.example", "tz": "America/New_York", "location": "Room 3",
                "online": "https://teams.microsoft.com/l/meetup-join/abc", "online_service": "teams",
                "notify_to": ["me@example.org", "you@example.org"],
            }),
        )]);
        let due = plan(&i, at("2026-11-24T13:45"), &vienna(), &Rules::default());
        assert_eq!(due.len(), 1);
        let public = mail_of(&i, &due[0], Shown::Public, false, Lang::En);
        assert_eq!(public.len(), 2);
        assert_eq!(public[1].to, "you@example.org");
        assert_eq!(
            public[0].subject,
            "Meeting at 14:00: Sync Bcc: x@evil.example"
        );
        assert_eq!(
            public[0].text,
            "Sync Bcc: x@evil.example\n2026-11-24 14:00-15:00 (08:00 America/New_York)\nPlace: Room 3\n\
             Service: Microsoft Teams\nJoin: https://teams.microsoft.com/l/meetup-join/abc\nOpen: a/m (tasks-desktop)\n"
        );
        // Internal: the service, not the address, unless the settings release it.
        let internal = mail_of(&i, &due[0], Shown::Internal, false, Lang::De);
        assert!(
            !internal[0].text.contains("https://"),
            "{}",
            internal[0].text
        );
        assert!(internal[0].text.contains("Dienst: Microsoft Teams\n"));
        assert_eq!(
            internal[0].subject,
            "Meeting um 14:00: Sync Bcc: x@evil.example"
        );
        assert!(mail_of(&i, &due[0], Shown::Internal, true, Lang::De)[0]
            .text
            .contains("Beitreten: https://teams"));
        // Private and unclassified: nothing at all.
        assert!(mail_of(&i, &due[0], Shown::Private, true, Lang::En).is_empty());
        assert!(mail_of(&i, &due[0], Shown::Unclassified, true, Lang::En).is_empty());
        // An address that is no web address never goes out.
        let odd = inputs(&[meeting(
            "a/o",
            "2026-11-24T14:00",
            "2026-11-24T15:00",
            json!({ "online": "msteams:/l/x", "online_service": "link", "notify_to": ["me@example.org"] }),
        )]);
        let due = plan(&odd, at("2026-11-24T13:45"), &vienna(), &Rules::default());
        let text = &mail_of(&odd, &due[0], Shown::Public, true, Lang::En)[0].text;
        assert!(
            !text.contains("msteams") && text.contains("Service: Online\n"),
            "{text}"
        );
    }

    #[test]
    fn the_mail_of_an_all_day_meeting_names_its_day_not_a_time() {
        let i = inputs(&[meeting(
            "a/d",
            "2026-11-24",
            "2026-11-24",
            json!({ "all_day": true, "notify_to": ["me@example.org"],
                    "notify": [{ "spec": "-1d@18:00", "days_before": 1, "at": "18:00" }] }),
        )]);
        let due = plan(&i, at("2026-11-23T18:00"), &vienna(), &Rules::default());
        let en = &mail_of(&i, &due[0], Shown::Public, false, Lang::En)[0];
        assert_eq!(en.subject, "Meeting on 2026-11-24: Title of a/d");
        assert!(
            en.text.starts_with("Title of a/d\n2026-11-24 (all day)\n"),
            "{}",
            en.text
        );
        let de = &mail_of(&i, &due[0], Shown::Public, false, Lang::De)[0];
        assert_eq!(de.subject, "Meeting am 2026-11-24: Title of a/d");
    }

    #[test]
    fn the_mail_after_the_end_asks_for_the_result_and_a_reminder_mail_names_its_task() {
        let i = inputs(&[meeting(
            "a/m",
            "2026-11-24T14:00",
            "2026-11-24T15:00",
            json!({ "notify_to": ["me@example.org"] }),
        )]);
        let due = plan(&i, at("2026-11-24T15:00"), &vienna(), &Rules::default());
        assert_eq!(due[0].kind, MEETING_END);
        let mail = &mail_of(&i, &due[0], Shown::Internal, false, Lang::De)[0];
        assert_eq!(mail.subject, "Meeting vorbei: Title of a/m");
        assert!(
            mail.text
                .ends_with("\nErgebnis eintragen oder abschließen?\n"),
            "{}",
            mail.text
        );
        // A meeting without addresses has no mail.
        let quiet = inputs(&[meeting(
            "a/q",
            "2026-11-24T14:00",
            "2026-11-24T15:00",
            json!({}),
        )]);
        let due = plan(&quiet, at("2026-11-24T13:45"), &vienna(), &Rules::default());
        assert!(mail_of(&quiet, &due[0], Shown::Public, true, Lang::En).is_empty());

        let doc = json!({ "tasks": [{ "id": "a/t", "area": "a", "title": "Call", "remind": "2026-11-24", "remind_at": "09:30", "remind_to": ["me@example.org"] }] });
        let r = Inputs {
            meetings: Vec::new(),
            reminders: reminders_of(&doc),
        };
        let due = plan(&r, at("2026-11-24T09:30"), &vienna(), &Rules::default());
        let mail = &mail_of(&r, &due[0], Shown::Public, false, Lang::En)[0];
        assert_eq!(mail.subject, "Reminder at 09:30: Call");
        assert_eq!(
            mail.text,
            "Call\n2026-11-24 09:30\nOpen: a/t (tasks-desktop)\n"
        );
    }
}
