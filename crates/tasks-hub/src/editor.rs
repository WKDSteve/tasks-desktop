//! Opening a task file in Neovim, in a window of its own.
//!
//! The page asks by task id; the hub finds the file (the engine names it, the hub checks here that
//! it lies inside the vault) and the opener of appkit starts Neovim with that one file as an
//! argument, shows a folder or asks for one (`appkit_hub::editor`).
//!
//! `TASKS_DESKTOP_EDITOR_LOG` (a file) makes the hub write the file it would have opened to that
//! file instead of starting anything: the seam of the tests.

use std::path::{Path, PathBuf};

pub use appkit_hub::editor::{
    pick_plan, picked_folder, plan, reveal_plan, strip_verbatim, FileOpener, Launch, TerminalOpener,
};

/// The opener of this app: `nvim` in a window of its own, the seam named by [`crate::IDENTITY`].
#[must_use]
pub fn terminal_opener(nvim: PathBuf, env: crate::config::Env) -> TerminalOpener {
    TerminalOpener::new(nvim, env, &crate::IDENTITY)
}

/// The opener of the hub, there from the start whether Neovim was found or not: the folder dialog and the file
/// manager need no Neovim, and the page of the first start asks for the vault before Neovim is looked for. When the
/// first start finds or sets Neovim, [`HubOpener::set_nvim`] makes it the one files are opened in.
pub struct HubOpener {
    env: crate::config::Env,
    /// Shows folders and asks for one; its Neovim is never started.
    base: TerminalOpener,
    nvim: std::sync::RwLock<Option<PathBuf>>,
}

impl HubOpener {
    #[must_use]
    pub fn new(nvim: Option<PathBuf>, env: crate::config::Env) -> Self {
        Self {
            base: terminal_opener(PathBuf::new(), env.clone()),
            env,
            nvim: std::sync::RwLock::new(nvim),
        }
    }

    /// Open files in this Neovim from now on.
    pub fn set_nvim(&self, nvim: PathBuf) {
        *self
            .nvim
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(nvim);
    }

    fn nvim(&self) -> Option<PathBuf> {
        self.nvim
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }
}

impl FileOpener for HubOpener {
    fn open(&self, file: &Path, line: Option<u32>) -> Result<(), String> {
        let nvim = self
            .nvim()
            .ok_or_else(|| "Neovim is not set up yet".to_owned())?;
        terminal_opener(nvim, self.env.clone()).open(file, line)
    }

    fn reveal(&self, dir: &Path) -> Result<(), String> {
        self.base.reveal(dir)
    }

    fn pick_folder(&self) -> Result<Option<PathBuf>, String> {
        self.base.pick_folder()
    }
}

/// The file of a task as the engine named it (`lib.nvim/ROADMAP/tasks/x.md`),
/// as a path inside `vault`, or why it is not one. The name must be a plain
/// relative path, and what it leads to must be a file that lies in the vault
/// once links are resolved: a link planted in a vault does not lead out of it.
///
/// # Errors
///
/// A short reason, no path.
pub fn file_in_vault(vault: &Path, name: &str) -> Result<PathBuf, &'static str> {
    use std::path::Component;
    let relative = Path::new(name);
    if name.is_empty()
        || relative.is_absolute()
        || !relative
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
    {
        return Err("the engine named a file that is not a plain relative path");
    }
    let joined = vault.join(relative);
    let meta = std::fs::symlink_metadata(&joined).map_err(|_| "the file is not there")?;
    if meta.file_type().is_symlink() || !meta.is_file() {
        return Err("the task is not a plain file");
    }
    let real = joined.canonicalize().map_err(|_| "the file is not there")?;
    let root = vault.canonicalize().map_err(|_| "the vault is not there")?;
    if !real.starts_with(&root) {
        return Err("the file lies outside the vault");
    }
    Ok(strip_verbatim(real))
}

#[cfg(test)]
mod tests {
    use hub_testkit::scratch::Scratch;

    use super::*;

    /// Without Neovim the hub still shows the folder dialog (the first start asks for the vault first) and says why
    /// it opens no file; once Neovim is set, files open in it.
    #[test]
    fn the_hub_opener_asks_for_a_folder_without_neovim_and_opens_files_once_it_is_set() {
        let dir = Scratch::new("hub-opener");
        let log = dir.join("opened.log");
        let env = crate::config::Env::from_pairs([
            (
                "TASKS_DESKTOP_EDITOR_LOG",
                log.to_string_lossy().into_owned(),
            ),
            ("TASKS_DESKTOP_PICK_RESULT", "/chosen".to_owned()),
        ]);
        let opener = HubOpener::new(None, env);
        assert_eq!(
            opener.open(Path::new("/v/a.md"), None).unwrap_err(),
            "Neovim is not set up yet"
        );
        assert_eq!(
            opener.pick_folder().unwrap(),
            Some(PathBuf::from("/chosen"))
        );
        opener.set_nvim(PathBuf::from("/opt/nvim"));
        opener.open(Path::new("/v/a.md"), Some(3)).unwrap();
        let text = std::fs::read_to_string(&log).unwrap();
        assert_eq!(
            text.lines().collect::<Vec<_>>(),
            ["pick", "/v/a.md:3"],
            "{text}"
        );
    }

    #[test]
    fn a_file_name_that_climbs_or_names_a_drive_is_refused() {
        let dir = Scratch::new("editor");
        std::fs::create_dir_all(dir.join("a")).unwrap();
        std::fs::write(dir.join("a").join("x.md"), "x").unwrap();
        let ok = file_in_vault(&dir, "a/x.md").unwrap();
        // What Neovim gets is a plain path, not the verbatim form Windows' canonicalize gives.
        assert!(!ok.to_string_lossy().starts_with(r"\\?\"), "{ok:?}");
        for bad in [
            "",
            "../x.md",
            "a/../a/x.md",
            "/etc/passwd",
            "C:/x.md",
            "a/nope.md",
        ] {
            assert!(file_in_vault(&dir, bad).is_err(), "{bad:?} was accepted");
        }
        // A folder is not a task file.
        assert!(file_in_vault(&dir, "a").is_err());
    }

    #[test]
    fn the_test_seam_is_named_by_the_app() {
        let dir = Scratch::new("editor-log");
        let log = dir.join("opened.log");
        let env = crate::config::Env::from_pairs([(
            "TASKS_DESKTOP_EDITOR_LOG",
            log.to_string_lossy().into_owned(),
        )]);
        terminal_opener(PathBuf::from("nvim"), env)
            .open(Path::new("/v/a.md"), None)
            .unwrap();
        assert!(std::fs::read_to_string(&log).unwrap().contains("a.md"));
    }
}
