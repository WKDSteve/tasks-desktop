//! Run the test sheets of one task now, from the page: the engine's `sheet-run <id>` as a process of its own (it starts
//! `testing sheets run`, which writes the state into the block of the task; the watcher brings that change to the page).
//! One run at a time: a sheet may take minutes. Whether a sheet may run at all (trust, the workstation) is testing.nvim's
//! decision; its refusal comes back in the output and the exit code.
//!
//! The process is a child of the hub (`appkit_core::child`): no console window, a time limit and a limit for its output,
//! and it ends with the hub, together with everything it started (a sheet runs a plugin's tests, which start processes
//! of their own).

use std::collections::VecDeque;
use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use appkit_core::child::{self, Environment, Leftovers, ProcError, Run, Start, Stream};
use appkit_hub::BoxFuture;
use serde_json::{json, Value};

/// The most lines of a run the page gets: the end, where the verdict stands.
const MAX_LINES: usize = 40;

/// The most characters of one line the page gets: nothing but the limit of the output keeps a line short.
const MAX_LINE_CHARS: usize = 2000;

/// How long a run may take and how much it may write before it is ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SheetLimits {
    pub timeout: Duration,
    /// For each of stdout and stderr, in bytes.
    pub max_output: usize,
}

impl Default for SheetLimits {
    /// 35 minutes and 16 MiB for each stream (the page gets the last 40 lines). The engine ends the sheets itself
    /// after 30 minutes (`TIMEOUT_MS` of its `sheet_run.lua`) and then says what they wrote until then; the limit
    /// here is the net below that, for a run the engine does not end, and so it has to be the longer one.
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(35 * 60),
            max_output: 16 * 1024 * 1024,
        }
    }
}

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
    /// As the engine process gets them: the settings are not in the environment of the hub.
    pub lib_dir: Option<PathBuf>,
    pub extra_areas: Vec<String>,
}

/// Runs the engine's command line. The vault is asked for at each run: it may have changed since the hub started.
pub struct SystemSheetRunner {
    pub command: Arc<dyn Fn() -> BoxFuture<'static, Result<SheetCommand, String>> + Send + Sync>,
    pub limits: SheetLimits,
}

impl SheetRunner for SystemSheetRunner {
    fn run<'a>(&'a self, id: &'a str) -> BoxFuture<'a, Result<SheetRun, String>> {
        Box::pin(async move {
            let command = (self.command)().await?;
            run_process(&command, id, self.limits).await
        })
    }
}

/// Whether a variable of the hub's environment is the engine's own (`TASKS_VAULT`, `TASKS_MARKER_DOCS`,
/// `TASKS_EXTRA_AREAS`, ...): a sheet run must not inherit it. Windows names are not case sensitive.
fn is_engine_var(name: &std::ffi::OsStr) -> bool {
    name.to_str()
        // by the bytes: a name may hold any character, and a cut inside one would panic
        .is_some_and(|n| n.len() > 6 && n.as_bytes()[..6].eq_ignore_ascii_case(b"TASKS_"))
}

/// The environment of a run. It keeps that of the hub: a sheet runs a plugin's tests through testing.nvim, which needs
/// `PATH`, the tool chains, `TESTING_*` and `NVIM_MACHINE_ROLE` (without it the workstation guard would not know where
/// it runs), so a list of what may pass would break runs or that guard. What it takes out is the engine's own
/// variables as the hub was started with them (`inherited`: the names of the hub's environment): the vault, the marker
/// documents and the extra areas of the run are those of the settings, set here, and a test of a sheet must never read
/// the real vault or the marker documents of this machine. The engine process of the hub gets none of them either
/// (`child_env` of appkit-hub).
fn environment_for(c: &SheetCommand, inherited: impl IntoIterator<Item = OsString>) -> Environment {
    // Neovim finds its own runtime: one the person has set would be that of another version.
    let mut remove: Vec<OsString> = vec!["VIM".into(), "VIMRUNTIME".into()];
    remove.extend(inherited.into_iter().filter(|name| is_engine_var(name)));
    // What the settings say is set after the removal and wins.
    let mut set: Vec<(OsString, OsString)> = Vec::new();
    if let Some(lib) = &c.lib_dir {
        set.push(("LIB_NVIM_DIR".into(), lib.into()));
    }
    if !c.extra_areas.is_empty() {
        set.push(("TASKS_EXTRA_AREAS".into(), c.extra_areas.join(",").into()));
    }
    Environment::Inherited { set, remove }
}

/// What is started for a run. The path of Neovim is the one of the settings or of `PATH`, taken as it is.
fn start_for(c: &SheetCommand, id: &str) -> Start {
    Start::as_given("tasks-hub sheet run", &c.nvim)
        .args(["--headless", "-u", "NONE", "-i", "NONE", "-n", "-l"])
        .arg(&c.script)
        .args(["sheet-run", id])
        .arg(format!("--vault={}", c.vault.display()))
        .env(environment_for(
            c,
            std::env::vars_os().map(|(name, _)| name),
        ))
}

async fn run_process(c: &SheetCommand, id: &str, limits: SheetLimits) -> Result<SheetRun, String> {
    // One end for each stream: the engine says the lines of the sheets on stdout and its verdict on stderr, and the
    // two pipes are read as they come, so only the order inside each is certain.
    let (mut out, mut err) = (Tail::default(), Tail::default());
    let run = Run {
        start: start_for(c, id),
        stdin: Vec::new(),
        timeout: limits.timeout,
        max_stdout: limits.max_output,
        max_stderr: limits.max_output,
        // Nothing stays behind a run: what the sheets started and left running is ended with it.
        leftovers: Leftovers::End,
    };
    let said = child::run_lines(run, |stream, line| match stream {
        Stream::Stdout => out.push(line),
        Stream::Stderr => err.push(line),
    })
    .await;
    match said {
        Ok(code) => Ok(SheetRun {
            code,
            lines: end_of(out, err),
        }),
        Err(e) => {
            eprintln!("sheet run of {id}: {e}");
            Err(told(&e))
        }
    }
}

/// What the page is told when a run did not come to its own end. The child and what it started are gone by then.
fn told(error: &ProcError) -> String {
    const MIB: usize = 1024 * 1024;
    match error {
        ProcError::Spawn(_) => "the run could not be started".to_owned(),
        ProcError::Io(_) => "the run stopped unexpectedly".to_owned(),
        ProcError::Timeout(limit) => {
            let seconds = limit.as_secs();
            let time = if seconds >= 60 && seconds.is_multiple_of(60) {
                format!("{} minutes", seconds / 60)
            } else {
                format!("{seconds} seconds")
            };
            format!("the run was ended: it took longer than {time}")
        }
        ProcError::TooLarge { limit, .. } => {
            let size = if *limit >= MIB && limit.is_multiple_of(MIB) {
                format!("{} MB", limit / MIB)
            } else {
                format!("{limit} bytes")
            };
            format!("the run was ended: it wrote more than {size} of output")
        }
    }
}

/// What the page gets of a run: stdout, then stderr (where the verdict of the engine stands), and of that the end.
fn end_of(out: Tail, err: Tail) -> Vec<String> {
    let mut lines = out.lines;
    lines.extend(err.lines);
    let skip = lines.len().saturating_sub(MAX_LINES);
    lines.into_iter().skip(skip).collect()
}

/// The end of one stream as it arrives, without control characters: the text of a sheet is not ours.
#[derive(Default)]
struct Tail {
    lines: VecDeque<String>,
}

impl Tail {
    fn push(&mut self, line: &str) {
        let line: String = line
            .chars()
            .filter(|c| !c.is_control())
            .take(MAX_LINE_CHARS)
            .collect();
        if line.trim().is_empty() {
            return;
        }
        if self.lines.len() == MAX_LINES {
            self.lines.pop_front();
        }
        self.lines.push_back(line);
    }
}

/// Holds the place of a run. A run that ends without saying how (it panicked) must not keep the place for good: no
/// other run could start until the hub is started again.
struct Place {
    state: Arc<Mutex<Value>>,
    id: String,
}

impl Drop for Place {
    fn drop(&mut self) {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        if state["state"] == "running" {
            *state = json!({ "state": "failed", "id": self.id, "message": "the run stopped unexpectedly" });
        }
    }
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
        let place = Place {
            state: Arc::clone(&self.state),
            id: id.to_owned(),
        };
        tokio::spawn(async move {
            let Place { state, id } = &place;
            let done = match runner.run(id).await {
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
    use super::{
        end_of, environment_for, told, SheetCommand, SheetRun, SheetRunJob, SheetRunner, Tail,
        MAX_LINE_CHARS,
    };
    use appkit_core::child::{Environment, ProcError};
    use appkit_hub::BoxFuture;
    use std::ffi::{OsStr, OsString};
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::time::Duration;

    fn sheet_command(extra_areas: &[&str]) -> SheetCommand {
        SheetCommand {
            nvim: PathBuf::from("nvim"),
            script: PathBuf::from("tasks.lua"),
            vault: PathBuf::from("vault"),
            lib_dir: Some(PathBuf::from("lib")),
            extra_areas: extra_areas.iter().map(|s| (*s).to_owned()).collect(),
        }
    }

    /// What the run does with the variables of the hub: those it takes out and those it sets.
    fn changes(
        c: &SheetCommand,
        inherited: &[OsString],
    ) -> (Vec<OsString>, Vec<(OsString, OsString)>) {
        match environment_for(c, inherited.iter().cloned()) {
            Environment::Inherited { set, remove } => (remove, set),
            Environment::Only(_) => panic!("a run keeps the environment of the hub"),
        }
    }

    #[test]
    fn a_run_never_inherits_the_engines_variables_of_the_hub_and_keeps_the_rest() {
        let inherited = [
            "TASKS_VAULT",
            "TASKS_MARKER_DOCS",
            "tasks_links",
            "TASKS_EXTRA_AREAS",
            "PATH",
            "NVIM_MACHINE_ROLE",
            "TESTING_TRUST_ROOTS",
            "TASKS",
            "ABCDE\u{c4}X",
            "TASKS\u{c4}",
        ]
        .map(OsString::from);
        let (remove, set) = changes(&sheet_command(&[]), &inherited);
        let removed = |name: &str| remove.iter().any(|r| r == OsStr::new(name));
        for name in [
            "TASKS_VAULT",
            "TASKS_MARKER_DOCS",
            "tasks_links",
            "TASKS_EXTRA_AREAS",
            "VIM",
            "VIMRUNTIME",
        ] {
            assert!(removed(name), "{name} is taken out");
        }
        for name in [
            "PATH",
            "NVIM_MACHINE_ROLE",
            "TESTING_TRUST_ROOTS",
            "TASKS",
            "ABCDE\u{c4}X",
            "TASKS\u{c4}",
        ] {
            assert!(!removed(name), "{name} is inherited as it is");
        }
        assert_eq!(
            set,
            [(OsString::from("LIB_NVIM_DIR"), OsString::from("lib"))],
            "without extra areas none are set, and those of the hub stay out"
        );
        // what the settings say is set after the removal and wins
        let (remove, set) = changes(&sheet_command(&["ALL", "x.nvim"]), &inherited);
        assert!(remove.iter().any(|r| r == OsStr::new("TASKS_EXTRA_AREAS")));
        assert!(set.contains(&("TASKS_EXTRA_AREAS".into(), "ALL,x.nvim".into())));
        assert!(set.contains(&("LIB_NVIM_DIR".into(), "lib".into())));
    }

    #[test]
    fn the_page_gets_the_end_of_the_output_as_plain_lines() {
        let mut tail = Tail::default();
        for i in 0..60 {
            tail.push(&format!("line {i}"));
        }
        let lines = end_of(tail, Tail::default());
        assert_eq!(lines.len(), 40);
        assert_eq!(lines[39], "line 59");

        let mut tail = Tail::default();
        tail.push("a\u{1b}[31mb");
        tail.push("");
        tail.push(" \t");
        tail.push(&"x".repeat(MAX_LINE_CHARS + 10));
        assert_eq!(
            end_of(tail, Tail::default()),
            ["a[31mb".to_owned(), "x".repeat(MAX_LINE_CHARS)]
        );
    }

    #[test]
    fn the_verdict_on_stderr_is_the_end_however_the_two_streams_arrived() {
        // stderr first, as a stream without a buffer arrives before one with a buffer
        let (mut out, mut err) = (Tail::default(), Tail::default());
        err.push("sheet-run: red: sheet x failed");
        for i in 0..60 {
            out.push(&format!("line {i}"));
        }
        let lines = end_of(out, err);
        assert_eq!(lines.len(), 40);
        assert_eq!(lines[38], "line 59");
        assert_eq!(lines[39], "sheet-run: red: sheet x failed");
    }

    /// A run that panics instead of answering.
    struct Panics;

    impl SheetRunner for Panics {
        fn run<'a>(&'a self, _id: &'a str) -> BoxFuture<'a, Result<SheetRun, String>> {
            Box::pin(async move { panic!("a run that panics") })
        }
    }

    #[tokio::test]
    async fn a_run_that_panics_gives_its_place_back_and_the_page_is_told() {
        let job = SheetRunJob::new(Arc::new(Panics));
        assert_eq!(job.start("a/b")["state"], "running");
        let mut state = job.state();
        for _ in 0..500 {
            if state["state"] != "running" {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
            state = job.state();
        }
        assert_eq!(state["state"], "failed", "{state}");
        assert_eq!(state["id"], "a/b");
        assert_eq!(state["message"], "the run stopped unexpectedly");
    }

    #[test]
    fn a_run_that_was_ended_is_told_in_a_sentence() {
        let io = || std::io::Error::other("C:\\Users\\someone\\nvim.exe");
        assert_eq!(
            told(&ProcError::Timeout(Duration::from_secs(1800))),
            "the run was ended: it took longer than 30 minutes"
        );
        assert_eq!(
            told(&ProcError::Timeout(Duration::from_secs(90))),
            "the run was ended: it took longer than 90 seconds"
        );
        assert_eq!(
            told(&ProcError::TooLarge {
                stream: "stdout",
                limit: 16 * 1024 * 1024
            }),
            "the run was ended: it wrote more than 16 MB of output"
        );
        assert_eq!(
            told(&ProcError::TooLarge {
                stream: "stderr",
                limit: 1000
            }),
            "the run was ended: it wrote more than 1000 bytes of output"
        );
        // the reason of the system (a path, a name) goes to the console of the hub, not to the page
        assert_eq!(
            told(&ProcError::Spawn(io())),
            "the run could not be started"
        );
        assert_eq!(told(&ProcError::Io(io())), "the run stopped unexpectedly");
    }
}
