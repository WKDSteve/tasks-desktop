//! Hands a task to an agent: the job intake of ai-desktop (`POST /jobs`, `docs/JOBS.md` of ai-desktop).
//!
//! The page names a task and what it asks for; the hub reads the task file and sends it. ai-desktop is reached the way
//! `:Tasks agent` of tasks.nvim reaches it, between two programs of the person on this machine:
//!
//! 1. `hub.json` of a running ai-desktop (`appkit_core::family`: a record of `ai-desktop` whose process is alive), in
//!    its config folder (`AI_DESKTOP_CONFIG_DIR`, else `%APPDATA%\ai-desktop`).
//! 2. `GET /health` on that port answers as ai-desktop with the instance of `hub.json`: the secret never goes to
//!    another program that took the port.
//! 3. `control.secret` beside `hub.json`, read anew (it changes with every start of ai-desktop), sent in the
//!    `Authorization` header and nowhere else: never logged, never in an answer to the page.
//! 4. `POST /jobs` with `{ source, task_id, title, markdown, vault, area, mode, kind, private }`, without `Origin`
//!    (a request with one is a browser's, which ai-desktop refuses).
//!
//! The page never speaks to ai-desktop: it gets the job id and the status, nothing of the secret or the port.

use std::path::PathBuf;

use appkit_core::family;
use appkit_core::registry;
use appkit_hub::BoxFuture;
use serde::Serialize;

use crate::config::Env;

/// The name this app sends as `source`.
pub const SOURCE: &str = "tasks-desktop";
/// What a job may do with the task: stand ready in the dashboard, or run at once.
pub const MODES: [&str; 2] = ["prefill", "run"];
/// What a job asks for (`kind` of `POST /jobs`).
pub const KINDS: [&str; 5] = [
    "handoff",
    "review-done",
    "draft-task",
    "prepare-decision",
    "split-plan",
];
/// ai-desktop takes a task file of up to 256 KiB.
pub const MAX_MARKDOWN: u64 = 256 * 1024;

const APP: &str = "ai-desktop";
const ENV_PREFIX: &str = "AI_DESKTOP";

/// The body of `POST /jobs`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Job {
    pub source: String,
    pub task_id: String,
    pub title: String,
    pub markdown: String,
    pub vault: String,
    pub area: String,
    pub mode: String,
    pub kind: String,
    /// The area is private or not classified: ai-desktop sends it to a local model only, or asks first.
    pub private: bool,
    /// `draft-task` only: the values the vault allows (`areas`, `kinds`, `tags`, `categories`, `plans`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub choices: Option<serde_json::Value>,
}

/// What ai-desktop answered (`201`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct JobAnswer {
    pub job_id: String,
    /// `prefilled`, `running` or `needs_confirmation`.
    pub status: String,
    pub private: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// The loopback port of ai-desktop: the page may open its dashboard at the job (`/#job=<id>`) when the person asked
    /// for it. Not a secret (`hub.json` says it to any program); the control secret never leaves the hub.
    pub port: u16,
}

/// Why a job did not reach ai-desktop.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Refusal {
    /// No `hub.json` of a live ai-desktop.
    NotRunning,
    /// The program on the port of `hub.json` is not that ai-desktop: nothing was sent.
    NotAiDesktop,
    /// The control secret is missing or not 64 hex digits.
    NoSecret,
    /// ai-desktop answered, but not with a job: its status and its message (one line).
    Refused { status: u16, message: String },
    /// The connection failed.
    Failed(String),
}

impl Refusal {
    /// The code of the answer to the page.
    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotRunning => "ai_desktop_not_running",
            Self::NotAiDesktop => "ai_desktop_mismatch",
            Self::NoSecret => "ai_desktop_secret",
            Self::Refused { .. } => "ai_desktop_refused",
            Self::Failed(_) => "ai_desktop_failed",
        }
    }

    /// The message of the answer to the page: what happened, never the secret.
    #[must_use]
    pub fn message(&self) -> String {
        match self {
            Self::NotRunning => "ai-desktop is not running".to_owned(),
            Self::NotAiDesktop => {
                "the program on the port of ai-desktop is not ai-desktop; nothing was sent"
                    .to_owned()
            }
            Self::NoSecret => "the control secret of ai-desktop cannot be read".to_owned(),
            Self::Refused { status, message } => {
                format!("ai-desktop refused the task ({status}): {message}")
            }
            Self::Failed(why) => format!("the hand-over failed: {why}"),
        }
    }
}

/// Where a job goes.
pub trait JobIntake: Send + Sync {
    fn send<'a>(&'a self, job: &'a Job) -> BoxFuture<'a, Result<JobAnswer, Refusal>>;

    /// The job as ai-desktop keeps it (`GET /jobs/<id>` with the secret): its status and, for a draft, `draft` or
    /// `draft_error`. An intake without jobs to read says it is not running.
    fn job<'a>(&'a self, _id: &'a str) -> BoxFuture<'a, Result<serde_json::Value, Refusal>> {
        Box::pin(async { Err(Refusal::NotRunning) })
    }

    /// Runs a job that waits for a yes (`needs_confirmation`), after the person said yes on the page:
    /// `POST /jobs/<id>/run` with `confirm_private` and the secret.
    fn confirm<'a>(&'a self, _id: &'a str) -> BoxFuture<'a, Result<(), Refusal>> {
        Box::pin(async { Err(Refusal::NotRunning) })
    }

    /// Puts a job away that nobody waits for any more (the person said no to its question, or closed the form):
    /// `DELETE /jobs/<id>` with the secret. A job that is gone already is put away.
    fn discard<'a>(&'a self, _id: &'a str) -> BoxFuture<'a, Result<(), Refusal>> {
        Box::pin(async { Err(Refusal::NotRunning) })
    }
}

/// The running ai-desktop of this machine, found in the environment `env`.
pub struct AiDesktop {
    env: Env,
}

impl AiDesktop {
    #[must_use]
    pub fn new(env: Env) -> Self {
        Self { env }
    }

    fn config_dir(&self) -> Option<PathBuf> {
        let vars = |name: &str| self.env.path(name);
        family::config_dir(&vars, APP, ENV_PREFIX)
    }

    /// The config folder and the record of the running ai-desktop.
    async fn found(&self) -> Result<(PathBuf, registry::HubRecord), Refusal> {
        let dir = self.config_dir().ok_or(Refusal::NotRunning)?;
        let record = {
            let dir = dir.clone();
            tokio::task::spawn_blocking(move || family::running_record(&dir, APP))
                .await
                .map_err(|e| Refusal::Failed(e.to_string()))?
                .ok_or(Refusal::NotRunning)?
        };
        Ok((dir, record))
    }
}

impl JobIntake for AiDesktop {
    fn send<'a>(&'a self, job: &'a Job) -> BoxFuture<'a, Result<JobAnswer, Refusal>> {
        Box::pin(async move {
            let (dir, record) = self.found().await?;
            send_to(record.port, &record.instance, &dir, job).await
        })
    }

    fn job<'a>(&'a self, id: &'a str) -> BoxFuture<'a, Result<serde_json::Value, Refusal>> {
        Box::pin(async move {
            let (dir, record) = self.found().await?;
            job_of(record.port, &record.instance, &dir, id).await
        })
    }

    fn confirm<'a>(&'a self, id: &'a str) -> BoxFuture<'a, Result<(), Refusal>> {
        Box::pin(async move {
            let (dir, record) = self.found().await?;
            confirm_at(record.port, &record.instance, &dir, id).await
        })
    }

    fn discard<'a>(&'a self, id: &'a str) -> BoxFuture<'a, Result<(), Refusal>> {
        Box::pin(async move {
            let (dir, record) = self.found().await?;
            drop_at(record.port, &record.instance, &dir, id).await
        })
    }
}

/// Whether the program on `port` is the ai-desktop of `instance` (`GET /health`): nothing is sent to another one.
async fn same_instance(port: u16, instance: &str) -> Result<(), Refusal> {
    let health = crate::client::request(port, "GET", "/health", &[], "")
        .await
        .map_err(|e| Refusal::Failed(e.to_string()))?;
    let doc = (health.status == 200)
        .then(|| serde_json::from_str::<serde_json::Value>(&body_of(&health)).ok())
        .flatten();
    let same = doc.as_ref().is_some_and(|d| {
        d["app"].as_str() == Some(APP) && d["instance"].as_str() == Some(instance)
    });
    if same {
        Ok(())
    } else {
        Err(Refusal::NotAiDesktop)
    }
}

/// The control secret beside `hub.json`, read anew: 64 hex digits, lower case.
fn secret_in(dir: &std::path::Path) -> Result<String, Refusal> {
    registry::read_secret(dir)
        .ok()
        .flatten()
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or(Refusal::NoSecret)
}

/// The refusal of an answer that is not the one wanted: its status and the first line of its message.
fn refused(reply: &crate::client::Reply) -> Refusal {
    let doc = serde_json::from_str::<serde_json::Value>(&body_of(reply)).ok();
    let message = doc
        .as_ref()
        .and_then(|d| d["error"]["message"].as_str())
        .map_or_else(|| format!("HTTP {}", reply.status), str::to_owned);
    Refusal::Refused {
        status: reply.status,
        message: message
            .lines()
            .next()
            .unwrap_or("")
            .chars()
            .take(300)
            .collect(),
    }
}

/// What the kit's client may read of a job (`GET /jobs/<id>`): its text (up to 256 KiB) and the output of its run
/// (up to 512 KiB), escaped as JSON, within 10 s. The client's default of 64 KiB is too little for a job whose answer
/// stands at its end.
const JOB_READ: crate::client::ReadLimits = crate::client::ReadLimits {
    max_reply_bytes: 2 * 1024 * 1024,
    timeout: std::time::Duration::from_secs(10),
};

/// `GET /jobs/<id>` of the ai-desktop on `port`, with the secret of `dir`: ai-desktop reads a job only to the person
/// since its management API has a login. Without a readable secret it asks without one, which an ai-desktop older
/// than the login still answers (a newer one refuses, and the refusal says why).
async fn job_of(
    port: u16,
    instance: &str,
    dir: &std::path::Path,
    id: &str,
) -> Result<serde_json::Value, Refusal> {
    // The id goes into the request line: the route checked it (16 hex digits); here only letters and digits pass.
    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err(Refusal::Failed("the job id is not plain".to_owned()));
    }
    same_instance(port, instance).await?;
    let auth = secret_in(dir).ok().map(|secret| format!("Bearer {secret}"));
    let headers: Vec<(&str, &str)> = auth
        .as_deref()
        .map(|auth| vec![("Authorization", auth)])
        .unwrap_or_default();
    let reply =
        crate::client::request_with(port, "GET", &format!("/jobs/{id}"), &headers, "", JOB_READ)
            .await
            .map_err(|e| Refusal::Failed(e.to_string()))?;
    if reply.status != 200 {
        return Err(refused(&reply));
    }
    serde_json::from_str::<serde_json::Value>(&body_of(&reply))
        .ok()
        .filter(serde_json::Value::is_object)
        .ok_or_else(|| Refusal::Failed("ai-desktop answered, but not with the job".to_owned()))
}

/// `POST /jobs/<id>/run` `{ "confirm_private": true }` with the secret of `dir`.
async fn confirm_at(
    port: u16,
    instance: &str,
    dir: &std::path::Path,
    id: &str,
) -> Result<(), Refusal> {
    same_instance(port, instance).await?;
    let secret = secret_in(dir)?;
    let auth = format!("Bearer {secret}");
    let reply = crate::client::request(
        port,
        "POST",
        &format!("/jobs/{id}/run"),
        &[
            ("Authorization", auth.as_str()),
            ("Content-Type", "application/json"),
        ],
        r#"{"confirm_private":true}"#,
    )
    .await
    .map_err(|e| Refusal::Failed(e.to_string()))?;
    if reply.status == 200 {
        Ok(())
    } else {
        Err(refused(&reply))
    }
}

/// `DELETE /jobs/<id>` with the secret of `dir`: ai-desktop answers `204` (a running job is cancelled first). A job
/// it does not know any more (`404`) is put away as well: that is what was asked for.
async fn drop_at(
    port: u16,
    instance: &str,
    dir: &std::path::Path,
    id: &str,
) -> Result<(), Refusal> {
    // The id goes into the request line (as in `job_of`): only letters and digits pass.
    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err(Refusal::Failed("the job id is not plain".to_owned()));
    }
    same_instance(port, instance).await?;
    let secret = secret_in(dir)?;
    let auth = format!("Bearer {secret}");
    let reply = crate::client::request(
        port,
        "DELETE",
        &format!("/jobs/{id}"),
        &[("Authorization", auth.as_str())],
        "",
    )
    .await
    .map_err(|e| Refusal::Failed(e.to_string()))?;
    if matches!(reply.status, 200 | 204 | 404) {
        Ok(())
    } else {
        Err(refused(&reply))
    }
}

/// Ask `/health` on `port`, then send the job with the secret of `dir`.
async fn send_to(
    port: u16,
    instance: &str,
    dir: &std::path::Path,
    job: &Job,
) -> Result<JobAnswer, Refusal> {
    same_instance(port, instance).await?;
    let secret = secret_in(dir)?;
    let body = serde_json::to_string(job).map_err(|e| Refusal::Failed(e.to_string()))?;
    let auth = format!("Bearer {secret}");
    let reply = crate::client::request(
        port,
        "POST",
        "/jobs",
        &[
            ("Authorization", auth.as_str()),
            ("Content-Type", "application/json"),
        ],
        &body,
    )
    .await
    .map_err(|e| Refusal::Failed(e.to_string()))?;
    if reply.status != 201 {
        return Err(refused(&reply));
    }
    let doc = serde_json::from_str::<serde_json::Value>(&body_of(&reply)).ok();
    let doc =
        doc.ok_or_else(|| Refusal::Failed("ai-desktop answered, but not with a job".to_owned()))?;
    let (Some(job_id), Some(status)) = (doc["job_id"].as_str(), doc["status"].as_str()) else {
        return Err(Refusal::Failed(
            "ai-desktop answered, but not with a job".to_owned(),
        ));
    };
    Ok(JobAnswer {
        job_id: job_id.to_owned(),
        status: status.to_owned(),
        private: doc["private"].as_bool() == Some(true),
        note: doc["note"].as_str().map(str::to_owned),
        port,
    })
}

/// The body of a reply as text: a server may send it in chunks (`Transfer-Encoding: chunked`), which the client of the
/// kit hands over as they came. A body that is not well formed in chunks is taken as it is.
fn body_of(reply: &crate::client::Reply) -> String {
    let chunked = reply
        .header("Transfer-Encoding")
        .is_some_and(|v| v.to_ascii_lowercase().contains("chunked"));
    if !chunked {
        return reply.body.clone();
    }
    unchunk(&reply.body).unwrap_or_else(|| reply.body.clone())
}

/// Undo `Transfer-Encoding: chunked`; None when the text is not well formed.
fn unchunk(text: &str) -> Option<String> {
    let mut out = String::new();
    let mut rest = text;
    loop {
        let (line, after) = rest.split_once("\r\n")?;
        let size = usize::from_str_radix(line.split(';').next()?.trim(), 16).ok()?;
        if size == 0 {
            return Some(out);
        }
        out.push_str(after.get(..size)?);
        rest = after.get(size..)?.strip_prefix("\r\n")?;
    }
}

/// Whether `kind` may be asked of a task of `status`: a review only of a finished task, a decision only of one that
/// waits for it; the rest of any task.
#[must_use]
pub fn kind_fits(kind: &str, status: &str) -> bool {
    match kind {
        "review-done" => status == "done",
        "prepare-decision" => status == "decision",
        "split-plan" => false,
        other => KINDS.contains(&other),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use appkit_core::registry::{write_record, write_secret, HubRecord};
    use hub_testkit::scratch::Scratch;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    const SECRET: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    fn job() -> Job {
        Job {
            source: SOURCE.to_owned(),
            task_id: "alpha.nvim/t1".to_owned(),
            title: "T1".to_owned(),
            markdown: "---\ntitle: T1\n---\n".to_owned(),
            vault: "E:/vault".to_owned(),
            area: "alpha.nvim".to_owned(),
            mode: "prefill".to_owned(),
            kind: "handoff".to_owned(),
            private: false,
            choices: None,
        }
    }

    /// ai-desktop as a double: answers `/health` as `instance` and `/jobs` with `jobs`; keeps every request.
    async fn double(
        instance: &'static str,
        jobs: (u16, &'static str),
    ) -> (u16, Arc<Mutex<Vec<String>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let keep = Arc::clone(&seen);
        tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener.accept().await else {
                    return;
                };
                let mut buf = Vec::new();
                let mut chunk = [0u8; 4096];
                // The client sends the whole request, then waits: read until the body named by Content-Length is in.
                loop {
                    let n = stream.read(&mut chunk).await.unwrap_or(0);
                    buf.extend_from_slice(&chunk[..n]);
                    let text = String::from_utf8_lossy(&buf).into_owned();
                    if let Some(head_end) = text.find("\r\n\r\n") {
                        let length = text[..head_end]
                            .lines()
                            .find_map(|l| l.strip_prefix("Content-Length: "))
                            .and_then(|v| v.trim().parse::<usize>().ok())
                            .unwrap_or(0);
                        if buf.len() >= head_end + 4 + length {
                            break;
                        }
                    }
                    if n == 0 {
                        break;
                    }
                }
                let text = String::from_utf8_lossy(&buf).into_owned();
                let (status, body) = if text.starts_with("GET /health ") {
                    (
                        200,
                        format!(
                            r#"{{"app":"ai-desktop","version":"0.1.0","instance":"{instance}"}}"#
                        ),
                    )
                } else {
                    (jobs.0, jobs.1.to_owned())
                };
                keep.lock().unwrap().push(text);
                let answer = format!(
                    "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(answer.as_bytes()).await;
                let _ = stream.shutdown().await;
            }
        });
        (port, seen)
    }

    fn running_at(dir: &std::path::Path, port: u16, instance: &str) {
        write_record(
            dir,
            &HubRecord {
                app: "ai-desktop".to_owned(),
                port,
                pid: std::process::id(),
                version: "0.1.0".to_owned(),
                instance: instance.to_owned(),
            },
        )
        .unwrap();
        write_secret(dir, SECRET).unwrap();
    }

    fn intake(dir: &std::path::Path) -> AiDesktop {
        AiDesktop::new(Env::from_pairs([(
            "AI_DESKTOP_CONFIG_DIR",
            dir.to_path_buf(),
        )]))
    }

    #[tokio::test]
    async fn the_job_goes_with_the_secret_in_the_header_and_without_an_origin() {
        let dir = Scratch::new("agent-send");
        let (port, seen) = double(
            "inst1",
            (
                201,
                r#"{"job_id":"j1","status":"prefilled","private":true}"#,
            ),
        )
        .await;
        running_at(&dir, port, "inst1");
        let answer = intake(&dir).send(&job()).await.unwrap();
        assert_eq!(
            answer,
            JobAnswer {
                job_id: "j1".to_owned(),
                status: "prefilled".to_owned(),
                private: true,
                note: None,
                port
            }
        );
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 2, "health, then the job");
        assert!(seen[0].starts_with("GET /health "), "{}", seen[0]);
        assert!(
            !seen[0].contains(SECRET),
            "the secret is not sent to /health"
        );
        let post = &seen[1];
        assert!(post.starts_with("POST /jobs "), "{post}");
        assert!(
            post.contains(&format!("Authorization: Bearer {SECRET}")),
            "{post}"
        );
        assert!(post.contains("Content-Type: application/json"), "{post}");
        assert!(
            !post.to_ascii_lowercase().contains("\r\norigin:"),
            "no Origin: {post}"
        );
        let body: serde_json::Value =
            serde_json::from_str(&post[post.find("\r\n\r\n").unwrap() + 4..]).unwrap();
        assert_eq!(body["source"], "tasks-desktop");
        assert_eq!(body["task_id"], "alpha.nvim/t1");
        assert_eq!(body["mode"], "prefill");
        assert_eq!(body["kind"], "handoff");
        assert_eq!(body["private"], false);
    }

    #[tokio::test]
    async fn another_program_on_the_port_gets_no_secret() {
        let dir = Scratch::new("agent-other");
        let (port, seen) = double(
            "someone-else",
            (201, r#"{"job_id":"j1","status":"prefilled"}"#),
        )
        .await;
        running_at(&dir, port, "inst1");
        assert_eq!(intake(&dir).send(&job()).await, Err(Refusal::NotAiDesktop));
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 1, "only the health was asked");
        assert!(seen.iter().all(|r| !r.contains(SECRET)));
    }

    #[tokio::test]
    async fn a_refusal_names_the_status_and_the_message_of_ai_desktop() {
        let dir = Scratch::new("agent-refused");
        let (port, _) = double(
            "inst1",
            (
                403,
                r#"{"error":{"code":"jobs_off","message":"jobs are switched off\nsecond line"}}"#,
            ),
        )
        .await;
        running_at(&dir, port, "inst1");
        assert_eq!(
            intake(&dir).send(&job()).await,
            Err(Refusal::Refused {
                status: 403,
                message: "jobs are switched off".to_owned()
            })
        );
    }

    #[tokio::test]
    async fn without_a_running_ai_desktop_or_its_secret_nothing_is_sent() {
        let dir = Scratch::new("agent-none");
        assert_eq!(intake(&dir).send(&job()).await, Err(Refusal::NotRunning));
        // A hub.json, but its secret is not 64 hex digits.
        let (port, seen) = double("inst1", (201, r#"{"job_id":"j1","status":"prefilled"}"#)).await;
        running_at(&dir, port, "inst1");
        write_secret(&dir, "not-hex").unwrap();
        assert_eq!(intake(&dir).send(&job()).await, Err(Refusal::NoSecret));
        assert_eq!(seen.lock().unwrap().len(), 1, "only the health was asked");
    }

    #[test]
    fn a_chunked_body_is_put_together() {
        assert_eq!(
            unchunk("7\r\n{\"a\":1}\r\n3\r\n, 2\r\n0\r\n\r\n").as_deref(),
            Some("{\"a\":1}, 2")
        );
        assert_eq!(
            unchunk("4;ext=1\r\nabcd\r\n0\r\n\r\n").as_deref(),
            Some("abcd")
        );
        assert_eq!(unchunk("zz\r\nabcd\r\n0\r\n\r\n"), None, "no size");
        assert_eq!(unchunk("9\r\nabcd\r\n0\r\n\r\n"), None, "shorter than said");
        assert_eq!(unchunk("4\r\nabcd"), None, "no end");
    }

    #[test]
    fn a_kind_fits_the_status_of_the_task() {
        assert!(kind_fits("handoff", "open"));
        assert!(kind_fits("handoff", "done"));
        assert!(kind_fits("review-done", "done"));
        assert!(!kind_fits("review-done", "doing"));
        assert!(kind_fits("prepare-decision", "decision"));
        assert!(!kind_fits("prepare-decision", "open"));
        assert!(!kind_fits("split-plan", "open"), "a plan, not a task");
        assert!(!kind_fits("anything", "open"));
    }

    #[tokio::test]
    async fn a_job_is_read_and_confirmed_with_the_secret() {
        let dir = Scratch::new("agent-draft");
        let (port, seen) = double(
            "inst2",
            (
                200,
                r#"{"id":"0123456789abcdef","status":"done","draft":{"title":"X"}}"#,
            ),
        )
        .await;
        running_at(&dir, port, "inst2");
        let doc = intake(&dir).job("0123456789abcdef").await.unwrap();
        assert_eq!(doc["draft"]["title"], "X");
        intake(&dir).confirm("0123456789abcdef").await.unwrap();
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 4, "health and the job, health and the run");
        assert!(
            seen[1].starts_with("GET /jobs/0123456789abcdef "),
            "{}",
            seen[1]
        );
        assert!(
            seen[1].contains(&format!("Authorization: Bearer {SECRET}")),
            "ai-desktop reads a job only with the secret: {}",
            seen[1]
        );
        let run = &seen[3];
        assert!(run.starts_with("POST /jobs/0123456789abcdef/run "), "{run}");
        assert!(
            run.contains(&format!("Authorization: Bearer {SECRET}")),
            "{run}"
        );
        assert!(run.ends_with(r#"{"confirm_private":true}"#), "{run}");
    }

    /// A job is read with its text and the output of its run (ai-desktop keeps up to 256 KiB and 512 KiB): far more
    /// than the 64 KiB the kit's client reads by default, and the draft, the drafts of a split or the review come at its end.
    #[tokio::test]
    async fn a_job_larger_than_64_kib_is_read_whole() {
        let dir = Scratch::new("agent-large-job");
        let body = serde_json::json!({
            "id": "0123456789abcdef",
            "status": "done",
            "markdown": "m".repeat(200 * 1024),
            "output": format!("{}\n<!-- split:begin -->{{}}<!-- split:end -->", "o\n".repeat(150 * 1024)),
            "draft": { "title": "X" },
        })
        .to_string();
        assert!(body.len() > 640 * 1024, "{}", body.len());
        let (port, _) = double("inst4", (200, Box::leak(body.into_boxed_str()))).await;
        running_at(&dir, port, "inst4");
        let doc = intake(&dir).job("0123456789abcdef").await.unwrap();
        assert_eq!(doc["draft"]["title"], "X");
        assert!(doc["output"]
            .as_str()
            .unwrap()
            .ends_with("<!-- split:end -->"));
    }

    #[tokio::test]
    async fn a_job_id_that_is_not_plain_is_not_asked() {
        let dir = Scratch::new("agent-bad-id");
        let (port, seen) = double("inst5", (200, r#"{"status":"done"}"#)).await;
        running_at(&dir, port, "inst5");
        for bad in ["../health", "a b", "", "a?x=1"] {
            assert!(
                matches!(intake(&dir).job(bad).await, Err(Refusal::Failed(_))),
                "{bad:?}"
            );
        }
        assert!(seen.lock().unwrap().is_empty(), "nothing was asked");
    }

    #[tokio::test]
    async fn a_job_is_put_away_with_the_secret_and_a_job_that_is_gone_counts_as_put_away() {
        let dir = Scratch::new("agent-drop");
        let (port, seen) = double("inst6", (204, "")).await;
        running_at(&dir, port, "inst6");
        intake(&dir).discard("0123456789abcdef").await.unwrap();
        {
            let seen = seen.lock().unwrap();
            assert_eq!(seen.len(), 2, "health, then the delete");
            assert!(!seen[0].contains(SECRET), "no secret to /health");
            let delete = &seen[1];
            assert!(
                delete.starts_with("DELETE /jobs/0123456789abcdef "),
                "{delete}"
            );
            assert!(
                delete.contains(&format!("Authorization: Bearer {SECRET}")),
                "{delete}"
            );
            assert!(
                !delete.to_ascii_lowercase().contains("\r\norigin:"),
                "no Origin: {delete}"
            );
        }
        // An id that is not plain is never put into a request line.
        for bad in ["../health", "a b", ""] {
            assert!(
                matches!(intake(&dir).discard(bad).await, Err(Refusal::Failed(_))),
                "{bad:?}"
            );
        }
        assert_eq!(seen.lock().unwrap().len(), 2, "nothing more was asked");

        // ai-desktop does not know the job any more: that is what was wanted.
        let gone = Scratch::new("agent-drop-gone");
        let (port, _) = double("inst7", (404, r#"{"error":{"message":"no such job"}}"#)).await;
        running_at(&gone, port, "inst7");
        intake(&gone).discard("0123456789abcdef").await.unwrap();

        // Any other answer is a refusal, and another program on the port gets no secret.
        let refused = Scratch::new("agent-drop-refused");
        let (port, seen) = double("inst8", (403, r#"{"error":{"message":"jobs are off"}}"#)).await;
        running_at(&refused, port, "inst8");
        assert_eq!(
            intake(&refused).discard("0123456789abcdef").await,
            Err(Refusal::Refused {
                status: 403,
                message: "jobs are off".to_owned()
            })
        );
        running_at(&refused, port, "other");
        let before = seen.lock().unwrap().len();
        assert_eq!(
            intake(&refused).discard("0123456789abcdef").await,
            Err(Refusal::NotAiDesktop)
        );
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), before + 1, "only the health was asked");
        assert!(!seen[before].contains(SECRET));
    }

    #[tokio::test]
    async fn a_refused_run_or_another_program_says_so() {
        let dir = Scratch::new("agent-draft-refused");
        let (port, _) = double(
            "inst3",
            (409, r#"{"error":{"message":"the area is private\nmore"}}"#),
        )
        .await;
        running_at(&dir, port, "inst3");
        assert_eq!(
            intake(&dir).confirm("0123456789abcdef").await,
            Err(Refusal::Refused {
                status: 409,
                message: "the area is private".to_owned()
            })
        );
        assert!(matches!(
            intake(&dir).job("0123456789abcdef").await,
            Err(Refusal::Refused { status: 409, .. })
        ));
        // hub.json names another instance: nothing is asked of that program.
        running_at(&dir, port, "other");
        assert_eq!(
            intake(&dir).job("0123456789abcdef").await,
            Err(Refusal::NotAiDesktop)
        );
    }
}
