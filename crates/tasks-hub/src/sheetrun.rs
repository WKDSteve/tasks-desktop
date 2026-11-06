//! Run the test sheets of one task now, from the page: the engine's `sheet-run <id>` as a process of its own (it starts
//! `testing sheets run`, which writes the state into the block of the task; the watcher brings that change to the page).
//! One run at a time: a sheet may take minutes. Whether a sheet may run at all (trust, the workstation) is testing.nvim's
//! decision; its refusal comes back in the output and the exit code.

use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex, PoisonError};

use appkit_hub::BoxFuture;
use serde_json::{json, Value};

/// The most lines of a run the page gets: the end, where the verdict stands.
const MAX_LINES: usize = 40;

/// What a run was asked to do and said.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SheetRun {
    pub code: Option<i32>,
    pub lines: Vec<String>,
}

/// How a run is made. The program has [`SystemSheetRunner`]; a test has one that answers.
pub trait SheetRunner: Send + Sync {
    /// Run the sheets of `id` to their end.
    fn run<'a>(&'a self, id: &'a str) -> BoxFuture<'a, Result<SheetRun, String>>;
}

/// The command of the vault that is read when the run starts.
pub struct SheetCommand {
    pub nvim: PathBuf,
    pub script: PathBuf,
    pub vault: PathBuf,
}

/// Runs the engine's command line. The vault is asked for at each run: it may have changed since the hub started.
pub struct SystemSheetRunner {
    pub command: Arc<dyn Fn() -> BoxFuture<'static, Result<SheetCommand, String>> + Send + Sync>,
}

impl SheetRunner for SystemSheetRunner {
    fn run<'a>(&'a self, id: &'a str) -> BoxFuture<'a, Result<SheetRun, String>> {
        Box::pin(async move {
            let command = (self.command)().await?;
            let id = id.to_owned();
            tokio::task::spawn_blocking(move || run_process(&command, &id))
                .await
                .map_err(|_| "the run stopped unexpectedly".to_owned())?
        })
    }
}

fn run_process(c: &SheetCommand, id: &str) -> Result<SheetRun, String> {
    let mut command = Command::new(&c.nvim);
    command
        .args(["--headless", "-u", "NONE", "-i", "NONE", "-n", "-l"])
        .arg(&c.script)
        .args(["sheet-run", id])
        .arg(format!("--vault={}", c.vault.display()))
        .stdin(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: no console window for a process the hub starts, as for its engine.
        command.creation_flags(0x0800_0000);
    }
    let out = command.output().map_err(|e| {
        eprintln!("sheet run of {id}: {e}");
        "the run could not be started".to_owned()
    })?;
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(SheetRun {
        code: out.status.code(),
        lines: last_lines(&text),
    })
}

/// The end of the output, without control characters: the text of a sheet is not ours.
fn last_lines(text: &str) -> Vec<String> {
    let lines: Vec<String> = text
        .lines()
        .map(|line| line.chars().filter(|c| !c.is_control()).collect::<String>())
        .filter(|line| !line.trim().is_empty())
        .collect();
    let skip = lines.len().saturating_sub(MAX_LINES);
    lines.into_iter().skip(skip).collect()
}

/// The job: one run at a time, and what the last one said.
pub struct SheetRunJob {
    runner: Arc<dyn SheetRunner>,
    state: Arc<Mutex<Value>>,
}

impl SheetRunJob {
    #[must_use]
    pub fn new(runner: Arc<dyn SheetRunner>) -> Self {
        Self {
            runner,
            state: Arc::new(Mutex::new(json!({ "state": "idle" }))),
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

    /// Start a run of `id` unless one runs; where the job stands then (a run of another task says which).
    #[must_use]
    pub fn start(&self, id: &str) -> Value {
        let first = {
            let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
            if state["state"] == "running" {
                return state.clone();
            }
            *state = json!({ "state": "running", "id": id });
            state.clone()
        };
        let runner = Arc::clone(&self.runner);
        let state = Arc::clone(&self.state);
        let id = id.to_owned();
        tokio::spawn(async move {
            let done = match runner.run(&id).await {
                Ok(run) => json!({
                    "state": "done",
                    "id": id,
                    "code": run.code,
                    "lines": run.lines,
                }),
                Err(message) => json!({ "state": "failed", "id": id, "message": message }),
            };
            *state.lock().unwrap_or_else(PoisonError::into_inner) = done;
        });
        first
    }
}

#[cfg(test)]
mod tests {
    use super::last_lines;

    #[test]
    fn the_page_gets_the_end_of_the_output_as_plain_lines() {
        let many: String = (0..60).map(|i| format!("line {i}\r\n")).collect();
        let lines = last_lines(&many);
        assert_eq!(lines.len(), 40);
        assert_eq!(lines[39], "line 59");
        assert_eq!(last_lines("a\u{1b}[31mb\n\n"), ["a[31mb"]);
    }
}
