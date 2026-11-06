//! The check over all vaults, as one job. The hub reads one vault at a time (decided 2026-10-29), so this is a loop: each
//! vault in turn gets an engine of its own for its check, and the vault that is read does not change. One job at a time; a
//! start while one runs is told that one. Its state lives here and not in the runtime of a vault, because choosing another
//! vault does not end it.

use std::sync::{Arc, Mutex, PoisonError};

use appkit_hub::BoxFuture;
use serde_json::{json, Value};

use crate::engine::{Calls, Engine};

/// How many findings of one vault the page gets: the dialog names them, the check of that vault has them all.
const MAX_FINDINGS: usize = 50;

/// The vaults there are, and an engine for each. The program asks its settings; a test has fakes.
pub trait VaultEngines: Send + Sync {
    /// The names of the vaults, in the order the dialog lists them.
    fn names(&self) -> Vec<String>;

    /// An engine for the vault `name`, without changing the vault that is read.
    fn engine<'a>(&'a self, name: &'a str) -> BoxFuture<'a, Result<Arc<dyn Engine>, String>>;
}

/// The job and what it found so far.
pub struct AllVaultsCheck {
    engines: Arc<dyn VaultEngines>,
    state: Arc<Mutex<Value>>,
}

fn idle() -> Value {
    json!({ "state": "idle", "vaults": [] })
}

/// What the check of one vault says, for the page.
fn result_of(name: &str, text: &str) -> Value {
    let Ok(doc) = serde_json::from_str::<Value>(text) else {
        return failed(
            name,
            "the engine answered with something that is not a document",
        );
    };
    let findings: Vec<Value> = doc["findings"]
        .as_array()
        .map(|all| all.iter().take(MAX_FINDINGS).cloned().collect())
        .unwrap_or_default();
    json!({
        "name": name,
        "state": "done",
        "ok": doc["ok"],
        "errors": doc["errors"],
        "warnings": doc["warnings"],
        "tasks": doc["tasks"],
        "total": doc["total"],
        "findings": findings,
    })
}

fn failed(name: &str, message: &str) -> Value {
    json!({ "name": name, "state": "failed", "message": message })
}

impl AllVaultsCheck {
    #[must_use]
    pub fn new(engines: Arc<dyn VaultEngines>) -> Self {
        Self {
            engines,
            state: Arc::new(Mutex::new(idle())),
        }
    }

    /// Where the job stands.
    #[must_use]
    pub fn state(&self) -> Value {
        self.state
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    /// Start the job unless one runs; where it stands then.
    #[must_use]
    pub fn start(&self) -> Value {
        let names = self.engines.names();
        let first = {
            let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
            if state["state"] == "running" {
                return state.clone();
            }
            let vaults: Vec<Value> = names
                .iter()
                .map(|name| json!({ "name": name, "state": "waiting" }))
                .collect();
            *state = json!({ "state": "running", "vaults": vaults });
            state.clone()
        };
        let engines = Arc::clone(&self.engines);
        let state = Arc::clone(&self.state);
        tokio::spawn(async move {
            for (i, name) in names.iter().enumerate() {
                let set = |value: Value| {
                    state.lock().unwrap_or_else(PoisonError::into_inner)["vaults"][i] = value;
                };
                set(json!({ "name": name, "state": "running" }));
                let outcome = match engines.engine(name).await {
                    Err(why) => failed(name, &why),
                    Ok(engine) => match engine.call(Calls::Check, None).await {
                        Ok(reply) => result_of(name, &reply.text),
                        Err(error) => {
                            // A process failure holds paths: the console of the hub has it, the page a sentence.
                            eprintln!("check of vault {name:?}: {error}");
                            failed(name, "the check of this vault failed")
                        }
                    },
                };
                set(outcome);
            }
            state.lock().unwrap_or_else(PoisonError::into_inner)["state"] = json!("done");
        });
        first
    }
}

#[cfg(test)]
mod tests {
    use super::result_of;

    #[test]
    fn a_check_is_told_with_its_numbers_and_at_most_50_findings() {
        let findings: Vec<_> = (0..60)
            .map(|i| serde_json::json!({ "severity": "error", "message": format!("m{i}") }))
            .collect();
        let doc = serde_json::json!({ "ok": false, "errors": 60, "warnings": 0, "tasks": 3, "total": 60, "findings": findings });
        let out = result_of("work", &doc.to_string());
        assert_eq!(out["state"], "done");
        assert_eq!(out["errors"], 60);
        assert_eq!(out["findings"].as_array().unwrap().len(), 50);
    }

    #[test]
    fn something_that_is_no_document_is_a_failure() {
        assert_eq!(result_of("work", "nonsense")["state"], "failed");
    }
}
