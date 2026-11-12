//! What the hub tells a paired phone by Web Push (tasks-mobile `docs/HUB.md` section 5): `decision` when a task starts
//! to wait for the author's decision, `remind` when the `remind:` day of a task has come. This module only says which
//! notices a snapshot gives, once each: the kinds, the ids and the areas. Whether one goes out (a subscriber, the class
//! of the area) is the sender's (`server::push`).
//!
//! What was told is kept in `notices.json` in the settings folder, so a restart of the hub tells nothing twice:
//!
//! ```json
//! { "schema": 1, "vault": "E:/vault", "decision": ["a/x"], "reminded": { "a/y": "2026-11-12" } }
//! ```
//!
//! `decision` is the set of tasks that waited for a decision at the last look; a task in it now and not then starts to
//! wait (one notice per change into the status, also after it left it and came back). The first look at a vault (no
//! file, another vault, a file that cannot be read) tells nothing: it only learns the set. `reminded` holds, per task,
//! the day it was reminded on: a task whose `remind:` day has come (that day or earlier, an open task or a finished one
//! of `reminders`) is reminded once a day, until the day is moved or taken away.

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

#[derive(Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct State {
    schema: u32,
    vault: Option<String>,
    /// `None`: this vault was not looked at yet.
    decision: Option<BTreeSet<String>>,
    reminded: BTreeMap<String, String>,
}

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
        let state = path.as_deref().and_then(read).unwrap_or_default();
        Self {
            path,
            state: Mutex::new(state),
        }
    }

    /// The notices `doc` (a `tasks.snapshot`) gives for `vault`, each once; `today` (YYYY-MM-DD, the engine's day, which
    /// is the person's) is the day reminders are for, `None`: no reminders now. What is told is kept before the notices
    /// are returned.
    pub fn observe(&self, vault: &str, doc: &Value, today: Option<&str>) -> Vec<Notice> {
        let Ok(mut state) = self.state.lock() else {
            return Vec::new();
        };
        let before = State {
            schema: state.schema,
            vault: state.vault.clone(),
            decision: state.decision.clone(),
            reminded: state.reminded.clone(),
        };
        if state.vault.as_deref() != Some(vault) {
            *state = State {
                schema: 1,
                vault: Some(vault.to_owned()),
                decision: None,
                reminded: BTreeMap::new(),
            };
        }
        state.schema = 1;
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

        if *state != before
            && let Some(path) = &self.path
            && let Err(e) = write(path, &state)
        {
            eprintln!("note: {} cannot be written: {e}", path.display());
        }
        notices
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
    (state.schema == 1).then_some(state)
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
        n.observe(
            "v",
            &snap(&[("a/x", "open", Some("2026-11-12"))]),
            Some("2026-11-12"),
        );
        let again = Notices::open(Some(path.clone()));
        assert!(again.observe("v", &doc, Some("2026-11-12")).is_empty());
        let told = again.observe(
            "v",
            &snap(&[("a/x", "decision", Some("2026-11-12"))]),
            Some("2026-11-12"),
        );
        assert_eq!(kinds(&told), [("decision".into(), "a/x".into())]);
        // A file that is not one of these is a first look.
        std::fs::write(&path, "{").unwrap();
        let broken = Notices::open(Some(path));
        assert!(broken
            .observe("v", &snap(&[("a/y", "decision", None)]), None)
            .is_empty());
    }
}
