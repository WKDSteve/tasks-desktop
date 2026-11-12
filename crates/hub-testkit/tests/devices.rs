//! A paired phone (tasks-mobile) at the tasks hub, with the fake engine: it reaches exactly the routes the phone page
//! asks, nothing else (appkit `MOB-02`, fail closed), and `ops` takes from it only the operations the phone page sends,
//! each at its level (`MOB-03`). A session of the PC is held to none of this.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use appkit_core::authn::{ManualClock, Secret, CODE_BYTES, TOKEN_BYTES};
use hub_testkit::scratch::Scratch;
use serde_json::{json, Value};
use tasks_hub::classes::AreaPolicy;
use tasks_hub::client;
use tasks_hub::config::Env;
use tasks_hub::engine::{CliEngine, CliEngineConfig, Engine};
use tasks_hub::server::{start_with, Extras, HubStatus, Limits, RunningServer, ServerConfig};

/// The public key of a test device: the base point of P-256 (private key 1), uncompressed. The hub needs a point on the
/// curve to pair; this test never signs a login.
const DEVICE_KEY: &str = "046b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2964fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5";

/// The tests of this file each start a hub with an engine process; one after the other, as the write tests.
static ONE_AT_A_TIME: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

struct Rig {
    server: RunningServer,
    control: String,
    // Last: the folder is removed after the server, which has the vault open.
    _dir: Scratch,
}

impl Rig {
    async fn new(name: &str) -> Self {
        let dir = Scratch::new(&format!("devices-{name}"));
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
        let control = Secret::generate(TOKEN_BYTES).unwrap();
        let server = start_with(
            ServerConfig {
                devices: Some(dir.join("devices.json")),
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
                policy: Arc::new(AreaPolicy::default()),
                usage: None,
                ui: tasks_hub::ui::UiFiles::none(),
                watch: None,
            },
            Extras {
                upload_dir: Some(dir.join("uploads")),
                ..Extras::default()
            },
        )
        .await
        .unwrap();
        Self {
            server,
            control: control.to_hex(),
            _dir: dir,
        }
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

    /// A one-time code from the PC.
    async fn code(&self) -> String {
        let (status, doc) = self
            .send("POST", "/api/control/pair", &self.control, "{}")
            .await;
        assert_eq!(status, 200, "{doc}");
        doc["code"].as_str().unwrap().to_owned()
    }

    /// A phone paired with a code: its id and its session.
    async fn phone(&self) -> (String, String) {
        let code = self.code().await;
        let body = json!({ "code": code, "name": "Phone", "key": DEVICE_KEY }).to_string();
        let origin = self.origin();
        let reply = client::request(
            self.server.addr().port(),
            "POST",
            "/auth/device/pair",
            &[("Origin", &origin), ("Content-Type", "application/json")],
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

    /// A session of the PC (a code exchanged on this machine).
    async fn pc(&self) -> String {
        let code = self.code().await;
        let origin = self.origin();
        let reply = client::request(
            self.server.addr().port(),
            "POST",
            "/auth/exchange",
            &[("Origin", &origin), ("Content-Type", "application/json")],
            &format!(r#"{{"code":"{code}"}}"#),
        )
        .await
        .unwrap();
        let doc: Value = serde_json::from_str(&reply.body).unwrap();
        doc["token"].as_str().unwrap().to_owned()
    }

    /// The PC sets the level of a device.
    async fn set_level(&self, device: &str, level: &str) {
        let body = json!({ "device": device, "level": level }).to_string();
        let (status, doc) = self
            .send("POST", "/api/control/devices/level", &self.control, &body)
            .await;
        assert_eq!(status, 200, "{doc}");
    }

    /// A request of `ops` with one operation.
    async fn op(&self, token: &str, op: &Value) -> (u16, Value) {
        let body = json!({ "client_op_id": "c-1", "ops": [op] }).to_string();
        self.send("POST", "/api/tasks/ops", token, &body).await
    }
}

/// The operations the phone page sends, one of each, and what they need.
fn phone_ops() -> [(Value, &'static str); 4] {
    [
        (
            json!({ "op": "new", "area": "alpha.nvim", "title": "From the phone" }),
            "create",
        ),
        (
            json!({ "op": "answer", "id": "alpha.nvim/t1", "question": 1, "option": 1 }),
            "create",
        ),
        (
            json!({ "op": "set", "id": "alpha.nvim/t1", "patch": { "status": "doing" } }),
            "change",
        ),
        (
            json!({ "op": "done", "id": "alpha.nvim/t2", "confirm": "x" }),
            "change",
        ),
    ]
}

fn refused(status: u16, doc: &Value, code: &str) -> bool {
    status == 403 && doc["error"]["code"] == code
}

#[tokio::test]
async fn a_phone_reaches_the_routes_of_the_phone_page_and_nothing_else() {
    let _one = ONE_AT_A_TIME.lock().await;
    let r = Rig::new("routes").await;
    let (_, phone) = r.phone().await;

    for path in [
        "/api/tasks/snapshot",
        "/api/tasks/areas",
        "/api/tasks/next?n=10",
        "/api/tasks/task?id=alpha.nvim/t1",
        "/api/tasks/done_preview?id=alpha.nvim/t1",
    ] {
        let (status, doc) = r.send("GET", path, &phone, "").await;
        assert_eq!(status, 200, "{path}: {doc}");
    }
    // The upload route takes the phone's session (what it then says of the file is the route's).
    let (status, doc) = r
        .send("POST", "/api/tasks/upload?id=alpha.nvim/t1", &phone, "{}")
        .await;
    assert!(
        status != 401 && status != 403,
        "upload is released: {status} {doc}"
    );

    // What only the desktop page needs answers the phone `not_for_devices`, before it runs.
    for (method, path) in [
        ("GET", "/api/vaults"),
        ("POST", "/api/vaults/select"),
        ("GET", "/api/tasks/about"),
        ("GET", "/api/tasks/events"),
        ("GET", "/api/tasks/search?q=a"),
        ("GET", "/api/tasks/finished"),
        ("GET", "/api/tasks/repos"),
        ("POST", "/api/tasks/rescan"),
        ("POST", "/api/tasks/estimate"),
        ("POST", "/api/tasks/open"),
        ("GET", "/api/tasks/hello-not-a-route"),
    ] {
        let (status, doc) = r.send(method, path, &phone, r#"{"name":"main"}"#).await;
        assert!(
            refused(status, &doc, "not_for_devices"),
            "{method} {path}: {status} {doc}"
        );
    }

    // The PC still reaches them (this hub has no list of vaults: the route itself says so).
    let pc = r.pc().await;
    let (status, doc) = r.send("GET", "/api/vaults", &pc, "").await;
    assert_eq!(doc["error"]["code"], "vaults_unavailable", "{status} {doc}");
    let (status, doc) = r.send("GET", "/api/tasks/about", &pc, "").await;
    assert_eq!(status, 200, "{doc}");
}

#[tokio::test]
async fn ops_takes_from_a_phone_only_what_the_phone_page_sends_at_its_level() {
    let _one = ONE_AT_A_TIME.lock().await;
    let r = Rig::new("ops").await;
    let (device, phone) = r.phone().await;

    // A new phone may change (the default of this app), never trigger.
    let (status, doc) = r
        .send("POST", "/api/control/devices", &r.control, "{}")
        .await;
    assert_eq!(status, 200, "{doc}");
    assert_eq!(doc["devices"][0]["level"], "change", "{doc}");

    // Every operation of the phone page gets past the door (the engine judges it).
    for (op, _) in phone_ops() {
        let (status, doc) = r.op(&phone, &op).await;
        assert_eq!(status, 200, "{op}: {doc}");
        assert_eq!(doc["kind"], "tasks.result", "{op}: {doc}");
    }
    // Any other operation is not for a phone, at any level, also in a dry run and next to one that is.
    let others = [
        json!({ "op": "attach", "id": "alpha.nvim/t1", "from": "clipboard" }),
        json!({ "op": "reorder", "id": "alpha.nvim/t1", "before": "alpha.nvim/t2" }),
        json!({ "op": "move_area", "id": "alpha.nvim/t1", "area": "beta" }),
        json!({ "op": "set_body", "id": "alpha.nvim/t1", "body": "x" }),
        json!({ "op": "view_delete", "name": "v" }),
    ];
    for level in ["change", "trigger"] {
        r.set_level(&device, level).await;
        for op in &others {
            let (status, doc) = r.op(&phone, op).await;
            assert!(
                refused(status, &doc, "not_for_devices"),
                "{level} {op}: {status} {doc}"
            );
        }
    }
    let mixed = json!({ "dry_run": true, "ops": [phone_ops()[0].0, others[0]] }).to_string();
    let (status, doc) = r.send("POST", "/api/tasks/ops", &phone, &mixed).await;
    assert!(refused(status, &doc, "not_for_devices"), "{status} {doc}");

    // At `create`, a phone creates and answers, but neither sets a status nor finishes a task.
    r.set_level(&device, "create").await;
    for (op, needs) in phone_ops() {
        let (status, doc) = r.op(&phone, &op).await;
        if needs == "create" {
            assert_eq!(status, 200, "{op}: {doc}");
        } else {
            assert!(
                refused(status, &doc, "level_too_low"),
                "{op}: {status} {doc}"
            );
        }
    }
    let mixed = json!({ "ops": [phone_ops()[0].0, phone_ops()[2].0] }).to_string();
    let (status, doc) = r.send("POST", "/api/tasks/ops", &phone, &mixed).await;
    assert!(refused(status, &doc, "level_too_low"), "{status} {doc}");

    // At `read`, the guard keeps it from `ops` and `upload`; it still reads.
    r.set_level(&device, "read").await;
    let (status, doc) = r.op(&phone, &phone_ops()[0].0).await;
    assert!(refused(status, &doc, "level_too_low"), "{status} {doc}");
    let (status, doc) = r
        .send("POST", "/api/tasks/upload?id=alpha.nvim/t1", &phone, "{}")
        .await;
    assert!(refused(status, &doc, "level_too_low"), "{status} {doc}");
    let (status, doc) = r.send("GET", "/api/tasks/snapshot", &phone, "").await;
    assert_eq!(status, 200, "{doc}");

    // The PC is held to none of it.
    let pc = r.pc().await;
    let (status, doc) = r.op(&pc, &others[1]).await;
    assert_eq!(status, 200, "{doc}");
}

#[tokio::test]
async fn a_tailnet_name_needs_devices_and_a_plain_name() {
    let start = |devices: Option<PathBuf>, name: &str| {
        let name = name.to_owned();
        async move {
            start_with(
                ServerConfig {
                    devices,
                    addr: "127.0.0.1:0".parse().unwrap(),
                    limits: Limits::default(),
                    clock: Arc::new(ManualClock::new()),
                    pairing_ttl: Duration::from_secs(60),
                    control_secret: Secret::generate(TOKEN_BYTES).unwrap(),
                    instance: Secret::generate(CODE_BYTES).unwrap(),
                    status: HubStatus {
                        engine_ready: false,
                        problem: None,
                        capabilities: Vec::new(),
                    },
                    engine: None,
                    policy: Arc::new(AreaPolicy::default()),
                    usage: None,
                    ui: tasks_hub::ui::UiFiles::none(),
                    watch: None,
                },
                Extras {
                    tailnet: Some(name),
                    ..Extras::default()
                },
            )
            .await
        }
    };
    let dir = Scratch::new("devices-tailnet");
    let err = start(None, "pc.example.ts.net")
        .await
        .err()
        .expect("refused");
    assert_eq!(err.kind(), std::io::ErrorKind::InvalidInput, "{err}");
    for bad in [
        "PC.example.ts.net",
        "pc.example.ts.net:443",
        "https://pc.example.ts.net",
        "pc",
        "10.0.0.1",
    ] {
        let err = start(Some(dir.join("devices.json")), bad)
            .await
            .err()
            .unwrap_or_else(|| panic!("{bad} is refused"));
        assert_eq!(err.kind(), std::io::ErrorKind::InvalidInput, "{bad}: {err}");
    }
    let server = start(Some(dir.join("devices.json")), "pc.example.ts.net")
        .await
        .expect("a plain name with devices starts");
    server.shutdown().await;
}
