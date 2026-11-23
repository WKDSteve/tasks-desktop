//! The commands of tasks-desktop (the program `tasks-hub`; `install` makes it the command `tasks-desktop`): those every
//! hub app shares (`appkit_hub::cli`: `start`, `stop`/`quit`, `restart`, `status`, `open`, `link`, `logs`, `paths`,
//! `version`, `help`) and its own (`setup`, `serve`, `autostart`, `install`, `uninstall`, `open --phone`, `devices`,
//! `phone`, `testing`, `usage`, `areas`). Without an argument (a double click) it starts the hub in the background and
//! opens the browser.
//!
//! Exit codes: 0 done, 1 failed (`status`: the hub does not run; `areas check`: an area without a data class), 2 wrong
//! arguments.
//!
//! The release build is a window program (appkit `docs/PROCESSES.md`, "A hub is a window program"): Windows
//! opens no console window for the link, the login entry or a double click, and from a terminal it attaches to
//! the terminal's console. A debug build stays a console program.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use appkit_core::console::{self, Console};
use appkit_hub::cli::{self, Parsed, Verb};
use tasks_hub::app::{self, AreasCommand, ServeOptions};
use tasks_hub::background::{self, Autostart, InstallOptions, UninstallOptions};
use tasks_hub::setup;

/// The command in the terminal (the program is `tasks-hub`).
const COMMAND: &str = "tasks-desktop";

/// The commands of tasks-desktop that are not common to the hub apps, by the name `help <command>` takes.
const OWN_USAGE: [(&str, &str); 10] = [
    (
        "setup",
        "  tasks-desktop setup                         ask the questions of the first start here (vault,
                                              installation), then start the hub and open the page\n",
    ),
    (
        "serve",
        "  tasks-desktop serve [--port <1024-65535>]   run the hub in this terminal until Ctrl-C\n",
    ),
    (
        "autostart",
        "  tasks-desktop autostart on|off|status       start the hub with your login (Windows: Run key;
                                              Linux: autostart entry; macOS: launch agent)\n",
    ),
    (
        "install",
        "  tasks-desktop install [--autostart] [--shortcut] [--open]
                                              copy this program to a fixed place (a build then does
                                              not fight the running hub for the file) and make the
                                              command `tasks-desktop` for every new terminal; the
                                              Start menu gets a link, --shortcut adds one on the
                                              desktop; --open starts the hub and opens the page\n",
    ),
    (
        "uninstall",
        "  tasks-desktop uninstall [--purge-settings]  stop the hub, take away the login entry, the link and
                                              the command; --purge-settings also removes the settings
                                              (never the vault); the program file is left for the script\n",
    ),
    (
        "open",
        "  tasks-desktop open --phone [--no-window]    a pairing code for a phone through Tailscale Serve
                                              (TASKS_DESKTOP_TAILNET), as a QR code for its camera; in a
                                              terminal also as a picture in a window\n",
    ),
    (
        "devices",
        "  tasks-desktop devices                       list the phones paired with a key of their own
  tasks-desktop devices revoke <id>           revoke one: its sessions end, it has to pair again
  tasks-desktop devices level <id> read|create|change|trigger
                                              what one may do (a new phone: change); its open
                                              sessions follow at once\n",
    ),
    (
        "phone",
        "  tasks-desktop phone export <file>           write what a paired phone is given (public and internal
                                              areas only) as a file the phone opens, read only (no
                                              running hub needed)\n",
    ),
    (
        "testing",
        "  tasks-desktop testing link <link>           pair this hub with the testing hub (the link of
                                              `testing-hub phone pair --tunnel`), so a phone can start
                                              the test sheets of a task there
  tasks-desktop testing unlink                forget that pairing here\n",
    ),
    (
        "usage",
        "  tasks-desktop usage [--days=14]             on how many of the last days the interface was opened
                                              (counts only, kept on this machine)
  tasks-desktop areas propose [--private=a,b] [--write]
                                              propose a data class for every area (written, with
                                              --write, as areas.proposed.json: nothing is released until
                                              you rename it to areas.json)
  tasks-desktop areas check                   list the areas that have no data class (exit 1 if any)\n",
    ),
];

/// The own commands of the app, for the tab completion (`usage` explains `areas`).
fn own_words() -> Vec<&'static str> {
    OWN_USAGE
        .iter()
        .map(|(name, _)| if *name == "usage" { "areas" } else { *name })
        .collect()
}

/// The text of `help`: the common commands, then the own ones, then what the background hub does.
fn usage() -> String {
    let mut out = String::from("usage:\n");
    out.push_str(&cli::usage_lines(COMMAND));
    for (_, lines) in OWN_USAGE {
        out.push_str(lines);
    }
    out.push_str(
        "\nThe hub in the background has no window (its log: tasks-desktop logs). It ends itself 10 minutes after the
last page closed, unless it starts with your login, a phone is paired or config.json has keep_running: true.
A hub that `start --open` or `open` started is stopped again when the page cannot be opened. `link` prints
the link of this PC, and with a tailnet name set a second one for a phone (the same code under /m/).
Exit codes: 0 done, 1 failed (status: the hub does not run), 2 wrong arguments.",
    );
    out
}

/// What one command does, for `help <command>`: the common text, the own lines, or both (`open` and `open --phone`);
/// `areas` is explained with `usage`.
fn help_of(command: &str) -> Option<String> {
    let own_name = if command == "areas" { "usage" } else { command };
    let own = OWN_USAGE
        .iter()
        .find(|(name, _)| *name == own_name)
        .map(|(_, lines)| lines.trim_end().to_owned());
    match (cli::help(command, COMMAND), own) {
        (Some(common), Some(own)) => Some(format!("{common}\n{own}")),
        (common, own) => common.or(own),
    }
}

/// Why the program ends without having done its work, and with which exit code.
struct Failed {
    message: String,
    code: i32,
}

impl Failed {
    /// Wrong arguments: exit code 2.
    fn usage(message: String) -> Self {
        Self {
            message,
            code: cli::USAGE_EXIT,
        }
    }
}

impl From<String> for Failed {
    /// A command that failed: exit code 1.
    fn from(message: String) -> Self {
        Self { message, code: 1 }
    }
}

fn parse_port(args: &[String]) -> Result<Option<u16>, String> {
    match args {
        [] => Ok(None),
        [flag, value] if flag == "--port" => value
            .parse::<u16>()
            .ok()
            .filter(|p| *p >= 1024)
            .map(Some)
            .ok_or_else(|| format!("--port must be a number from 1024 to 65535, not {value:?}")),
        _ => Err(usage()),
    }
}

fn parse_days(args: &[String]) -> Result<u32, String> {
    match args {
        [] => Ok(14),
        [flag] => flag
            .strip_prefix("--days=")
            .and_then(|n| n.parse::<u32>().ok())
            .filter(|n| (1..=366).contains(n))
            .ok_or_else(|| "--days is a number from 1 to 366".to_owned()),
        _ => Err(usage()),
    }
}

fn parse_areas(args: &[String]) -> Result<AreasCommand, String> {
    match args.split_first() {
        Some((verb, rest)) if verb == "propose" => {
            let mut private = Vec::new();
            let mut write = false;
            for arg in rest {
                if arg == "--write" {
                    write = true;
                } else if let Some(list) = arg.strip_prefix("--private=") {
                    private.extend(list.split(',').filter(|s| !s.is_empty()).map(str::to_owned));
                } else {
                    return Err(usage());
                }
            }
            Ok(AreasCommand::Propose { private, write })
        }
        Some((verb, rest)) if verb == "check" && rest.is_empty() => Ok(AreasCommand::Check),
        _ => Err(usage()),
    }
}

/// What a double click does: the hub runs in the background (a second click finds it), and the browser
/// opens with a one-time link. `TASKS_DESKTOP_NO_LAUNCH` prints the link instead (the tests).
async fn click(ask: bool) -> Result<(), String> {
    let env = tasks_hub::config::Env::from_process();
    // The questions of a first start (vault, install) in the console: asked for (`setup`), or a console of the
    // program's own at a terminal. A double click gets them in the page.
    if ask {
        setup::forget_asked(&env)?;
    }
    let installed = if ask || setup::interactive(&env) {
        setup::run(&mut setup::Console, &env).await?
    } else {
        None
    };
    let started = match installed {
        // The hub runs from the installed copy, not from the file that was downloaded.
        Some(program) => background::start_from(&program)?,
        None => background::start().await?,
    };
    print!("{started}");
    let print_only = std::env::var_os(tasks_hub::IDENTITY.var("NO_LAUNCH")).is_some();
    open_page(started, print_only).await
}

/// Open the page of the hub that was just started or found, in the browser (`print_only`: print the link instead).
/// Its future is on the heap and made here, not in the `match` of `run`: a large future made there takes room in the
/// stack of the main thread for every command (see `uninstall` of the kit), which overflows it in a debug build.
fn open_page(
    started: String,
    print_only: bool,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>>>> {
    Box::pin(async move {
        let page = async {
            let url = app::open().await?;
            if print_only {
                println!("{url}");
                Ok(())
            } else {
                app::launch(link_of_this_pc(&url))
            }
        };
        open_or_stop(&started, page, background::stop).await
    })
}

/// The link the browser of this PC opens, out of what `open` printed: its first line. With a tailnet name set there
/// is a second one, the link for the phone, which is not for this browser (and made `launch` refuse the whole text).
fn link_of_this_pc(printed: &str) -> &str {
    printed.lines().next().unwrap_or(printed)
}

/// Open the page of the hub that was just started or found (`started` is what the start printed). A hub this call
/// started for the page does not stay behind when the page cannot be opened: nobody would see it. One that ran
/// already is not this call's to stop.
async fn open_or_stop<P, S, F>(started: &str, page: P, stop: S) -> Result<(), String>
where
    P: std::future::Future<Output = Result<(), String>>,
    S: FnOnce() -> F,
    F: std::future::Future<Output = Result<String, String>>,
{
    let Err(why) = page.await else {
        return Ok(());
    };
    if !background::started_now(started) {
        return Err(why);
    }
    Err(match stop().await {
        Ok(_) => format!("{why}; the hub that was started for the page is stopped again"),
        Err(left) => format!("{why}; the hub that was started for the page still runs: {left}"),
    })
}

/// A console that was opened by a double click closes with the program: an error is read before that.
fn wait_for_enter() {
    use std::io::{BufRead, IsTerminal, Write};
    if std::io::stdin().is_terminal() {
        eprint!("Press Enter to close this window.");
        let _ = std::io::stderr().flush();
        let _ = std::io::stdin().lock().lines().next();
    }
}

/// `phone export <file>`, run as a task of the runtime: its worker threads have a larger stack than the main thread of
/// Windows (1 MB), which the engine calls of the export overflow in a debug build. `run` holds only the handle.
fn phone_export(
    file: &str,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send>> {
    let file = std::path::PathBuf::from(file);
    let task = tokio::spawn(async move { app::phone_export(&file).await });
    Box::pin(async move {
        task.await
            .map_err(|e| format!("the export stopped: {e}"))?
            .map(|text| println!("{text}"))
    })
}

/// `open --phone`, a task of the runtime like the export (it holds the code open until it is over).
fn open_phone(
    window: bool,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send>> {
    let task = tokio::spawn(async move { app::open_phone(window).await });
    Box::pin(async move {
        task.await
            .map_err(|e| format!("the pairing stopped: {e}"))?
    })
}

/// `testing link <link>`, a task of the runtime like the export (the pairing goes over the network).
fn testing_link(
    text: &str,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send>> {
    let text = text.to_owned();
    let task = tokio::spawn(async move { app::testing_link(&text).await });
    Box::pin(async move {
        task.await
            .map_err(|e| format!("the pairing stopped: {e}"))?
            .map(|text| println!("{text}"))
    })
}

/// Whether the link of a page is printed instead of opened (`TASKS_DESKTOP_NO_LAUNCH`: the tests).
fn print_only() -> bool {
    std::env::var_os(tasks_hub::IDENTITY.var("NO_LAUNCH")).is_some()
}

/// The hub in the background, then its page in the browser (`start --open`, `open`, `restart --open`).
async fn start_and_open() -> Result<(), String> {
    let started = background::start().await?;
    print!("{started}");
    open_page(started, print_only()).await
}

/// The command the arguments name; the exit code when it ran. Apart from `main` so that its future lives on the heap:
/// the main thread of Windows has 1 MB of stack, and the future of all the commands together is too big for it in a
/// debug build.
async fn run(args: Vec<String>) -> Result<i32, Failed> {
    let verb = match cli::parse(&args) {
        Parsed::Common(verb) => verb,
        Parsed::Usage(text) => return Err(Failed::usage(text)),
        Parsed::Own => return Box::pin(run_own(&args)).await.map(|()| 0),
    };
    match verb {
        Verb::Click => Box::pin(click(false)).await?,
        Verb::Start { open: false } => print!("{}", Box::pin(background::start()).await?),
        Verb::Start { open: true } | Verb::Open => Box::pin(start_and_open()).await?,
        Verb::Stop => print!("{}", Box::pin(background::stop()).await?),
        Verb::Restart { open } => {
            print!("{}", Box::pin(background::stop()).await?);
            if open {
                Box::pin(start_and_open()).await?;
            } else {
                print!("{}", Box::pin(background::start()).await?);
            }
        }
        Verb::Status { json } => {
            let status = Box::pin(cli::status(&background::APP, tasks_hub::VERSION)).await;
            if json {
                println!("{}", status.json());
            } else {
                print!("{}", status.text());
            }
            return Ok(status.exit_code());
        }
        Verb::Link => println!("{}", Box::pin(app::open()).await?),
        Verb::Logs { lines, follow } => {
            Box::pin(cli::logs(&background::APP, lines, follow)).await?
        }
        Verb::Paths => print!("{}", cli::paths(&background::APP)),
        Verb::Completions(shell) => print!(
            "{}",
            cli::completions_script(shell, &[COMMAND, "tasks-hub"], &own_words())
        ),
        Verb::Version => println!("{}", tasks_hub::version_line()),
        Verb::Help(None) => println!("{}", usage()),
        Verb::Help(Some(command)) => match help_of(&command) {
            Some(text) => println!("{text}"),
            None => {
                return Err(Failed::usage(format!(
                    "no command {command:?}\n\n{}",
                    usage()
                )));
            }
        },
    }
    Ok(0)
}

/// The commands of tasks-desktop itself.
async fn run_own(args: &[String]) -> Result<(), Failed> {
    match args.first().map(String::as_str) {
        Some("setup") if args.len() == 1 => Box::pin(click(true)).await?,
        Some("serve") => {
            let port = parse_port(&args[1..]).map_err(Failed::usage)?;
            Box::pin(app::serve(ServeOptions { port })).await?;
        }
        Some("install") => {
            let mut opts = InstallOptions::default();
            let mut open = false;
            for arg in &args[1..] {
                match arg.as_str() {
                    "--autostart" => opts.autostart = true,
                    "--shortcut" => opts.shortcut = true,
                    "--open" => open = true,
                    _ => return Err(Failed::usage(usage())),
                }
            }
            print!("{}", Box::pin(background::install(opts)).await?);
            // The installation of the page: the hub that was stopped for the copy took the sessions of the page with
            // it, so the page of the hub that runs now opens with a pairing link of its own.
            if open {
                let env = tasks_hub::config::Env::from_process();
                let started = background::start_from(&background::installed_program(&env)?)?;
                print!("{started}");
                open_page(started, print_only()).await?;
            }
        }
        Some("uninstall")
            if args.len() == 1 || (args.len() == 2 && args[1] == "--purge-settings") =>
        {
            let opts = UninstallOptions {
                purge_settings: args.len() == 2,
            };
            print!("{}", background::uninstall(opts).await?);
        }
        Some("autostart") if args.len() == 2 => {
            let what = match args[1].as_str() {
                "on" => Autostart::On,
                "off" => Autostart::Off,
                "status" => Autostart::Status,
                _ => return Err(Failed::usage(usage())),
            };
            print!("{}", background::autostart(what)?);
        }
        Some("open") if args.len() == 2 && args[1] == "--phone" => open_phone(true).await?,
        Some("open")
            if args.len() == 3
                && args[1..].iter().any(|a| a == "--phone")
                && args[1..].iter().any(|a| a == "--no-window") =>
        {
            open_phone(false).await?;
        }
        Some("devices") if args.len() == 1 => {
            println!(
                "{}",
                Box::pin(app::devices(app::DevicesCommand::List)).await?
            );
        }
        Some("devices") if args.len() == 4 && args[1] == "level" => {
            let level = app::DevicesCommand::Level(args[2].clone(), args[3].clone());
            println!("{}", Box::pin(app::devices(level)).await?);
        }
        Some("devices") if args.len() == 3 && args[1] == "revoke" => {
            let revoke = app::DevicesCommand::Revoke(args[2].clone());
            println!("{}", Box::pin(app::devices(revoke)).await?);
        }
        Some("usage") => {
            let days = parse_days(&args[1..]).map_err(Failed::usage)?;
            print!("{}", app::usage(days)?);
        }
        Some("phone") if args.len() == 3 && args[1] == "export" => phone_export(&args[2]).await?,
        Some("testing") if args.len() == 3 && args[1] == "link" => testing_link(&args[2]).await?,
        Some("testing") if args.len() == 2 && args[1] == "unlink" => {
            println!("{}", app::testing_unlink()?);
        }
        Some("areas") => {
            let command = parse_areas(&args[1..]).map_err(Failed::usage)?;
            print!("{}", Box::pin(app::areas(command)).await?);
        }
        _ => return Err(Failed::usage(usage())),
    }
    Ok(())
}

fn main() {
    // First, before the runtime: on Linux and macOS this program is also the watcher of the process group of each
    // child it starts (started with `--appkit-child-watcher`, it only waits and never returns here); docs/PROCESSES.md
    // of appkit.
    appkit_core::child::watcher_main();
    hub_main();
}

#[tokio::main]
async fn hub_main() {
    // Before the first line is written.
    let console = console::attach_parent();
    console::report_panics("tasks-hub");
    let args: Vec<String> = std::env::args().skip(1).collect();
    let by_click = args.is_empty();
    match Box::pin(run(args)).await {
        Ok(0) => {}
        // `status` of a hub that does not run: said on stdout already, only the exit code is left.
        Ok(code) => std::process::exit(code),
        Err(failed) => {
            // stderr, or a message box when nobody reads it (the link of a window program).
            console::report("tasks-hub", &failed.message);
            // In the console of a terminal the shell reads the same keys: only a console of its own waits.
            if by_click && console == Console::Own {
                wait_for_enter();
            }
            std::process::exit(failed.code);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{link_of_this_pc, open_or_stop};
    use std::cell::Cell;

    const STARTED: &str = "the hub runs in the background (port 1, process 2)\n";
    const FOUND: &str = "a hub is already running (port 1, process 2)\n";

    async fn run(
        started: &str,
        page: Result<(), String>,
        stop: Result<String, String>,
    ) -> (Result<(), String>, bool) {
        let stopped = Cell::new(false);
        let said = open_or_stop(started, async { page }, || {
            stopped.set(true);
            async { stop }
        })
        .await;
        (said, stopped.get())
    }

    #[tokio::test]
    async fn a_hub_started_for_a_page_that_does_not_open_is_stopped_again() {
        let (said, stopped) = run(STARTED, Err("no browser".to_owned()), Ok(String::new())).await;
        assert!(stopped);
        let why = said.unwrap_err();
        assert!(
            why.starts_with("no browser; ") && why.ends_with("is stopped again"),
            "{why}"
        );

        let (said, stopped) = run(
            STARTED,
            Err("no browser".to_owned()),
            Err("denied".to_owned()),
        )
        .await;
        assert!(stopped);
        assert!(said.unwrap_err().ends_with("still runs: denied"));
    }

    /// With `TASKS_DESKTOP_TAILNET` set `open` prints two lines; the browser gets the first, and `launch` takes it.
    #[test]
    fn the_browser_opens_the_link_of_this_pc_and_not_the_one_for_the_phone() {
        let code = "0123456789abcdef0123456789abcdef";
        let local = format!("http://127.0.0.1:17615/#pair={code}");
        let both =
            format!("{local}\nphone through Tailscale: https://pc.tail1234.ts.net/m/#pair={code}");
        assert_eq!(link_of_this_pc(&both), local);
        assert_eq!(link_of_this_pc(&local), local);
        assert!(tasks_hub::app::is_own_link(link_of_this_pc(&both)));
        assert!(
            !tasks_hub::app::is_own_link(&both),
            "the whole text was what stopped the hub"
        );
    }

    #[tokio::test]
    async fn a_hub_that_ran_already_or_a_page_that_opened_stops_nothing() {
        let (said, stopped) = run(FOUND, Err("no browser".to_owned()), Ok(String::new())).await;
        assert_eq!(said, Err("no browser".to_owned()));
        assert!(!stopped, "the hub was not started by this call");

        let (said, stopped) = run(STARTED, Ok(()), Ok(String::new())).await;
        assert_eq!(said, Ok(()));
        assert!(!stopped);
    }
}
