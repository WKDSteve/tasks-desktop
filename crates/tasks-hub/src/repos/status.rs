//! The state of a repo of the tiles: its checkout (clean, changed, ahead, behind) and the CI of its newest pushed
//! commit (green, red, running, queued, waiting for approval), as terminal.nvim shows it (`:Terminal repos`,
//! `docs/repos.md` there; the rules are the same, measured on the same runs).
//!
//! The hub asks `git status --porcelain=v1 -b` and `gh run list --event push` in the folder of the repo, through
//! [`Tools`] (the real one starts them as children of the hub, `appkit_core::child`: no shell, a time limit, a limit
//! for the output; the tests hand in a `git` and a `gh` that only answer). `gh` uses its own login; the hub reads no
//! token. The questions are throttled per repo: `git` at most every few seconds, `gh` once a minute, also after a
//! failure, so nothing is polled in seconds whatever the page asks.
//!
//! **Waiting for approval** is a state of its own, not red: the runner guard of testing.nvim (`docs/RUNNER-GUARD.md`)
//! refuses the job of a commit of a public repository that was not approved, and GitHub reports that as a plain
//! `failure`. It is told from a real failure by the steps: in a refused run every failed job failed only in its setup
//! step, so no step of the workflow ran.
//!
//! What the page is told never names a folder of this machine: words of a fixed set, numbers, the name of the branch,
//! the address of the run on github.com and the command that approves a commit (only of plain names and a hex sha).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use appkit_hub::BoxFuture;
use serde_json::{json, Value};

/// The smallest time between two `git status` runs of one repo.
pub const LOCAL_EVERY: Duration = Duration::from_secs(5);
/// The smallest time between two `gh` questions of one repo.
pub const CI_EVERY: Duration = Duration::from_secs(60);
/// How long one process may run.
pub const TIMEOUT: Duration = Duration::from_secs(15);
/// The most output of one process that is read.
pub const MAX_OUTPUT: usize = 1024 * 1024;
/// The most failed runs of one commit whose jobs are looked at to tell a refusal of the guard from a red run.
pub const MAX_FAILED_LOOKUPS: usize = 5;
/// The most runs of the list that are read.
const LIST_LIMIT: &str = "10";

/// The step a job fails in when the runner refuses it (`Set up job` on a GitHub-hosted runner).
const SETUP_STEPS: [&str; 2] = ["Set up runner", "Set up job"];

/// The checkout of a repo.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Local {
    pub branch: Option<String>,
    /// Files with a change (staged, unstaged or untracked; in a shared checkout those of other sessions too).
    pub changed: u32,
    pub ahead: u32,
    pub behind: u32,
    /// The upstream branch is gone.
    pub gone: bool,
}

impl Local {
    /// `clean`, `dirty`, `unpushed`, `behind` or `diverged`.
    #[must_use]
    pub fn state(&self) -> &'static str {
        if self.ahead > 0 && self.behind > 0 {
            "diverged"
        } else if self.changed > 0 {
            "dirty"
        } else if self.ahead > 0 {
            "unpushed"
        } else if self.behind > 0 {
            "behind"
        } else {
            "clean"
        }
    }
}

fn number_after(info: &str, word: &str) -> u32 {
    info.split(", ")
        .find_map(|part| part.trim().strip_prefix(word))
        .and_then(|n| n.trim().parse().ok())
        .unwrap_or(0)
}

/// Read `git status --porcelain=v1 -b`.
#[must_use]
pub fn local_state(text: &str) -> Local {
    let mut out = Local::default();
    for line in text.lines().filter(|l| !l.is_empty()) {
        let Some(head) = line.strip_prefix("## ") else {
            out.changed += 1;
            continue;
        };
        let (names, info) = match head.rsplit_once(" [") {
            Some((names, info)) if info.ends_with(']') => (names, &info[..info.len() - 1]),
            _ => (head, ""),
        };
        let branch = names.split_once("...").map_or(names, |(branch, _)| branch);
        let branch = branch.strip_prefix("No commits yet on ").unwrap_or(branch);
        out.branch = plain_branch(branch).then(|| branch.to_owned());
        out.ahead = number_after(info, "ahead ");
        out.behind = number_after(info, "behind ");
        out.gone = info.contains("gone");
    }
    out
}

/// A branch name the page is told: what git allows, without anything that is not a plain character of a name.
fn plain_branch(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 200
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-/+@".contains(&b))
}

/// One step of a job.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Step {
    pub name: String,
    pub conclusion: String,
}

/// One job of a run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Job {
    pub conclusion: String,
    pub steps: Vec<Step>,
}

/// One run of a workflow.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Run {
    pub id: Option<u64>,
    pub status: String,
    pub conclusion: String,
    pub url: String,
    /// The jobs, once they were looked at (only for a failed run).
    pub jobs: Option<Vec<Job>>,
}

/// The CI of a commit, worst first: the state of a commit with several workflows is the first of these any has.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Ci {
    Red,
    Approval,
    Running,
    Queued,
    Cancelled,
    Green,
    Skipped,
    None,
}

impl Ci {
    /// The word the page knows the state by.
    #[must_use]
    pub fn word(self) -> &'static str {
        match self {
            Self::Red => "red",
            Self::Approval => "approval",
            Self::Running => "running",
            Self::Queued => "queued",
            Self::Cancelled => "cancelled",
            Self::Green => "green",
            Self::Skipped => "skipped",
            Self::None => "none",
        }
    }
}

/// Was a failed run refused by the runner guard rather than failed by its own steps: at least one failed job, and
/// every failed job failed only in a setup step.
#[must_use]
pub fn refused_by_guard(jobs: &[Job]) -> bool {
    let mut failed = 0;
    for job in jobs.iter().filter(|j| j.conclusion == "failure") {
        failed += 1;
        let mut any = false;
        for step in job.steps.iter().filter(|s| s.conclusion == "failure") {
            any = true;
            if !SETUP_STEPS.contains(&step.name.as_str()) {
                return false;
            }
        }
        if !any {
            return false;
        }
    }
    failed > 0
}

/// The state of one run.
#[must_use]
pub fn run_state(run: &Run) -> Ci {
    match run.status.as_str() {
        "completed" => match run.conclusion.as_str() {
            "success" => Ci::Green,
            "failure" | "timed_out" | "startup_failure" => {
                if run.jobs.as_deref().is_some_and(refused_by_guard) {
                    Ci::Approval
                } else {
                    Ci::Red
                }
            }
            "cancelled" => Ci::Cancelled,
            "skipped" | "neutral" => Ci::Skipped,
            _ => Ci::Red,
        },
        "in_progress" => Ci::Running,
        "" => Ci::None,
        // queued, waiting, pending, requested
        _ => Ci::Queued,
    }
}

/// The state of a commit: the worst among its runs.
#[must_use]
pub fn ci_state(runs: &[Run]) -> Ci {
    runs.iter().map(run_state).min().unwrap_or(Ci::None)
}

fn plain_name(text: &str) -> bool {
    !text.is_empty()
        && text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
}

/// `owner/repo` of the address of a run (`https://github.com/<owner>/<repo>/actions/runs/<id>`), when the address is
/// exactly that: only such an address is ever told to the page.
#[must_use]
pub fn owner_repo_of(url: &str) -> Option<&str> {
    let rest = url.strip_prefix("https://github.com/")?;
    let mut parts = rest.split('/');
    let (owner, repo) = (parts.next()?, parts.next()?);
    let tail: Vec<&str> = parts.collect();
    let run = matches!(tail.as_slice(), ["actions", "runs", id] if !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit()));
    (plain_name(owner) && plain_name(repo) && run).then(|| &rest[..owner.len() + 1 + repo.len()])
}

/// The command that approves the commit of a refused run: `testing ci trust <owner/repo> <sha>`. It is copied to be
/// pasted into a shell, so anything but plain names and a hex sha gets no command.
#[must_use]
pub fn trust_command(owner_repo: &str, sha: &str) -> Option<String> {
    let (owner, repo) = owner_repo.split_once('/')?;
    let hex = !sha.is_empty() && sha.len() <= 64 && sha.bytes().all(|b| b.is_ascii_hexdigit());
    (plain_name(owner) && plain_name(repo) && hex)
        .then(|| format!("testing ci trust {owner_repo} {sha}"))
}

/// The two programs the hub asks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Tool {
    Git,
    Gh,
}

/// What a program said.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Said {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

/// Why a program said nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Silent {
    /// It is not installed (not on `PATH`).
    Missing,
    /// It could not be started, took too long or said too much.
    Failed,
}

/// `git` and `gh`, as the hub asks them: `args` in the folder `cwd`, never through a shell.
pub trait Tools: Send + Sync {
    fn ask<'a>(
        &'a self,
        tool: Tool,
        args: &'a [&'a str],
        cwd: &'a Path,
    ) -> BoxFuture<'a, Result<Said, Silent>>;
}

/// The programs of this machine, found once on the `PATH` the hub was started with.
pub struct SystemTools {
    git: Option<PathBuf>,
    gh: Option<PathBuf>,
}

impl SystemTools {
    /// Look for `git` and `gh` in the folders of `path` (the value of `PATH`).
    #[must_use]
    pub fn on_path(path: Option<&std::ffi::OsStr>) -> Self {
        let find = |name: &str| {
            let file = if cfg!(windows) {
                format!("{name}.exe")
            } else {
                name.to_owned()
            };
            std::env::split_paths(path?)
                .filter(|dir| dir.is_absolute())
                .map(|dir| dir.join(&file))
                .find(|candidate| candidate.is_file())
        };
        Self {
            git: find("git"),
            gh: find("gh"),
        }
    }

    /// Never ask GitHub: the CI of every repo is `unavailable` (`no_gh`), as on a machine without `gh`.
    #[must_use]
    pub fn without_gh(mut self) -> Self {
        self.gh = None;
        self
    }
}

impl Tools for SystemTools {
    fn ask<'a>(
        &'a self,
        tool: Tool,
        args: &'a [&'a str],
        cwd: &'a Path,
    ) -> BoxFuture<'a, Result<Said, Silent>> {
        use appkit_core::child::{self, Environment, Leftovers, Run as ChildRun, Start};
        Box::pin(async move {
            let (program, caller) = match tool {
                Tool::Git => (self.git.as_ref(), "tasks-hub repo status (git)"),
                Tool::Gh => (self.gh.as_ref(), "tasks-hub repo status (gh)"),
            };
            let program = program.ok_or(Silent::Missing)?;
            let start = Start::new(caller, program)
                .args(args.iter().copied())
                .cwd(cwd)
                // The person's own environment: `gh` finds its login there, `git` its settings. Nothing asks back:
                // a prompt would wait for a terminal nobody sees.
                .env(Environment::Inherited {
                    set: vec![
                        ("GIT_TERMINAL_PROMPT".into(), "0".into()),
                        ("GH_PROMPT_DISABLED".into(), "1".into()),
                        ("GH_NO_UPDATE_NOTIFIER".into(), "1".into()),
                        ("GIT_OPTIONAL_LOCKS".into(), "0".into()),
                    ],
                    remove: Vec::new(),
                });
            let said = child::run(ChildRun {
                start,
                stdin: Vec::new(),
                timeout: TIMEOUT,
                max_stdout: MAX_OUTPUT,
                max_stderr: 64 * 1024,
                leftovers: Leftovers::End,
            })
            .await
            .map_err(|_| Silent::Failed)?;
            Ok(Said {
                code: said.code,
                stdout: String::from_utf8_lossy(&said.stdout).into_owned(),
                stderr: String::from_utf8_lossy(&said.stderr).into_owned(),
            })
        })
    }
}

/// What the CI question of a repo came to.
#[derive(Debug, Clone, PartialEq, Eq)]
enum CiRow {
    /// `gh` answered.
    Known {
        state: Ci,
        url: Option<String>,
        sha: Option<String>,
        trust: Option<String>,
    },
    /// It did not: a word of a fixed set for why (`no_gh`, `login`, `offline`, `no_remote`, `failed`).
    Unavailable(&'static str),
}

#[derive(Debug, Clone, Default)]
struct Row {
    local: Option<(Instant, Result<Local, &'static str>)>,
    ci: Option<(Instant, CiRow)>,
}

/// Why `gh` did not answer, from what it wrote: a word of a fixed set (its own text may name a folder).
fn why_not(stderr: &str) -> &'static str {
    let text = stderr.to_ascii_lowercase();
    if text.contains("auth login") || text.contains("authentication") || text.contains("401") {
        "login"
    } else if text.contains("error connecting")
        || text.contains("dial tcp")
        || text.contains("no such host")
        || text.contains("could not resolve")
        || text.contains("timeout")
    {
        "offline"
    } else if text.contains("no git remotes")
        || text.contains("none of the git remotes")
        || text.contains("not a git repository")
    {
        "no_remote"
    } else {
        "failed"
    }
}

fn text_of<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or_default()
}

fn jobs_of(doc: &Value) -> Vec<Job> {
    doc["jobs"]
        .as_array()
        .map_or(&[][..], Vec::as_slice)
        .iter()
        .map(|job| Job {
            conclusion: text_of(job, "conclusion").to_owned(),
            steps: job["steps"]
                .as_array()
                .map_or(&[][..], Vec::as_slice)
                .iter()
                .map(|step| Step {
                    name: text_of(step, "name").to_owned(),
                    conclusion: text_of(step, "conclusion").to_owned(),
                })
                .collect(),
        })
        .collect()
}

/// The states of the repos, as asked last, and the times they were asked.
pub struct Status {
    tools: Arc<dyn Tools>,
    rows: tokio::sync::Mutex<HashMap<PathBuf, Row>>,
    local_every: Duration,
    ci_every: Duration,
}

impl Status {
    #[must_use]
    pub fn new(tools: Arc<dyn Tools>) -> Self {
        Self {
            tools,
            rows: tokio::sync::Mutex::new(HashMap::new()),
            local_every: LOCAL_EVERY,
            ci_every: CI_EVERY,
        }
    }

    /// Other intervals than [`LOCAL_EVERY`] and [`CI_EVERY`] (the tests).
    #[must_use]
    pub fn with_intervals(mut self, local: Duration, ci: Duration) -> Self {
        self.local_every = local;
        self.ci_every = ci;
        self
    }

    async fn local(&self, folder: &Path) -> Result<Local, &'static str> {
        // A tile whose folder is gone (moved, a drive that is not there): said as that, and nothing is started.
        if !folder.is_dir() {
            return Err("no_folder");
        }
        match self
            .tools
            .ask(Tool::Git, &["status", "--porcelain=v1", "-b"], folder)
            .await
        {
            Ok(said) if said.code == Some(0) => Ok(local_state(&said.stdout)),
            Ok(_) => Err("not_a_repo"),
            Err(Silent::Missing) => Err("no_git"),
            Err(Silent::Failed) => Err("failed"),
        }
    }

    async fn ci(&self, folder: &Path) -> CiRow {
        let list = self
            .tools
            .ask(
                Tool::Gh,
                &[
                    "run",
                    "list",
                    "--event",
                    "push",
                    "--limit",
                    LIST_LIMIT,
                    "--json",
                    "databaseId,status,conclusion,headSha,url",
                ],
                folder,
            )
            .await;
        let said = match list {
            Ok(said) if said.code == Some(0) => said,
            Ok(said) => return CiRow::Unavailable(why_not(&said.stderr)),
            Err(Silent::Missing) => return CiRow::Unavailable("no_gh"),
            Err(Silent::Failed) => return CiRow::Unavailable("failed"),
        };
        let Ok(Value::Array(list)) = serde_json::from_str::<Value>(&said.stdout) else {
            return CiRow::Unavailable("failed");
        };
        // The list is newest first: the runs of the newest commit are the leading ones with its sha.
        let Some(sha) = list.first().map(|r| text_of(r, "headSha").to_owned()) else {
            return CiRow::Known {
                state: Ci::None,
                url: None,
                sha: None,
                trust: None,
            };
        };
        let mut runs: Vec<Run> = list
            .iter()
            .take_while(|r| text_of(r, "headSha") == sha)
            .map(|r| Run {
                id: r["databaseId"].as_u64(),
                status: text_of(r, "status").to_owned(),
                conclusion: text_of(r, "conclusion").to_owned(),
                url: text_of(r, "url").to_owned(),
                jobs: None,
            })
            .collect();
        // A failed run may be a refusal of the runner guard: only the steps of its jobs tell. Every failed run is
        // looked at (a commit with two refused workflows waits for approval, it is not red), a few at most.
        let mut looked = 0;
        for run in &mut runs {
            if looked == MAX_FAILED_LOOKUPS {
                break;
            }
            let (Ci::Red, Some(id)) = (run_state(run), run.id) else {
                continue;
            };
            looked += 1;
            let id = id.to_string();
            let jobs = self
                .tools
                .ask(Tool::Gh, &["run", "view", &id, "--json", "jobs"], folder)
                .await;
            if let Ok(said) = jobs
                && said.code == Some(0)
                && let Ok(doc) = serde_json::from_str::<Value>(&said.stdout)
            {
                run.jobs = Some(jobs_of(&doc));
            }
        }
        let state = ci_state(&runs);
        // The run to open: the first one in the state of the commit (the red one of a red commit).
        let shown = runs.iter().find(|r| run_state(r) == state);
        let url = shown
            .map(|r| r.url.as_str())
            .filter(|u| owner_repo_of(u).is_some());
        let hex = !sha.is_empty() && sha.len() <= 64 && sha.bytes().all(|b| b.is_ascii_hexdigit());
        let trust = (state == Ci::Approval)
            .then(|| url.and_then(owner_repo_of))
            .flatten()
            .and_then(|owner_repo| trust_command(owner_repo, &sha));
        CiRow::Known {
            state,
            url: url.map(str::to_owned),
            sha: hex.then_some(sha),
            trust,
        }
    }

    /// The state of the repo in `folder`, asked now where the last answer is older than its interval. `fresh` asks
    /// `git` again in any case and `gh` when its last answer is older than the interval of `git` (a button of the
    /// page cannot poll `gh` in seconds either). The answer names no folder.
    pub async fn look(&self, folder: &Path, fresh: bool) -> Value {
        let now = Instant::now();
        let held = self
            .rows
            .lock()
            .await
            .get(folder)
            .cloned()
            .unwrap_or_default();
        let due = |at: Option<Instant>, every: Duration| {
            at.is_none_or(|at| now.saturating_duration_since(at) >= every)
        };
        let local = match &held.local {
            Some((at, local)) if !fresh && !due(Some(*at), self.local_every) => local.clone(),
            _ => self.local(folder).await,
        };
        let ci_every = if fresh {
            self.local_every.min(self.ci_every)
        } else {
            self.ci_every
        };
        let ci = match &held.ci {
            Some((at, ci)) if !due(Some(*at), ci_every) => (*at, ci.clone()),
            // A folder that is no checkout has no CI to ask for.
            _ if local.is_err() => (now, CiRow::Unavailable("no_remote")),
            _ => (now, self.ci(folder).await),
        };
        self.rows.lock().await.insert(
            folder.to_path_buf(),
            Row {
                local: Some((now, local.clone())),
                ci: Some(ci.clone()),
            },
        );
        let local = match local {
            Ok(l) => json!({
                "state": l.state(),
                "branch": l.branch,
                "changed": l.changed,
                "ahead": l.ahead,
                "behind": l.behind,
                "gone": l.gone,
            }),
            Err(why) => json!({ "state": "unavailable", "reason": why }),
        };
        let ci = match ci.1 {
            CiRow::Known {
                state,
                url,
                sha,
                trust,
            } => json!({ "state": state.word(), "url": url, "sha": sha, "trust": trust }),
            CiRow::Unavailable(why) => json!({ "state": "unavailable", "reason": why }),
        };
        json!({ "kind": "hub.repo_status", "local": local, "ci": ci })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[test]
    fn the_checkout_is_read_from_git_status() {
        let clean = local_state("## main...origin/main\n");
        assert_eq!(clean.state(), "clean");
        assert_eq!(clean.branch.as_deref(), Some("main"));

        let dirty = local_state("## main...origin/main [ahead 1]\n M a.rs\n?? b.rs\r\nA  c.rs\n");
        assert_eq!((dirty.changed, dirty.ahead, dirty.behind), (3, 1, 0));
        assert_eq!(dirty.state(), "dirty");

        assert_eq!(
            local_state("## main...origin/main [ahead 2]").state(),
            "unpushed"
        );
        assert_eq!(
            local_state("## main...origin/main [behind 3]").state(),
            "behind"
        );
        let both = local_state("## feat/x...origin/feat/x [ahead 2, behind 3]\n M a\n");
        assert_eq!((both.ahead, both.behind, both.state()), (2, 3, "diverged"));
        assert_eq!(both.branch.as_deref(), Some("feat/x"));

        let gone = local_state("## old...origin/old [gone]");
        assert!(gone.gone);
        assert_eq!(gone.state(), "clean");
        assert_eq!(
            local_state("## No commits yet on main").branch.as_deref(),
            Some("main")
        );
        assert_eq!(
            local_state("## HEAD (no branch)").branch,
            None,
            "not a plain name"
        );
        assert_eq!(local_state("").state(), "clean");
    }

    fn job(conclusion: &str, steps: &[(&str, &str)]) -> Job {
        Job {
            conclusion: conclusion.to_owned(),
            steps: steps
                .iter()
                .map(|(name, conclusion)| Step {
                    name: (*name).to_owned(),
                    conclusion: (*conclusion).to_owned(),
                })
                .collect(),
        }
    }

    fn run(status: &str, conclusion: &str, jobs: Option<Vec<Job>>) -> Run {
        Run {
            id: Some(1),
            status: status.to_owned(),
            conclusion: conclusion.to_owned(),
            url: "https://github.com/o/r/actions/runs/1".to_owned(),
            jobs,
        }
    }

    #[test]
    fn a_run_refused_by_the_guard_failed_only_in_its_setup_steps() {
        let refused = vec![
            job(
                "failure",
                &[("Set up runner", "failure"), ("Run tests", "skipped")],
            ),
            job("failure", &[("Set up job", "failure")]),
            job("success", &[("Set up runner", "success")]),
        ];
        assert!(refused_by_guard(&refused));
        // A step of the workflow failed: red.
        let red = vec![job(
            "failure",
            &[("Set up runner", "success"), ("Run tests", "failure")],
        )];
        assert!(!refused_by_guard(&red));
        // One refused, one really failed: red.
        let mixed = vec![
            job("failure", &[("Set up runner", "failure")]),
            job("failure", &[("Run tests", "failure")]),
        ];
        assert!(!refused_by_guard(&mixed));
        // A failed job without a failed step, and no failed job at all, are no refusal.
        assert!(!refused_by_guard(&[job(
            "failure",
            &[("Set up runner", "success")]
        )]));
        assert!(!refused_by_guard(&[job("success", &[])]));
        assert!(!refused_by_guard(&[]));
    }

    #[test]
    fn a_run_has_one_state_and_a_commit_the_worst_of_its_runs() {
        assert_eq!(run_state(&run("completed", "success", None)), Ci::Green);
        assert_eq!(run_state(&run("completed", "failure", None)), Ci::Red);
        assert_eq!(run_state(&run("completed", "timed_out", None)), Ci::Red);
        let refused = Some(vec![job("failure", &[("Set up runner", "failure")])]);
        assert_eq!(
            run_state(&run("completed", "failure", refused.clone())),
            Ci::Approval
        );
        assert_eq!(
            run_state(&run("completed", "cancelled", None)),
            Ci::Cancelled
        );
        assert_eq!(run_state(&run("completed", "skipped", None)), Ci::Skipped);
        assert_eq!(run_state(&run("completed", "neutral", None)), Ci::Skipped);
        assert_eq!(run_state(&run("completed", "something_new", None)), Ci::Red);
        assert_eq!(run_state(&run("in_progress", "", None)), Ci::Running);
        assert_eq!(run_state(&run("queued", "", None)), Ci::Queued);
        assert_eq!(run_state(&run("waiting", "", None)), Ci::Queued);
        assert_eq!(run_state(&run("", "", None)), Ci::None);

        let green = run("completed", "success", None);
        assert_eq!(ci_state(&[]), Ci::None);
        assert_eq!(
            ci_state(&[green.clone(), run("in_progress", "", None)]),
            Ci::Running
        );
        assert_eq!(
            ci_state(&[green.clone(), run("completed", "failure", refused)]),
            Ci::Approval
        );
        assert_eq!(
            ci_state(&[
                green,
                run("queued", "", None),
                run("completed", "failure", None)
            ]),
            Ci::Red
        );
    }

    #[test]
    fn only_a_run_address_of_github_and_plain_names_are_told_or_put_into_a_command() {
        assert_eq!(
            owner_repo_of("https://github.com/WKDSteve/tasks-desktop/actions/runs/123"),
            Some("WKDSteve/tasks-desktop")
        );
        for bad in [
            "http://github.com/o/r/actions/runs/1",
            "https://github.com.evil.example/o/r/actions/runs/1",
            "https://github.com/o/r/actions/runs/1?x=1",
            "https://github.com/o/r/actions/runs/",
            "https://github.com/o/r/actions/runs/1/job/2",
            "https://github.com/o/r; rm -rf ~/actions/runs/1",
            "https://github.com/o/actions/runs/1",
            "javascript:alert(1)",
            "",
        ] {
            assert_eq!(owner_repo_of(bad), None, "{bad}");
        }
        assert_eq!(
            trust_command("o/streamtap", "abc1234").as_deref(),
            Some("testing ci trust o/streamtap abc1234")
        );
        for (owner_repo, sha) in [
            ("o/r; rm -rf ~", "abc"),
            ("o/r", "abc; id"),
            ("o", "abc"),
            ("o/r/x", "abc"),
            ("o/r", ""),
            ("o/$(id)", "abc"),
            ("o/r", "xyz"),
        ] {
            assert_eq!(trust_command(owner_repo, sha), None, "{owner_repo} {sha}");
        }
    }

    /// A `git` and a `gh` that answer from a table and count what they were asked.
    #[derive(Default)]
    struct Fake {
        git: Mutex<Option<Result<Said, Silent>>>,
        list: Mutex<Option<Result<Said, Silent>>>,
        jobs: Mutex<HashMap<String, String>>,
        asked: Mutex<Vec<String>>,
    }

    fn ok(stdout: &str) -> Result<Said, Silent> {
        Ok(Said {
            code: Some(0),
            stdout: stdout.to_owned(),
            stderr: String::new(),
        })
    }

    fn refused(stderr: &str) -> Result<Said, Silent> {
        Ok(Said {
            code: Some(1),
            stdout: String::new(),
            stderr: stderr.to_owned(),
        })
    }

    impl Tools for Fake {
        fn ask<'a>(
            &'a self,
            tool: Tool,
            args: &'a [&'a str],
            _cwd: &'a Path,
        ) -> BoxFuture<'a, Result<Said, Silent>> {
            Box::pin(async move {
                self.asked.lock().unwrap().push(format!(
                    "{} {}",
                    if tool == Tool::Git { "git" } else { "gh" },
                    args.iter().take(3).copied().collect::<Vec<_>>().join(" ")
                ));
                match (tool, args.get(1).copied()) {
                    (Tool::Git, _) => self.git.lock().unwrap().clone().unwrap_or(ok("## main\n")),
                    (Tool::Gh, Some("list")) => {
                        self.list.lock().unwrap().clone().unwrap_or(ok("[]"))
                    }
                    (Tool::Gh, _) => {
                        let id = args.get(2).copied().unwrap_or_default();
                        match self.jobs.lock().unwrap().get(id) {
                            Some(text) => ok(text),
                            None => refused("no such run"),
                        }
                    }
                }
            })
        }
    }

    impl Fake {
        fn asked(&self) -> Vec<String> {
            std::mem::take(&mut *self.asked.lock().unwrap())
        }
    }

    fn status(fake: &Arc<Fake>) -> Status {
        Status::new(Arc::clone(fake) as Arc<dyn Tools>)
    }

    /// A folder that is there (the hub looks before it starts anything); no test writes into it.
    static FOLDER: std::sync::LazyLock<String> =
        std::sync::LazyLock::new(|| std::env::temp_dir().to_string_lossy().into_owned());

    #[tokio::test]
    async fn a_look_tells_the_checkout_and_the_newest_pushed_commit_and_names_no_folder() {
        let fake = Arc::new(Fake::default());
        *fake.git.lock().unwrap() = Some(ok("## main...origin/main [ahead 1]\n M a.rs\n"));
        *fake.list.lock().unwrap() = Some(ok(r#"[
            {"databaseId":9,"status":"completed","conclusion":"success","headSha":"abc123","url":"https://github.com/o/r/actions/runs/9"},
            {"databaseId":8,"status":"in_progress","conclusion":"","headSha":"abc123","url":"https://github.com/o/r/actions/runs/8"},
            {"databaseId":7,"status":"completed","conclusion":"failure","headSha":"older","url":"https://github.com/o/r/actions/runs/7"}
        ]"#));
        let doc = status(&fake).look(Path::new(FOLDER.as_str()), false).await;
        assert_eq!(
            doc,
            json!({
                "kind": "hub.repo_status",
                "local": { "state": "dirty", "branch": "main", "changed": 1, "ahead": 1, "behind": 0, "gone": false },
                "ci": { "state": "running", "url": "https://github.com/o/r/actions/runs/8", "sha": "abc123", "trust": null },
            })
        );
        assert!(!doc.to_string().contains(FOLDER.as_str()), "{doc}");
        // The older commit's failed run is not looked at.
        assert_eq!(
            fake.asked(),
            ["git status --porcelain=v1 -b", "gh run list --event"]
        );
    }

    #[tokio::test]
    async fn a_failed_run_refused_by_the_guard_waits_for_approval_with_the_command() {
        let fake = Arc::new(Fake::default());
        *fake.list.lock().unwrap() = Some(ok(r#"[
            {"databaseId":5,"status":"completed","conclusion":"failure","headSha":"abc1234","url":"https://github.com/o/streamtap/actions/runs/5"},
            {"databaseId":4,"status":"completed","conclusion":"success","headSha":"abc1234","url":"https://github.com/o/streamtap/actions/runs/4"}
        ]"#));
        fake.jobs.lock().unwrap().insert(
            "5".to_owned(),
            r#"{"jobs":[{"conclusion":"failure","steps":[{"name":"Set up runner","conclusion":"failure"},{"name":"Test","conclusion":"skipped"}]}]}"#.to_owned(),
        );
        let doc = status(&fake).look(Path::new(FOLDER.as_str()), false).await;
        assert_eq!(doc["ci"]["state"], "approval");
        assert_eq!(doc["ci"]["trust"], "testing ci trust o/streamtap abc1234");
        assert_eq!(
            doc["ci"]["url"],
            "https://github.com/o/streamtap/actions/runs/5"
        );
        assert_eq!(
            fake.asked(),
            [
                "git status --porcelain=v1 -b",
                "gh run list --event",
                "gh run view 5"
            ]
        );

        // The same run with a failed step of the workflow is red, and gets no command.
        fake.jobs.lock().unwrap().insert(
            "5".to_owned(),
            r#"{"jobs":[{"conclusion":"failure","steps":[{"name":"Test","conclusion":"failure"}]}]}"#.to_owned(),
        );
        let doc = status(&fake).look(Path::new(FOLDER.as_str()), false).await;
        assert_eq!(doc["ci"]["state"], "red");
        assert_eq!(doc["ci"]["trust"], Value::Null);
        // The jobs cannot be read: red, not a guess.
        fake.jobs.lock().unwrap().clear();
        let doc = status(&fake).look(Path::new(FOLDER.as_str()), false).await;
        assert_eq!(doc["ci"]["state"], "red");
    }

    #[tokio::test]
    async fn without_gh_offline_or_outside_a_checkout_the_answer_is_a_word_not_an_error() {
        let fake = Arc::new(Fake::default());
        *fake.list.lock().unwrap() = Some(Err(Silent::Missing));
        let doc = status(&fake).look(Path::new(FOLDER.as_str()), false).await;
        assert_eq!(
            doc["ci"],
            json!({ "state": "unavailable", "reason": "no_gh" })
        );
        assert_eq!(doc["local"]["state"], "clean");

        for (stderr, word) in [
            (
                "To get started with GitHub CLI, please run:  gh auth login",
                "login",
            ),
            ("error connecting to api.github.com", "offline"),
            ("dial tcp: lookup api.github.com: no such host", "offline"),
            ("no git remotes found", "no_remote"),
            ("something else in E:/secret/place", "failed"),
        ] {
            *fake.list.lock().unwrap() = Some(refused(stderr));
            let doc = status(&fake).look(Path::new(FOLDER.as_str()), false).await;
            assert_eq!(
                doc["ci"],
                json!({ "state": "unavailable", "reason": word }),
                "{stderr}"
            );
        }
        *fake.list.lock().unwrap() = Some(ok("not json"));
        let doc = status(&fake).look(Path::new(FOLDER.as_str()), false).await;
        assert_eq!(doc["ci"]["reason"], "failed");

        // No checkout: git says so, and gh is not asked at all.
        *fake.git.lock().unwrap() = Some(refused("fatal: not a git repository: E:/secret/place"));
        fake.asked();
        let doc = status(&fake).look(Path::new(FOLDER.as_str()), false).await;
        assert_eq!(
            doc["local"],
            json!({ "state": "unavailable", "reason": "not_a_repo" })
        );
        assert_eq!(
            doc["ci"],
            json!({ "state": "unavailable", "reason": "no_remote" })
        );
        assert_eq!(fake.asked(), ["git status --porcelain=v1 -b"]);
        *fake.git.lock().unwrap() = Some(Err(Silent::Missing));
        let doc = status(&fake).look(Path::new(FOLDER.as_str()), false).await;
        assert_eq!(doc["local"]["reason"], "no_git");
        assert!(!doc.to_string().contains(FOLDER.as_str()));
        assert!(!doc.to_string().contains("secret"));
    }

    #[tokio::test]
    async fn the_questions_are_throttled_per_repo_also_for_a_fresh_look() {
        let fake = Arc::new(Fake::default());
        let status =
            status(&fake).with_intervals(Duration::from_secs(3600), Duration::from_secs(7200));
        status.look(Path::new(FOLDER.as_str()), false).await;
        assert_eq!(
            fake.asked(),
            ["git status --porcelain=v1 -b", "gh run list --event"]
        );
        // Asked again at once: both answers are held.
        let doc = status.look(Path::new(FOLDER.as_str()), false).await;
        assert_eq!(doc["local"]["state"], "clean");
        assert_eq!(fake.asked(), Vec::<String>::new());
        // A fresh look asks git, and gh only when its answer is older than the interval of git.
        status.look(Path::new(FOLDER.as_str()), true).await;
        assert_eq!(fake.asked(), ["git status --porcelain=v1 -b"]);
        // Another repo has its own times.
        let other = std::env::current_dir().unwrap();
        status.look(&other, false).await;
        assert_eq!(
            fake.asked(),
            ["git status --porcelain=v1 -b", "gh run list --event"]
        );

        // With no interval every look asks; a failure is held like an answer.
        let eager = Status::new(Arc::clone(&fake) as Arc<dyn Tools>)
            .with_intervals(Duration::ZERO, Duration::from_secs(7200));
        *fake.list.lock().unwrap() = Some(refused("error connecting to api.github.com"));
        eager.look(Path::new(FOLDER.as_str()), false).await;
        eager.look(Path::new(FOLDER.as_str()), false).await;
        assert_eq!(
            fake.asked(),
            [
                "git status --porcelain=v1 -b",
                "gh run list --event",
                "git status --porcelain=v1 -b"
            ]
        );
    }

    #[tokio::test]
    async fn only_a_few_failed_runs_of_a_commit_are_looked_at() {
        let fake = Arc::new(Fake::default());
        let runs: Vec<Value> = (1..=8)
            .map(|i| json!({ "databaseId": i, "status": "completed", "conclusion": "failure", "headSha": "abc", "url": format!("https://github.com/o/r/actions/runs/{i}") }))
            .collect();
        *fake.list.lock().unwrap() = Some(ok(&Value::Array(runs).to_string()));
        status(&fake).look(Path::new(FOLDER.as_str()), false).await;
        let views = fake
            .asked()
            .iter()
            .filter(|a| a.starts_with("gh run view"))
            .count();
        assert_eq!(views, MAX_FAILED_LOOKUPS);
    }

    #[tokio::test]
    async fn a_tile_whose_folder_is_gone_is_said_as_that_and_nothing_is_started() {
        let fake = Arc::new(Fake::default());
        let doc = status(&fake)
            .look(Path::new("E:/no/such/folder/of/a/tile"), false)
            .await;
        assert_eq!(
            doc["local"],
            json!({ "state": "unavailable", "reason": "no_folder" })
        );
        assert_eq!(
            doc["ci"],
            json!({ "state": "unavailable", "reason": "no_remote" })
        );
        assert_eq!(fake.asked(), Vec::<String>::new());
    }

    /// By hand (`cargo test -p tasks-hub --lib real_git_and_gh -- --ignored --nocapture`): the real `git` and `gh` of
    /// this machine, asked in this checkout. Needs both programs, a login of `gh` and the network, so it is not part
    /// of a run of the tests.
    #[tokio::test]
    #[ignore = "asks the real git and gh of this machine, and GitHub"]
    async fn real_git_and_gh_answer_for_this_checkout() {
        let tools = SystemTools::on_path(std::env::var_os("PATH").as_deref());
        assert!(tools.git.is_some(), "git is on the PATH");
        let here = std::env::current_dir().unwrap();
        let doc = Status::new(Arc::new(tools)).look(&here, false).await;
        println!("{doc:#}");
        assert_ne!(doc["local"]["state"], "unavailable", "{doc}");
        assert!(doc["local"]["branch"].is_string(), "{doc}");
        assert!(doc["ci"]["state"].is_string(), "{doc}");
        assert!(!doc.to_string().contains(&*here.to_string_lossy()), "{doc}");
    }

    #[test]
    fn the_programs_are_found_on_the_path_or_are_missing() {
        let none = SystemTools::on_path(None);
        assert!(none.git.is_none() && none.gh.is_none());
        let empty = SystemTools::on_path(Some(std::ffi::OsStr::new("")));
        assert!(empty.git.is_none());
    }
}
