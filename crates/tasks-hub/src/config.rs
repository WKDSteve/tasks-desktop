//! The settings of the hub: the keys every app has come from `appkit-hub`, the two keys of the tasks
//! engine are [`TasksSettings`].

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub use appkit_hub::config::{
    valid_vault_name, AppSettings, ConfigError, Resolved, Source, VaultEntry, MAIN_VAULT,
    MAX_VAULTS,
};
pub use appkit_hub::env::Env;

/// The keys of `config.json` that only the tasks engine has.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TasksSettings {
    /// A checkout of lib.nvim.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lib_dir: Option<PathBuf>,
    /// Folders that are areas although they have no `ROADMAP/` or `Backlog/`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_areas: Vec<String>,
    /// The folders `attach` takes the newest screenshot from (`from: latest`); none: only the clipboard is read. The
    /// engine of the hub runs without the person's configuration, so it gets these instead of the folders of the
    /// system.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attach_dirs: Vec<PathBuf>,
    /// The Web Push reminders of a day for the paired phones.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reminders: Option<RemindersSettings>,
}

/// `reminders` of `config.json`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RemindersSettings {
    /// The time of day (`HH:MM`, the engine's, which is the person's) the one notice of the day's reminders goes out
    /// from; unset: `08:00`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub send_at: Option<String>,
}

impl TasksSettings {
    /// The time of day the reminders of a day go out from.
    #[must_use]
    pub fn send_at(&self) -> &str {
        self.reminders
            .as_ref()
            .and_then(|r| r.send_at.as_deref())
            .unwrap_or(crate::notices::DEFAULT_SEND_AT)
    }
}

/// The most folders `attach_dirs` may name (the engine's limit too).
pub const MAX_ATTACH_DIRS: usize = 8;

impl AppSettings for TasksSettings {
    /// An area name is one plain folder name, nothing that could climb out of the vault or break
    /// the comma separated list the engine splits itself.
    fn validate(&self) -> Result<(), String> {
        for name in &self.extra_areas {
            valid_area_name(name).map_err(|why| format!("extra_areas: {name:?} {why}"))?;
        }
        if self.attach_dirs.len() > MAX_ATTACH_DIRS {
            return Err(format!("attach_dirs: at most {MAX_ATTACH_DIRS} folders"));
        }
        for dir in &self.attach_dirs {
            if !dir.is_absolute() {
                return Err(format!(
                    "attach_dirs: {} is not an absolute path",
                    dir.display()
                ));
            }
        }
        if let Some(at) = self.reminders.as_ref().and_then(|r| r.send_at.as_deref())
            && !crate::notices::valid_time(at)
        {
            return Err(format!(
                "reminders.send_at: {at:.20?} is not a time of day HH:MM (00:00 to 23:59)"
            ));
        }
        Ok(())
    }
}

/// The settings file of the tasks hub.
pub type FileConfig = appkit_hub::config::FileConfig<TasksSettings>;

/// The variable that names this machine in the tailnet (`pc.example.ts.net`), for a phone through Tailscale Serve.
pub const TAILNET_VAR: &str = "TASKS_DESKTOP_TAILNET";

/// Is this a name the guard takes as the tailnet name (appkit `with_tailnet_name`, the same rule): a plain host name
/// (lower-case labels of letters, digits and `-`, none at an end of a label, at least two, the last not all digits; no
/// scheme), with an optional `:<port>` other than 443 when Tailscale Serve forwards another HTTPS port to this hub
/// (`tailscale serve --https=8443 ...`, so that a second hub of the PC has 443).
#[must_use]
pub fn valid_tailnet_name(name: &str) -> bool {
    appkit_core::authn::tailnet_name_ok(name)
}

/// The longest name of an area the hub accepts.
const MAX_AREA_NAME: usize = 128;

/// Is this one plain folder name, fit to be an area (or a repository)?
/// Nothing that could climb out of a folder, name a drive, hide itself or
/// break a comma separated list.
///
/// # Errors
///
/// What is wrong with the name.
pub fn valid_area_name(name: &str) -> Result<(), &'static str> {
    if name.is_empty() || name.chars().count() > MAX_AREA_NAME {
        return Err("must have 1 to 128 characters");
    }
    if name.starts_with('.') || name.ends_with([' ', '.']) {
        return Err("must not start with a dot or end with a dot or a space");
    }
    if name
        .chars()
        .any(|c| c.is_control() || "/\\,:*?\"<>|".contains(c))
    {
        return Err("holds a character that is not allowed in a folder name");
    }
    Ok(())
}

/// The config folder of this app on this device (see [`appkit_hub::config::config_dir`]).
#[must_use]
pub fn config_dir(env: &Env) -> Option<PathBuf> {
    appkit_hub::config::config_dir(env, &crate::IDENTITY)
}

/// Load `config.json` from `dir`. A missing file is an empty config.
///
/// # Errors
///
/// [`ConfigError`] when the file exists and cannot be read or is not valid.
pub fn load_file(dir: &Path) -> Result<FileConfig, ConfigError> {
    appkit_hub::config::load_file(dir)
}

/// Write `config.json` into `dir` in one step.
///
/// # Errors
///
/// The reason, as text.
pub fn save_file(dir: &Path, cfg: &FileConfig) -> Result<(), String> {
    appkit_hub::config::save_file(dir, cfg)
}

#[cfg(test)]
mod tests {
    use hub_testkit::scratch::Scratch;

    use super::*;

    #[test]
    fn env_override_wins_for_the_config_dir() {
        let env = Env::from_pairs([
            ("TASKS_DESKTOP_CONFIG_DIR", "C:/x/cfg"),
            ("APPDATA", "C:/a"),
        ]);
        assert_eq!(config_dir(&env), Some(PathBuf::from("C:/x/cfg")));
    }

    #[test]
    fn an_empty_variable_is_not_set() {
        let env = Env::from_pairs([("TASKS_VAULT", "")]);
        assert!(env.get("TASKS_VAULT").is_none());
    }

    #[test]
    fn a_tailnet_name_is_a_plain_host_name() {
        for good in [
            "pc.example.ts.net",
            "my-pc.tail1a2b.ts.net",
            "a.b",
            "pc.example.ts.net:8443",
        ] {
            assert!(valid_tailnet_name(good), "{good}");
        }
        for bad in [
            "",
            "pc",
            "PC.example.ts.net",
            "pc.example.ts.net:443",
            "pc.example.ts.net:0",
            "pc.example.ts.net:",
            "https://pc.example.ts.net",
            "pc..ts.net",
            "-pc.ts.net",
            "pc-.ts.net",
            "pc.ts.net.",
            "10.0.0.1",
            "pc_1.ts.net",
            "pc.ts.net/m",
        ] {
            assert!(!valid_tailnet_name(bad), "{bad}");
        }
    }

    #[test]
    fn unknown_keys_in_the_file_are_refused() {
        assert!(serde_json::from_str::<FileConfig>(r#"{"vault":"x","vualt":"y"}"#).is_err());
        assert!(serde_json::from_str::<FileConfig>(r#"{"extra_areas":[],"lib_dir":"x"}"#).is_ok());
    }

    /// The file on disk keeps its keys: the two of the tasks engine are read from, and written
    /// to, the same level as the others.
    #[test]
    fn the_keys_of_the_tasks_engine_stay_in_the_one_flat_file() {
        let text =
            r#"{"vault":"V","engine_dir":"E","lib_dir":"L","extra_areas":["ALL"],"port":20000}"#;
        let cfg: FileConfig = serde_json::from_str(text).unwrap();
        assert_eq!(cfg.app.lib_dir, Some(PathBuf::from("L")));
        assert_eq!(cfg.app.extra_areas, ["ALL"]);
        // The text, not the values: a file that is saved keeps the order it always had, so a
        // person who keeps it in git sees no move of `port`.
        assert_eq!(serde_json::to_string(&cfg).unwrap(), text);
    }

    #[test]
    fn a_missing_file_is_an_empty_config() {
        let parent = Scratch::new("no-such-config-dir");
        let dir = parent.join("absent");
        let cfg = load_file(&dir).expect("missing file is fine");
        assert!(cfg.vault.is_none() && cfg.app.extra_areas.is_empty());
    }

    fn areas(names: &[&str]) -> FileConfig {
        FileConfig {
            app: TasksSettings {
                extra_areas: names.iter().map(|s| (*s).to_owned()).collect(),
                ..TasksSettings::default()
            },
            ..FileConfig::default()
        }
    }

    #[test]
    fn plain_area_names_are_accepted() {
        assert!(
            areas(&["ALL", "nvim-config", "docmap-desktop", "migrate.nvim"])
                .validate()
                .is_ok()
        );
    }

    #[test]
    fn area_names_that_could_leave_the_vault_or_split_the_list_are_refused() {
        for bad in [
            "", "..", ".", "a/b", "a\\b", "a,b", "../x", ".hidden", "a:b", "a\nb", "trail.",
            "C:\\x",
        ] {
            assert!(areas(&[bad]).validate().is_err(), "{bad:?} was accepted");
        }
    }

    fn shots(dirs: &[PathBuf]) -> FileConfig {
        FileConfig {
            app: TasksSettings {
                attach_dirs: dirs.to_vec(),
                ..TasksSettings::default()
            },
            ..FileConfig::default()
        }
    }

    #[test]
    fn the_screenshot_folders_are_absolute_and_few() {
        let here = std::env::temp_dir();
        assert!(shots(&[]).validate().is_ok());
        assert!(shots(std::slice::from_ref(&here)).validate().is_ok());
        assert!(
            shots(&[PathBuf::from("Pictures")]).validate().is_err(),
            "a relative folder"
        );
        assert!(
            shots(&vec![here; MAX_ATTACH_DIRS + 1]).validate().is_err(),
            "more folders than the engine takes"
        );
    }

    #[test]
    fn the_hour_of_the_reminders_is_a_time_of_day_and_eight_without_one() {
        let at = |send_at: Option<&str>| FileConfig {
            app: TasksSettings {
                reminders: Some(RemindersSettings {
                    send_at: send_at.map(str::to_owned),
                }),
                ..TasksSettings::default()
            },
            ..FileConfig::default()
        };
        assert_eq!(TasksSettings::default().send_at(), "08:00");
        assert_eq!(at(None).app.send_at(), "08:00");
        assert_eq!(at(Some("06:45")).app.send_at(), "06:45");
        assert!(at(Some("06:45")).validate().is_ok());
        for bad in ["6:45", "25:00", "08:00:00", "morning"] {
            assert!(at(Some(bad)).validate().is_err(), "{bad}");
        }
        let dir = temp_config("send-at", br#"{"reminders":{"send_at":"19:15"}}"#);
        assert_eq!(load_file(&dir).unwrap().app.send_at(), "19:15");
        let dir = temp_config("send-at-bad", br#"{"reminders":{"send_at":"7"}}"#);
        assert!(matches!(load_file(&dir), Err(ConfigError::Invalid(..))));
    }

    /// A config folder holding `config.json` with `bytes`; it is removed when the value drops.
    fn temp_config(name: &str, bytes: &[u8]) -> Scratch {
        let dir = Scratch::new(name);
        std::fs::write(dir.join("config.json"), bytes).unwrap();
        dir
    }

    #[test]
    fn a_settings_file_with_a_bad_area_is_refused_on_load() {
        let dir = temp_config("bad-area", br#"{"extra_areas":["../outside"]}"#);
        assert!(matches!(load_file(&dir), Err(ConfigError::Invalid(..))));
    }
}
