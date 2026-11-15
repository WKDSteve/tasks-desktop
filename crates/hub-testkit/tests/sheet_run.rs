//! The run of test sheets as a process (`SystemSheetRunner`): it is a child of the hub through `appkit_core::child`, so
//! it has a time limit and a limit for its output, and what it started ends with it.

use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use hub_testkit::scratch::Scratch;
use tasks_hub::sheetrun::{SheetCommand, SheetLimits, SheetRunner, SystemSheetRunner};

/// How long a process of the probe may take to start, or to be gone, on a busy machine.
const BUDGET: Duration = Duration::from_secs(30);

fn runner(vault: &Path, limits: SheetLimits) -> SystemSheetRunner {
    let vault = vault.to_path_buf();
    SystemSheetRunner {
        command: Arc::new(move || {
            let vault = vault.clone();
            Box::pin(async move {
                Ok(SheetCommand {
                    nvim: PathBuf::from(env!("CARGO_BIN_EXE_sheet-probe")),
                    script: vault.join("tasks.lua"),
                    lib_dir: Some(vault.join("lib")),
                    extra_areas: vec!["ALL".to_owned(), "x.nvim".to_owned()],
                    vault,
                })
            })
        }),
        limits,
    }
}

/// The port the process listens on that the probe started, once it says so.
async fn grandchild_port(vault: &Path) -> u16 {
    let file = vault.join(".grandchild-port");
    let patience = tokio::time::Instant::now() + BUDGET;
    loop {
        if let Ok(text) = std::fs::read_to_string(&file) {
            return text.trim().parse().expect("a port");
        }
        assert!(
            tokio::time::Instant::now() < patience,
            "the probe never started its own process"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

fn listens(port: u16) -> bool {
    TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_secs(2)).is_ok()
}

/// The process behind `port` is gone: nothing takes a connection any more.
async fn gone(port: u16) -> bool {
    let patience = tokio::time::Instant::now() + BUDGET;
    while tokio::time::Instant::now() < patience {
        if !listens(port) {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    false
}

#[tokio::test(flavor = "multi_thread")]
async fn a_run_gets_the_settings_and_the_environment_of_the_hub_and_its_end_reaches_the_page() {
    let vault = Scratch::new("sheet-run-plain");
    let run = runner(&vault, SheetLimits::default())
        .run("alpha.nvim/t")
        .await
        .unwrap();
    assert_eq!(run.code, Some(1));
    let has = |line: &str| run.lines.iter().any(|l| l == line);
    assert!(has("sheet of alpha.nvim/t"), "{:?}", run.lines);
    assert!(
        has(&format!("vault={}", vault.display())),
        "{:?}",
        run.lines
    );
    assert!(
        has(&format!("lib={}", vault.join("lib").display())),
        "{:?}",
        run.lines
    );
    assert!(has("areas=ALL,x.nvim"), "{:?}", run.lines);
    // The environment of the hub is inherited: a sheet needs PATH and the tool chains.
    assert!(has("path=true"), "{:?}", run.lines);
    // stderr is part of what the page gets, and its end: there the engine says its verdict.
    assert_eq!(
        run.lines.last().map(String::as_str),
        Some("1 sheet failed"),
        "{:?}",
        run.lines
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_run_that_takes_too_long_is_ended_with_what_it_started_and_the_page_is_told() {
    let vault = Scratch::new("sheet-run-hang");
    let runner = runner(
        &vault,
        SheetLimits {
            timeout: Duration::from_secs(10),
            ..SheetLimits::default()
        },
    );
    let run = tokio::spawn(async move { runner.run("probe/hang").await });
    // That it wrote its port says that it ran; whether it still does is not asked here, the limit may be over.
    let port = grandchild_port(&vault).await;

    let message = tokio::time::timeout(BUDGET, run)
        .await
        .expect("the time limit ends the run")
        .unwrap()
        .unwrap_err();
    assert_eq!(message, "the run was ended: it took longer than 10 seconds");
    assert!(
        gone(port).await,
        "the process the sheet started ended with the run"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_run_that_writes_without_end_is_ended_and_the_page_is_told() {
    let vault = Scratch::new("sheet-run-flood");
    let runner = runner(
        &vault,
        SheetLimits {
            max_output: 64 * 1024,
            ..SheetLimits::default()
        },
    );
    let message = tokio::time::timeout(BUDGET, runner.run("probe/flood"))
        .await
        .expect("the limit ends the run")
        .unwrap_err();
    assert_eq!(
        message,
        "the run was ended: it wrote more than 65536 bytes of output"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_run_ends_with_what_it_started_when_the_hub_drops_it() {
    let vault = Scratch::new("sheet-run-dropped");
    let runner = runner(&vault, SheetLimits::default());
    let run = tokio::spawn(async move { runner.run("probe/hang").await });
    let port = grandchild_port(&vault).await;
    assert!(listens(port), "the process of the sheet runs");

    // What the end of the hub does to the task of a run: its runtime drops it.
    run.abort();
    assert!(run.await.unwrap_err().is_cancelled());
    assert!(
        gone(port).await,
        "the process the sheet started ended with the run"
    );
}
