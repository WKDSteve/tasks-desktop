//! The order to stay, as the settings of the page see it: `keep_running` in `config.json`. Without it a hub in the
//! background ends itself a while after the last page closed (`background::left_alone`); with it, it stays. The hub
//! reads the key when that wait is over, not at the start, so the switch acts without a restart.

use std::path::PathBuf;

use crate::config;

/// The order to stay of this hub. The program has [`SettingsFile`]; a test may have one that holds a value.
pub trait KeepRunning: Send + Sync {
    /// Whether the order stands.
    ///
    /// # Errors
    ///
    /// The settings cannot be read.
    fn is_on(&self) -> Result<bool, String>;

    /// Give the order, or take it back.
    ///
    /// # Errors
    ///
    /// The settings cannot be read or written; then nothing was changed.
    fn set(&self, on: bool) -> Result<(), String>;
}

/// The order as the key `keep_running` of `config.json` in a folder of settings.
pub struct SettingsFile {
    dir: PathBuf,
}

impl SettingsFile {
    #[must_use]
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }
}

impl KeepRunning for SettingsFile {
    fn is_on(&self) -> Result<bool, String> {
        config::load_file(&self.dir)
            .map(|file| file.keep_running.unwrap_or(false))
            .map_err(|_| "the settings file cannot be read".to_owned())
    }

    fn set(&self, on: bool) -> Result<(), String> {
        // Read again right before the change: what a person wrote into the file meanwhile stays, and a file that cannot
        // be read stops the change rather than being written over.
        let mut file = config::load_file(&self.dir)
            .map_err(|_| "the settings file cannot be read".to_owned())?;
        // Off is no key at all: the file says only what the person asked for.
        file.keep_running = on.then_some(true);
        config::save_file(&self.dir, &file)
    }
}

#[cfg(test)]
mod tests {
    use super::{KeepRunning, SettingsFile};
    use hub_testkit::scratch::Scratch;

    #[test]
    fn the_order_is_the_key_of_the_settings_and_the_rest_of_the_file_stays() {
        let dir = Scratch::new("keep-running");
        let order = SettingsFile::new(dir.to_path_buf());
        // No file: no order.
        assert_eq!(order.is_on(), Ok(false));
        std::fs::write(dir.join("config.json"), r#"{"vault":"C:/v","port":17615}"#).unwrap();
        assert_eq!(order.is_on(), Ok(false));
        order.set(true).unwrap();
        assert_eq!(order.is_on(), Ok(true));
        let text = std::fs::read_to_string(dir.join("config.json")).unwrap();
        let doc: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(doc["keep_running"], true, "{text}");
        assert_eq!(doc["vault"], "C:/v", "{text}");
        assert_eq!(doc["port"], 17615, "{text}");
        order.set(false).unwrap();
        assert_eq!(order.is_on(), Ok(false));
        let text = std::fs::read_to_string(dir.join("config.json")).unwrap();
        assert!(!text.contains("keep_running"), "{text}");
        assert!(text.contains("17615"), "{text}");
    }

    #[test]
    fn settings_that_cannot_be_read_are_not_written_over() {
        let dir = Scratch::new("keep-running-bad");
        let order = SettingsFile::new(dir.to_path_buf());
        std::fs::write(dir.join("config.json"), "{ not json").unwrap();
        assert!(order.is_on().is_err());
        assert!(order.set(true).is_err());
        assert_eq!(
            std::fs::read_to_string(dir.join("config.json")).unwrap(),
            "{ not json"
        );
    }
}
