//! A stand-in for the Neovim of a sheet run (`nvim --headless ... -l <script> sheet-run <id> --vault=<dir>`), for
//! `tests/sheet_run.rs`. What it does is chosen by the id of the task:
//!
//! - `probe/hang`: starts a process of its own (as a sheet does through testing.nvim) and does not end by itself
//!   while a test waits (two minutes, so that a test that fails leaves nothing behind for good);
//! - `probe/flood`: writes lines without end;
//! - anything else: says what it was given (the id, the vault, the settings in its environment) and ends with 1.
//!
//! The process it starts listens on a port of this machine and writes the number to `<vault>/.grandchild-port`: a test
//! sees that it lives (a connection is taken) and that it is gone (it is refused) without asking the system for a pid.

use std::io::Write as _;
use std::net::TcpListener;
use std::path::Path;
use std::time::Duration;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let [flag, vault] = args.as_slice()
        && flag == "--grandchild"
    {
        grandchild(Path::new(vault));
    }
    let id = args
        .iter()
        .position(|a| a == "sheet-run")
        .and_then(|at| args.get(at + 1))
        .map_or("", String::as_str);
    let vault = args
        .iter()
        .find_map(|a| a.strip_prefix("--vault="))
        .unwrap_or("");
    match id {
        "probe/hang" => {
            let me = std::env::current_exe().expect("the probe knows its own path");
            // A sheet starts its processes after Neovim and testing.nvim came up, not in its first moment (in which,
            // on Windows, a child is not yet in the job of the hub: a limit the helper of appkit names).
            std::thread::sleep(Duration::from_millis(500));
            // By hand on purpose: this plays a program that is not ours and starts what it likes. It keeps the pipes
            // of the probe, as a process of a sheet keeps those of Neovim.
            let mut started = std::process::Command::new(me)
                .args(["--grandchild", vault])
                .stdin(std::process::Stdio::null())
                .spawn()
                .expect("the probe starts its own process");
            // It outlives every limit of a test, and so does the probe.
            let _ = started.wait();
        }
        "probe/flood" => {
            let line = "x".repeat(1024);
            let mut out = std::io::stdout().lock();
            // The pipe breaks when the run is ended.
            while writeln!(out, "{line}").is_ok() {}
        }
        _ => {
            let var = |name: &str| std::env::var(name).unwrap_or_else(|_| "-".to_owned());
            // The verdict first, as it arrives from an engine whose stdout is buffered: the page gets it last.
            eprintln!("1 sheet failed");
            println!("sheet of {id}");
            println!("vault={vault}");
            println!("lib={}", var("LIB_NVIM_DIR"));
            println!("areas={}", var("TASKS_EXTRA_AREAS"));
            println!("path={}", std::env::var_os("PATH").is_some());
            std::process::exit(1);
        }
    }
}

/// Longer than any limit of a test, and short enough that a process a failed test left is gone soon.
const LIFETIME: Duration = Duration::from_secs(120);

/// Listen, say where, and take connections until the process is ended.
fn grandchild(vault: &Path) -> ! {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("a free port");
    let port = listener.local_addr().expect("the port").port();
    // Written beside and renamed: a reader never sees half a number.
    let beside = vault.join(".grandchild-port.new");
    std::fs::write(&beside, port.to_string()).expect("the port file");
    std::fs::rename(&beside, vault.join(".grandchild-port")).expect("the port file");
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            drop(stream);
        }
    });
    std::thread::sleep(LIFETIME);
    std::process::exit(0)
}
