//! Opening a task in Neovim: the page names the task, the engine names the file, the hub checks that it is a plain
//! file inside the vault and starts the editor with that one argument. Here the editor is the test seam: the file it
//! would have opened is written to a log.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use appkit_core::authn::{ManualClock, Secret, CODE_BYTES, TOKEN_BYTES};
use hub_testkit::patient;
use hub_testkit::scratch::Scratch;
use serde_json::Value;
use tasks_hub::agent::{Job, JobAnswer, JobIntake, Refusal};
use tasks_hub::classes::AreaPolicy;
use tasks_hub::client;
use tasks_hub::config::Env;
use tasks_hub::editor::terminal_opener;
use tasks_hub::engine::{CliEngine, CliEngineConfig, Engine};
use tasks_hub::family::{FamilyApps, NotWired, Presence};
use tasks_hub::keeprunning::{KeepRunning, SettingsFile};
use tasks_hub::loginentry::LoginEntry;
use tasks_hub::server::{
    start_with, Extras, HubStatus, Limits, RunningServer, ServerConfig, WatchConfig,
};
use tasks_hub::sheetrun::{SheetRun, SheetRunJob, SheetRunner};
use tasks_hub::store::RefreshOptions;

struct Rig {
    server: RunningServer,
    vault: PathBuf,
    log: PathBuf,
    token: String,
    // Last: the folder is removed after the server, which has the vault open.
    _base: Scratch,
}

async fn rig(name: &str, with_opener: bool) -> Rig {
    rig_with(name, with_opener, None).await
}

/// `pick`: the folder the folder dialog "returns" (`None`: the dialog is closed without a choice).
async fn rig_with(name: &str, with_opener: bool, pick: Option<&str>) -> Rig {
    rig_full(name, with_opener, pick, None, None, None, None, None).await
}

/// A run of test sheets that answers at once, and says which task it was asked for.
struct FakeSheets;

impl SheetRunner for FakeSheets {
    fn run<'a>(&'a self, id: &'a str) -> appkit_hub::BoxFuture<'a, Result<SheetRun, String>> {
        Box::pin(async move {
            if id == "alpha.nvim/refused" {
                return Err("the run could not be started".to_owned());
            }
            Ok(SheetRun {
                code: Some(1),
                lines: vec![format!("sheet of {id}: fail at step 2")],
            })
        })
    }
}

async fn job_over(r: &Rig) -> Value {
    for _ in 0..200 {
        let (_, doc) = get(r, "/api/tasks/sheet_run").await;
        if doc["state"] != "running" {
            return doc;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("the run did not end");
}

/// A login entry that holds its value (no test touches the registry of the machine).
struct FakeLogin {
    on: Mutex<Option<bool>>,
    refuse: bool,
}

impl LoginEntry for FakeLogin {
    fn is_on(&self) -> Option<bool> {
        *self.on.lock().unwrap()
    }

    fn set(&self, on: bool) -> Result<(), String> {
        if self.refuse {
            return Err("the system said no".to_owned());
        }
        *self.on.lock().unwrap() = Some(on);
        Ok(())
    }
}

// One helper for every test of this file: each of the seams is a parameter of its own.
#[allow(clippy::too_many_arguments)]
async fn rig_full(
    name: &str,
    with_opener: bool,
    pick: Option<&str>,
    login_entry: Option<Arc<dyn LoginEntry>>,
    runs: Option<Arc<SheetRunJob>>,
    stay: Option<Arc<dyn KeepRunning>>,
    family: Option<Arc<dyn FamilyApps>>,
    agent: Option<Arc<dyn JobIntake>>,
) -> Rig {
    let base = Scratch::new(&format!("open-{name}"));
    let vault = base.join("vault");
    let tasks = vault.join("alpha.nvim").join("ROADMAP").join("tasks");
    std::fs::create_dir_all(&tasks).unwrap();
    std::fs::write(tasks.join("t1.md"), "---\ntitle: t1\n---\n").unwrap();
    std::fs::write(base.join("outside.md"), "x").unwrap();
    std::fs::write(vault.join(".fake-n"), "1").unwrap();
    std::fs::write(
        vault.join(".fake-task-file"),
        "alpha.nvim/ROADMAP/tasks/t1.md",
    )
    .unwrap();
    let log = base.join("opened.log");
    let snaps = base.join("repos/ui.nvim/TESTS/__snapshots__/sheets/a.sheet");
    std::fs::create_dir_all(&snaps).unwrap();
    std::fs::write(
        snaps.join("float.80x24.snap"),
        "row one
row two
",
    )
    .unwrap();
    std::fs::write(base.join("repos/secret.snap"), "no").unwrap();
    let engine: Arc<dyn Engine> = Arc::new(CliEngine::new(CliEngineConfig {
        dialect: tasks_hub::engine::DIALECT,
        nvim: PathBuf::from(env!("CARGO_BIN_EXE_fake-nvim")),
        script: vault.join("scripts").join("tasks.lua"),
        vault: vault.clone(),
        lib_dir: None,
        extra_areas: vec![],
        env: Env::from_process(),
        timeout: Duration::from_secs(10),
        max_queue: 16,
        max_reply_bytes: 4 * 1024 * 1024,
    }));
    let control = Secret::generate(TOKEN_BYTES).unwrap();
    let cfg = ServerConfig {
        devices: None,
        addr: "127.0.0.1:0".parse().unwrap(),
        limits: Limits {
            snapshot_max_age: None,
            ..Limits::default()
        },
        clock: Arc::new(ManualClock::new()),
        pairing_ttl: Duration::from_secs(60),
        control_secret: control.clone(),
        instance: Secret::generate(CODE_BYTES).unwrap(),
        status: HubStatus {
            engine_ready: true,
            problem: None,
            capabilities: Vec::new(),
        },
        engine: Some(engine),
        policy: Arc::new(AreaPolicy::default()),
        usage: None,
        ui: tasks_hub::ui::UiFiles::none(),
        watch: Some(WatchConfig {
            vault: vault.clone(),
            refresh: RefreshOptions {
                debounce: Duration::from_millis(100),
                max_wait: Duration::from_secs(1),
                interval: Duration::from_secs(300),
            },
        }),
    };
    let opener: Option<Arc<dyn tasks_hub::editor::FileOpener>> = with_opener.then(|| {
        Arc::new(terminal_opener(
            PathBuf::from("nvim"),
            Env::from_pairs(
                [(
                    "TASKS_DESKTOP_EDITOR_LOG",
                    log.to_string_lossy().into_owned(),
                )]
                .into_iter()
                .chain(pick.map(|p| ("TASKS_DESKTOP_PICK_RESULT", p.to_owned()))),
            ),
        )) as Arc<dyn tasks_hub::editor::FileOpener>
    });
    let server = start_with(
        cfg,
        Extras {
            upload_dir: None,
            upload_engine: None,
            attach_dirs: Vec::new(),
            snapshot_root: Some(base.join("repos")),
            vaults: None,
            opener,
            login: login_entry,
            keep_running: stay,
            family,
            agent,
            first_start: None,
            all_vaults: None,
            sheet_run: runs,
            testing: None,
            repos: None,
            mail: None,
            repo_status: None,
            tailnet: None,
            push: None,
        },
    )
    .await
    .unwrap();
    let port = server.addr().port();
    let auth = format!("Bearer {}", control.to_hex());
    let reply = client::request(
        port,
        "POST",
        "/api/control/pair",
        &[
            ("Content-Type", "application/json"),
            ("Authorization", &auth),
        ],
        "{}",
    )
    .await
    .unwrap();
    let code = serde_json::from_str::<Value>(&reply.body).unwrap()["code"]
        .as_str()
        .unwrap()
        .to_owned();
    let origin = format!("http://127.0.0.1:{port}");
    let reply = client::request(
        port,
        "POST",
        "/auth/exchange",
        &[("Content-Type", "application/json"), ("Origin", &origin)],
        &format!(r#"{{"code":"{code}"}}"#),
    )
    .await
    .unwrap();
    let token = serde_json::from_str::<Value>(&reply.body).unwrap()["token"]
        .as_str()
        .unwrap()
        .to_owned();
    Rig {
        server,
        vault,
        log,
        token,
        _base: base,
    }
}

async fn open(r: &Rig, body: &str, session: bool) -> (u16, Value) {
    post(r, "/api/tasks/open", body, session).await
}

async fn post(r: &Rig, route: &str, body: &str, session: bool) -> (u16, Value) {
    let auth = format!("Bearer {}", r.token);
    let origin = format!("http://127.0.0.1:{}", r.server.addr().port());
    let mut headers: Vec<(&str, &str)> =
        vec![("Content-Type", "application/json"), ("Origin", &origin)];
    if session {
        headers.push(("Authorization", &auth));
    }
    let reply = patient::request(r.server.addr().port(), "POST", route, &headers, body)
        .await
        .unwrap();
    (
        reply.status,
        serde_json::from_str(&reply.body).unwrap_or(Value::Null),
    )
}

async fn get(r: &Rig, route: &str) -> (u16, Value) {
    let auth = format!("Bearer {}", r.token);
    let origin = format!("http://127.0.0.1:{}", r.server.addr().port());
    let headers = vec![
        ("Authorization", auth.as_str()),
        ("Origin", origin.as_str()),
    ];
    let reply = patient::request(r.server.addr().port(), "GET", route, &headers, "")
        .await
        .unwrap();
    (
        reply.status,
        serde_json::from_str(&reply.body).unwrap_or(Value::Null),
    )
}

fn opened(r: &Rig) -> Vec<String> {
    std::fs::read_to_string(&r.log)
        .map(|t| t.lines().map(str::to_owned).collect())
        .unwrap_or_default()
}

#[tokio::test]
async fn the_file_the_engine_names_is_opened_and_nothing_else() {
    let r = rig("ok", true).await;
    let (status, doc) = open(&r, r#"{"id":"alpha.nvim/t1"}"#, true).await;
    assert_eq!(status, 200, "{doc}");
    let seen = opened(&r);
    assert_eq!(seen.len(), 1, "{seen:?}");
    assert!(seen[0].ends_with("t1.md"), "{seen:?}");
    // The answer does not hold a path.
    assert!(!doc.to_string().contains("t1.md"));
}

#[tokio::test]
async fn a_name_that_leads_out_of_the_vault_is_refused_and_nothing_is_started() {
    let r = rig("out", true).await;
    for name in [
        "../outside.md",
        "/etc/passwd",
        "alpha.nvim/ROADMAP/tasks/nope.md",
        "alpha.nvim",
    ] {
        std::fs::write(r.vault.join(".fake-task-file"), name).unwrap();
        let (status, doc) = open(&r, r#"{"id":"alpha.nvim/t1"}"#, true).await;
        assert_eq!(
            (status, doc["error"]["code"].as_str()),
            (400, Some("open_refused")),
            "{name}"
        );
    }
    assert!(opened(&r).is_empty(), "something was started");
}

#[tokio::test]
async fn the_form_the_credential_and_a_hub_without_an_editor() {
    let r = rig("form", true).await;
    for bad in [
        "{}",
        r#"{"id":"../x"}"#,
        r#"{"id":"alpha.nvim/t1","path":"/etc/passwd"}"#,
        r#"{"id":5}"#,
        "{not json",
    ] {
        let (status, _) = open(&r, bad, true).await;
        assert_eq!(status, 400, "{bad}");
    }
    let (status, _) = open(&r, r#"{"id":"alpha.nvim/t1"}"#, false).await;
    assert_eq!(status, 401, "the credential comes first");
    assert!(opened(&r).is_empty());
    let none = rig("none", false).await;
    let (status, doc) = open(&none, r#"{"id":"alpha.nvim/t1"}"#, true).await;
    assert_eq!(
        (status, doc["error"]["code"].as_str()),
        (404, Some("open_unavailable"))
    );
}

#[tokio::test]
async fn the_folder_of_the_vault_is_shown_and_the_page_names_nothing() {
    let r = rig("reveal", true).await;
    let (status, doc) = post(&r, "/api/tasks/vault_reveal", "{}", true).await;
    assert_eq!(status, 200, "{doc}");
    let seen = opened(&r);
    assert_eq!(seen.len(), 1, "{seen:?}");
    assert!(seen[0].starts_with("reveal "), "{seen:?}");
    assert!(!doc.to_string().contains("vault"), "no path in the answer");
    // A folder named by the page is not taken, and the credential comes first.
    let (status, _) = post(&r, "/api/tasks/vault_reveal", r#"{"path":"/etc"}"#, true).await;
    assert_eq!(status, 400);
    let (status, _) = post(&r, "/api/tasks/vault_reveal", "{}", false).await;
    assert_eq!(status, 401);
    assert_eq!(opened(&r).len(), 1);
    let none = rig("reveal-none", false).await;
    let (status, doc) = post(&none, "/api/tasks/vault_reveal", "{}", true).await;
    assert_eq!(
        (status, doc["error"]["code"].as_str()),
        (404, Some("open_unavailable"))
    );
}

#[tokio::test]
async fn the_login_entry_is_read_set_and_taken_away_and_only_with_a_session() {
    let login = Arc::new(FakeLogin {
        on: Mutex::new(Some(false)),
        refuse: false,
    });
    let r = rig_full(
        "autostart",
        false,
        None,
        Some(login.clone()),
        None,
        None,
        None,
        None,
    )
    .await;
    let route = "/api/tasks/autostart";
    assert_eq!(get(&r, route).await.1["on"], false);
    let (status, doc) = post(&r, route, r#"{"on":true}"#, true).await;
    assert_eq!((status, doc["on"].as_bool()), (200, Some(true)), "{doc}");
    assert_eq!(*login.on.lock().unwrap(), Some(true));
    assert_eq!(get(&r, route).await.1["on"], true);
    let (status, doc) = post(&r, route, r#"{"on":false}"#, true).await;
    assert_eq!((status, doc["on"].as_bool()), (200, Some(false)), "{doc}");
    // Anything else is refused, and the credential comes first.
    for bad in [
        r#"{}"#,
        r#"{"on":"yes"}"#,
        r#"{"on":true,"exe":"x"}"#,
        "nonsense",
    ] {
        assert_eq!(post(&r, route, bad, true).await.0, 400, "{bad}");
    }
    assert_eq!(post(&r, route, r#"{"on":true}"#, false).await.0, 401);
    assert_eq!(
        *login.on.lock().unwrap(),
        Some(false),
        "a refused request changed nothing"
    );

    // The system refuses: the page is told, the state stays.
    let refusing = Arc::new(FakeLogin {
        on: Mutex::new(Some(false)),
        refuse: true,
    });
    let r2 = rig_full(
        "autostart-refused",
        false,
        None,
        Some(refusing),
        None,
        None,
        None,
        None,
    )
    .await;
    let (status, doc) = post(&r2, route, r#"{"on":true}"#, true).await;
    assert_eq!(
        (status, doc["error"]["code"].as_str()),
        (502, Some("autostart_failed"))
    );

    // A hub without an entry offers no switch.
    let none = rig("autostart-none", false).await;
    assert!(get(&none, route).await.1["on"].is_null());
    assert_eq!(post(&none, route, r#"{"on":true}"#, true).await.0, 404);
}

/// The job intake of ai-desktop as a double: it keeps every job and answers as it is told; `job` answers with
/// `doc`, `confirm` keeps the ids it was asked to run, `drop` the ids it was asked to put away.
struct FakeIntake {
    jobs: Mutex<Vec<Job>>,
    answer: Result<JobAnswer, Refusal>,
    doc: Mutex<Value>,
    confirmed: Mutex<Vec<String>>,
    dropped: Mutex<Vec<String>>,
}

impl JobIntake for FakeIntake {
    fn send<'a>(&'a self, job: &'a Job) -> appkit_hub::BoxFuture<'a, Result<JobAnswer, Refusal>> {
        Box::pin(async move {
            self.jobs.lock().unwrap().push(job.clone());
            self.answer.clone()
        })
    }

    fn job<'a>(&'a self, _id: &'a str) -> appkit_hub::BoxFuture<'a, Result<Value, Refusal>> {
        Box::pin(async move { Ok(self.doc.lock().unwrap().clone()) })
    }

    fn confirm<'a>(&'a self, id: &'a str) -> appkit_hub::BoxFuture<'a, Result<(), Refusal>> {
        Box::pin(async move {
            self.confirmed.lock().unwrap().push(id.to_owned());
            Ok(())
        })
    }

    fn discard<'a>(&'a self, id: &'a str) -> appkit_hub::BoxFuture<'a, Result<(), Refusal>> {
        Box::pin(async move {
            self.dropped.lock().unwrap().push(id.to_owned());
            Ok(())
        })
    }
}

fn intake(answer: Result<JobAnswer, Refusal>) -> Arc<FakeIntake> {
    Arc::new(FakeIntake {
        jobs: Mutex::new(Vec::new()),
        answer,
        doc: Mutex::new(Value::Null),
        confirmed: Mutex::new(Vec::new()),
        dropped: Mutex::new(Vec::new()),
    })
}

#[tokio::test]
async fn a_plan_goes_to_be_split_with_its_tasks_and_only_the_block_comes_back() {
    let job = JobAnswer {
        job_id: "0123456789abcdef".to_owned(),
        status: "running".to_owned(),
        private: true,
        note: None,
        port: 47123,
    };
    let fake = intake(Ok(job));
    let r = rig_full(
        "split",
        false,
        None,
        None,
        None,
        None,
        None,
        Some(Arc::clone(&fake) as Arc<dyn JobIntake>),
    )
    .await;
    let plans = r.vault.join("alpha.nvim/ROADMAP/plans");
    std::fs::create_dir_all(&plans).unwrap();
    std::fs::write(
        plans.join("p1.md"),
        "---\ntitle: Plan one\nphase_order: [build]\n---\n\n## Definition of done\n\nIt ships.\n",
    )
    .unwrap();
    std::fs::write(
        r.vault.join(".fake-merge-snapshot.json"),
        r#"{"plans":[{"id":"alpha.nvim/p1","title":"Plan one","areas":["alpha.nvim"],"phase_order":["build"],"valid":true}],
            "tasks":[{"id":"alpha.nvim/t1","area":"alpha.nvim","title":"t1","status":"open","plan":"alpha.nvim/p1","phase":"build","tags":[]}]}"#,
    )
    .unwrap();
    std::fs::write(
        r.vault.join(".fake-merge-finished.json"),
        r#"{"items":[{"id":"alpha.nvim/old","area":"alpha.nvim","slug":"old","title":"Old one","plan":"alpha.nvim/p1","tags":[]}]}"#,
    )
    .unwrap();
    // The vault moved on: the snapshot is read again with the plan in it.
    std::fs::write(r.vault.join(".fake-n"), "2").unwrap();
    let route = "/api/tasks/split";
    let mut sent = (0, Value::Null);
    for _ in 0..50 {
        sent = post(&r, route, r#"{"plan":"alpha.nvim/p1"}"#, true).await;
        if sent.0 == 201 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert_eq!(sent.0, 201, "{}", sent.1);
    {
        let jobs = fake.jobs.lock().unwrap();
        let job = jobs.last().unwrap();
        assert_eq!(
            (job.kind.as_str(), job.mode.as_str(), job.task_id.as_str()),
            ("split-plan", "run", "alpha.nvim/p1")
        );
        assert_eq!(job.area, "alpha.nvim");
        assert_eq!(job.title, "Plan one");
        assert!(job.private, "an unclassified area goes as private");
        assert!(job.markdown.contains("It ships."), "{}", job.markdown);
        assert!(
            job.markdown
                .contains("## Tasks of this plan\n\n- alpha.nvim/old (done, phase -): Old one\n- alpha.nvim/t1 (open, phase build): t1\n"),
            "{}",
            job.markdown
        );
    }
    assert_eq!(
        post(&r, route, r#"{"plan":"alpha.nvim/p1"}"#, false)
            .await
            .0,
        401
    );
    let (status, doc) = post(&r, route, r#"{"plan":"alpha.nvim/none"}"#, true).await;
    assert_eq!(
        (status, doc["error"]["code"].as_str()),
        (404, Some("plan_not_found")),
        "{doc}"
    );
    for bad in [
        r#"{"plan":"../p1"}"#,
        r#"{"plan":"alpha.nvim/p1","mode":"run"}"#,
        r#"{}"#,
    ] {
        assert_eq!(post(&r, route, bad, true).await.0, 400, "{bad}");
    }

    // The block of the answer, nothing else of it.
    *fake.doc.lock().unwrap() = serde_json::json!({
        "id": "0123456789abcdef",
        "source": "tasks-desktop",
        "kind": "split-plan",
        "status": "done",
        "markdown": "the plan",
        "output": "Thinking.\n<!-- split:begin -->\n{\"tasks\":[]}\n<!-- split:end -->\nmore\n<!-- split:begin -->\n{\"tasks\":[{\"title\":\"B\"}]}\n<!-- split:end -->"
    });
    let (status, doc) = post(
        &r,
        "/api/tasks/split_job",
        r#"{"job":"0123456789abcdef"}"#,
        true,
    )
    .await;
    assert_eq!(status, 200, "{doc}");
    assert_eq!(
        doc["block"], "{\"tasks\":[{\"title\":\"B\"}]}",
        "the last block"
    );
    assert!(
        doc.get("output").is_none() && doc.get("markdown").is_none(),
        "{doc}"
    );
    *fake.doc.lock().unwrap() = serde_json::json!({"source": "tasks-desktop", "kind": "split-plan", "status": "done", "output": "no block"});
    let (_, doc) = post(
        &r,
        "/api/tasks/split_job",
        r#"{"job":"0123456789abcdef"}"#,
        true,
    )
    .await;
    assert!(
        doc["block"].is_null() && doc["block_error"].is_string(),
        "{doc}"
    );
    *fake.doc.lock().unwrap() = serde_json::json!({"source": "tasks-desktop", "kind": "split-plan", "status": "running", "output": "<!-- split:begin -->{}<!-- split:end -->"});
    let (_, doc) = post(
        &r,
        "/api/tasks/split_job",
        r#"{"job":"0123456789abcdef"}"#,
        true,
    )
    .await;
    assert!(doc["block"].is_null(), "no block before it is done: {doc}");
    // A job this hub did not send as a split (a review the page knows the id of) is not shown through this route.
    for other in [
        serde_json::json!({"source": "tasks-desktop", "kind": "review-done", "status": "done", "note": "n",
            "output": "<!-- split:begin -->{\"tasks\":[]}<!-- split:end -->"}),
        serde_json::json!({"source": "another", "kind": "split-plan", "status": "done",
            "output": "<!-- split:begin -->{\"tasks\":[]}<!-- split:end -->"}),
    ] {
        *fake.doc.lock().unwrap() = other.clone();
        let (status, doc) = post(
            &r,
            "/api/tasks/split_job",
            r#"{"job":"0123456789abcdef"}"#,
            true,
        )
        .await;
        assert_eq!(
            (status, doc["error"]["code"].as_str()),
            (409, Some("not_own_job")),
            "{other} {doc}"
        );
    }
    *fake.doc.lock().unwrap() =
        serde_json::json!({"source": "tasks-desktop", "kind": "split-plan", "status": "running"});
    // A split that runs already is not run a second time; one that waits for a yes is.
    let (status, _) = post(
        &r,
        "/api/tasks/split_confirm",
        r#"{"job":"0123456789abcdef"}"#,
        true,
    )
    .await;
    assert_eq!(status, 409);
    *fake.doc.lock().unwrap() = serde_json::json!({"source": "tasks-desktop", "kind": "split-plan", "status": "needs_confirmation"});
    let (status, _) = post(
        &r,
        "/api/tasks/split_confirm",
        r#"{"job":"0123456789abcdef"}"#,
        true,
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(
        post(
            &r,
            "/api/tasks/split_job",
            r#"{"job":"0123456789abcdef"}"#,
            false
        )
        .await
        .0,
        401
    );
    // A split that runs is not put away: only one that waits for a yes.
    *fake.doc.lock().unwrap() =
        serde_json::json!({"source": "tasks-desktop", "kind": "split-plan", "status": "running"});
    let (status, _) = post(
        &r,
        "/api/tasks/split_drop",
        r#"{"job":"0123456789abcdef"}"#,
        true,
    )
    .await;
    assert_eq!(status, 409);
    assert!(fake.dropped.lock().unwrap().is_empty());
    *fake.doc.lock().unwrap() = serde_json::json!({"source": "tasks-desktop", "kind": "split-plan", "status": "needs_confirmation"});
    // The person said no to a split of a private area (or closed the dialog while it asked): the job is put away.
    let (status, doc) = post(
        &r,
        "/api/tasks/split_drop",
        r#"{"job":"0123456789abcdef"}"#,
        true,
    )
    .await;
    assert_eq!(
        (status, doc["status"].as_str()),
        (200, Some("dropped")),
        "{doc}"
    );
    assert_eq!(
        fake.dropped.lock().unwrap().as_slice(),
        ["0123456789abcdef"]
    );
    assert_eq!(
        post(
            &r,
            "/api/tasks/split_drop",
            r#"{"job":"0123456789abcdef"}"#,
            false
        )
        .await
        .0,
        401
    );
    assert_eq!(
        post(&r, "/api/tasks/split_drop", r#"{"job":"../x"}"#, true)
            .await
            .0,
        400
    );
    assert_eq!(
        fake.dropped.lock().unwrap().len(),
        1,
        "nothing is put away without a session or with a bad id"
    );
}

#[tokio::test]
async fn a_draft_goes_as_private_with_the_choices_and_only_its_result_comes_back() {
    let job = JobAnswer {
        job_id: "0123456789abcdef".to_owned(),
        status: "needs_confirmation".to_owned(),
        private: true,
        note: None,
        port: 47123,
    };
    let fake = intake(Ok(job));
    let r = rig_full(
        "draft",
        false,
        None,
        None,
        None,
        None,
        None,
        Some(Arc::clone(&fake) as Arc<dyn JobIntake>),
    )
    .await;
    // The page sends the text and nothing else: the values of the vault are the engine's, asked by the hub (WEB-13).
    let body = r#"{"text":"Der Knopf\nsoll blau sein"}"#;
    let (status, doc) = post(&r, "/api/tasks/draft", body, true).await;
    assert_eq!(status, 201, "{doc}");
    assert_eq!(doc["status"], "needs_confirmation", "{doc}");
    {
        let jobs = fake.jobs.lock().unwrap();
        let sent = &jobs[0];
        assert_eq!(
            (
                sent.kind.as_str(),
                sent.mode.as_str(),
                sent.task_id.as_str()
            ),
            ("draft-task", "run", "draft/new")
        );
        assert_eq!(sent.area, "", "the area is not chosen yet");
        assert!(sent.private, "the strictest class");
        assert_eq!(sent.title, "Der Knopf");
        assert_eq!(sent.markdown, "Der Knopf\nsoll blau sein");
        let choices = sent.choices.as_ref().unwrap();
        assert_eq!(
            choices["areas"],
            serde_json::json!(["alpha.nvim", "beta.nvim", "secret-area"]),
            "the areas of the engine, sorted"
        );
        assert_eq!(
            choices["kinds"],
            serde_json::json!(["bug", "feature", "idea", "research", "task"]),
            "the kinds of the engine's hello"
        );
        assert_eq!(choices["categories"], serde_json::json!(["bug", "docs"]));
        assert!(
            choices.get("tags").is_none() && choices.get("plans").is_none(),
            "an empty list is left out: {choices}"
        );
    }
    assert_eq!(post(&r, "/api/tasks/draft", body, false).await.0, 401);
    for bad in [
        r#"{"text":""}"#,
        r#"{"text":"   "}"#,
        r#"{}"#,
        // A list of the page is not taken any more, not even a well-formed one.
        r#"{"text":"x","choices":{"areas":["alpha.nvim"],"kinds":["task"]}}"#,
        r#"{"text":"x","area":"a"}"#,
    ] {
        assert_eq!(
            post(&r, "/api/tasks/draft", bad, true).await.0,
            400,
            "{bad}"
        );
    }
    assert_eq!(fake.jobs.lock().unwrap().len(), 1, "nothing more was sent");

    // The draft routes act only on a draft of this hub that waits for a yes: a running review the page knows the id
    // of is neither run nor put away, nor is a draft that runs already.
    let waiting = serde_json::json!({
        "source": "tasks-desktop", "task_id": "draft/new", "kind": "draft-task", "status": "needs_confirmation"
    });
    for (other, code) in [
        (
            serde_json::json!({"source": "tasks-desktop", "task_id": "alpha.nvim/t1", "kind": "review-done", "status": "running"}),
            "not_own_job",
        ),
        (
            serde_json::json!({"source": "tasks-desktop", "task_id": "alpha.nvim/t1", "kind": "review-done", "status": "needs_confirmation"}),
            "not_own_job",
        ),
        (
            serde_json::json!({"source": "another", "task_id": "draft/new", "kind": "draft-task", "status": "needs_confirmation"}),
            "not_own_job",
        ),
        (
            serde_json::json!({"source": "tasks-desktop", "task_id": "draft/new", "kind": "draft-task", "status": "running"}),
            "not_waiting",
        ),
    ] {
        *fake.doc.lock().unwrap() = other.clone();
        for route in ["/api/tasks/draft_drop", "/api/tasks/draft_confirm"] {
            let (status, doc) = post(&r, route, r#"{"job":"0123456789abcdef"}"#, true).await;
            assert_eq!(
                (status, doc["error"]["code"].as_str()),
                (409, Some(code)),
                "{route} {other} {doc}"
            );
        }
    }
    assert!(
        fake.dropped.lock().unwrap().is_empty() && fake.confirmed.lock().unwrap().is_empty(),
        "no other job was touched"
    );
    *fake.doc.lock().unwrap() = waiting;

    // The person said yes on the page: the hub runs the job.
    let (status, doc) = post(
        &r,
        "/api/tasks/draft_confirm",
        r#"{"job":"0123456789abcdef"}"#,
        true,
    )
    .await;
    assert_eq!(
        (status, doc["status"].as_str()),
        (200, Some("running")),
        "{doc}"
    );
    assert_eq!(
        fake.confirmed.lock().unwrap().as_slice(),
        ["0123456789abcdef"]
    );
    assert_eq!(
        post(
            &r,
            "/api/tasks/draft_confirm",
            r#"{"job":"0123456789abcdef"}"#,
            false
        )
        .await
        .0,
        401
    );
    // The person said no (or closed the form while it asked): the hub puts the waiting job away.
    let (status, doc) = post(
        &r,
        "/api/tasks/draft_drop",
        r#"{"job":"fedcba9876543210"}"#,
        true,
    )
    .await;
    assert_eq!(
        (status, doc["status"].as_str()),
        (200, Some("dropped")),
        "{doc}"
    );
    assert_eq!(
        fake.dropped.lock().unwrap().as_slice(),
        ["fedcba9876543210"]
    );
    assert_eq!(
        post(
            &r,
            "/api/tasks/draft_drop",
            r#"{"job":"fedcba9876543210"}"#,
            false
        )
        .await
        .0,
        401
    );
    assert_eq!(
        fake.dropped.lock().unwrap().len(),
        1,
        "nothing is put away without a session"
    );
    for bad in [
        r#"{"job":"../x"}"#,
        r#"{"job":"0123456789ABCDEF"}"#,
        r#"{}"#,
    ] {
        assert_eq!(
            post(&r, "/api/tasks/draft_drop", bad, true).await.0,
            400,
            "{bad}"
        );
        assert_eq!(
            post(&r, "/api/tasks/draft_confirm", bad, true).await.0,
            400,
            "{bad}"
        );
        assert_eq!(
            post(&r, "/api/tasks/draft_job", bad, true).await.0,
            400,
            "{bad}"
        );
    }

    // Only the result of the job reaches the page, not the text or the model's answer.
    *fake.doc.lock().unwrap() = serde_json::json!({
        "id": "0123456789abcdef",
        "source": "tasks-desktop",
        "task_id": "draft/new",
        "kind": "draft-task",
        "status": "done",
        "markdown": "Der Knopf soll blau sein",
        "output": "the whole answer",
        "draft": {"schema": "tasks-draft/1", "title": "Blau", "dropped": []},
        "note": "draft: one answer, no tools"
    });
    let (status, doc) = post(
        &r,
        "/api/tasks/draft_job",
        r#"{"job":"0123456789abcdef"}"#,
        true,
    )
    .await;
    assert_eq!(status, 200, "{doc}");
    assert_eq!(doc["status"], "done");
    assert_eq!(doc["draft"]["title"], "Blau");
    assert!(
        doc.get("markdown").is_none() && doc.get("output").is_none(),
        "{doc}"
    );
    assert_eq!(
        post(
            &r,
            "/api/tasks/draft_job",
            r#"{"job":"0123456789abcdef"}"#,
            false
        )
        .await
        .0,
        401
    );
}

#[tokio::test]
async fn a_task_is_handed_to_the_agent_with_its_file_and_only_with_a_session() {
    let route = "/api/tasks/agent";
    let job = JobAnswer {
        job_id: "3f9c0a1b2c3d4e5f".to_owned(),
        status: "prefilled".to_owned(),
        private: false,
        note: None,
        port: 47123,
    };
    let fake = intake(Ok(job));
    let r = rig_full(
        "agent",
        false,
        None,
        None,
        None,
        None,
        None,
        Some(Arc::clone(&fake) as Arc<dyn JobIntake>),
    )
    .await;
    std::fs::write(
        r.vault.join("alpha.nvim/ROADMAP/tasks/t1.md"),
        "---\ntitle: t1\n---\n\n## Akzeptanz\n\n- [ ] it works\n",
    )
    .unwrap();
    let body = r#"{"id":"alpha.nvim/t1","mode":"prefill","kind":"handoff"}"#;
    let (status, doc) = post(&r, route, body, true).await;
    assert_eq!(status, 201, "{doc}");
    assert_eq!(doc["job_id"], "3f9c0a1b2c3d4e5f", "{doc}");
    assert_eq!(doc["status"], "prefilled", "{doc}");
    // The port of ai-desktop for its dashboard; nothing of the secret.
    assert_eq!(doc["port"], 47123, "{doc}");
    assert!(
        doc.get("secret").is_none() && !doc.to_string().contains("Bearer"),
        "{doc}"
    );
    {
        let jobs = fake.jobs.lock().unwrap();
        assert_eq!(jobs.len(), 1);
        let sent = &jobs[0];
        assert_eq!(sent.source, "tasks-desktop");
        assert_eq!(sent.task_id, "alpha.nvim/t1");
        assert_eq!(sent.area, "alpha.nvim");
        assert_eq!(
            (sent.mode.as_str(), sent.kind.as_str()),
            ("prefill", "handoff")
        );
        assert!(
            sent.markdown.contains("- [ ] it works"),
            "{}",
            sent.markdown
        );
        assert!(
            !sent.vault.contains('\\'),
            "the vault with forward slashes: {}",
            sent.vault
        );
        // No classes in this hub: the area is unclassified, so it goes as private.
        assert!(sent.private);
    }
    // Refused before anything is sent: a credential is missing, a mode or kind ai-desktop does not take, a review of a
    // task that is not finished.
    assert_eq!(post(&r, route, body, false).await.0, 401);
    for bad in [
        r#"{"id":"alpha.nvim/t1","mode":"later","kind":"handoff"}"#,
        r#"{"id":"alpha.nvim/t1","mode":"run","kind":"anything"}"#,
        r#"{"id":"../t1","mode":"run","kind":"handoff"}"#,
        r#"{"id":"alpha.nvim/t1","mode":"run"}"#,
        r#"{"id":"alpha.nvim/t1","mode":"run","kind":"handoff","model":"x"}"#,
    ] {
        assert_eq!(post(&r, route, bad, true).await.0, 400, "{bad}");
    }
    // A review is of a finished task: the engine reads it from the Backlog (`task` with `finished`); an id with no
    // finished file is not found, and nothing is sent.
    let review = r#"{"id":"alpha.nvim/t1","mode":"run","kind":"review-done"}"#;
    let (status, doc) = post(&r, route, review, true).await;
    assert_eq!(
        (status, doc["error"]["code"].as_str()),
        (404, Some("not_found")),
        "{doc}"
    );
    assert_eq!(fake.jobs.lock().unwrap().len(), 1, "nothing more was sent");

    // The finished file goes, with its commits.
    let done_dir = r.vault.join("alpha.nvim/Backlog/FEATURES");
    std::fs::create_dir_all(&done_dir).unwrap();
    std::fs::write(
        done_dir.join("2026-11-01_t1.md"),
        "---\ntitle: Done one\nstatus: done\ncommits: [alpha.nvim@abc1234]\n---\n\n## Akzeptanz\n\n- [x] it works\n",
    )
    .unwrap();
    std::fs::write(
        r.vault.join(".fake-task-done-file"),
        "alpha.nvim/Backlog/FEATURES/2026-11-01_t1.md",
    )
    .unwrap();
    std::fs::write(
        r.vault.join(".fake-merge-task.json"),
        r#"{"task":{"id":"alpha.nvim/t1","area":"alpha.nvim","title":"Done one","status":"done","file":"alpha.nvim/Backlog/FEATURES/2026-11-01_t1.md"}}"#,
    )
    .unwrap();
    let (status, doc) = post(&r, route, review, true).await;
    assert_eq!(status, 201, "{doc}");
    {
        let jobs = fake.jobs.lock().unwrap();
        assert_eq!(
            (jobs[1].kind.as_str(), jobs[1].title.as_str()),
            ("review-done", "Done one")
        );
        assert!(
            jobs[1].markdown.contains("commits: [alpha.nvim@abc1234]"),
            "the finished file: {}",
            jobs[1].markdown
        );
    }
    // Another kind is asked of the open task (no `finished`): its status decides.
    let (status, doc) = post(
        &r,
        "/api/tasks/agent",
        r#"{"id":"alpha.nvim/t1","mode":"run","kind":"prepare-decision"}"#,
        true,
    )
    .await;
    assert_eq!(
        (status, doc["error"]["code"].as_str()),
        (409, Some("kind_unfit")),
        "the open task (status done by the merge) is no decision: {doc}"
    );
    std::fs::remove_file(r.vault.join(".fake-merge-task.json")).unwrap();
    std::fs::remove_file(r.vault.join(".fake-task-done-file")).unwrap();

    // A task file over 256 KiB is not sent.
    std::fs::write(
        r.vault.join("alpha.nvim/ROADMAP/tasks/t1.md"),
        "x".repeat(256 * 1024 + 1),
    )
    .unwrap();
    let (status, doc) = post(&r, route, body, true).await;
    assert_eq!(
        (status, doc["error"]["code"].as_str()),
        (413, Some("task_too_large")),
        "{doc}"
    );
    assert_eq!(fake.jobs.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn the_answer_of_a_review_comes_back_taken_apart_by_the_engine_and_never_whole() {
    let route = "/api/tasks/agent_result";
    let fake = intake(Err(Refusal::NotRunning));
    let r = rig_full(
        "agent-result",
        false,
        None,
        None,
        None,
        None,
        None,
        Some(Arc::clone(&fake) as Arc<dyn JobIntake>),
    )
    .await;
    let body = r#"{"job":"0123456789abcdef","id":"alpha.nvim/t1","kind":"review-done"}"#;

    // While it runs: its status, nothing of the text.
    *fake.doc.lock().unwrap() = serde_json::json!({
        "id": "0123456789abcdef", "status": "running", "markdown": "the task", "output": "half"
    });
    let (status, doc) = post(&r, route, body, true).await;
    assert_eq!(
        (status, doc["status"].as_str()),
        (200, Some("running")),
        "{doc}"
    );
    assert!(
        doc.get("output").is_none() && doc.get("markdown").is_none(),
        "{doc}"
    );

    // Done: the engine's sections and follow-up, not the model's whole answer.
    *fake.doc.lock().unwrap() = serde_json::json!({
        "id": "0123456789abcdef", "status": "done", "markdown": "the task",
        "output": "a review with a follow-up"
    });
    let (status, doc) = post(&r, route, body, true).await;
    assert_eq!(status, 200, "{doc}");
    assert_eq!(doc["status"], "done");
    assert_eq!(doc["sections"][0]["heading"], "## Prüfung", "{doc}");
    assert_eq!(doc["follow_up"]["title"], "Document it", "{doc}");
    assert!(
        doc.get("output").is_none() && doc.get("markdown").is_none(),
        "{doc}"
    );

    // A long answer: only its end goes to the engine (the block is the last thing in it), cut at a character.
    let long = format!("{}ü{}", "x".repeat(300 * 1024), "the end");
    *fake.doc.lock().unwrap() =
        serde_json::json!({ "id": "0123456789abcdef", "status": "done", "output": long });
    let (status, doc) = post(&r, route, body, true).await;
    assert_eq!(status, 200, "{doc}");
    let text = doc["sections"][0]["text"].as_str().unwrap();
    assert!(
        text.len() <= 64 * 1024 && text.ends_with("the end"),
        "{}",
        text.len()
    );

    // An answer the engine refuses: its reason, nothing to adopt.
    *fake.doc.lock().unwrap() =
        serde_json::json!({ "id": "0123456789abcdef", "status": "done", "output": "broken" });
    let (status, doc) = post(&r, route, body, true).await;
    assert_eq!(status, 400, "{doc}");
    assert!(doc.to_string().contains("no review block"), "{doc}");

    // A failed job: its status and error.
    *fake.doc.lock().unwrap() =
        serde_json::json!({ "id": "0123456789abcdef", "status": "failed", "error": "boom" });
    let (_, doc) = post(&r, route, body, true).await;
    assert_eq!(
        (doc["status"].as_str(), doc["error"].as_str()),
        (Some("failed"), Some("boom")),
        "{doc}"
    );

    // Refused before anything is asked: no session, a bad job, a kind that brings no answer back, a bad id.
    assert_eq!(post(&r, route, body, false).await.0, 401);
    for bad in [
        r#"{"job":"../x","id":"alpha.nvim/t1","kind":"review-done"}"#,
        r#"{"job":"0123456789abcdef","id":"alpha.nvim/t1","kind":"handoff"}"#,
        r#"{"job":"0123456789abcdef","id":"../t1","kind":"review-done"}"#,
        r#"{"job":"0123456789abcdef","id":"alpha.nvim/t1"}"#,
    ] {
        assert_eq!(post(&r, route, bad, true).await.0, 400, "{bad}");
    }
}

#[tokio::test]
async fn a_refusal_of_ai_desktop_reaches_the_page_and_a_hub_without_an_intake_says_so() {
    let route = "/api/tasks/agent";
    let body = r#"{"id":"alpha.nvim/t1","mode":"run","kind":"handoff"}"#;
    for (name, refusal, status, code) in [
        (
            "agent-gone",
            Refusal::NotRunning,
            409,
            "ai_desktop_not_running",
        ),
        (
            "agent-refused",
            Refusal::Refused {
                status: 429,
                message: "more than 10 jobs in a minute".to_owned(),
            },
            502,
            "ai_desktop_refused",
        ),
        (
            "agent-other",
            Refusal::NotAiDesktop,
            502,
            "ai_desktop_mismatch",
        ),
    ] {
        let fake = intake(Err(refusal));
        let r = rig_full(
            name,
            false,
            None,
            None,
            None,
            None,
            None,
            Some(fake as Arc<dyn JobIntake>),
        )
        .await;
        let (got, doc) = post(&r, route, body, true).await;
        assert_eq!(
            (got, doc["error"]["code"].as_str()),
            (status, Some(code)),
            "{name}: {doc}"
        );
        let message = doc["error"]["message"].as_str().unwrap_or("");
        assert!(!message.is_empty(), "{name}: {doc}");
        if name == "agent-refused" {
            assert!(
                message.contains("429") && message.contains("10 jobs"),
                "{message}"
            );
        }
    }
    let none = rig("agent-none", false).await;
    let (status, doc) = post(&none, route, body, true).await;
    assert_eq!(
        (status, doc["error"]["code"].as_str()),
        (404, Some("agent_unavailable")),
        "{doc}"
    );
}

/// ai-desktop as some discovery sees it: the test says what is found.
struct FoundAi(Presence);

impl FamilyApps for FoundAi {
    fn ai_desktop(&self) -> Presence {
        self.0
    }
}

#[tokio::test]
async fn ai_desktop_is_reported_as_the_family_finds_it_and_only_with_a_session() {
    let route = "/api/tasks/ai_desktop";
    let found = Presence {
        installed: true,
        running: true,
        port: Some(47124),
    };
    let r = rig_full(
        "ai-found",
        false,
        None,
        None,
        None,
        None,
        Some(Arc::new(FoundAi(found))),
        None,
    )
    .await;
    let (status, doc) = get(&r, route).await;
    assert_eq!(status, 200, "{doc}");
    assert_eq!(
        (doc["installed"].as_bool(), doc["running"].as_bool()),
        (Some(true), Some(true)),
        "{doc}"
    );
    assert_eq!(doc["port"], 47124, "{doc}");
    // Without a session the hub says nothing about the machine.
    let origin = format!("http://127.0.0.1:{}", r.server.addr().port());
    let reply = patient::request(
        r.server.addr().port(),
        "GET",
        route,
        &[("Origin", origin.as_str())],
        "",
    )
    .await
    .unwrap();
    assert_eq!(reply.status, 401, "{}", reply.body);

    // Until the discovery of appkit is wired, and in a hub without it: not found.
    for (name, family) in [
        (
            "ai-not-wired",
            Some(Arc::new(NotWired) as Arc<dyn FamilyApps>),
        ),
        ("ai-none", None),
    ] {
        let r = rig_full(name, false, None, None, None, None, family, None).await;
        let (status, doc) = get(&r, route).await;
        assert_eq!(status, 200, "{name}: {doc}");
        assert_eq!(
            doc,
            serde_json::json!({ "installed": false, "running": false, "port": null }),
            "{name}"
        );
    }
}

#[tokio::test]
async fn the_order_to_stay_is_the_key_of_the_settings_and_only_with_a_session() {
    let settings = Scratch::new("open-keep-running-settings");
    std::fs::write(settings.join("config.json"), r#"{"port":17615}"#).unwrap();
    let file = || std::fs::read_to_string(settings.join("config.json")).unwrap();
    let stay: Arc<dyn KeepRunning> = Arc::new(SettingsFile::new(settings.to_path_buf()));
    let r = rig_full(
        "keep-running",
        false,
        None,
        None,
        None,
        Some(stay),
        None,
        None,
    )
    .await;
    let route = "/api/tasks/keep_running";
    assert_eq!(get(&r, route).await.1["on"], false);
    let (status, doc) = post(&r, route, r#"{"on":true}"#, true).await;
    assert_eq!((status, doc["on"].as_bool()), (200, Some(true)), "{doc}");
    assert!(
        file().contains(r#""keep_running": true"#) || file().contains(r#""keep_running":true"#),
        "{}",
        file()
    );
    assert!(
        file().contains("17615"),
        "the rest of the settings stays: {}",
        file()
    );
    assert_eq!(get(&r, route).await.1["on"], true);
    let (status, doc) = post(&r, route, r#"{"on":false}"#, true).await;
    assert_eq!((status, doc["on"].as_bool()), (200, Some(false)), "{doc}");
    assert!(!file().contains("keep_running"), "{}", file());
    // Anything else is refused, and the credential comes first.
    for bad in [
        r#"{}"#,
        r#"{"on":"yes"}"#,
        r#"{"on":true,"dir":"x"}"#,
        "nonsense",
    ] {
        assert_eq!(post(&r, route, bad, true).await.0, 400, "{bad}");
    }
    assert_eq!(post(&r, route, r#"{"on":true}"#, false).await.0, 401);
    assert!(
        !file().contains("keep_running"),
        "a refused request changed nothing"
    );

    // Settings that cannot be read: the page is told, the file is not written over.
    std::fs::write(settings.join("config.json"), "{ not json").unwrap();
    assert!(get(&r, route).await.1["on"].is_null());
    let (status, doc) = post(&r, route, r#"{"on":true}"#, true).await;
    assert_eq!(
        (status, doc["error"]["code"].as_str()),
        (502, Some("keep_running_failed"))
    );
    assert_eq!(file(), "{ not json");

    // A hub without settings offers no switch.
    let none = rig("keep-running-none", false).await;
    assert!(get(&none, route).await.1["on"].is_null());
    assert_eq!(post(&none, route, r#"{"on":true}"#, true).await.0, 404);
}

#[tokio::test]
async fn the_test_sheets_of_a_task_run_as_one_job_and_only_with_a_session() {
    let job = Arc::new(SheetRunJob::new(Arc::new(FakeSheets)));
    let r = rig_full("sheets", false, None, None, Some(job), None, None, None).await;
    let route = "/api/tasks/sheet_run";
    assert_eq!(get(&r, route).await.1["state"], "idle");
    let (status, doc) = post(&r, route, r#"{"id":"alpha.nvim/t1"}"#, true).await;
    assert_eq!(status, 200, "{doc}");
    let over = job_over(&r).await;
    assert_eq!(over["state"], "done", "{over}");
    assert_eq!(over["code"], 1);
    assert_eq!(over["lines"][0], "sheet of alpha.nvim/t1: fail at step 2");

    // A name is all the page gives: not a path, not more fields, not without a session.
    for bad in [
        r#"{"id":"../x"}"#,
        r#"{"id":"a"}"#,
        "{}",
        r#"{"id":"a/b","sheet":"x"}"#,
    ] {
        assert_eq!(post(&r, route, bad, true).await.0, 400, "{bad}");
    }
    assert_eq!(
        post(&r, route, r#"{"id":"alpha.nvim/t1"}"#, false).await.0,
        401
    );

    // What could not start is told, and the next run may start.
    post(&r, route, r#"{"id":"alpha.nvim/refused"}"#, true).await;
    assert_eq!(job_over(&r).await["state"], "failed");

    // A hub without it says so.
    let none = rig("sheets-none", false).await;
    assert_eq!(
        post(&none, route, r#"{"id":"alpha.nvim/t1"}"#, true)
            .await
            .0,
        404
    );
}

#[tokio::test]
async fn the_folder_the_person_picks_is_answered_and_a_closed_dialog_says_so() {
    let r = rig_with("pick", true, Some("/home/me/my-vault")).await;
    let (status, doc) = post(&r, "/api/tasks/vault_pick", "{}", true).await;
    assert_eq!(
        (status, doc["path"].as_str()),
        (200, Some("/home/me/my-vault")),
        "{doc}"
    );
    assert_eq!(opened(&r), vec!["pick".to_owned()]);
    // The page names no folder, and the credential comes first.
    let (status, _) = post(&r, "/api/tasks/vault_pick", r#"{"path":"/etc"}"#, true).await;
    assert_eq!(status, 400);
    let (status, _) = post(&r, "/api/tasks/vault_pick", "{}", false).await;
    assert_eq!(status, 401);
    assert_eq!(opened(&r).len(), 1, "a refused request showed no dialog");
    // A dialog closed without a choice is an answer, not an error.
    let closed = rig_with("pick-closed", true, None).await;
    let (status, doc) = post(&closed, "/api/tasks/vault_pick", "{}", true).await;
    assert_eq!(status, 200, "{doc}");
    assert!(doc["path"].is_null(), "{doc}");
    let none = rig("pick-none", false).await;
    let (status, doc) = post(&none, "/api/tasks/vault_pick", "{}", true).await;
    assert_eq!(
        (status, doc["error"]["code"].as_str()),
        (404, Some("open_unavailable"))
    );
}

#[tokio::test]
async fn a_new_vault_is_made_only_when_confirmed_and_never_over_something() {
    let r = rig("create", false).await;
    let target = r.vault.parent().unwrap().join("fresh");
    let body = |area: &str, extra: &str| {
        format!(
            r#"{{"path":{},"area":"{area}"{extra}}}"#,
            serde_json::to_string(&target.to_string_lossy()).unwrap()
        )
    };
    let route = "/api/tasks/vault_create";
    let (status, doc) = post(&r, route, &body("alpha.nvim", ""), true).await;
    assert_eq!(
        (status, doc["error"]["code"].as_str()),
        (400, Some("not_confirmed"))
    );
    assert!(!target.exists());
    let (status, _) = post(&r, route, &body("alpha.nvim", r#","confirm":true"#), false).await;
    assert_eq!(status, 401);
    assert!(!target.exists());
    let (status, doc) = post(&r, route, &body("alpha.nvim", r#","confirm":true"#), true).await;
    assert_eq!(status, 200, "{doc}");
    assert!(target.join("alpha.nvim/ROADMAP/tasks").is_dir());
    // The same area again is the folder of the earlier try; another area would be merged into it, and is refused.
    let (status, doc) = post(&r, route, &body("beta.nvim", r#","confirm":true"#), true).await;
    assert_eq!(
        (status, doc["error"]["code"].as_str()),
        (400, Some("not_empty"))
    );
    assert!(!target.join("beta.nvim").exists());
    let (status, _) = post(&r, route, &body("alpha.nvim", r#","confirm":true"#), true).await;
    assert_eq!(status, 200, "the folder of the earlier try is taken again");
    let bad = r#"{"path":"relative/v","area":"a","confirm":true}"#;
    let (status, doc) = post(&r, route, bad, true).await;
    assert_eq!(
        (status, doc["error"]["code"].as_str()),
        (400, Some("bad_path"))
    );
}

#[tokio::test]
async fn a_snapshot_of_a_checkout_is_read_and_a_name_that_climbs_is_refused() {
    let r = rig("snap", false).await;
    let (status, doc) = get(
        &r,
        "/api/tasks/sheet_snap?name=ui.nvim/TESTS/__snapshots__/sheets/a.sheet/float.80x24.snap",
    )
    .await;
    assert_eq!(status, 200, "{doc}");
    assert_eq!(
        doc["text"],
        "row one
row two
"
    );
    for name in [
        "../secret.snap",
        "ui.nvim/TESTS/__snapshots__/../../../secret.snap",
        "ui.nvim/TESTS/__snapshots__/sheets/a.sheet/none.snap",
    ] {
        let (status, doc) = get(&r, &format!("/api/tasks/sheet_snap?name={name}")).await;
        assert_eq!(status, 404, "{name}: {doc}");
        assert!(doc.get("text").is_none(), "{name}: {doc}");
    }
}

#[tokio::test]
async fn an_intent_is_checked_before_it_is_parsed_and_the_engine_says_what_it_would_do() {
    let r = rig("intent", false).await;
    let route = "/api/tasks/intent";
    let wrap = |intent: &str| serde_json::json!({ "text": intent }).to_string();
    let new = r#"{"schema":"wkd-intent/1","action":"tasks.new","mode":"form","source":{"app":"testing"},"finding":{"fp":"0123456789abcdef","area":"alpha.nvim","title":"parse_spec: an empty line ends the list"},"target":null}"#;

    // A dry run: what would be created, and nothing was.
    let (status, doc) = post(&r, route, &wrap(new), true).await;
    assert_eq!(status, 200, "{doc}");
    assert_eq!(doc["kind"], "tasks.intent");
    assert_eq!(doc["outcome"], "would_create");
    assert_eq!(doc["area"], "alpha.nvim");
    assert_eq!(doc["title"], "parse_spec: an empty line ends the list");
    // The finding is known to the vault already: the task that holds it.
    std::fs::write(r.vault.join(".fake-finding"), "0123456789abcdef").unwrap();
    let (status, doc) = post(&r, route, &wrap(new), true).await;
    assert_eq!(
        (status, doc["outcome"].as_str()),
        (200, Some("exists")),
        "{doc}"
    );
    assert_eq!(doc["id"], "alpha.nvim/t1");

    // tasks.show: a task that is there, and one that is not.
    let show = |id: &str| {
        wrap(&format!(
            r#"{{"schema":"wkd-intent/1","action":"tasks.show","mode":"form","source":{{"app":"testing"}},"finding":null,"target":{{"id":"{id}"}}}}"#
        ))
    };
    let (_, doc) = post(&r, route, &show("alpha.nvim/t1"), true).await;
    assert_eq!(doc["outcome"], "shown", "{doc}");
    let (_, doc) = post(&r, route, &show("alpha.nvim/gone"), true).await;
    assert_eq!(doc["outcome"], "not_found", "{doc}");

    // An action of another app is the engine's refusal, with its words.
    let foreign = new.replace("tasks.new", "rules.new");
    let (status, doc) = post(&r, route, &wrap(&foreign), true).await;
    assert_eq!(status, 400, "{doc}");
    assert_eq!(doc["error"]["code"], "invalid_argument");
    assert!(
        doc["error"]["message"]
            .as_str()
            .unwrap()
            .contains("rules.new"),
        "{doc}"
    );

    // Too large is refused before it is parsed (the text is no JSON at all), and so is what is no object.
    let big = "x".repeat(64 * 1024 + 1);
    let (status, doc) = post(&r, route, &wrap(&big), true).await;
    assert_eq!(
        (status, doc["error"]["code"].as_str()),
        (400, Some("intent_too_large")),
        "{doc}"
    );
    for bad in ["", "not json", "[1,2]", "\"text\"", "7"] {
        let (status, doc) = post(&r, route, &wrap(bad), true).await;
        assert_eq!(
            (status, doc["error"]["code"].as_str()),
            (400, Some("bad_intent")),
            "{bad}: {doc}"
        );
    }
    // The page cannot say yes for the person, name a vault or send the intent as an object.
    for bad in [
        format!(r#"{{"text":{},"yes":true}}"#, serde_json::json!(new)),
        format!(r#"{{"intent":{new}}}"#),
        r#"{"text":7}"#.to_owned(),
        "{}".to_owned(),
    ] {
        assert_eq!(post(&r, route, &bad, true).await.0, 400, "{bad}");
    }
    assert_eq!(post(&r, route, &wrap(new), false).await.0, 401);
}
