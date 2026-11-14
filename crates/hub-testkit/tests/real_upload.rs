//! An upload against the real engine, over a copy of the fixture vault: asked with `exact=1` (the phone page, which
//! sends a file again when the answer was lost), a file of a name the task already has is not attached a second time;
//! the engine answers `exists` in the look before the transfer already, and the task keeps one asset. Not asked (the
//! desktop page), the second file gets a counter. And the engine names its day (`hello.today`), which the
//! reminders of the push go by.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use appkit_core::authn::{ManualClock, Secret, CODE_BYTES, TOKEN_BYTES};
use hub_testkit::engine_home::engine_env;
use hub_testkit::scratch::Scratch;
use serde_json::Value;
use tasks_hub::classes::AreaPolicy;
use tasks_hub::client;
use tasks_hub::config::{Env, FileConfig, TasksSettings};
use tasks_hub::discovery::{discover, SetupProblem};
use tasks_hub::engine::{probe, Calls, CliEngine, Engine};
use tasks_hub::server::{start_with, Extras, HubStatus, Limits, ServerConfig};

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), target).unwrap();
        }
    }
}

fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("e2e")
        .join("fixture")
        .join("vault")
}

/// The real engine over a copy of the fixture vault, or None when no engine is usable here (red when
/// `TASKS_DESKTOP_REQUIRE_ENGINE` is set).
async fn engine(vault: &Path, home: &Scratch) -> Option<Arc<dyn Engine>> {
    let env = Env::from_process();
    let file = FileConfig {
        vault: Some(vault.to_path_buf()),
        app: TasksSettings {
            extra_areas: ["ALL", "nvim-config"]
                .iter()
                .map(|s| (*s).to_owned())
                .collect(),
            ..TasksSettings::default()
        },
        ..FileConfig::default()
    };
    let setup = match discover(&file, &env).await {
        Ok(s) => s,
        Err(
            p @ (SetupProblem::NvimNotFound { .. }
            | SetupProblem::NvimTooOld { .. }
            | SetupProblem::NvimProbeFailed(_)
            | SetupProblem::EngineNotFound { .. }
            | SetupProblem::LibNotFound { .. }),
        ) => {
            assert!(
                std::env::var_os("TASKS_DESKTOP_REQUIRE_ENGINE").is_none(),
                "the engine is required but not usable: {p}"
            );
            eprintln!("skipped: {p}");
            return None;
        }
        Err(other) => panic!("{other}"),
    };
    let engine = CliEngine::new(tasks_hub::engine::cli_config_from_setup(
        &setup,
        engine_env(home),
    ));
    probe(&engine).await.expect("the engine answers hello");
    Some(Arc::new(engine))
}

#[tokio::test]
async fn a_second_upload_of_the_same_name_is_exists_and_the_task_keeps_one_asset() {
    let dir = Scratch::new("real-upload");
    let vault = dir.join("vault");
    copy_dir(&fixture(), &vault);
    let home = Scratch::new("real-upload-home");
    let Some(engine) = engine(&vault, &home).await else {
        return;
    };
    let control = Secret::generate(TOKEN_BYTES).unwrap();
    let server = start_with(
        ServerConfig {
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
            watch: None,
        },
        Extras {
            upload_dir: Some(dir.join("uploads")),
            ..Extras::default()
        },
    )
    .await
    .unwrap();
    let port = server.addr().port();
    let origin = format!("http://127.0.0.1:{port}");
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
    let session = format!("Bearer {token}");
    let upload = |path: &'static str, body: &'static str| {
        let session = session.clone();
        let origin = origin.clone();
        async move {
            let reply = client::request(
                port,
                "POST",
                path,
                &[
                    ("Authorization", &session),
                    ("Origin", &origin),
                    ("Content-Type", "application/octet-stream"),
                    ("X-Upload-Name", "note.txt"),
                ],
                body,
            )
            .await
            .unwrap();
            assert_eq!(reply.status, 200, "{}", reply.body);
            serde_json::from_str::<Value>(&reply.body).unwrap()
        }
    };
    let exact = "/api/tasks/upload?id=lib.nvim/alpha&exact=1";
    let first = upload(exact, "first").await;
    assert_eq!(first["results"][0]["ok"], true, "{first}");
    let assets = |vault: &Path| -> Vec<String> {
        let mut names = Vec::new();
        let mut stack = vec![vault.join("lib.nvim")];
        while let Some(dir) = stack.pop() {
            for entry in std::fs::read_dir(&dir).unwrap().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                } else if path.file_name().is_some_and(|n| {
                    n.to_string_lossy().starts_with("note") && n.to_string_lossy().ends_with(".txt")
                }) {
                    names.push(path.to_string_lossy().into_owned());
                }
            }
        }
        names
    };
    assert_eq!(assets(&vault).len(), 1, "{:?}", assets(&vault));
    let second = upload(exact, "second").await;
    assert_eq!(second["results"][0]["ok"], false, "{second}");
    assert_eq!(second["results"][0]["error"]["code"], "exists", "{second}");
    let found = assets(&vault);
    assert_eq!(found.len(), 1, "no second asset under a counter: {found:?}");
    assert_eq!(std::fs::read_to_string(&found[0]).unwrap(), "first");
    // Without `exact` the same name gets a counter.
    let third = upload("/api/tasks/upload?id=lib.nvim/alpha", "third").await;
    assert_eq!(third["results"][0]["ok"], true, "{third}");
    assert_eq!(assets(&vault).len(), 2, "{:?}", assets(&vault));
    // `kind`: the asset lies in the folder of its kind below `assets/`, and the answer names that folder.
    let before: std::collections::BTreeSet<String> = assets(&vault).into_iter().collect();
    let video = upload("/api/tasks/upload?id=lib.nvim/alpha&kind=video", "video").await;
    assert_eq!(video["results"][0]["ok"], true, "{video}");
    assert_eq!(
        video["results"][0]["asset"], "assets/videos/note.txt",
        "{video}"
    );
    assert_eq!(
        video["results"][0]["link"], "[note.txt](assets/videos/note.txt)",
        "{video}"
    );
    let added: Vec<String> = assets(&vault)
        .into_iter()
        .filter(|path| !before.contains(path))
        .collect();
    assert_eq!(added.len(), 1, "{added:?}");
    assert!(
        added[0]
            .replace('\\', "/")
            .ends_with("/assets/videos/note.txt"),
        "{added:?}"
    );
    assert_eq!(std::fs::read_to_string(&added[0]).unwrap(), "video");
    // A word that is no kind is refused before anything is taken: the page names no folder.
    for bad in ["videos", "..%2Fx", ""] {
        let reply = client::request(
            port,
            "POST",
            &format!("/api/tasks/upload?id=lib.nvim/alpha&kind={bad}"),
            &[
                ("Origin", origin.as_str()),
                ("Authorization", session.as_str()),
                ("Content-Type", "application/octet-stream"),
                ("X-Upload-Name", "note.txt"),
            ],
            "refused",
        )
        .await
        .unwrap();
        assert_eq!(reply.status, 400, "{bad:?}: {}", reply.body);
        assert!(reply.body.contains("bad_query"), "{}", reply.body);
    }
    assert_eq!(assets(&vault).len(), 3, "{:?}", assets(&vault));
    server.shutdown().await;
}

#[tokio::test]
async fn the_engine_names_its_day() {
    let dir = Scratch::new("real-today");
    let vault = dir.join("vault");
    copy_dir(&fixture(), &vault);
    let home = Scratch::new("real-today-home");
    let Some(engine) = engine(&vault, &home).await else {
        return;
    };
    let reply = engine.call(Calls::Hello, None).await.unwrap();
    let doc: Value = serde_json::from_str(&reply.text).unwrap();
    let today = doc["today"].as_str().expect("hello names today");
    assert!(
        today.len() == 10
            && today.bytes().enumerate().all(|(i, b)| if i == 4 || i == 7 {
                b == b'-'
            } else {
                b.is_ascii_digit()
            }),
        "{today}"
    );
}
