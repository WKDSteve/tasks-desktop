//! The hub as a background program (`start`, `stop`, `autostart`, `install`, `uninstall`): the
//! work is the kit's, this module states what is the tasks hub's own and keeps the names the
//! other modules and the tests use.

use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;

use appkit_hub::background::Background;
pub use appkit_hub::background::{
    run_command, start_from, Autostart, InstallOptions, UninstallOptions,
};

use crate::config::Env;

/// The files of the tasks hub in the config folder besides those every hub has.
const EXTRA_FILES: [&str; 3] = ["setup.json", "areas.json", "areas.proposed.json"];

/// What the background commands know about this app.
pub(crate) const APP: Background<'static> = Background {
    login: crate::LOGIN,
    extra_files: &EXTRA_FILES,
    uninstall_script: "scripts/uninstall",
};

/// Start a hub in the background unless one runs. Returns what to print.
///
/// # Errors
///
/// A text for the person at the terminal.
pub async fn start() -> Result<String, String> {
    appkit_hub::background::start(&APP).await
}

/// Stop the hub that runs (the one `hub.json` names and that answers as it).
///
/// # Errors
///
/// A text for the person at the terminal.
pub async fn stop() -> Result<String, String> {
    appkit_hub::background::stop(&APP).await
}

/// Start the hub with the login of the user.
///
/// # Errors
///
/// A text for the person at the terminal.
pub fn autostart(what: Autostart) -> Result<String, String> {
    appkit_hub::background::autostart(&APP, what)
}

/// [`autostart`] for the program at `exe` (what `install` registers).
///
/// # Errors
///
/// A text for the person at the terminal.
pub fn autostart_for(what: Autostart, exe: &Path) -> Result<String, String> {
    appkit_hub::background::autostart_for(&APP, what, exe)
}

/// Where `install` puts this program.
///
/// # Errors
///
/// The reason there is no install folder.
pub fn installed_program(env: &Env) -> Result<PathBuf, String> {
    appkit_hub::background::installed_program(&APP, env)
}

/// The file name the program has once installed.
#[must_use]
pub fn program_file() -> String {
    crate::IDENTITY.program_file()
}

/// Copy this program to a fixed place and start the hub from there again when one was running.
///
/// # Errors
///
/// A text for the person at the terminal.
pub async fn install(opts: InstallOptions) -> Result<String, String> {
    appkit_hub::background::install(&APP, opts).await
}

/// Take the integration of the program with the system away.
pub fn uninstall(
    opts: UninstallOptions,
) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send>> {
    Box::pin(async move {
        let said = appkit_hub::background::uninstall(&APP, opts).await;
        if said.is_ok() {
            let env = crate::config::Env::from_process();
            if let Ok(dir) = appkit_hub::instance::config_folder(&env, &crate::IDENTITY) {
                remove_unpacked(&dir);
            }
        }
        said
    })
}

/// What the program put below its folder and can make again: the engine it unpacked, and files on their way to the
/// engine. These are no settings of the person's, so they go with the program.
fn remove_unpacked(dir: &std::path::Path) {
    for name in ["engine", "uploads"] {
        let _ = std::fs::remove_dir_all(dir.join(name));
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_engine_it_unpacked_goes_with_the_program_and_nothing_else_does() {
        let dir = std::env::temp_dir().join(format!("tasks-unpacked-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("engine").join("abc")).unwrap();
        std::fs::create_dir_all(dir.join("uploads")).unwrap();
        std::fs::write(dir.join("config.json"), "{}").unwrap();
        super::remove_unpacked(&dir);
        assert!(!dir.join("engine").exists());
        assert!(!dir.join("uploads").exists());
        assert!(dir.join("config.json").is_file());
        let _ = std::fs::remove_dir_all(&dir);
    }

    use super::*;

    /// `uninstall --purge-settings` removes these files and nothing else: a file of the app that
    /// is not named here would stay behind, one that is named here and is not the app's is lost.
    #[test]
    fn the_files_of_the_tasks_hub_besides_the_kits_are_named() {
        assert_eq!(
            APP.extra_files,
            ["setup.json", "areas.json", "areas.proposed.json"]
        );
        assert_eq!(APP.login.summary, "the task overview");
        assert_eq!(APP.uninstall_script, "scripts/uninstall");
        assert!(program_file().starts_with("tasks-hub"));
    }

    /// The desktop link keeps what the link of the script host was: the name `Tasks.lnk`,
    /// `start --open`, minimized, the description of the app.
    #[test]
    fn the_desktop_link_is_the_one_it_always_was() {
        assert_eq!(
            appkit_hub::background::desktop_link_name(crate::IDENTITY.title),
            "Tasks.lnk"
        );
        let link = appkit_hub::background::app_link(
            crate::IDENTITY.app,
            std::path::Path::new(r"C:\x\tasks-hub.exe"),
            appkit_hub::background::LinkStart::OpenPage,
        );
        assert_eq!(link.target, r"C:\x\tasks-hub.exe");
        assert_eq!(link.arguments, "start --open");
        assert_eq!(link.working_dir, r"C:\x");
        assert_eq!(link.show_command, 7);
        assert_eq!(
            link.description,
            "tasks-desktop: start the hub and open the page"
        );
    }
}
