//! A paired phone (tasks-mobile) at the tasks hub, with the fake engine: it reaches exactly the routes the phone page
//! asks, nothing else (appkit `MOB-02`, fail closed), and `ops` takes from it only the operations the phone page sends,
//! each at its level (`MOB-03`). A session of the PC is held to none of this.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use appkit_core::authn::{ManualClock, Secret, CODE_BYTES, TOKEN_BYTES};
use hub_testkit::scratch::Scratch;
use serde_json::{json, Value};
use tasks_hub::classes::{AreaPolicy, Class, Entry};
use tasks_hub::client;
use tasks_hub::config::Env;
use tasks_hub::engine::{CliEngine, CliEngineConfig, Engine};
use tasks_hub::server::{start_with, Extras, HubStatus, Limits, RunningServer, ServerConfig};

/// The public key of a test device: the base point of P-256 (private key 1), uncompressed. The hub needs a point on the
/// curve to pair; this test never signs a login.
const DEVICE_KEY: &str = "046b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2964fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5";

/// `alpha.nvim` is internal, `secret-area` private, `beta.nvim` has no class (unclassified).
fn policy() -> AreaPolicy {
    let entry = |class| Entry { class, repo: None };
    AreaPolicy::new(std::collections::BTreeMap::from([
        ("alpha.nvim".to_owned(), entry(Class::Internal)),
        ("secret-area".to_owned(), entry(Class::Private)),
    ]))
    .unwrap()
}

/// The tests of this file each start a hub with an engine process; one after the other, as the write tests.
static ONE_AT_A_TIME: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

struct Rig {
    server: RunningServer,
    control: String,
    /// The tailnet name the hub was told, if any.
    tailnet: Option<String>,
    // Last: the folder is removed after the server, which has the vault open.
    _dir: Scratch,
}

impl Rig {
    async fn new(name: &str) -> Self {
        Self::with_tailnet(name, None).await
    }

    async fn with_tailnet(name: &str, tailnet: Option<&str>) -> Self {
        let dir = Scratch::new(&format!("devices-{name}"));
        let vault = dir.join("vault");
        std::fs::create_dir_all(vault.join("alpha.nvim").join("ROADMAP").join("tasks")).unwrap();
        std::fs::write(vault.join(".fake-n"), "2").unwrap();
        // A private area beside the internal one: the phone is never told of it (MOB-02).
        std::fs::write(
            vault.join(".fake-extra"),
            "secret-area/plan
beta.nvim/loose
",
        )
        .unwrap();
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
                policy: Arc::new(policy()),
                usage: None,
                ui: tasks_hub::ui::UiFiles::none(),
                watch: None,
            },
            Extras {
                upload_dir: Some(dir.join("uploads")),
                tailnet: tailnet.map(str::to_owned),
                ..Extras::default()
            },
        )
        .await
        .unwrap();
        Self {
            server,
            control: control.to_hex(),
            tailnet: tailnet.map(str::to_owned),
            _dir: dir,
        }
    }

    /// A request through the tailnet (`tailscale serve`): the `Host` is the tailnet name, the origin its `https` form.
    async fn through_tailnet(
        &self,
        method: &str,
        path: &str,
        token: &str,
        body: &str,
    ) -> (u16, Value) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let host = self.tailnet.as_deref().expect("a hub with a tailnet name");
        let mut text = format!(
            "{method} {path} HTTP/1.1\r\nHost: {host}\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n"
        );
        if method != "GET" {
            text.push_str(&format!(
                "Origin: https://{host}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n",
                body.len()
            ));
        }
        text.push_str("\r\n");
        text.push_str(body);
        let mut stream = tokio::net::TcpStream::connect(self.server.addr())
            .await
            .unwrap();
        stream.write_all(text.as_bytes()).await.unwrap();
        let mut reply = Vec::new();
        stream.read_to_end(&mut reply).await.unwrap();
        let reply = String::from_utf8_lossy(&reply).into_owned();
        let (head, rest) = reply.split_once("\r\n\r\n").expect("a head");
        let status = head.split(' ').nth(1).unwrap().parse().unwrap();
        let chunked = head
            .to_ascii_lowercase()
            .contains("transfer-encoding: chunked");
        let body = if chunked {
            let mut out = String::new();
            let mut rest = rest;
            while let Some((size, tail)) = rest.split_once("\r\n") {
                let size = usize::from_str_radix(size.trim(), 16).unwrap_or(0);
                if size == 0 {
                    break;
                }
                out.push_str(&tail[..size]);
                rest = &tail[size + 2..];
            }
            out
        } else {
            rest.to_owned()
        };
        (status, serde_json::from_str(&body).unwrap_or(Value::Null))
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
    // An upload adds a file to a task that is there: that changes it, more than `create` may.
    let (status, doc) = r
        .send("POST", "/api/tasks/upload?id=alpha.nvim/t1", &phone, "{}")
        .await;
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

#[tokio::test]
async fn a_phone_is_told_nothing_of_an_area_that_is_not_released() {
    let _one = ONE_AT_A_TIME.lock().await;
    let r = Rig::new("classes").await;
    let (_, phone) = r.phone().await;
    let pc = r.pc().await;
    let hidden = ["secret-area", "beta.nvim"];
    let tells = |doc: &Value| {
        let text = doc.to_string();
        hidden.iter().find(|word| text.contains(*word)).copied()
    };

    // The list: the tasks and areas of alpha.nvim only, with counts of those; the PC sees all.
    let (status, doc) = r.send("GET", "/api/tasks/snapshot", &phone, "").await;
    assert_eq!(status, 200, "{doc}");
    assert_eq!(tells(&doc), None, "{doc}");
    let tasks = doc["tasks"].as_array().unwrap();
    assert!(
        !tasks.is_empty() && tasks.iter().all(|t| t["area"] == "alpha.nvim"),
        "{doc}"
    );
    assert_eq!(doc["counts"]["listed"], tasks.len(), "{doc}");
    let (status, doc) = r.send("GET", "/api/tasks/snapshot", &pc, "").await;
    assert_eq!(status, 200, "{doc}");
    assert!(doc.to_string().contains("secret-area/plan"), "{doc}");

    let (status, doc) = r.send("GET", "/api/tasks/areas", &phone, "").await;
    assert_eq!(status, 200, "{doc}");
    assert_eq!(tells(&doc), None, "{doc}");
    assert_eq!(doc["areas"][0]["name"], "alpha.nvim", "{doc}");
    let (_, doc) = r.send("GET", "/api/tasks/areas", &pc, "").await;
    assert!(doc.to_string().contains("secret-area"), "{doc}");

    // A task of such an area is not there for the phone, read or written; the PC reads it.
    for path in [
        "/api/tasks/task?id=secret-area/plan",
        "/api/tasks/task?id=beta.nvim/loose",
        "/api/tasks/done_preview?id=secret-area/plan",
        "/api/tasks/next?area=secret-area",
    ] {
        let (status, doc) = r.send("GET", path, &phone, "").await;
        assert_eq!(
            (status, doc["error"]["code"].clone()),
            (404, json!("not_found")),
            "{path}: {doc}"
        );
    }
    let (status, doc) = r
        .send("GET", "/api/tasks/task?id=secret-area/plan", &pc, "")
        .await;
    assert_eq!(status, 200, "{doc}");
    let (status, doc) = r
        .send("GET", "/api/tasks/task?id=alpha.nvim/t1", &phone, "")
        .await;
    assert_eq!(status, 200, "{doc}");
    let (status, doc) = r.send("GET", "/api/tasks/next", &phone, "").await;
    assert_eq!(status, 200, "{doc}");
    assert_eq!(tells(&doc), None, "{doc}");

    for op in [
        json!({ "op": "set", "id": "secret-area/plan", "patch": { "status": "doing" } }),
        json!({ "op": "done", "id": "beta.nvim/loose", "confirm": "x" }),
        json!({ "op": "answer", "id": "secret-area/plan", "question": 1, "option": 1 }),
        json!({ "op": "new", "area": "secret-area", "title": "From the phone" }),
        json!({ "op": "new", "title": "No area" }),
    ] {
        let (status, doc) = r.op(&phone, &op).await;
        assert_eq!(
            (status, doc["error"]["code"].clone()),
            (404, json!("not_found")),
            "{op}: {doc}"
        );
    }
    let new_task = json!({ "op": "new", "area": "alpha.nvim", "title": "From the phone" });
    let (status, doc) = r.op(&phone, &new_task).await;
    assert_eq!(status, 200, "{doc}");
    let (status, doc) = r
        .send("POST", "/api/tasks/upload?id=secret-area/plan", &phone, "x")
        .await;
    assert_eq!(
        (status, doc["error"]["code"].clone()),
        (404, json!("not_found")),
        "{doc}"
    );
}

#[tokio::test]
async fn an_operation_of_a_phone_holds_only_the_fields_the_phone_page_sends() {
    let _one = ONE_AT_A_TIME.lock().await;
    let r = Rig::new("fields").await;
    let (device, phone) = r.phone().await;
    // At the highest level too: a field is no way past the level.
    r.set_level(&device, "trigger").await;
    let id = "alpha.nvim/t1";
    let status_only = json!({ "status": "doing" });
    let refused_ops = [
        // `set` sets the status, nothing else.
        json!({ "op": "set", "id": id, "patch": { "title": "renamed" } }),
        json!({ "op": "set", "id": id, "patch": { "status": "doing", "title": "renamed" } }),
        json!({ "op": "set", "id": id, "patch": { "order": 1 } }),
        json!({ "op": "set", "id": id, "patch": { "plan": "other" } }),
        json!({ "op": "set", "id": id, "patch": { "project": "other" } }),
        json!({ "op": "set", "id": id, "patch": { "phase": "two" } }),
        json!({ "op": "set", "id": id, "patch": { "after": "alpha.nvim/t2" } }),
        json!({ "op": "set", "id": id, "patch": { "blocked_by": ["alpha.nvim/t2"] } }),
        json!({ "op": "set", "id": id, "patch": { "actor": "someone" } }),
        json!({ "op": "set", "id": id, "patch": { "remind": "2026-01-01" } }),
        json!({ "op": "set", "id": id, "patch": { "due": "2026-01-01" } }),
        json!({ "op": "set", "id": id, "patch": {} }),
        json!({ "op": "set", "id": id, "patch": "doing" }),
        json!({ "op": "set", "id": id }),
        // No claim of another is broken, nobody else acts.
        json!({ "op": "set", "id": id, "patch": status_only, "force": true }),
        json!({ "op": "set", "id": id, "patch": status_only, "by": "someone" }),
        json!({ "op": "done", "id": id, "confirm": "x", "force": true }),
        json!({ "op": "done", "id": id, "confirm": "x", "by": "someone" }),
        json!({ "op": "answer", "id": id, "question": 1, "option": 1, "by": "someone" }),
        // A new task is an area, a title and a text.
        json!({ "op": "new", "area": "alpha.nvim", "title": "N", "plan": "p" }),
        json!({ "op": "new", "area": "alpha.nvim", "title": "N", "status": "doing" }),
        json!({ "op": "new", "area": "alpha.nvim", "title": "N", "by": "someone" }),
    ];
    for op in &refused_ops {
        let (status, doc) = r.op(&phone, op).await;
        assert!(
            refused(status, &doc, "not_for_devices"),
            "{op}: {status} {doc}"
        );
    }
    // What the phone page sends gets through, with its `if_match` and a text.
    for op in [
        json!({ "op": "set", "id": id, "patch": status_only, "if_match": "e1" }),
        json!({ "op": "new", "area": "alpha.nvim", "title": "N", "body": "b" }),
        json!({ "op": "answer", "id": id, "question": 1, "option": 1, "if_match": "e1" }),
    ] {
        let (status, doc) = r.op(&phone, &op).await;
        assert_eq!(status, 200, "{op}: {doc}");
    }
    // A screenshot of the PC is refused as not for devices, before the hub's folders are looked at: the phone learns
    // nothing of the settings of the PC (this hub has none).
    let latest = json!({ "op": "attach", "id": id, "from": "latest" });
    let (status, doc) = r.op(&phone, &latest).await;
    assert!(refused(status, &doc, "not_for_devices"), "{status} {doc}");
    // The PC is held to none of it.
    let pc = r.pc().await;
    let (status, doc) = r.op(&pc, &refused_ops[0]).await;
    assert_eq!(status, 200, "{doc}");
    let (status, doc) = r.op(&pc, &latest).await;
    assert_eq!(doc["error"]["code"], "attach_no_folders", "{status} {doc}");
}

#[tokio::test]
async fn through_the_tailnet_a_phone_gets_the_same_routes_and_the_same_cut() {
    let _one = ONE_AT_A_TIME.lock().await;
    let r = Rig::with_tailnet("tailnet", Some("pc.example.ts.net")).await;
    let (_, phone) = r.phone().await;

    let (status, doc) = r
        .through_tailnet("GET", "/api/tasks/snapshot", &phone, "")
        .await;
    assert_eq!(status, 200, "{doc}");
    assert!(!doc["tasks"].as_array().unwrap().is_empty(), "{doc}");
    let text = doc.to_string();
    assert!(
        !text.contains("secret-area") && !text.contains("beta.nvim"),
        "{doc}"
    );
    let (status, doc) = r
        .through_tailnet("GET", "/api/tasks/task?id=secret-area/plan", &phone, "")
        .await;
    assert_eq!(status, 404, "{doc}");
    assert_eq!(doc["error"]["code"], "not_found", "{doc}");
    let (status, doc) = r.through_tailnet("GET", "/api/vaults", &phone, "").await;
    assert!(refused(status, &doc, "not_for_devices"), "{status} {doc}");
    let set = json!({ "ops": [{ "op": "set", "id": "alpha.nvim/t1", "patch": { "title": "x" } }] })
        .to_string();
    let (status, doc) = r
        .through_tailnet("POST", "/api/tasks/ops", &phone, &set)
        .await;
    assert!(refused(status, &doc, "not_for_devices"), "{status} {doc}");

    // A session of the PC is not let in there at all; on loopback it still reads everything.
    let pc = r.pc().await;
    let (status, doc) = r
        .through_tailnet("GET", "/api/tasks/snapshot", &pc, "")
        .await;
    assert_eq!(status, 403, "{doc}");
    let (status, doc) = r.send("GET", "/api/tasks/snapshot", &pc, "").await;
    assert_eq!(status, 200, "{doc}");
    assert!(doc.to_string().contains("secret-area"), "{doc}");
}

/// A plan of a private area (`secret-area/umzug`) that holds only the internal area, a released plan that names a
/// private target and project, a released plan that names released ones; and the areas of the vault.
fn plans_of_the_vault() -> Value {
    json!({
        "areas": [{ "name": "secret-area" }, { "name": "beta.nvim" }, { "name": "alpha.nvim" }],
        "plans": [
            { "id": "secret-area/umzug", "title": "Umzug", "areas": ["alpha.nvim"],
              "target": "secret-area/kuendigung", "project": "secret-area/scheidung" },
            { "id": "alpha.nvim/open-plan", "title": "Open", "areas": ["alpha.nvim"],
              "target": "secret-area/kuendigung", "project": "secret-area/scheidung" },
            { "id": "alpha.nvim/good", "title": "Good", "areas": ["alpha.nvim"],
              "target": "alpha.nvim/t1", "project": "alpha.nvim/proj" },
        ],
        "projects": [
            { "id": "secret-area/scheidung", "title": "Scheidung", "areas": ["alpha.nvim"] },
            { "id": "alpha.nvim/proj", "title": "Proj", "areas": ["alpha.nvim"] },
        ],
    })
}

/// Words of what the phone may not know, in any document it is given.
fn tells_secret(doc: &Value) -> Option<&'static str> {
    let text = doc.to_string();
    [
        "secret-area",
        "umzug",
        "Umzug",
        "scheidung",
        "kuendigung",
        "beta.nvim",
        "E:/",
    ]
    .into_iter()
    .find(|word| text.contains(word))
}

impl Rig {
    /// Put `merge` into the answers of `method` of the fake engine.
    fn merge(&self, method: &str, merge: &Value) {
        std::fs::write(
            self._dir
                .join("vault")
                .join(format!(".fake-merge-{method}.json")),
            merge.to_string(),
        )
        .unwrap();
    }
}

#[tokio::test]
async fn a_plan_is_given_to_a_phone_only_with_what_it_names_released() {
    let _one = ONE_AT_A_TIME.lock().await;
    let r = Rig::new("plans").await;
    r.merge("snapshot", &plans_of_the_vault());
    let (_, phone) = r.phone().await;
    let pc = r.pc().await;

    let (status, doc) = r.send("GET", "/api/tasks/snapshot", &phone, "").await;
    assert_eq!(status, 200, "{doc}");
    assert_eq!(tells_secret(&doc), None, "{doc}");
    let plans: Vec<&str> = doc["plans"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["id"].as_str().unwrap())
        .collect();
    // A plan whose file is in a private area is not there, whatever areas it holds.
    assert_eq!(plans, ["alpha.nvim/open-plan", "alpha.nvim/good"], "{doc}");
    // A target or a project the phone may not know is left out of the plan; released ones stay.
    assert!(doc["plans"][0].get("target").is_none(), "{doc}");
    assert!(doc["plans"][0].get("project").is_none(), "{doc}");
    assert_eq!(doc["plans"][1]["target"], "alpha.nvim/t1", "{doc}");
    assert_eq!(doc["plans"][1]["project"], "alpha.nvim/proj", "{doc}");
    assert_eq!(doc["projects"].as_array().unwrap().len(), 1, "{doc}");
    // The state of the whole vault is not told: a `rev` of its own, no `digest`.
    let (_, full) = r.send("GET", "/api/tasks/snapshot", &pc, "").await;
    assert!(full.to_string().contains("secret-area/umzug"), "{full}");
    assert!(doc.get("digest").is_none(), "{doc}");
    let rev = doc["rev"].as_str().unwrap();
    assert!(rev.starts_with("sha256:") && rev != full["rev"], "{rev}");
    let (_, task) = r
        .send("GET", "/api/tasks/task?id=alpha.nvim/t1", &phone, "")
        .await;
    assert!(
        task.get("rev").is_none() && task.get("digest").is_none(),
        "{task}"
    );

    // What finishing a task closes is told only of a plan or project the phone may know.
    r.merge(
        "done_preview",
        &json!({ "plan": "secret-area/umzug", "closes_plan": "secret-area/umzug",
                 "closes_project": "secret-area/scheidung", "digest": "sha256:vault" }),
    );
    let path = "/api/tasks/done_preview?id=alpha.nvim/t1";
    let (status, doc) = r.send("GET", path, &phone, "").await;
    assert_eq!(status, 200, "{doc}");
    assert_eq!(tells_secret(&doc), None, "{doc}");
    assert!(
        doc.get("closes_plan").is_none() && doc.get("digest").is_none(),
        "{doc}"
    );
    r.merge(
        "done_preview",
        &json!({ "closes_plan": "alpha.nvim/good", "closes_project": "alpha.nvim/proj" }),
    );
    let (_, doc) = r.send("GET", path, &phone, "").await;
    assert_eq!(doc["closes_plan"], "alpha.nvim/good", "{doc}");
    assert_eq!(doc["closes_project"], "alpha.nvim/proj", "{doc}");
}

#[tokio::test]
async fn a_write_tells_a_phone_only_what_it_may_know() {
    let _one = ONE_AT_A_TIME.lock().await;
    let r = Rig::new("results").await;
    r.merge("snapshot", &plans_of_the_vault());
    r.merge(
        "ops",
        &json!({ "each_result": {
            "plans_closed": ["secret-area/umzug", "alpha.nvim/good"],
            "projects_closed": ["secret-area/scheidung", "alpha.nvim/proj"],
            "changed_ids": ["alpha.nvim/t2", "secret-area/kuendigung"],
            "notes": ["E:/vault/secret-area/umzug-notes.md"],
            "file": "secret-area/ROADMAP/tasks/kuendigung.md",
            "index": { "action": "written" },
            "inverse": { "op": "set", "id": "secret-area/kuendigung", "patch": { "status": "open" } },
            "error": { "code": "conflict", "message": "secret-area/kuendigung changed", "retryable": true },
        }}),
    );
    let (_, phone) = r.phone().await;
    let pc = r.pc().await;
    // The plans the phone may know come from the snapshot the hub holds.
    let (status, _) = r.send("GET", "/api/tasks/snapshot", &phone, "").await;
    assert_eq!(status, 200);

    let done = json!({ "op": "done", "id": "alpha.nvim/t2", "confirm": "x" });
    let (status, doc) = r.op(&phone, &done).await;
    assert_eq!(status, 200, "{doc}");
    assert_eq!(tells_secret(&doc), None, "{doc}");
    let entry = &doc["results"][0];
    assert_eq!(entry["id"], "alpha.nvim/t2", "{doc}");
    assert_eq!(entry["plans_closed"], json!(["alpha.nvim/good"]), "{doc}");
    assert_eq!(
        entry["projects_closed"],
        json!(["alpha.nvim/proj"]),
        "{doc}"
    );
    assert_eq!(entry["changed_ids"], json!(["alpha.nvim/t2"]), "{doc}");
    assert_eq!(
        entry["error"],
        json!({ "code": "conflict", "message": "", "retryable": true })
    );
    for field in ["notes", "file", "index", "inverse"] {
        assert!(entry.get(field).is_none(), "{field}: {doc}");
    }
    assert!(doc.get("digest").is_none(), "{doc}");
    // The PC is told everything.
    let (_, doc) = r.op(&pc, &done).await;
    assert!(doc.to_string().contains("secret-area/umzug"), "{doc}");

    // An upload answers in the same words.
    let origin = r.origin();
    let auth = format!("Bearer {phone}");
    let reply = client::request(
        r.server.addr().port(),
        "POST",
        "/api/tasks/upload?id=alpha.nvim/t2&exact=1",
        &[
            ("Authorization", auth.as_str()),
            ("Origin", origin.as_str()),
            ("Content-Type", "application/octet-stream"),
            ("X-Upload-Name", "photo.png"),
        ],
        "png",
    )
    .await
    .unwrap();
    assert_eq!(reply.status, 200, "{}", reply.body);
    let doc: Value = serde_json::from_str(&reply.body).unwrap();
    assert_eq!(tells_secret(&doc), None, "{doc}");
    assert_eq!(
        doc["results"][0]["changed_ids"],
        json!(["alpha.nvim/t2"]),
        "{doc}"
    );
}

#[tokio::test]
async fn a_phone_is_proposed_tasks_of_released_areas_when_the_vault_picks_others() {
    let _one = ONE_AT_A_TIME.lock().await;
    let r = Rig::new("next").await;
    r.merge("snapshot", &plans_of_the_vault());
    // The engine's pick over the vault is all of areas the phone may not see; asked per area, alpha.nvim has two.
    let brief = |id: &str| json!({ "id": id, "title": format!("Title {id}"), "status": "open" });
    r.merge(
        "next",
        &json!({ "by_area": {
            "": { "task": brief("secret-area/a"), "alternatives": [brief("beta.nvim/b"), brief("secret-area/c")] },
            "alpha.nvim": { "task": brief("alpha.nvim/t1"), "alternatives": [brief("alpha.nvim/t2"), brief("alpha.nvim/t0")] },
        }}),
    );
    let (_, phone) = r.phone().await;
    let (status, _) = r.send("GET", "/api/tasks/snapshot", &phone, "").await;
    assert_eq!(status, 200);

    let (status, doc) = r.send("GET", "/api/tasks/next?n=1", &phone, "").await;
    assert_eq!(status, 200, "{doc}");
    assert_eq!(tells_secret(&doc), None, "{doc}");
    assert_eq!(doc["task"]["id"], "alpha.nvim/t1", "{doc}");
    // Shortened to what was asked: the pick and one alternative.
    assert_eq!(
        doc["alternatives"],
        json!([brief("alpha.nvim/t2")]),
        "{doc}"
    );
    // Without `n`, the engine's default: the pick and two alternatives.
    let (_, doc) = r.send("GET", "/api/tasks/next", &phone, "").await;
    assert_eq!(doc["alternatives"].as_array().unwrap().len(), 2, "{doc}");
    // The PC gets the engine's pick as it is.
    let pc = r.pc().await;
    let (_, doc) = r.send("GET", "/api/tasks/next?n=1", &pc, "").await;
    assert_eq!(doc["task"]["id"], "secret-area/a", "{doc}");
}
