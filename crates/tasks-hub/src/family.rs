//! The other apps of the family this hub tells its page about: for now only ai-desktop, whose presence decides whether
//! the page offers its AI functions at all (the switch "Show AI functions" of the Options menu).
//!
//! The answer is cheap and local: no request to another hub, no secret. Until the discovery of appkit
//! (`family_apps()`) is wired here, the hub says "not found" ([`NotWired`]), and the page offers nothing.

use serde::Serialize;

/// Whether an app of the family is on this machine, and whether its hub is running now.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct Presence {
    /// Installed on this machine (it may not be running).
    pub installed: bool,
    /// Its hub runs now.
    pub running: bool,
}

/// Where the hub learns which apps of the family are there.
pub trait FamilyApps: Send + Sync {
    /// ai-desktop on this machine: read anew on each call (the page asks when its window gets the focus).
    fn ai_desktop(&self) -> Presence;
}

/// The answer until the discovery of appkit is wired: no app of the family is found.
#[derive(Debug, Default)]
pub struct NotWired;

impl FamilyApps for NotWired {
    fn ai_desktop(&self) -> Presence {
        Presence::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn not_wired_finds_nothing() {
        assert_eq!(
            NotWired.ai_desktop(),
            Presence {
                installed: false,
                running: false
            }
        );
    }

    #[test]
    fn presence_is_sent_with_both_fields() {
        let text = serde_json::to_string(&Presence {
            installed: true,
            running: false,
        })
        .unwrap();
        assert_eq!(text, r#"{"installed":true,"running":false}"#);
    }
}
