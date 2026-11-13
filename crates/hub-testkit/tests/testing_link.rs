//! The tasks hub as a paired device of another hub of the kit (`tasks_hub::testing_link`), against a real hub
//! (`DemoDevices` of appkit-testkit, whose `run` route is at `trigger` and answers with the body it was given): the
//! keys are made and kept, the pairing is read back, a trigger is confirmed with the kept key, and the level of the
//! device there decides.

use std::sync::Arc;
use std::time::Duration;

use appkit_core::authn::{ManualClock, Secret, CODE_BYTES, TOKEN_BYTES};
use appkit_hub::{HubStatus, Limits as HubLimits, RunningServer};
use appkit_mobile::link::AppRoutes;
use appkit_mobile::way::{pair_link, HubAddress};
use appkit_testkit::subject::{StartConfig, Subject};
use appkit_testkit::subjects::DemoDevices;
use hub_testkit::scratch::Scratch;
use serde_json::{json, Value};
use tasks_hub::client;
use tasks_hub::testing_link::{self, Target, TestingLink, KEYS_FILE, LINK_FILE};

struct Other {
    server: RunningServer,
    control: String,
    _subject: DemoDevices,
}

impl Other {
    async fn start() -> Self {
        let subject = DemoDevices::new();
        let control = Secret::generate(TOKEN_BYTES).unwrap();
        let server = subject
            .start(StartConfig {
                addr: "127.0.0.1:0".parse().unwrap(),
                limits: HubLimits::default(),
                clock: Arc::new(ManualClock::new()),
                pairing_ttl: Duration::from_secs(60),
                control_secret: control.clone(),
                instance: Secret::generate(CODE_BYTES).unwrap(),
                status: HubStatus {
                    engine_ready: true,
                    problem: None,
                    capabilities: Vec::new(),
                },
            })
            .await
            .unwrap();
        Self {
            server,
            control: control.to_hex(),
            _subject: subject,
        }
    }

    fn port(&self) -> u16 {
        self.server.addr().port()
    }

    /// A call of the PC with the control secret.
    async fn control(&self, path: &str, body: &Value) -> Value {
        let auth = format!("Bearer {}", self.control);
        let origin = format!("http://127.0.0.1:{}", self.port());
        let headers = [
            ("Authorization", auth.as_str()),
            ("Origin", origin.as_str()),
            ("Content-Type", "application/json"),
        ];
        let reply = client::request(self.port(), "POST", path, &headers, &body.to_string())
            .await
            .unwrap();
        assert_eq!(reply.status, 200, "{path}: {}", reply.body);
        serde_json::from_str(&reply.body).unwrap()
    }

    /// The pairing link `<program> phone pair --tunnel` prints.
    async fn link(&self) -> String {
        let code = self.control("/api/control/pair", &json!({})).await;
        pair_link(
            &HubAddress::tunnel(self.port()).unwrap(),
            "demo",
            code["code"].as_str().unwrap(),
        )
    }
}

fn demo() -> Target {
    Target {
        routes: AppRoutes::new("demo-desktop", "demo"),
        sheets_path: "/api/demo/items".to_owned(),
        run_path: "/api/demo/items".to_owned(),
        start_path: "/api/demo/run".to_owned(),
    }
}

#[tokio::test]
async fn the_tasks_hub_pairs_keeps_its_keys_and_confirms_a_trigger_with_them() {
    let other = Other::start().await;
    let dir = Scratch::new("testing-link");
    let said = testing_link::pair_with(&dir, &other.link().await, &demo())
        .await
        .unwrap();
    assert!(said.contains("trigger"), "{said}");
    assert!(dir.join(LINK_FILE).is_file() && dir.join(KEYS_FILE).is_file());
    let devices = other.control("/api/control/devices", &json!({})).await;
    let device = devices["devices"][0]["id"].as_str().unwrap().to_owned();
    assert_eq!(devices["devices"][0]["name"], "tasks-hub", "{devices}");
    // It paired with a key to confirm a trigger, and a new device may not trigger yet.
    assert_eq!(devices["devices"][0]["confirm"], true, "{devices}");

    // Read back from the files, as a hub that starts again does.
    let kept = TestingLink::with_target(dir.to_path_buf(), demo());
    let link = kept.get().await.unwrap().expect("paired");
    let body = json!({ "task": "alpha.nvim/t1" }).to_string();
    // A refusal of the other hub is an answer, not an error of the way: the route reads its status and code.
    let refused = link
        .trigger("/api/demo/run", body.as_bytes())
        .await
        .unwrap();
    assert_eq!(refused.status, 403);
    let doc: Value = serde_json::from_slice(&refused.body).unwrap();
    assert_eq!(doc["error"]["code"], "level_too_low", "{doc}");

    // Raised on the other hub, the confirmation made with the kept key lets exactly this body through.
    other
        .control(
            "/api/control/devices/level",
            &json!({ "device": device, "level": "trigger" }),
        )
        .await;
    let answer = link
        .trigger("/api/demo/run", body.as_bytes())
        .await
        .unwrap();
    assert_eq!(answer.status, 200);
    assert_eq!(String::from_utf8(answer.body).unwrap(), body);

    // Unlinked: the files are gone here, and the hub says there is no pairing.
    let said = testing_link::unlink(&dir).unwrap();
    assert!(said.contains(&device), "{said}");
    assert!(!dir.join(LINK_FILE).exists() && !dir.join(KEYS_FILE).exists());
    let fresh = TestingLink::with_target(dir.to_path_buf(), demo());
    assert!(fresh.get().await.unwrap().is_none());
}

#[tokio::test]
async fn a_spent_or_foreign_link_pairs_nothing_and_keeps_nothing() {
    let other = Other::start().await;
    let dir = Scratch::new("testing-link-refused");
    let text = other.link().await;
    testing_link::pair_with(&dir, &text, &demo()).await.unwrap();
    std::fs::remove_file(dir.join(LINK_FILE)).unwrap();
    std::fs::remove_file(dir.join(KEYS_FILE)).unwrap();
    // The same code again: spent.
    let err = testing_link::pair_with(&dir, &text, &demo())
        .await
        .unwrap_err();
    assert!(err.contains("refused"), "{err}");
    // Not a pairing link at all, or one of another app.
    for bad in [
        "https://example.com/",
        "http://127.0.0.1:1/#appkit-pair=1&app=demo&code=zz",
    ] {
        assert!(
            testing_link::pair_with(&dir, bad, &demo()).await.is_err(),
            "{bad}"
        );
    }
    let err = testing_link::pair(&dir, &other.link().await)
        .await
        .unwrap_err();
    assert!(!err.is_empty());
    assert!(!dir.join(LINK_FILE).exists() && !dir.join(KEYS_FILE).exists());
}
