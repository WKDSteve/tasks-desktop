//! The first start in the page: the hub's side of the steps the page shows while the hub is not set up (the vault,
//! Neovim) and of the installation it offers.
//!
//! The page names no path. The folder and the program are chosen in the dialog of the system that the hub shows, and
//! the hub checks the choice before it keeps it (`appkit_hub::setup`). The routes are in `server::setup`.

use std::path::PathBuf;
use std::sync::Arc;

use appkit_hub::setup::InstallOffer;
use appkit_hub::vaults::BoxFuture;

use crate::config::Env;
use crate::server::VaultTarget;

/// What the page of the first start asks of the hub. An error is a short text for the page: no path.
pub trait FirstStart: Send + Sync {
    /// What the page offers about the installation now.
    fn install_offer(&self) -> Result<InstallOffer, String>;

    /// Whether the hub can show a dialog to choose the program of Neovim (Windows); elsewhere the page says where
    /// Neovim was looked for.
    fn can_pick_program(&self) -> bool;

    /// Show the file dialog for the program of Neovim and wait for the person; `None`: closed. Blocks.
    fn pick_program(&self) -> Result<Option<PathBuf>, String>;

    /// Probe the chosen Neovim, keep it and set up the engine again: what the hub reads from now on.
    fn set_nvim(&self, nvim: PathBuf) -> BoxFuture<'_, Result<VaultTarget, String>>;

    /// Keep the chosen folder as the vault (the folder was checked) and set up the engine for it.
    fn set_vault(&self, folder: PathBuf) -> BoxFuture<'_, Result<VaultTarget, String>>;

    /// Start the installation (`tasks-hub install`): it stops this hub and starts it again from the installed copy.
    fn install(&self, autostart: bool, shortcut: bool) -> Result<(), String>;

    /// The person does not want the installation: it is not offered again.
    fn decline_install(&self) -> Result<(), String>;
}

/// The first start of the real hub: its settings, its opener and its environment.
pub struct HubFirstStart {
    pub(crate) vaults: Arc<crate::app::ConfigVaults>,
    pub(crate) opener: Arc<crate::editor::HubOpener>,
    pub(crate) env: Env,
}

impl HubFirstStart {
    /// The Neovim of the engine is also the one files are opened in (the one of the bundle has no runtime to edit
    /// with: another is looked for).
    fn adopt_nvim(&self, nvim: Option<PathBuf>) {
        if let Some(editor) = nvim.and_then(|n| crate::bundle::editor_nvim(n, &self.env)) {
            self.opener.set_nvim(editor);
        }
    }
}

impl FirstStart for HubFirstStart {
    fn install_offer(&self) -> Result<InstallOffer, String> {
        appkit_hub::setup::install_offer(&crate::setup::APP, &self.env)
    }

    fn can_pick_program(&self) -> bool {
        cfg!(windows) || self.env.get(&crate::IDENTITY.var("EDITOR_LOG")).is_some()
    }

    fn pick_program(&self) -> Result<Option<PathBuf>, String> {
        appkit_hub::editor::pick_program(&self.env, &crate::IDENTITY)
    }

    fn set_nvim(&self, nvim: PathBuf) -> BoxFuture<'_, Result<VaultTarget, String>> {
        Box::pin(async move {
            appkit_hub::setup::checked_nvim(&nvim, &self.env).await?;
            let (target, found) = self.vaults.set_first_nvim(nvim).await?;
            self.adopt_nvim(found);
            Ok(target)
        })
    }

    fn set_vault(&self, folder: PathBuf) -> BoxFuture<'_, Result<VaultTarget, String>> {
        Box::pin(async move {
            let (target, found) = self.vaults.set_first_vault(folder).await?;
            // Asked once in the page: the console does not ask for it again.
            if let Err(why) = appkit_hub::setup::note_vault_chosen(&crate::setup::APP, &self.env) {
                eprintln!("note: {why}");
            }
            self.adopt_nvim(found);
            Ok(target)
        })
    }

    fn install(&self, autostart: bool, shortcut: bool) -> Result<(), String> {
        appkit_hub::setup::start_install(&crate::setup::APP, &self.env, autostart, shortcut)
    }

    fn decline_install(&self) -> Result<(), String> {
        appkit_hub::setup::decline_install(&crate::setup::APP, &self.env)
    }
}
