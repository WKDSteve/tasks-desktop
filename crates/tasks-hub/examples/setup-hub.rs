//! The hub of a first start, for the test sheet `TESTS/sheets/first-start.sheet.lua`: the hub as `serve` runs it, in
//! the environment it is given (a config folder of the run, no vault, the seams of the dialogs), on a free port.
//! Prints a pairing link (of the phone page under /m/ when `TASKS_SETUP_HUB_PHONE` is set) and ends on Enter (or when
//! stdin closes).
//!
//! ```text
//! TASKS_DESKTOP_CONFIG_DIR=<an empty folder> cargo run -p tasks-hub --example setup-hub
//! ```

use std::time::Duration;

use tasks_hub::app::{self, ServeOptions};

#[tokio::main]
async fn main() -> Result<(), String> {
    let server = tokio::spawn(app::serve(ServeOptions { port: Some(0) }));
    // The link needs the hub's record (`hub.json`), which the server writes once it listens.
    let mut link = None;
    for _ in 0..300 {
        if server.is_finished() {
            break;
        }
        if let Ok(text) = app::open().await {
            link = text.lines().next().map(str::to_owned);
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let Some(mut link) = link else {
        return match server.await {
            Ok(Err(e)) => Err(e),
            _ => Err("the hub did not start within 30 s".to_owned()),
        };
    };
    // A sheet of the phone page (`TASKS_SETUP_HUB_PHONE` set) gets the link of the page under /m/: the code is single
    // use, so the desktop page must not take it first.
    if std::env::var_os("TASKS_SETUP_HUB_PHONE").is_some_and(|v| !v.is_empty()) {
        link = link.replacen("/#pair=", "/m/#pair=", 1);
    }
    println!("{link}");
    let _ = tokio::task::spawn_blocking(|| std::io::stdin().read_line(&mut String::new())).await;
    server.abort();
    Ok(())
}
