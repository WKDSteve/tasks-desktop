//! What the hub tells a paired phone by Web Push (tasks-mobile `docs/HUB.md` section 5): `decision` when a task starts
//! to wait for the author's decision, `remind` when the `remind:` day of a task has come. This module only says which
//! notices a snapshot gives, once each: the kinds, the ids and the areas. Whether one goes out (a subscriber, the class
//! of the area) is the sender's (`server::push`).
//!
//! What was told is kept in `notices.json` in the settings folder, per vault (its canonical path), so a restart of the
//! hub tells nothing twice, and a change of vault (A, then B, then A again; or two runtimes for a moment) neither
//! forgets nor repeats what was told for the other:
//!
//! ```json
//! { "schema": 2, "vaults": { "E:\\vault": { "decision": ["a/x"], "reminded": { "a/y": "2026-11-12" } } } }
//! ```
//!
//! `decision` is the set of tasks that waited for a decision at the last look; a task in it now and not then starts to
//! wait (one notice per change into the status, also after it left it and came back). The first look at a vault (no
//! file, a vault not in it, a file that cannot be read, or a look after a time nobody subscribed to anything:
//! `forget_decisions`) tells nothing: it only learns the set. `reminded` holds, per task, the day it was reminded on: a
//! task whose `remind:` day has come (that day or earlier, an open task or a finished one of `reminders`) is reminded
//! once a day, until the day is moved or taken away.
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

/// One notice: its kind, the task and its area (for the class).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Notice {
    pub kind: &'static str,
    pub id: String,
    pub area: String,
}

/// What was told for one vault.
#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct VaultState {
    /// `None`: this vault was not looked at yet (or not while anybody listened).
    decision: Option<BTreeSet<String>>,
    reminded: BTreeMap<String, String>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct State {
    schema: u32,
    vaults: BTreeMap<String, VaultState>,
}

/// The schema of `notices.json`; a file of another (the one vault of schema 1) is a first look.
const SCHEMA: u32 = 2;

/// The notices of the hub and what it has told.
#[derive(Debug)]
pub struct Notices {
    path: Option<PathBuf>,
    state: Mutex<State>,
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
        }
    }

    /// The notices `doc` (a `tasks.snapshot`) gives for `vault`, each once; `today` (YYYY-MM-DD, the engine's day, which
    /// is the person's) is the day reminders are for, `None`: no reminders now. What is told is kept before the notices
    /// are returned. Reads and writes the file: call it off the async workers.
    pub fn observe(&self, vault: &str, doc: &Value, today: Option<&str>) -> Vec<Notice> {
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

            if let Some(today) = today {
                // An open task carries its reminder; a finished one is in `reminders`.
                let finished = doc["reminders"].as_array().map_or(&[][..], Vec::as_slice);
                for task in tasks.iter().chain(finished) {
                    let Some(id) = task["id"].as_str() else {
                        continue;
                    };
                    // Days are YYYY-MM-DD: their order is the order of the text.
                    let due = task["remind"]
                        .as_str()
                        .is_some_and(|day| day.len() == 10 && day <= today);
                    if due && state.reminded.get(id).map(String::as_str) != Some(today) {
                        state.reminded.insert(id.to_owned(), today.to_owned());
                        notices.push(notice(REMIND, task));
                    }
                }
                // Only today's are needed to tell nothing twice.
                state.reminded.retain(|_, day| day == today);
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
                match notice.kind {
                    DECISION => {
                        if let Some(known) = &mut state.decision {
                            known.remove(&notice.id);
                        }
                    }
                    _ => {
                        state.reminded.remove(&notice.id);
                    }
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
    Notice { kind, id, area }
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

    fn kinds(notices: &[Notice]) -> Vec<(String, String)> {
        notices
            .iter()
            .map(|n| (n.kind.to_owned(), n.id.clone()))
            .collect()
    }

    #[test]
    fn a_task_that_starts_to_wait_for_a_decision_is_told_once_per_change() {
        let n = Notices::open(None);
        // The first look learns, tells nothing.
        assert!(n
            .observe("v", &snap(&[("a/x", "decision", None)]), None)
            .is_empty());
        assert!(n
            .observe(
                "v",
                &snap(&[("a/x", "decision", None), ("a/y", "open", None)]),
                None
            )
            .is_empty());
        let told = n.observe(
            "v",
            &snap(&[("a/x", "decision", None), ("a/y", "decision", None)]),
            None,
        );
        assert_eq!(kinds(&told), [("decision".into(), "a/y".into())]);
        assert_eq!(told[0].area, "a");
        // Every later scan with the same state tells nothing.
        assert!(n
            .observe(
                "v",
                &snap(&[("a/x", "decision", None), ("a/y", "decision", None)]),
                None
            )
            .is_empty());
        // Out and back in: a new change, a new notice.
        n.observe(
            "v",
            &snap(&[("a/x", "decision", None), ("a/y", "doing", None)]),
            None,
        );
        let told = n.observe(
            "v",
            &snap(&[("a/x", "decision", None), ("a/y", "decision", None)]),
            None,
        );
        assert_eq!(kinds(&told), [("decision".into(), "a/y".into())]);
    }

    #[test]
    fn another_vault_is_a_first_look() {
        let n = Notices::open(None);
        n.observe("v", &snap(&[]), None);
        assert!(n
            .observe("w", &snap(&[("a/x", "decision", None)]), None)
            .is_empty());
    }

    #[test]
    fn each_vault_keeps_what_was_told_for_it() {
        let n = Notices::open(None);
        let a = snap(&[("a/x", "open", Some("2026-11-12"))]);
        let b = snap(&[("b/y", "open", None)]);
        assert_eq!(n.observe("A", &a, Some("2026-11-12")).len(), 1);
        n.observe("B", &b, Some("2026-11-12"));
        // Back to A the same day: told already, and its decisions are still known.
        assert!(n.observe("A", &a, Some("2026-11-12")).is_empty());
        // A decision in B while A is looked at too (two runtimes for a moment): told for B, once.
        let b_waits = snap(&[("b/y", "decision", None)]);
        assert_eq!(
            kinds(&n.observe("B", &b_waits, None)),
            [("decision".into(), "b/y".into())]
        );
        n.observe("A", &a, Some("2026-11-12"));
        assert!(n.observe("B", &b_waits, None).is_empty());
    }

    #[test]
    fn a_notice_that_reached_no_phone_is_told_again() {
        let n = Notices::open(None);
        n.observe("v", &snap(&[("a/x", "open", None)]), None);
        let doc = snap(&[("a/x", "decision", Some("2026-11-12"))]);
        let told = n.observe("v", &doc, Some("2026-11-12"));
        assert_eq!(told.len(), 2, "{told:?}");
        n.unsent("v", &told);
        assert_eq!(
            kinds(&n.observe("v", &doc, Some("2026-11-12"))),
            [
                ("decision".into(), "a/x".into()),
                ("remind".into(), "a/x".into())
            ]
        );
        assert!(n.observe("v", &doc, Some("2026-11-12")).is_empty());
    }

    #[test]
    fn after_a_time_without_listeners_the_past_is_not_told() {
        let n = Notices::open(None);
        n.observe("v", &snap(&[("a/x", "open", None)]), None);
        n.forget_decisions("v");
        // a/x started to wait while nobody listened: the next look only learns it.
        assert!(n
            .observe("v", &snap(&[("a/x", "decision", None)]), None)
            .is_empty());
    }

    #[test]
    fn a_reminder_is_told_once_a_day_from_its_day_on() {
        let n = Notices::open(None);
        let doc = snap(&[
            ("a/x", "open", Some("2026-11-12")),
            ("a/y", "open", Some("2026-11-11")),
            ("a/z", "open", Some("2026-11-13")),
        ]);
        let mut doc = doc;
        doc["reminders"] =
            json!([{ "id": "b/done", "area": "b", "title": "t", "remind": "2026-11-12" }]);
        let told = n.observe("v", &doc, Some("2026-11-12"));
        assert_eq!(
            kinds(&told),
            [
                ("remind".into(), "a/x".into()),
                ("remind".into(), "a/y".into()),
                ("remind".into(), "b/done".into())
            ]
        );
        assert!(n.observe("v", &doc, Some("2026-11-12")).is_empty());
        // Without a day nothing is reminded, and what was told stays told.
        assert!(n.observe("v", &doc, None).is_empty());
        assert!(n.observe("v", &doc, Some("2026-11-12")).is_empty());
        // The next day: each of them again, once, with the task of that day.
        assert_eq!(
            kinds(&n.observe("v", &doc, Some("2026-11-13"))),
            [
                ("remind".into(), "a/x".into()),
                ("remind".into(), "a/y".into()),
                ("remind".into(), "a/z".into()),
                ("remind".into(), "b/done".into())
            ]
        );
        assert!(n.observe("v", &doc, Some("2026-11-13")).is_empty());
        // A day that is not one is no reminder.
        let odd = snap(&[("a/q", "open", Some("soon"))]);
        assert!(n.observe("v", &odd, Some("2026-11-13")).is_empty());
    }

    #[test]
    fn what_was_told_outlives_a_restart() {
        let dir = hub_testkit::scratch::Scratch::new("notices-restart");
        let path = dir.join("notices.json");
        let doc = snap(&[("a/x", "open", Some("2026-11-12"))]);
        let n = Notices::open(Some(path.clone()));
        n.observe("v", &doc, Some("2026-11-12"));
        n.observe("w", &snap(&[]), None);
        let again = Notices::open(Some(path.clone()));
        assert!(again.observe("v", &doc, Some("2026-11-12")).is_empty());
        let told = again.observe(
            "v",
            &snap(&[("a/x", "decision", Some("2026-11-12"))]),
            Some("2026-11-12"),
        );
        assert_eq!(kinds(&told), [("decision".into(), "a/x".into())]);
        // A file that is not one of these (also the one vault of schema 1) is a first look.
        for text in [
            "{",
            r#"{ "schema": 1, "vault": "v", "decision": [], "reminded": {} }"#,
        ] {
            std::fs::write(&path, text).unwrap();
            let broken = Notices::open(Some(path.clone()));
            assert!(broken
                .observe("v", &snap(&[("a/y", "decision", None)]), None)
                .is_empty());
        }
    }
}
