//! Find Neovim, the engine checkout and the vault, and probe them: the search is the kit's, the
//! names it looks for (`TASKS_VAULT`, `TASKS_NVIM`, `TASKS_ENGINE_DIR`, the `tasks.nvim` checkout
//! and its `scripts/tasks.lua`) are stated here.

use std::path::{Path, PathBuf};

use appkit_hub::discovery::AppInputs;
pub use appkit_hub::discovery::{parse_nvim_version, DiscoverySpec, Setup, SetupProblem, MIN_NVIM};

use crate::bundle::Bundled;
use crate::config::{Env, FileConfig};

/// What the hub looks for.
pub const SPEC: DiscoverySpec = DiscoverySpec {
    vault_var: "TASKS_VAULT",
    nvim_var: "TASKS_NVIM",
    engine_dir_var: "TASKS_ENGINE_DIR",
    engine_name: "tasks.nvim",
    engine_script: &["scripts", "tasks.lua"],
};

/// The engine entry point inside a tasks.nvim checkout.
#[must_use]
pub fn engine_script(engine_dir: &Path) -> PathBuf {
    appkit_hub::discovery::engine_script(&SPEC, engine_dir)
}

/// Resolve everything the engine needs and probe Neovim.
///
/// # Errors
///
/// The first [`SetupProblem`] in the order settings, vault, Neovim, engine.
pub async fn discover(file: &FileConfig, env: &Env) -> Result<Setup, SetupProblem> {
    let file = with_bundled(file, env, crate::bundle::current(env));
    let inputs = AppInputs {
        lib_dir: file.app.lib_dir.as_deref(),
        extra_areas: &file.app.extra_areas,
    };
    appkit_hub::discovery::discover(&SPEC, &file, inputs, env).await
}

/// What was set by hand goes first; what was not comes from the engine this program carries, and only without one is the
/// machine searched. The kit searches `PATH` and `REPOS_DIR` after the settings, so that is where the bundle goes in.
fn with_bundled(file: &FileConfig, env: &Env, bundled: Option<&Bundled>) -> FileConfig {
    let mut out = file.clone();
    let Some(bundled) = bundled else {
        return out;
    };
    if out.nvim.is_none() && env.get(SPEC.nvim_var).is_none() {
        out.nvim = Some(bundled.nvim.clone());
    }
    // The lib goes with its engine: a checkout of the engine set by hand looks for the lib beside it, as it always did.
    if out.engine_dir.is_none() && env.get(SPEC.engine_dir_var).is_none() {
        out.engine_dir = Some(bundled.engine_dir.clone());
        let lib_set = env.get("LIB_NVIM_DIR").is_some() || env.get("LIB_NVIM_PATH").is_some();
        if out.app.lib_dir.is_none() && !lib_set {
            out.app.lib_dir = Some(bundled.lib_dir.clone());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_was_set_by_hand_goes_before_the_engine_of_the_program() {
        let bundled = Bundled {
            root: PathBuf::from("B"),
            nvim: PathBuf::from("B/nvim.exe"),
            engine_dir: PathBuf::from("B/tasks.nvim"),
            lib_dir: PathBuf::from("B/lib.nvim"),
        };
        let none = Env::from_pairs(Vec::<(&str, &str)>::new());
        let empty = FileConfig::default();

        // Nothing set: the bundle.
        let got = with_bundled(&empty, &none, Some(&bundled));
        assert_eq!(got.nvim, Some(bundled.nvim.clone()));
        assert_eq!(got.engine_dir, Some(bundled.engine_dir.clone()));
        assert_eq!(got.app.lib_dir, Some(bundled.lib_dir.clone()));

        // No bundle: nothing is filled in, the kit searches the machine.
        let got = with_bundled(&empty, &none, None);
        assert_eq!(
            (got.nvim, got.engine_dir, got.app.lib_dir),
            (None, None, None)
        );

        // The environment.
        let set = Env::from_pairs([
            ("TASKS_NVIM", "n"),
            ("TASKS_ENGINE_DIR", "e"),
            ("LIB_NVIM_DIR", "l"),
        ]);
        let got = with_bundled(&empty, &set, Some(&bundled));
        assert_eq!(
            (got.nvim, got.engine_dir, got.app.lib_dir),
            (None, None, None)
        );

        // An engine set by hand keeps the lib it finds itself.
        let set = Env::from_pairs([("TASKS_ENGINE_DIR", "e")]);
        let got = with_bundled(&empty, &set, Some(&bundled));
        assert_eq!(got.nvim, Some(bundled.nvim.clone()));
        assert_eq!((got.engine_dir, got.app.lib_dir), (None, None));

        // The settings.
        let file = FileConfig {
            nvim: Some(PathBuf::from("mine")),
            ..FileConfig::default()
        };
        let got = with_bundled(&file, &none, Some(&bundled));
        assert_eq!(got.nvim, Some(PathBuf::from("mine")));
        assert_eq!(got.engine_dir, Some(bundled.engine_dir.clone()));
    }

    /// These names are in the environments of people: a rename is a migration.
    #[test]
    fn the_names_that_are_searched_do_not_move() {
        assert_eq!(SPEC.vault_var, "TASKS_VAULT");
        assert_eq!(SPEC.nvim_var, "TASKS_NVIM");
        assert_eq!(SPEC.engine_dir_var, "TASKS_ENGINE_DIR");
        let script = engine_script(Path::new("E"));
        assert_eq!(
            script,
            Path::new("E").join("scripts").join("tasks.lua"),
            "{script:?}"
        );
    }

    #[test]
    fn the_engine_is_looked_for_under_its_own_name() {
        let problem = SetupProblem::EngineNotFound {
            name: SPEC.engine_name,
            tried: vec!["x".to_owned()],
        };
        assert_eq!(
            problem.to_string(),
            "the tasks.nvim checkout was not found (tried: x)"
        );
    }
}
