//! The hub keeps the series of the figures (`_Telemetry/history`) by itself, against the real engine: a vault that keeps
//! a series gets its row of the day from the hub, without a page that asks (`server/history.rs`). The unit tests of the
//! job there use an engine double with a clock; this one sees the engine write the file.
//!
//! What starts the request does not matter here: from the hour of the reminders on the job asks at its first look,
//! before that a change of the vault starts it (the test makes one, beside the hub, as Neovim would). Either way a row
//! is written within the job's first round.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use appkit_core::authn::{ManualClock, Secret, CODE_BYTES, TOKEN_BYTES};
use hub_testkit::engine_home::engine_env;
use hub_testkit::scratch::Scratch;
use tasks_hub::classes::AreaPolicy;
use tasks_hub::config::{Env, FileConfig, TasksSettings};
use tasks_hub::discovery::{discover, SetupProblem};
use tasks_hub::engine::{probe, CliEngine, Engine};
use tasks_hub::server::{start, HubStatus, Limits, ServerConfig, WatchConfig};
use tasks_hub::store::RefreshOptions;

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

/// The rows of the series, all months together.
fn rows(vault: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(vault.join("_Telemetry").join("history")) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .filter(|e| e.file_name().to_string_lossy().ends_with(".jsonl"))
        .flat_map(|e| {
            std::fs::read_to_string(e.path())
                .unwrap_or_default()
                .lines()
                .filter(|l| !l.trim().is_empty())
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .collect()
}

/// A hub over a copy of the fixture vault; `series` makes the folder of the series first; `capabilities` are what the
/// engine is said to offer. None when no engine is usable here (red when `TASKS_DESKTOP_REQUIRE_ENGINE` is set).
async fn hub(
    name: &str,
    series: bool,
    capabilities: &[&str],
) -> Option<(
    tasks_hub::server::RunningServer,
    Arc<dyn Engine>,
    PathBuf,
    Scratch,
    Scratch,
)> {
    let dir = Scratch::new(&format!("real-history-{name}"));
    let vault = dir.to_path_buf();
    copy_dir(&fixture(), &vault);
    if series {
        std::fs::create_dir_all(vault.join("_Telemetry").join("history")).unwrap();
    }
    let file = FileConfig {
        vault: Some(vault.clone()),
        app: TasksSettings {
            extra_areas: ["ALL", "nvim-config"]
                .iter()
                .map(|s| (*s).to_owned())
                .collect(),
            ..TasksSettings::default()
        },
        ..FileConfig::default()
    };
    let setup = match discover(&file, &Env::from_process()).await {
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
    let home = Scratch::new(&format!("real-history-{name}-home"));
    let engine = CliEngine::new(tasks_hub::engine::cli_config_from_setup(
        &setup,
        engine_env(&home),
    ));
    probe(&engine).await.expect("the engine answers hello");
    let engine: Arc<dyn Engine> = Arc::new(engine);
    let server = start(ServerConfig {
        devices: None,
        addr: "127.0.0.1:0".parse().unwrap(),
        limits: Limits {
            snapshot_max_age: None,
            ..Limits::default()
        },
        clock: Arc::new(ManualClock::new()),
        pairing_ttl: Duration::from_secs(60),
        control_secret: Secret::generate(TOKEN_BYTES).unwrap(),
        instance: Secret::generate(CODE_BYTES).unwrap(),
        status: HubStatus {
            engine_ready: true,
            problem: None,
            capabilities: capabilities.iter().map(|c| (*c).to_owned()).collect(),
        },
        engine: Some(Arc::clone(&engine)),
        policy: Arc::new(AreaPolicy::default()),
        usage: None,
        ui: tasks_hub::ui::UiFiles::none(),
        watch: Some(WatchConfig {
            vault: vault.clone(),
            refresh: RefreshOptions::default(),
        }),
    })
    .await
    .unwrap();
    // Last: the folders are removed after the hub and the engine.
    Some((server, engine, vault, home, dir))
}

/// A change of the vault the hub did not make: a new task file, as an editor beside the hub writes it.
fn change(vault: &Path) {
    let file = vault
        .join("lib.nvim")
        .join("ROADMAP")
        .join("tasks")
        .join("real-history-change.md");
    std::fs::write(
        &file,
        "---\ntitle: A change for the history\nstatus: open\n---\n",
    )
    .unwrap();
}

/// Until `rows` has a row, at most `within`.
async fn first_row(vault: &Path, within: Duration) -> Option<Duration> {
    let started = Instant::now();
    while started.elapsed() < within {
        if !rows(vault).is_empty() {
            return Some(started.elapsed());
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    None
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_vault_that_keeps_a_series_gets_its_row_from_the_hub() {
    let Some((server, _engine, vault, _home, _dir)) = hub("kept", true, &["history"]).await else {
        return;
    };
    assert!(rows(&vault).is_empty(), "no row before the hub ran");
    change(&vault);
    // The engine's write is two Neovim processes after the watcher's debounce: seconds, more on a busy runner.
    let took = first_row(&vault, Duration::from_secs(60)).await;
    assert!(took.is_some(), "the hub wrote no row of the figures");
    let rows = rows(&vault);
    let row: serde_json::Value = serde_json::from_str(&rows[0]).expect("a row is JSON");
    assert!(
        row["day"].is_string() || row["date"].is_string(),
        "a row names its day: {row}"
    );
    drop(server);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_vault_without_a_series_and_an_engine_without_history_get_none() {
    for (name, series, capabilities) in [
        ("no-series", false, &["history"][..]),
        ("no-capability", true, &[][..]),
    ] {
        let Some((server, _engine, vault, _home, _dir)) = hub(name, series, capabilities).await
        else {
            return;
        };
        change(&vault);
        assert!(
            first_row(&vault, Duration::from_secs(8)).await.is_none(),
            "{name}: the hub wrote a row it was not asked for"
        );
        assert!(
            !vault.join("_Telemetry").exists() || series,
            "{name}: the hub started a series by itself"
        );
        drop(server);
    }
}
