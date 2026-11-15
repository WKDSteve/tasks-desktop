//! The detail of a task, the areas and the next tasks are kept for one state of the vault: a second look
//! costs no engine question, a change of the vault empties the table.

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use appkit_core::authn::{ManualClock, Secret, CODE_BYTES, TOKEN_BYTES};
use hub_testkit::scratch::Scratch;
use serde_json::Value;
use tasks_hub::classes::AreaPolicy;
use tasks_hub::client;
use tasks_hub::config::Env;
use tasks_hub::engine::{CliEngine, CliEngineConfig, Engine};
use tasks_hub::server::{start, HubStatus, Limits, RunningServer, ServerConfig, WatchConfig};
use tasks_hub::store::RefreshOptions;

struct Rig {
    server: RunningServer,
    vault: PathBuf,
    token: String,
    // Last: the folder is removed after the server, which has the vault open.
    _dir: Scratch,
}

async fn rig(name: &str) -> Rig {
    let dir = Scratch::new(&format!("detail-{name}"));
    let vault = dir.to_path_buf();
    std::fs::create_dir_all(vault.join("alpha.nvim").join("ROADMAP").join("tasks")).unwrap();
    std::fs::write(vault.join(".fake-n"), "2").unwrap();
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
    let server = start(ServerConfig {
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
    })
    .await
    .unwrap();
    let addr: SocketAddr = server.addr();
    let port = addr.port();
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
        token,
        _dir: dir,
    }
}

async fn task(r: &Rig, id: &str) -> (u16, Value) {
    let auth = format!("Bearer {}", r.token);
    let reply = client::request(
        r.server.addr().port(),
        "GET",
        &format!("/api/tasks/task?id={id}"),
        &[("Authorization", &auth)],
        "",
    )
    .await
    .unwrap();
    let doc = serde_json::from_str(&reply.body).unwrap_or(Value::Null);
    (reply.status, doc)
}

fn calls(vault: &Path) -> usize {
    std::fs::read_to_string(vault.join(".fake-task-calls"))
        .map(|t| t.lines().count())
        .unwrap_or(0)
}

fn touch(vault: &Path, file: &str) {
    std::fs::write(
        vault
            .join("alpha.nvim")
            .join("ROADMAP")
            .join("tasks")
            .join(file),
        "---
title: x
status: open
---
",
    )
    .unwrap();
}

#[tokio::test]
async fn a_second_look_at_a_task_costs_no_engine_question_until_the_vault_changes() {
    let r = rig("kept").await;
    // Every `task` question is counted (and takes no time).
    std::fs::write(r.vault.join(".fake-task-ms"), "0").unwrap();

    // The page has its list before it opens a task; the hub holds that state.
    let auth = format!("Bearer {}", r.token);
    let reply = client::request(
        r.server.addr().port(),
        "GET",
        "/api/tasks/snapshot",
        &[("Authorization", &auth)],
        "",
    )
    .await
    .unwrap();
    assert_eq!(reply.status, 200);

    let (status, first) = task(&r, "alpha.nvim/t1").await;
    assert_eq!(status, 200, "{first}");
    assert_eq!(calls(&r.vault), 1);
    let (_, again) = task(&r, "alpha.nvim/t1").await;
    assert_eq!(again, first);
    assert_eq!(calls(&r.vault), 1, "the second look came from the table");

    // Another task is another question.
    task(&r, "alpha.nvim/t2").await;
    assert_eq!(calls(&r.vault), 2);

    // The vault changes: the table is emptied with the state it was for.
    std::fs::write(r.vault.join(".fake-n"), "3").unwrap();
    touch(&r.vault, "new-task.md");
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let (_, doc) = task(&r, "alpha.nvim/t1").await;
        if doc["rev"] != first["rev"] {
            break;
        }
        assert!(Instant::now() < deadline, "the new state was not seen");
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    assert!(calls(&r.vault) >= 3, "asked again for the new state");
}

#[tokio::test]
async fn a_hub_that_holds_no_snapshot_keeps_nothing_and_fetches_no_scan_for_a_task() {
    let r = rig("cold").await;
    std::fs::write(r.vault.join(".fake-task-ms"), "0").unwrap();
    std::fs::write(r.vault.join(".fake-calls"), "").ok();
    task(&r, "alpha.nvim/t1").await;
    task(&r, "alpha.nvim/t1").await;
    // Both looks went to the engine: there was no state to key them by.
    assert_eq!(calls(&r.vault), 2);
    // And asking for a task did not make the hub scan the whole vault.
    let scans = std::fs::read_to_string(r.vault.join(".fake-calls"))
        .map(|t| t.lines().count())
        .unwrap_or(0);
    assert_eq!(scans, 0, "no snapshot was fetched for a task");
}

async fn get(r: &Rig, path: &str) -> (u16, Value) {
    let auth = format!("Bearer {}", r.token);
    let reply = client::request(
        r.server.addr().port(),
        "GET",
        path,
        &[("Authorization", &auth)],
        "",
    )
    .await
    .unwrap();
    let doc = serde_json::from_str(&reply.body).unwrap_or(Value::Null);
    (reply.status, doc)
}

fn asked(vault: &Path, method: &str) -> usize {
    std::fs::read_to_string(vault.join(format!(".fake-calls-{method}")))
        .map(|t| t.lines().count())
        .unwrap_or(0)
}

#[tokio::test]
async fn areas_and_next_are_asked_once_per_state_of_the_vault() {
    let r = rig("areas-next").await;
    // The page has its list first; the hub holds that state.
    let (status, snap) = get(&r, "/api/tasks/snapshot").await;
    assert_eq!(status, 200, "{snap}");

    let (status, areas) = get(&r, "/api/tasks/areas").await;
    assert_eq!(status, 200, "{areas}");
    let (_, again) = get(&r, "/api/tasks/areas").await;
    assert_eq!(again, areas);
    assert_eq!(
        asked(&r.vault, "areas"),
        1,
        "the second look came from the table"
    );

    let (status, next) = get(&r, "/api/tasks/next?n=3").await;
    assert_eq!(status, 200, "{next}");
    let (_, again) = get(&r, "/api/tasks/next?n=3").await;
    assert_eq!(again, next);
    assert_eq!(
        asked(&r.vault, "next"),
        1,
        "the second look came from the table"
    );
    // Another question is another answer.
    let (_, other) = get(&r, "/api/tasks/next?n=4").await;
    assert_eq!(other["echoed"]["n"], 4, "{other}");
    assert_eq!(asked(&r.vault, "next"), 2);
    // A task detail beside them does not push them out.
    task(&r, "alpha.nvim/t1").await;
    get(&r, "/api/tasks/areas").await;
    get(&r, "/api/tasks/next?n=3").await;
    assert_eq!((asked(&r.vault, "areas"), asked(&r.vault, "next")), (1, 2));
    // `next` depends on more than the state (a claim set by another program, the day): it is held for a moment only.
    tokio::time::sleep(Duration::from_millis(5200)).await;
    get(&r, "/api/tasks/areas").await;
    get(&r, "/api/tasks/next?n=3").await;
    assert_eq!(
        (asked(&r.vault, "areas"), asked(&r.vault, "next")),
        (1, 3),
        "next is asked again after a few seconds, areas not"
    );

    // The vault changes: both are asked again for the new state.
    std::fs::write(r.vault.join(".fake-n"), "3").unwrap();
    touch(&r.vault, "new-task.md");
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let (_, now) = get(&r, "/api/tasks/snapshot").await;
        if now["rev"] != snap["rev"] {
            break;
        }
        assert!(Instant::now() < deadline, "the new state was not seen");
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    get(&r, "/api/tasks/areas").await;
    get(&r, "/api/tasks/next?n=3").await;
    assert_eq!((asked(&r.vault, "areas"), asked(&r.vault, "next")), (2, 4));
}

#[tokio::test]
async fn a_hub_that_holds_no_snapshot_asks_areas_and_next_every_time() {
    let r = rig("areas-cold").await;
    get(&r, "/api/tasks/areas").await;
    get(&r, "/api/tasks/areas").await;
    get(&r, "/api/tasks/next").await;
    get(&r, "/api/tasks/next").await;
    assert_eq!((asked(&r.vault, "areas"), asked(&r.vault, "next")), (2, 2));
}
