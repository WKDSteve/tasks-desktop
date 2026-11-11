//! The tasks hub as a subject of the matrix.

use std::sync::Arc;

use appkit_core::identity::AppIdentity;
use appkit_hub::{BoxFuture, RunningServer};
use tasks_hub::classes::AreaPolicy;
use tasks_hub::server::{start, ServerConfig};

use appkit_testkit::subject::{StartConfig, Subject};

/// `tasks-hub`, with no engine, no vault and no page.
pub struct Tasks;

/// `tasks-hub` with a desktop page and the phone page under `/m/` (as a build with `ui/dist-mobile` has), and paired
/// devices kept in a scratch folder of its own (removed when the value is dropped).
pub struct TasksWithPhonePage {
    dir: crate::scratch::Scratch,
}

impl TasksWithPhonePage {
    #[must_use]
    pub fn new() -> Self {
        Self {
            dir: crate::scratch::Scratch::new("phone-devices"),
        }
    }
}

impl Default for TasksWithPhonePage {
    fn default() -> Self {
        Self::new()
    }
}

/// The prefix and the Trusted Types policy of the phone page.
pub const PHONE_PREFIX: &str = "/m";
pub const PHONE_WORKER_POLICY: &str = "tasks-mobile-worker";

fn start_with(
    cfg: StartConfig,
    ui: tasks_hub::ui::UiFiles,
    devices: Option<std::path::PathBuf>,
) -> BoxFuture<'static, std::io::Result<RunningServer>> {
    Box::pin(async move {
        start(ServerConfig {
            addr: cfg.addr,
            limits: cfg.limits,
            clock: cfg.clock,
            pairing_ttl: cfg.pairing_ttl,
            control_secret: cfg.control_secret,
            instance: cfg.instance,
            engine: None,
            policy: Arc::new(AreaPolicy::default()),
            usage: None,
            ui,
            devices,
            watch: None,
            status: cfg.status,
        })
        .await
    })
}

const DATA_ROUTES: [&str; 16] = [
    "snapshot",
    "task",
    "next",
    "areas",
    "about",
    "links",
    "enums",
    "groupings",
    "views",
    "finished",
    "waits",
    "plan_compare",
    "events",
    "ops",
    "repos",
    "repos/image",
];

impl Subject for TasksWithPhonePage {
    fn identity(&self) -> &'static AppIdentity {
        &tasks_hub::IDENTITY
    }

    fn start(&self, cfg: StartConfig) -> BoxFuture<'_, std::io::Result<RunningServer>> {
        start_with(
            cfg,
            tasks_hub::ui::UiFiles::from_static(&[
                ("index.html", "text/html; charset=utf-8", b"<!doctype html>"),
                (
                    "m/index.html",
                    "text/html; charset=utf-8",
                    b"<!doctype html>",
                ),
                ("m/sw.js", "text/javascript; charset=utf-8", b"//"),
                ("m/manifest.webmanifest", "application/manifest+json", b"{}"),
            ]),
            Some(self.dir.join("devices.json")),
        )
    }

    fn data_routes(&self) -> Vec<&'static str> {
        DATA_ROUTES.to_vec()
    }
}

impl Subject for Tasks {
    fn identity(&self) -> &'static AppIdentity {
        &tasks_hub::IDENTITY
    }

    fn start(&self, cfg: StartConfig) -> BoxFuture<'_, std::io::Result<RunningServer>> {
        Box::pin(async move {
            start(ServerConfig {
                devices: None,
                addr: cfg.addr,
                limits: cfg.limits,
                clock: cfg.clock,
                pairing_ttl: cfg.pairing_ttl,
                control_secret: cfg.control_secret,
                instance: cfg.instance,
                engine: None,
                policy: Arc::new(AreaPolicy::default()),
                usage: None,
                ui: tasks_hub::ui::UiFiles::none(),
                watch: None,
                status: cfg.status,
            })
            .await
        })
    }

    fn data_routes(&self) -> Vec<&'static str> {
        vec![
            "snapshot",
            "task",
            "next",
            "areas",
            "about",
            "links",
            "enums",
            "groupings",
            "views",
            "finished",
            "waits",
            "plan_compare",
            "events",
            "ops",
            "repos",
            "repos/image",
        ]
    }
}
