//! The other apps of the family this hub tells its page about: for now only ai-desktop, whose presence decides whether
//! the page offers its AI functions at all (the switch "Show AI functions" of the Options menu).
//!
//! The answer is cheap and local: no request to another hub, no secret. [`Discovered`] asks the discovery of appkit
//! (`appkit_core::family`: the manifest its installer writes, the `hub.json` of a running ai-desktop, see `FAMILY.md` of
//! appkit); [`NotWired`] finds nothing (a hub of the tests).

use appkit_core::family::{self, Member};
use serde::Serialize;

use crate::config::Env;

/// ai-desktop as the family knows it: its name and the prefix of its variables (`AI_DESKTOP_CONFIG_DIR`).
const AI_DESKTOP: Member<'static> = Member {
    app: "ai-desktop",
    env_prefix: "AI_DESKTOP",
};

/// docmap-desktop: the program an "Open in DocMap" starts, found by its manifest (`DOCMAP_DESKTOP_CONFIG_DIR` moves its
/// config folder, and with it `hub.json`).
const DOCMAP_DESKTOP: Member<'static> = Member {
    app: "docmap-desktop",
    env_prefix: "DOCMAP_DESKTOP",
};

/// A file the tests give the hub (`TASKS_DESKTOP_DOCMAP_LOG`): the hub then writes the arguments it would start
/// docmap-desktop with, one line each, instead of starting anything.
pub const DOCMAP_LOG_VAR: &str = "TASKS_DESKTOP_DOCMAP_LOG";

/// Whether an app of the family is on this machine, and whether its hub is running now.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct Presence {
    /// Installed on this machine (it may not be running).
    pub installed: bool,
    /// Its hub runs now.
    pub running: bool,
    /// The loopback port while it runs (its `hub.json` says it to any program): the page opens the dashboard of a job of
    /// ai-desktop there (`/#job=<id>`). No path, no secret.
    pub port: Option<u16>,
}

/// Where the hub learns which apps of the family are there.
pub trait FamilyApps: Send + Sync {
    /// ai-desktop on this machine: read anew on each call (the page asks when its window gets the focus).
    fn ai_desktop(&self) -> Presence;

    /// docmap-desktop on this machine (`installed`: its program is there and can be started).
    fn docmap_desktop(&self) -> Presence {
        Presence::default()
    }

    /// Start docmap-desktop at a place: `docmap-desktop --open-at <folder> <at>`, the folder of a repo the person
    /// added as a tile and `at` as [`crate::docmap::CodeRef::at`] spells it. Each is one argument; nothing goes
    /// through a shell.
    ///
    /// # Errors
    ///
    /// A short reason, no path.
    fn open_docmap(&self, _folder: &std::path::Path, _at: &str) -> Result<(), String> {
        Err("docmap-desktop is not found".to_owned())
    }
}

/// The apps of the family as the discovery of appkit finds them in the environment `env` (a few file reads per call).
pub struct Discovered {
    env: Env,
}

impl Discovered {
    #[must_use]
    pub fn new(env: Env) -> Self {
        Self { env }
    }
}

impl FamilyApps for Discovered {
    fn ai_desktop(&self) -> Presence {
        let vars = |name: &str| self.env.path(name);
        // Named here as well, so a build that runs from its checkout (a hub.json, no manifest) counts as running.
        let app = family::family_app(&vars, AI_DESKTOP);
        Presence {
            installed: app.installed,
            running: app.running,
            port: app.running.then_some(app.port).flatten(),
        }
    }

    fn docmap_desktop(&self) -> Presence {
        let app = self.docmap_app();
        Presence {
            // A hub of the tests that logs its starts counts as having a program.
            installed: app.program.is_some() || self.env.path(DOCMAP_LOG_VAR).is_some(),
            running: app.running,
            port: None,
        }
    }

    fn open_docmap(&self, folder: &std::path::Path, at: &str) -> Result<(), String> {
        if let Some(log) = self.env.path(DOCMAP_LOG_VAR) {
            use std::io::Write as _;
            let mut file = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(log)
                .map_err(|e| e.to_string())?;
            return writeln!(file, "--open-at\t{}\t{at}", folder.display())
                .map_err(|e| e.to_string());
        }
        let program = self
            .docmap_app()
            .program
            .ok_or_else(|| "docmap-desktop is not installed".to_owned())?;
        let folder_text = folder.to_string_lossy();
        appkit_core::launch::spawn(
            &program,
            &["--open-at", &folder_text, at],
            &appkit_core::launch::LaunchOpts {
                cwd: folder,
                window: appkit_core::launch::Window::Default,
            },
        )
        .map(|_| ())
    }
}

impl Discovered {
    fn docmap_app(&self) -> family::FamilyApp {
        let vars = |name: &str| self.env.path(name);
        family::family_app(&vars, DOCMAP_DESKTOP)
    }
}

/// No app of the family is found (a hub without the discovery, the tests).
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
    use appkit_core::family::{write_manifest, Manifest, FAMILY_DIR_VAR, MANIFEST_SCHEMA};
    use appkit_core::registry::{write_record, HubRecord};
    use hub_testkit::scratch::Scratch;

    fn env_of(root: &std::path::Path) -> Env {
        Env::from_pairs([
            (FAMILY_DIR_VAR, root.join("family")),
            ("AI_DESKTOP_CONFIG_DIR", root.join("ai")),
        ])
    }

    #[test]
    fn discovered_finds_nothing_on_an_empty_machine() {
        let root = Scratch::new("family-empty");
        assert_eq!(
            Discovered::new(env_of(&root)).ai_desktop(),
            Presence::default()
        );
    }

    #[test]
    fn discovered_reads_the_manifest_and_the_hub_json_of_ai_desktop() {
        let root = Scratch::new("family-ai");
        let program = root.join("ai-desktop.exe");
        std::fs::write(&program, b"x").unwrap();
        write_manifest(
            &root.join("family"),
            &Manifest {
                schema: MANIFEST_SCHEMA.to_owned(),
                app: "ai-desktop".to_owned(),
                version: None,
                program: program.clone(),
                env_prefix: "AI_DESKTOP".to_owned(),
            },
        )
        .unwrap();
        let found = Discovered::new(env_of(&root));
        assert_eq!(
            found.ai_desktop(),
            Presence {
                installed: true,
                running: false,
                port: None
            }
        );
        // Running: a hub.json whose process is alive (this test stands in for it).
        write_record(
            &root.join("ai"),
            &HubRecord {
                app: "ai-desktop".to_owned(),
                port: 8080,
                pid: std::process::id(),
                version: "0.1.0".to_owned(),
                instance: "ab".repeat(16),
            },
        )
        .unwrap();
        assert_eq!(
            found.ai_desktop(),
            Presence {
                installed: true,
                running: true,
                port: Some(8080)
            }
        );
        // A program that is gone leaves a leftover manifest: not installed, but still running.
        std::fs::remove_file(&program).unwrap();
        assert_eq!(
            found.ai_desktop(),
            Presence {
                installed: false,
                running: true,
                port: Some(8080)
            }
        );
    }

    #[test]
    fn not_wired_finds_nothing() {
        assert_eq!(NotWired.ai_desktop(), Presence::default());
    }

    #[test]
    fn presence_is_sent_with_both_fields() {
        let text = serde_json::to_string(&Presence {
            installed: true,
            running: true,
            port: Some(8080),
        })
        .unwrap();
        assert_eq!(text, r#"{"installed":true,"running":true,"port":8080}"#);
        let text = serde_json::to_string(&Presence::default()).unwrap();
        assert_eq!(text, r#"{"installed":false,"running":false,"port":null}"#);
    }
}
