//! The scheduler and a series of meetings against the real engine (capability `meeting_series`): the hub reads the
//! planned meetings of its window from `tasks.meetings` (as `server::schedule` does) and plans their notices. A series
//! is listed as its occurrences, so every occurrence is told at its own time; an excepted day and an occurrence
//! cancelled through its id (its first entry, which makes its file) tell nothing.

use std::path::{Path, PathBuf};

use hub_testkit::engine_home::engine_env;
use hub_testkit::scratch::Scratch;
use jiff::tz::TimeZone;
use serde_json::{json, Value};
use tasks_hub::config::{Env, FileConfig, TasksSettings};
use tasks_hub::discovery::{discover, SetupProblem};
use tasks_hub::engine::{probe, Calls, CliEngine, Engine, Method};
use tasks_hub::schedule::{meeting_of, plan, Inputs, Rules, MEETING};

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

/// The real engine over `vault`, or `None` (skipped) without one that has series.
async fn engine(vault: &Path, home: &Scratch) -> Option<CliEngine> {
    let file = FileConfig {
        vault: Some(vault.to_path_buf()),
        app: TasksSettings::default(),
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
    let engine = CliEngine::new(tasks_hub::engine::cli_config_from_setup(
        &setup,
        engine_env(home),
    ));
    let info = probe(&engine).await.expect("the engine answers hello");
    if !info.capabilities.iter().any(|c| c == "meeting_series") {
        assert!(
            std::env::var_os("TASKS_DESKTOP_REQUIRE_ENGINE").is_none(),
            "the engine has no meeting_series: engine.lock names an older one than the checkout"
        );
        eprintln!("skipped: the engine has no meeting_series");
        return None;
    }
    Some(engine)
}

async fn call(engine: &CliEngine, method: Method, params: &Value) -> Value {
    let reply = engine.call(method, Some(params)).await.expect("an answer");
    serde_json::from_str(&reply.text).unwrap()
}

fn vienna(wall: &str) -> jiff::Timestamp {
    wall.parse::<jiff::civil::DateTime>()
        .unwrap()
        .to_zoned(TimeZone::get("Europe/Vienna").unwrap())
        .unwrap()
        .timestamp()
}

#[tokio::test]
async fn every_occurrence_of_a_series_is_told_but_an_excepted_or_cancelled_one() {
    let dir = Scratch::new("real-series-schedule");
    let vault = dir.join("vault");
    copy_dir(&fixture(), &vault);
    let home = Scratch::new("real-series-schedule-home");
    let Some(engine) = engine(&vault, &home).await else {
        return;
    };
    let meetings = vault.join("lib.nvim").join("MEETINGS");
    std::fs::create_dir_all(&meetings).unwrap();
    std::fs::write(
        meetings.join("ser-sync.md"),
        "---\ntitle: Weekly sync\nstatus: planned\ndate: 2030-01-07\ntime: \"10:00\"\nduration: 30m\ntz: Europe/Vienna\nnotify: [-15m]\nrepeat: weekly\nrepeat_until: 2030-01-28\nexcept: [2030-01-14]\n---\n\nA series of one test.\n",
    )
    .unwrap();

    // The first entry into an occurrence: its cancellation makes its file.
    let done = call(
        &engine,
        Calls::Ops,
        &json!({ "ops": [{ "op": "meeting_set", "id": "lib.nvim/ser-sync-2030-01-21", "patch": { "status": "cancelled" } }] }),
    )
    .await;
    assert_eq!(done["results"][0]["ok"], true, "{done}");
    assert_eq!(done["results"][0]["created"], true, "{done}");
    assert!(meetings.join("ser-sync-2030-01-21.md").is_file());

    // What the scheduler asks the engine for its window.
    let doc = call(
        &engine,
        Calls::Meetings,
        &json!({ "since": "2030-01-01", "until": "2030-02-28", "status": ["planned"], "limit": 100, "offset": 0 }),
    )
    .await;
    assert_eq!(doc["kind"], "tasks.meetings", "{doc}");
    let items = doc["items"].as_array().unwrap();
    let inputs = Inputs {
        meetings: items.iter().filter_map(meeting_of).collect(),
        reminders: Vec::new(),
    };
    let ids: Vec<&str> = inputs.meetings.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(
        ids,
        [
            "lib.nvim/ser-sync-2030-01-07",
            "lib.nvim/ser-sync-2030-01-28"
        ],
        "{doc}"
    );

    let zone = TimeZone::get("Europe/Vienna").unwrap();
    let told = |wall: &str| -> Vec<String> {
        plan(&inputs, vienna(wall), &zone, &Rules::default())
            .into_iter()
            .filter(|d| d.kind == MEETING)
            .map(|d| d.id)
            .collect()
    };
    // Each occurrence at its own time, not only the first day of the series.
    assert_eq!(told("2030-01-07T09:50"), ["lib.nvim/ser-sync-2030-01-07"]);
    assert_eq!(told("2030-01-28T09:50"), ["lib.nvim/ser-sync-2030-01-28"]);
    // The excepted day and the cancelled occurrence tell nothing.
    assert!(told("2030-01-14T09:50").is_empty());
    assert!(told("2030-01-21T09:50").is_empty());
}
