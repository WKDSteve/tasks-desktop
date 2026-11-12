//! Web Push to the paired phones (tasks-mobile `docs/HUB.md` section 5), with the fake engine and a push service that
//! only counts: a task that starts to wait for a decision is told once to a phone that subscribed to `decision`, and
//! only when its area is `internal` or `public`; for a private area nothing goes out at all. A paired phone reaches the
//! routes of push.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use appkit_core::authn::{ManualClock, Secret, CODE_BYTES, TOKEN_BYTES};
use appkit_hub::push::{b64url, Push, PushRequest, PushTransport, Subscription};
use hub_testkit::scratch::Scratch;
use serde_json::{json, Value};
use tasks_hub::classes::{AreaPolicy, Class, Entry};
use tasks_hub::client;
use tasks_hub::config::Env;
use tasks_hub::engine::{CliEngine, CliEngineConfig, Engine};
use tasks_hub::notices::Notices;
use tasks_hub::server::{
    start_with, BoxFuture, Extras, HubPush, HubStatus, Limits, RunningServer, ServerConfig,
    WatchConfig,
};
use tasks_hub::store::RefreshOptions;

/// The tests of this file each start a hub with an engine process; one after the other, as the write tests.
static ONE_AT_A_TIME: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// The base point of P-256, uncompressed: a valid public key of a device.
const DEVICE_KEY: &str = "046b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2964fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5";

/// A push service that takes everything and keeps the endpoints it was sent to.
#[derive(Default)]
struct Counting {
    sent: Mutex<Vec<String>>,
}

impl PushTransport for Counting {
    fn send(&self, request: PushRequest) -> BoxFuture<'_, Option<u16>> {
        self.sent.lock().unwrap().push(request.endpoint);
        Box::pin(async { Some(201) })
    }
}

fn hex(text: &str) -> Vec<u8> {
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
        .collect()
}

struct Rig {
    server: RunningServer,
    control: String,
    token: String,
    push: Arc<Push>,
    service: Arc<Counting>,
    vault: PathBuf,
    _dir: Scratch,
}

impl Rig {
    async fn new(name: &str, class: Class) -> Self {
        let dir = Scratch::new(&format!("push-{name}"));
        let vault = dir.join("vault");
        std::fs::create_dir_all(vault.join("alpha.nvim").join("ROADMAP").join("tasks")).unwrap();
        std::fs::write(vault.join(".fake-n"), "2").unwrap();
        let engine: Arc<dyn Engine> = Arc::new(CliEngine::new(CliEngineConfig {
            dialect: tasks_hub::engine::DIALECT,
            nvim: PathBuf::from(env!("CARGO_BIN_EXE_fake-nvim")),
            script: vault.join("scripts").join("tasks.lua"),
            vault: vault.clone(),
            lib_dir: None,
            extra_areas: vec![],
            env: Env::from_process(),
            timeout: Duration::from_secs(10),
            max_queue: 16,
            max_reply_bytes: 4 * 1024 * 1024,
        }));
        let service = Arc::new(Counting::default());
        let push = Arc::new(Push::open(&dir.join("settings"), service.clone()).unwrap());
        let policy = AreaPolicy::new(std::collections::BTreeMap::from([(
            "alpha.nvim".to_owned(),
            Entry { class, repo: None },
        )]))
        .unwrap();
        let control = Secret::generate(TOKEN_BYTES).unwrap();
        let server = start_with(
            ServerConfig {
                devices: Some(dir.join("settings").join("devices.json")),
                addr: "127.0.0.1:0".parse().unwrap(),
                limits: Limits {
                    snapshot_max_age: None,
                    ..Limits::default()
                },
                clock: Arc::new(ManualClock::new()),
                pairing_ttl: Duration::from_secs(60),
                control_secret: control.clone(),
                instance: Secret::generate(CODE_BYTES).unwrap(),
                status: HubStatus {
                    engine_ready: true,
                    problem: None,
                    capabilities: Vec::new(),
                },
                engine: Some(engine),
                policy: Arc::new(policy),
                usage: None,
                ui: tasks_hub::ui::UiFiles::none(),
                watch: Some(WatchConfig {
                    vault: vault.clone(),
                    refresh: RefreshOptions {
                        debounce: Duration::from_millis(100),
                        max_wait: Duration::from_secs(1),
                        interval: Duration::from_secs(300),
                    },
                }),
            },
            Extras {
                push: Some(HubPush {
                    push: Arc::clone(&push),
                    notices: Arc::new(Notices::open(Some(
                        dir.join("settings").join("notices.json"),
                    ))),
                }),
                ..Extras::default()
            },
        )
        .await
        .unwrap();
        let mut rig = Self {
            server,
            control: control.to_hex(),
            token: String::new(),
            push,
            service,
            vault,
            _dir: dir,
        };
        rig.token = rig.pc().await;
        rig
    }

    fn origin(&self) -> String {
        format!("http://127.0.0.1:{}", self.server.addr().port())
    }

    async fn send(&self, method: &str, path: &str, token: &str, body: &str) -> (u16, Value) {
        let auth = format!("Bearer {token}");
        let origin = self.origin();
        let mut headers = vec![("Authorization", auth.as_str())];
        if method != "GET" {
            headers.push(("Origin", origin.as_str()));
            headers.push(("Content-Type", "application/json"));
        }
        let reply = client::request(self.server.addr().port(), method, path, &headers, body)
            .await
            .unwrap();
        (
            reply.status,
            serde_json::from_str(&reply.body).unwrap_or(Value::Null),
        )
    }

    async fn code(&self) -> String {
        let (status, doc) = self
            .send("POST", "/api/control/pair", &self.control, "{}")
            .await;
        assert_eq!(status, 200, "{doc}");
        doc["code"].as_str().unwrap().to_owned()
    }

    async fn pc(&self) -> String {
        let code = self.code().await;
        let reply = client::request(
            self.server.addr().port(),
            "POST",
            "/auth/exchange",
            &[
                ("Origin", &self.origin()),
                ("Content-Type", "application/json"),
            ],
            &format!(r#"{{"code":"{code}"}}"#),
        )
        .await
        .unwrap();
        let doc: Value = serde_json::from_str(&reply.body).unwrap();
        doc["token"].as_str().unwrap().to_owned()
    }

    /// A paired phone's id and session.
    async fn phone(&self) -> (String, String) {
        let code = self.code().await;
        let body = json!({ "code": code, "name": "Phone", "key": DEVICE_KEY }).to_string();
        let reply = client::request(
            self.server.addr().port(),
            "POST",
            "/auth/device/pair",
            &[
                ("Origin", &self.origin()),
                ("Content-Type", "application/json"),
            ],
            &body,
        )
        .await
        .unwrap();
        assert_eq!(reply.status, 200, "{}", reply.body);
        let doc: Value = serde_json::from_str(&reply.body).unwrap();
        (
            doc["device"].as_str().unwrap().to_owned(),
            doc["token"].as_str().unwrap().to_owned(),
        )
    }

    /// The hub's snapshot, read once: the job of the notices learns the tasks as they are.
    async fn read(&self) {
        let (status, doc) = self
            .send("GET", "/api/tasks/snapshot", &self.token, "")
            .await;
        assert_eq!(status, 200, "{doc}");
    }

    /// Give a task a status: the fake engine reads it from `.fake-status`, and a write moves the vault on (a new
    /// snapshot, as after a change of a file).
    async fn set_status(&self, id: &str, status: &str) {
        let file = self.vault.join(".fake-status");
        let mut lines: Vec<String> = std::fs::read_to_string(&file)
            .unwrap_or_default()
            .lines()
            .filter(|l| !l.starts_with(&format!("{id}=")))
            .map(str::to_owned)
            .collect();
        lines.push(format!("{id}={status}"));
        std::fs::write(
            &file,
            lines.join(
                "
",
            ),
        )
        .unwrap();
        let body = json!({ "ops": [{ "op": "set", "id": id, "patch": { "status": status } }] })
            .to_string();
        let (code, doc) = self
            .send("POST", "/api/tasks/ops", &self.token, &body)
            .await;
        assert_eq!(code, 200, "{doc}");
        assert_eq!(doc["results"][0]["outcome"], "changed", "{doc}");
    }

    fn sent(&self) -> Vec<String> {
        self.service.sent.lock().unwrap().clone()
    }

    /// Wait until `n` notices went out, or a while; the count then.
    async fn wait_for(&self, n: usize) -> usize {
        for _ in 0..50 {
            if self.sent().len() >= n {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        self.sent().len()
    }
}

fn subscription(endpoint: &str, kinds: &[&str]) -> Subscription {
    Subscription {
        endpoint: endpoint.to_owned(),
        p256dh: b64url(&hex(DEVICE_KEY)),
        auth: b64url(&[7u8; 16]),
        kinds: kinds.iter().map(|k| (*k).to_owned()).collect(),
    }
}

#[tokio::test]
async fn a_phone_reaches_the_routes_of_push() {
    let _one = ONE_AT_A_TIME.lock().await;
    let r = Rig::new("routes", Class::Internal).await;
    let (_, phone) = r.phone().await;
    let (status, doc) = r.send("GET", "/api/push/key", &phone, "").await;
    assert_eq!(status, 200, "{doc}");
    assert_eq!(doc["key"], r.push.public_key());
    let body = json!({
        "endpoint": "https://push.example.com/a",
        "p256dh": b64url(&hex(DEVICE_KEY)),
        "auth": b64url(&[7u8; 16]),
        "kinds": ["remind", "decision"],
    })
    .to_string();
    let (status, doc) = r.send("POST", "/api/push/subscribe", &phone, &body).await;
    assert_eq!(status, 200, "{doc}");
    assert!(r.push.has_subscribers("decision"));
    let (status, doc) = r.send("POST", "/api/push/unsubscribe", &phone, "{}").await;
    assert_eq!(status, 200, "{doc}");
    assert!(!r.push.has_subscribers("decision"));
}

#[tokio::test]
async fn a_task_that_starts_to_wait_for_a_decision_is_told_once_to_the_phones_that_asked() {
    let _one = ONE_AT_A_TIME.lock().await;
    let r = Rig::new("decision", Class::Internal).await;
    r.push
        .subscribe(
            "d1",
            subscription("https://push.example.com/d1", &["decision"]),
        )
        .unwrap();
    r.push
        .subscribe(
            "d2",
            subscription("https://push.example.com/d2", &["remind"]),
        )
        .unwrap();
    r.read().await;
    r.set_status("alpha.nvim/t1", "decision").await;
    assert_eq!(r.wait_for(1).await, 1, "{:?}", r.sent());
    assert_eq!(r.sent(), ["https://push.example.com/d1"]);
    // Another change of the vault: the task still waits, nothing more is told.
    r.set_status("alpha.nvim/t2", "doing").await;
    tokio::time::sleep(Duration::from_millis(800)).await;
    assert_eq!(r.sent().len(), 1, "{:?}", r.sent());
    // Out of the status and back in: told again.
    r.set_status("alpha.nvim/t1", "open").await;
    r.set_status("alpha.nvim/t1", "decision").await;
    assert_eq!(r.wait_for(2).await, 2, "{:?}", r.sent());
}

#[tokio::test]
async fn nothing_goes_out_for_a_private_area() {
    let _one = ONE_AT_A_TIME.lock().await;
    let r = Rig::new("private", Class::Private).await;
    r.push
        .subscribe(
            "d1",
            subscription("https://push.example.com/d1", &["decision", "remind"]),
        )
        .unwrap();
    r.read().await;
    r.set_status("alpha.nvim/t1", "decision").await;
    tokio::time::sleep(Duration::from_millis(1500)).await;
    assert!(r.sent().is_empty(), "{:?}", r.sent());
}

#[tokio::test]
async fn a_reminder_whose_day_has_come_is_told_once_on_the_day_the_engine_says() {
    let _one = ONE_AT_A_TIME.lock().await;
    let r = Rig::new("remind", Class::Internal).await;
    std::fs::write(
        r.vault.join(".fake-remind"),
        "alpha.nvim/t1=2026-11-10\nalpha.nvim/t2=2026-11-13",
    )
    .unwrap();
    r.push
        .subscribe(
            "d1",
            subscription("https://push.example.com/d1", &["remind"]),
        )
        .unwrap();
    // An engine that does not say its day reminds of nothing.
    r.read().await;
    r.set_status("alpha.nvim/t0", "doing").await;
    tokio::time::sleep(Duration::from_millis(800)).await;
    assert!(r.sent().is_empty(), "{:?}", r.sent());
    // On 2026-11-12: t1 (its day has passed), once, whatever else changes.
    std::fs::write(r.vault.join(".fake-today"), "2026-11-12").unwrap();
    r.set_status("alpha.nvim/t0", "open").await;
    assert_eq!(r.wait_for(1).await, 1, "{:?}", r.sent());
    r.set_status("alpha.nvim/t0", "doing").await;
    tokio::time::sleep(Duration::from_millis(800)).await;
    assert_eq!(r.sent().len(), 1, "{:?}", r.sent());
    // The next day: t1 again and t2, its day.
    std::fs::write(r.vault.join(".fake-today"), "2026-11-13").unwrap();
    r.set_status("alpha.nvim/t0", "open").await;
    assert_eq!(r.wait_for(3).await, 3, "{:?}", r.sent());
}
