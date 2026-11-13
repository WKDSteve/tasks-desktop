//! What the hub tells a paired phone by Web Push (tasks-mobile `docs/HUB.md` section 5): `decision` when a task starts
//! to wait for the author's decision, and `remind` once a day, as one notice without an id (the phone opens *Today*),
//! from the hour of the settings on (`reminders.send_at`, 08:00 when unset) when the `remind:` day of a task of a
//! released area has come. This module only says which notices a snapshot gives, once each. Whether one goes out (a
//! subscriber, the class of the area of a decision) is the sender's (`server::push`).
//!
//! What was told is kept in `notices.json` in the settings folder, per vault (its canonical path), so a restart of the
//! hub tells nothing twice, and a change of vault (A, then B, then A again; or two runtimes for a moment) neither
//! forgets nor repeats what was told for the other:
//!
//! ```json
//! { "schema": 3, "vaults": { "E:\\vault": { "decision": ["a/x"], "reminded_on": "2026-11-12" } } }
//! ```
//!
//! `decision` is the set of tasks that waited for a decision at the last look; a task in it now and not then starts to
//! wait (one notice per change into the status, also after it left it and came back). The first look at a vault (no
//! file, a vault not in it, a file that cannot be read, or a look after a time nobody subscribed to anything:
//! `forget_decisions`) tells nothing: it only learns the set. `reminded_on` is the day the reminder notice of the vault
//! went out: once a day, from `send_at` on (compared with the engine's time of day, `hello.time`: the person's), when a
//! task of a released area has a `remind:` day that has come (that day or earlier, an open task or a finished one of
//! `reminders`), until its day is moved or taken away. A day whose reminders are all of private areas tells nothing,
//! not even that there are some.
//!
//! A notice that reached no phone (`unsent`: refused or unanswered by every push service) is taken back, so the next
//! look tells it again.
//!
//! The file is the memory of a restart, not of the hub: a write that fails is logged and the notices still go out (the
//! state in memory is right); only after a restart may such a notice be told again.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The kinds of notices (the phone subscribes to them by these names).
pub const DECISION: &str = "decision";
pub const REMIND: &str = "remind";

/// One notice: its kind, and for a decision the task and its area (for the class). The reminder of a day names none.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Notice {
    pub kind: &'static str,
    pub id: Option<String>,
    pub area: String,
}

/// The hour reminders go out from when the settings name none.
pub const DEFAULT_SEND_AT: &str = "08:00";

/// Is this a time of day as `send_at` and `hello.time` give it: `HH:MM`, 00:00 to 23:59.
#[must_use]
pub fn valid_time(text: &str) -> bool {
    let b = text.as_bytes();
    b.len() == 5
        && b[2] == b':'
        && [0, 1, 3, 4].iter().all(|&i| b[i].is_ascii_digit())
        && (b[0] - b'0') * 10 + (b[1] - b'0') < 24
        && b[3] < b'6'
}

/// What was told for one vault.
#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct VaultState {
    /// `None`: this vault was not looked at yet (or not while anybody listened).
    decision: Option<BTreeSet<String>>,
    /// The day the reminder notice of this vault went out.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    reminded_on: Option<String>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct State {
    schema: u32,
    vaults: BTreeMap<String, VaultState>,
}

/// The schema of `notices.json`; a file of another (the one vault of schema 1, the reminders per task of 2) is a first
/// look.
const SCHEMA: u32 = 3;

/// The notices of the hub and what it has told.
#[derive(Debug)]
pub struct Notices {
    path: Option<PathBuf>,
    state: Mutex<State>,
    /// `HH:MM`: the reminders of a day go out from this time of day on.
    send_at: String,
}

/// The most bytes of `notices.json` that are read.
const MAX_FILE: u64 = 1024 * 1024;

impl Notices {
    /// What was told, from `path` (`None`: in memory only). A file that is missing, too large or not one of these is a
    /// first look: nothing is told for what is in the vault now.
    #[must_use]
    pub fn open(path: Option<PathBuf>) -> Self {
        let state = path.as_deref().and_then(read).unwrap_or(State {
            schema: SCHEMA,
            vaults: BTreeMap::new(),
        });
        Self {
            path,
            state: Mutex::new(state),
            send_at: DEFAULT_SEND_AT.to_owned(),
        }
    }

    /// Send the reminders of a day from `at` (`HH:MM`, see `valid_time`) on; another text keeps the default.
    #[must_use]
    pub fn with_send_at(mut self, at: &str) -> Self {
        if valid_time(at) {
            at.clone_into(&mut self.send_at);
        }
        self
    }

    /// The notices `doc` (a `tasks.snapshot`) gives for `vault`, each once. `now` is the engine's day (YYYY-MM-DD) and
    /// time of day (HH:MM), which are the person's, `None`: no reminders now; `released` says whether a reminder of a
    /// task of that area may be told. What is told is kept before the notices are returned. Reads and writes the file:
    /// call it off the async workers.
    pub fn observe(
        &self,
        vault: &str,
        doc: &Value,
        now: Option<(&str, &str)>,
        released: &dyn Fn(&str) -> bool,
    ) -> Vec<Notice> {
        let send_at = self.send_at.as_str();
        self.change(|state| {
            let state = state.vaults.entry(vault.to_owned()).or_default();
            let mut notices = Vec::new();
            let tasks = doc["tasks"].as_array().map_or(&[][..], Vec::as_slice);

            let waiting: BTreeSet<String> = tasks
                .iter()
                .filter(|t| t["status"] == "decision")
                .filter_map(|t| t["id"].as_str().map(str::to_owned))
                .collect();
            if let Some(known) = &state.decision {
                for task in tasks {
                    let Some(id) = task["id"].as_str() else {
                        continue;
                    };
                    if waiting.contains(id) && !known.contains(id) {
                        notices.push(notice(DECISION, task));
                    }
                }
            }
            state.decision = Some(waiting);

            // Times are HH:MM and days YYYY-MM-DD: their order is the order of the text.
            if let Some((today, time)) = now
                && time >= send_at
                && state.reminded_on.as_deref() != Some(today)
            {
                // An open task carries its reminder; a finished one is in `reminders`.
                let finished = doc["reminders"].as_array().map_or(&[][..], Vec::as_slice);
                let due = tasks.iter().chain(finished).any(|task| {
                    task["remind"]
                        .as_str()
                        .is_some_and(|day| day.len() == 10 && day <= today)
                        && released(&notice(REMIND, task).area)
                });
                if due {
                    state.reminded_on = Some(today.to_owned());
                    notices.push(Notice {
                        kind: REMIND,
                        id: None,
                        area: String::new(),
                    });
                }
            }
            notices
        })
    }

    /// Take back notices of `vault` that reached no phone: the next look tells them again.
    pub fn unsent(&self, vault: &str, notices: &[Notice]) {
        if notices.is_empty() {
            return;
        }
        self.change(|state| {
            let Some(state) = state.vaults.get_mut(vault) else {
                return;
            };
            for notice in notices {
                if notice.kind == REMIND {
                    state.reminded_on = None;
                } else if let (Some(id), Some(known)) = (&notice.id, &mut state.decision) {
                    known.remove(id);
                }
            }
        });
    }

    /// Nobody listens for decisions now: what waits is not followed (the snapshot is not even read), so the next look
    /// at `vault` is a first look again. A phone that subscribes later is not told the past.
    pub fn forget_decisions(&self, vault: &str) {
        self.change(|state| {
            if let Some(state) = state.vaults.get_mut(vault) {
                state.decision = None;
            }
        });
    }

    /// Change the state under its lock and keep it when it changed.
    fn change<T>(&self, f: impl FnOnce(&mut State) -> T) -> T
    where
        T: Default,
    {
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
            // Deliberately only told: see the module docs.
            eprintln!("note: {} cannot be written: {e}", path.display());
        }
        out
    }
}

fn notice(kind: &'static str, task: &Value) -> Notice {
    let id = task["id"].as_str().unwrap_or_default().to_owned();
    // The area is the first part of the id when the entry does not name it.
    let area = task["area"]
        .as_str()
        .map(str::to_owned)
        .or_else(|| id.split_once('/').map(|(a, _)| a.to_owned()))
        .unwrap_or_default();
    Notice {
        kind,
        id: Some(id),
        area,
    }
}

fn read(path: &Path) -> Option<State> {
    let meta = std::fs::metadata(path).ok()?;
    if meta.len() > MAX_FILE {
        return None;
    }
    let state: State = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    (state.schema == SCHEMA).then_some(state)
}

fn write(path: &Path, state: &State) -> std::io::Result<()> {
    let text = serde_json::to_string_pretty(state).map_err(std::io::Error::other)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn snap(tasks: &[(&str, &str, Option<&str>)]) -> Value {
        json!({ "tasks": tasks.iter().map(|(id, status, remind)| json!({
            "id": id, "area": id.split('/').next().unwrap(), "status": status, "remind": remind,
        })).collect::<Vec<_>>() })
    }

    fn kinds(notices: &[Notice]) -> Vec<(String, Option<String>)> {
        notices
            .iter()
            .map(|n| (n.kind.to_owned(), n.id.clone()))
            .collect()
    }

    fn all(_: &str) -> bool {
        true
    }

    fn decision(id: &str) -> (String, Option<String>) {
        ("decision".into(), Some(id.into()))
    }

    fn remind() -> (String, Option<String>) {
        ("remind".into(), None)
    }

    #[test]
    fn a_task_that_starts_to_wait_for_a_decision_is_told_once_per_change() {
        let n = Notices::open(None);
        let look = |doc: &Value| n.observe("v", doc, None, &all);
        // The first look learns, tells nothing.
        assert!(look(&snap(&[("a/x", "decision", None)])).is_empty());
        assert!(look(&snap(&[("a/x", "decision", None), ("a/y", "open", None)])).is_empty());
        let both = snap(&[("a/x", "decision", None), ("a/y", "decision", None)]);
        let told = look(&both);
        assert_eq!(kinds(&told), [decision("a/y")]);
        assert_eq!(told[0].area, "a");
        // Every later scan with the same state tells nothing.
        assert!(look(&both).is_empty());
        // Out and back in: a new change, a new notice.
        look(&snap(&[("a/x", "decision", None), ("a/y", "doing", None)]));
        assert_eq!(kinds(&look(&both)), [decision("a/y")]);
    }

    #[test]
    fn another_vault_is_a_first_look() {
        let n = Notices::open(None);
        n.observe("v", &snap(&[]), None, &all);
        assert!(n
            .observe("w", &snap(&[("a/x", "decision", None)]), None, &all)
            .is_empty());
    }

    #[test]
    fn each_vault_keeps_what_was_told_for_it() {
        let n = Notices::open(None);
        let now = Some(("2026-11-12", "09:00"));
        let a = snap(&[("a/x", "open", Some("2026-11-12"))]);
        let b = snap(&[("b/y", "open", None)]);
        assert_eq!(kinds(&n.observe("A", &a, now, &all)), [remind()]);
        n.observe("B", &b, now, &all);
        // Back to A the same day: told already, and its decisions are still known.
        assert!(n.observe("A", &a, now, &all).is_empty());
        // A decision in B while A is looked at too (two runtimes for a moment): told for B, once.
        let b_waits = snap(&[("b/y", "decision", None)]);
        assert_eq!(
            kinds(&n.observe("B", &b_waits, None, &all)),
            [decision("b/y")]
        );
        n.observe("A", &a, now, &all);
        assert!(n.observe("B", &b_waits, None, &all).is_empty());
    }

    #[test]
    fn a_notice_that_reached_no_phone_is_told_again() {
        let n = Notices::open(None);
        let now = Some(("2026-11-12", "09:00"));
        n.observe("v", &snap(&[("a/x", "open", None)]), None, &all);
        let doc = snap(&[("a/x", "decision", Some("2026-11-12"))]);
        let told = n.observe("v", &doc, now, &all);
        assert_eq!(kinds(&told), [decision("a/x"), remind()]);
        n.unsent("v", &told);
        assert_eq!(
            kinds(&n.observe("v", &doc, now, &all)),
            [decision("a/x"), remind()]
        );
        assert!(n.observe("v", &doc, now, &all).is_empty());
    }

    #[test]
    fn after_a_time_without_listeners_the_past_is_not_told() {
        let n = Notices::open(None);
        n.observe("v", &snap(&[("a/x", "open", None)]), None, &all);
        n.forget_decisions("v");
        // a/x started to wait while nobody listened: the next look only learns it.
        assert!(n
            .observe("v", &snap(&[("a/x", "decision", None)]), None, &all)
            .is_empty());
    }

    #[test]
    fn the_reminders_of_a_day_are_one_notice_from_the_hour_of_the_settings_on() {
        let n = Notices::open(None);
        let mut doc = snap(&[
            ("a/x", "open", Some("2026-11-12")),
            ("a/y", "open", Some("2026-11-11")),
            ("a/z", "open", Some("2026-11-14")),
        ]);
        doc["reminders"] =
            json!([{ "id": "b/done", "area": "b", "title": "t", "remind": "2026-11-12" }]);
        // Before 08:00 (the default) nothing; from it on one notice for all of them, without an id.
        assert!(n
            .observe("v", &doc, Some(("2026-11-12", "07:59")), &all)
            .is_empty());
        let told = n.observe("v", &doc, Some(("2026-11-12", "08:00")), &all);
        assert_eq!(kinds(&told), [remind()]);
        assert_eq!(told[0].area, "");
        // Once a day, whatever is looked at later.
        assert!(n
            .observe("v", &doc, Some(("2026-11-12", "23:59")), &all)
            .is_empty());
        // Without a day and a time nothing is reminded, and what was told stays told.
        assert!(n.observe("v", &doc, None, &all).is_empty());
        assert!(n
            .observe("v", &doc, Some(("2026-11-12", "12:00")), &all)
            .is_empty());
        // The next day again, from the hour on.
        assert!(n
            .observe("v", &doc, Some(("2026-11-13", "00:10")), &all)
            .is_empty());
        assert_eq!(
            kinds(&n.observe("v", &doc, Some(("2026-11-13", "10:30")), &all)),
            [remind()]
        );
        // A day without a reminder that has come tells nothing (a/z is for the 14th).
        let later = snap(&[
            ("a/z", "open", Some("2026-11-14")),
            ("a/q", "open", Some("soon")),
        ]);
        assert!(n
            .observe("w", &later, Some(("2026-11-13", "09:00")), &all)
            .is_empty());
    }

    #[test]
    fn the_hour_is_the_settings_and_a_private_reminder_is_no_reason() {
        let n = Notices::open(None).with_send_at("18:30");
        let doc = snap(&[
            ("secret/x", "open", Some("2026-11-12")),
            ("open/y", "open", Some("2026-11-13")),
        ]);
        let public = |area: &str| area == "open";
        assert!(n
            .observe("v", &doc, Some(("2026-11-12", "18:29")), &public)
            .is_empty());
        // Only a private reminder has come: nothing, not even that there is one.
        assert!(n
            .observe("v", &doc, Some(("2026-11-12", "18:30")), &public)
            .is_empty());
        // The public one comes the next day: told then.
        assert_eq!(
            kinds(&n.observe("v", &doc, Some(("2026-11-13", "18:31")), &public)),
            [remind()]
        );
        // A text that is no time keeps the default.
        let odd = Notices::open(None).with_send_at("8:00");
        assert_eq!(odd.send_at, DEFAULT_SEND_AT);
    }

    #[test]
    fn a_time_is_hh_mm() {
        for good in ["00:00", "08:00", "23:59", "12:30"] {
            assert!(valid_time(good), "{good}");
        }
        for bad in ["24:00", "8:00", "08:60", "08-00", "08:00:00", "", "ab:cd"] {
            assert!(!valid_time(bad), "{bad}");
        }
    }

    #[test]
    fn what_was_told_outlives_a_restart() {
        let dir = hub_testkit::scratch::Scratch::new("notices-restart");
        let path = dir.join("notices.json");
        let now = Some(("2026-11-12", "09:00"));
        let doc = snap(&[("a/x", "open", Some("2026-11-12"))]);
        let n = Notices::open(Some(path.clone()));
        n.observe("v", &doc, now, &all);
        n.observe("w", &snap(&[]), None, &all);
        let again = Notices::open(Some(path.clone()));
        assert!(again.observe("v", &doc, now, &all).is_empty());
        let told = again.observe(
            "v",
            &snap(&[("a/x", "decision", Some("2026-11-12"))]),
            now,
            &all,
        );
        assert_eq!(kinds(&told), [decision("a/x")]);
        // A file that is not one of these (also schema 1 and 2) is a first look.
        for text in [
            "{",
            r#"{ "schema": 1, "vault": "v", "decision": [], "reminded": {} }"#,
            r#"{ "schema": 2, "vaults": { "v": { "decision": [], "reminded": {} } } }"#,
        ] {
            std::fs::write(&path, text).unwrap();
            let broken = Notices::open(Some(path.clone()));
            assert!(broken
                .observe("v", &snap(&[("a/y", "decision", None)]), None, &all)
                .is_empty());
        }
    }
}
