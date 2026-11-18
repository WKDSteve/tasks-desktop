//! The reminders by e-mail over a real hub, with the fake engine and a transport that only keeps what it is handed:
//! the answer of the route is the mail (the preview), a task of a private or unclassified area is never in it, a hub
//! without a mail account says so and sends nothing, and what is refused is refused before anything leaves.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use appkit_core::authn::{ManualClock, Secret, CODE_BYTES, TOKEN_BYTES};
use hub_testkit::scratch::Scratch;
use serde_json::{json, Value};
use tasks_hub::classes::{AreaPolicy, Class, Entry};
use tasks_hub::client;
use tasks_hub::config::Env;
use tasks_hub::engine::{CliEngine, CliEngineConfig, Engine};
use tasks_hub::mail::{Message, Transport};
use tasks_hub::server::{
    start_with, BoxFuture, Extras, HubStatus, Limits, RunningServer, ServerConfig,
};

/// The tests of this file each start a hub with an engine process; one after the other, as the write tests.
static ONE_AT_A_TIME: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// A transport that keeps the mails it was handed, or refuses them with `refusal`.
#[derive(Default)]
struct Kept {
    sent: Mutex<Vec<Message>>,
    refusal: Mutex<Option<String>>,
}

impl Transport for Kept {
    fn send<'a>(&'a self, message: &'a Message) -> BoxFuture<'a, Result<(), String>> {
        Box::pin(async move {
            if let Some(why) = self.refusal.lock().unwrap().clone() {
                return Err(why);
            }
            self.sent.lock().unwrap().push(message.clone());
            Ok(())
        })
    }
}

struct Rig {
    server: RunningServer,
    token: String,
    mail: Arc<Kept>,
    _dir: Scratch,
}

impl Rig {
    /// A hub over a vault with reminders in an internal area (`alpha.nvim`: t1, t2), a private one (`secret.nvim`),
    /// one without a class (`new.nvim`) and a finished task of a public one (`open.nvim`). `account`: with a transport.
    async fn new(name: &str, account: bool) -> Self {
        let dir = Scratch::new(&format!("reminders-mail-{name}"));
        let vault = dir.join("vault");
        std::fs::create_dir_all(vault.join("alpha.nvim").join("ROADMAP").join("tasks")).unwrap();
        std::fs::write(vault.join(".fake-n"), "2").unwrap();
        std::fs::write(vault.join(".fake-extra"), "secret.nvim/s1\nnew.nvim/n1").unwrap();
        std::fs::write(
            vault.join(".fake-remind"),
            "alpha.nvim/t2=2026-11-10\nalpha.nvim/t1=2026-11-12\nsecret.nvim/s1=2026-11-10\nnew.nvim/n1=2026-11-10",
        )
        .unwrap();
        std::fs::write(
            vault.join(".fake-merge-snapshot.json"),
            json!({ "reminders": [
                { "id": "open.nvim/done1", "area": "open.nvim", "title": "Finished one", "remind": "2026-11-01", "remind_at": "07:15" },
            ] })
            .to_string(),
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
        let entry = |class| Entry { class, repo: None };
        let policy = AreaPolicy::new(std::collections::BTreeMap::from([
            ("alpha.nvim".to_owned(), entry(Class::Internal)),
            ("open.nvim".to_owned(), entry(Class::Public)),
            ("secret.nvim".to_owned(), entry(Class::Private)),
        ]))
        .unwrap();
        let control = Secret::generate(TOKEN_BYTES).unwrap();
        let mail = Arc::new(Kept::default());
        let server = start_with(
            ServerConfig {
                devices: None,
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
                watch: None,
            },
            Extras {
                mail: account.then(|| Arc::clone(&mail) as Arc<dyn Transport>),
                ..Extras::default()
            },
        )
        .await
        .unwrap();
        let mut rig = Self {
            server,
            token: String::new(),
            mail,
            _dir: dir,
        };
        rig.token = rig.pair(&control.to_hex()).await;
        rig
    }

    fn origin(&self) -> String {
        format!("http://127.0.0.1:{}", self.server.addr().port())
    }

    async fn pair(&self, control: &str) -> String {
        let port = self.server.addr().port();
        let origin = self.origin();
        let auth = format!("Bearer {control}");
        let reply = client::request(
            port,
            "POST",
            "/api/control/pair",
            &[
                ("Authorization", auth.as_str()),
                ("Origin", origin.as_str()),
                ("Content-Type", "application/json"),
            ],
            "{}",
        )
        .await
        .unwrap();
        let code = serde_json::from_str::<Value>(&reply.body).unwrap()["code"]
            .as_str()
            .unwrap()
            .to_owned();
        let reply = client::request(
            port,
            "POST",
            "/auth/exchange",
            &[
                ("Origin", origin.as_str()),
                ("Content-Type", "application/json"),
            ],
            &format!(r#"{{"code":"{code}"}}"#),
        )
        .await
        .unwrap();
        serde_json::from_str::<Value>(&reply.body).unwrap()["token"]
            .as_str()
            .unwrap()
            .to_owned()
    }

    async fn post_as(&self, token: Option<&str>, body: &str) -> (u16, Value) {
        let origin = self.origin();
        let auth = token.map(|t| format!("Bearer {t}"));
        let mut headers = vec![
            ("Origin", origin.as_str()),
            ("Content-Type", "application/json"),
        ];
        if let Some(auth) = &auth {
            headers.push(("Authorization", auth.as_str()));
        }
        let reply = client::request(
            self.server.addr().port(),
            "POST",
            "/api/tasks/reminders/mail",
            &headers,
            body,
        )
        .await
        .unwrap();
        (
            reply.status,
            serde_json::from_str(&reply.body).unwrap_or(Value::Null),
        )
    }

    async fn post(&self, body: &Value) -> (u16, Value) {
        self.post_as(Some(&self.token), &body.to_string()).await
    }

    fn sent(&self) -> Vec<Message> {
        self.mail.sent.lock().unwrap().clone()
    }
}

const ALL: [&str; 5] = [
    "alpha.nvim/t1",
    "secret.nvim/s1",
    "alpha.nvim/t2",
    "new.nvim/n1",
    "open.nvim/done1",
];

#[tokio::test(flavor = "multi_thread")]
async fn the_preview_is_the_mail_and_a_private_or_unclassified_task_is_never_in_it() {
    let _one = ONE_AT_A_TIME.lock().await;
    let r = Rig::new("preview", true).await;
    let (status, doc) = r.post(&json!({ "to": "me@example.org", "ids": ALL })).await;
    assert_eq!(status, 200, "{doc}");
    assert_eq!(doc["kind"], "hub.reminders_mail");
    assert_eq!(doc["account"], true);
    assert_eq!(doc["sent"], false);
    assert_eq!(doc["to"], "me@example.org");
    assert_eq!(doc["subject"], "Reminders: 3 tasks");
    assert_eq!(
        doc["included"],
        json!(["open.nvim/done1", "alpha.nvim/t2", "alpha.nvim/t1"])
    );
    assert_eq!(
        doc["left_out"],
        json!([
            { "id": "secret.nvim/s1", "reason": "private" },
            { "id": "new.nvim/n1", "reason": "unclassified" },
        ])
    );
    let text = doc["text"].as_str().unwrap();
    assert!(
        text.contains("2026-11-01 07:15  Finished one  (open.nvim/done1, finished)"),
        "{text}"
    );
    assert!(text.contains("(alpha.nvim/t2)"), "{text}");
    for word in ["secret.nvim", "new.nvim", "Extra"] {
        assert!(!text.contains(word), "{word} is in the mail: {text}");
    }
    // A preview sends nothing.
    assert!(r.sent().is_empty());

    // In German when asked for; a task without a reminder is unknown.
    let (status, doc) = r
        .post(&json!({ "to": "me@example.org", "ids": ["alpha.nvim/t0", "alpha.nvim/t1"], "lang": "de" }))
        .await;
    assert_eq!(status, 200, "{doc}");
    assert_eq!(doc["subject"], "Erinnerung: 1 Task");
    assert_eq!(
        doc["left_out"],
        json!([{ "id": "alpha.nvim/t0", "reason": "unknown" }])
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_send_hands_the_previewed_mail_to_the_transport_and_says_why_it_failed() {
    let _one = ONE_AT_A_TIME.lock().await;
    let r = Rig::new("send", true).await;
    let (_, preview) = r.post(&json!({ "to": "me@example.org", "ids": ALL })).await;
    let body =
        json!({ "to": "me@example.org", "ids": ALL, "send": true, "digest": preview["digest"] });
    let (status, doc) = r.post(&body).await;
    assert_eq!(status, 200, "{doc}");
    assert_eq!(doc["sent"], true);
    let sent = r.sent();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].to, "me@example.org");
    assert_eq!(sent[0].subject, preview["subject"].as_str().unwrap());
    assert_eq!(sent[0].text, preview["text"].as_str().unwrap());
    assert!(!sent[0].text.contains("secret.nvim"));

    // Only tasks that may not go: refused, nothing reaches the transport.
    let none = json!({ "to": "me@example.org", "ids": ["secret.nvim/s1", "new.nvim/n1"] });
    let (_, empty) = r.post(&none).await;
    let (status, doc) = r
        .post(&json!({ "to": "me@example.org", "ids": ["secret.nvim/s1", "new.nvim/n1"], "send": true, "digest": empty["digest"] }))
        .await;
    assert_eq!(status, 400, "{doc}");
    assert_eq!(doc["error"]["code"], "nothing_to_send");
    assert_eq!(r.sent().len(), 1);

    // The transport refuses: its reason, one line, and no second mail.
    *r.mail.refusal.lock().unwrap() = Some("the server refused\r\nthe login".to_owned());
    let (status, doc) = r.post(&body).await;
    assert_eq!(status, 502, "{doc}");
    assert_eq!(doc["error"]["code"], "mail_failed");
    assert_eq!(doc["error"]["message"], "the server refusedthe login");
    assert_eq!(r.sent().len(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn only_the_mail_that_was_shown_is_sent() {
    let _one = ONE_AT_A_TIME.lock().await;
    let r = Rig::new("bound", true).await;
    let (status, shown) = r
        .post(&json!({ "to": "me@example.org", "ids": ["alpha.nvim/t1"] }))
        .await;
    assert_eq!(status, 200, "{shown}");
    let digest = shown["digest"].as_str().unwrap().to_owned();
    assert!(digest.starts_with("sha256:"), "{digest}");
    // The same question has the same digest; another choice, address or language another one.
    let (_, again) = r
        .post(&json!({ "to": "me@example.org", "ids": ["alpha.nvim/t1"] }))
        .await;
    assert_eq!(again["digest"], shown["digest"]);

    for (body, status, code) in [
        // A send says which mail was shown.
        (
            json!({ "to": "me@example.org", "ids": ["alpha.nvim/t1"], "send": true }),
            400,
            "bad_request",
        ),
        // Another choice than the one shown (a box ticked after the preview).
        (
            json!({ "to": "me@example.org", "ids": ["alpha.nvim/t1", "alpha.nvim/t2"], "send": true, "digest": digest }),
            409,
            "mail_changed",
        ),
        // Another address than the one shown.
        (
            json!({ "to": "you@example.org", "ids": ["alpha.nvim/t1"], "send": true, "digest": digest }),
            409,
            "mail_changed",
        ),
        // Another language than the one shown.
        (
            json!({ "to": "me@example.org", "ids": ["alpha.nvim/t1"], "lang": "de", "send": true, "digest": digest }),
            409,
            "mail_changed",
        ),
        (
            json!({ "to": "me@example.org", "ids": ["alpha.nvim/t1"], "send": true, "digest": "sha256:00" }),
            409,
            "mail_changed",
        ),
    ] {
        let (got, doc) = r.post(&body).await;
        assert_eq!(got, status, "{body}: {doc}");
        assert_eq!(doc["error"]["code"], code, "{body}");
        // A refusal tells nothing of the mail it would have been.
        assert!(doc["text"].is_null() && doc["subject"].is_null(), "{doc}");
    }
    assert!(r.sent().is_empty(), "nothing was sent");

    // The mail that was shown goes out, and it is that mail.
    let (status, doc) = r
        .post(&json!({ "to": "me@example.org", "ids": ["alpha.nvim/t1"], "send": true, "digest": digest }))
        .await;
    assert_eq!(status, 200, "{doc}");
    let sent = r.sent();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].text, shown["text"].as_str().unwrap());
    assert_eq!(sent[0].digest(), digest);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_hub_without_a_mail_account_shows_the_mail_and_sends_nothing() {
    let _one = ONE_AT_A_TIME.lock().await;
    let r = Rig::new("no-account", false).await;
    let (status, doc) = r
        .post(&json!({ "to": "me@example.org", "ids": ["alpha.nvim/t1"] }))
        .await;
    assert_eq!(status, 200, "{doc}");
    assert_eq!(doc["account"], false);
    assert_eq!(doc["included"], json!(["alpha.nvim/t1"]));
    let shown = doc["digest"].clone();
    let (status, doc) = r
        .post(&json!({ "to": "me@example.org", "ids": ["alpha.nvim/t1"], "send": true, "digest": shown }))
        .await;
    assert_eq!(status, 409, "{doc}");
    assert_eq!(doc["error"]["code"], "mail_not_set_up");
    assert!(r.sent().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn what_is_not_an_address_a_list_of_ids_or_a_session_is_refused_before_anything_is_sent() {
    let _one = ONE_AT_A_TIME.lock().await;
    let r = Rig::new("refused", true).await;
    for (body, code) in [
        (
            json!({ "to": "me@example.org\r\nBcc: you@example.org", "ids": ["alpha.nvim/t1"], "send": true }),
            "bad_address",
        ),
        (
            json!({ "to": "a@b.de, c@d.de", "ids": ["alpha.nvim/t1"], "send": true }),
            "bad_address",
        ),
        (
            json!({ "to": "me@example.org", "ids": [], "send": true }),
            "bad_request",
        ),
        (
            json!({ "to": "me@example.org", "ids": ["../x"], "send": true }),
            "bad_id",
        ),
        (
            json!({ "to": "me@example.org", "ids": ["alpha.nvim/t1"], "lang": "fr" }),
            "bad_request",
        ),
        (
            json!({ "to": "me@example.org", "ids": ["alpha.nvim/t1"], "from": "x@y.de" }),
            "bad_request",
        ),
        (
            json!({ "to": "me@example.org", "ids": vec!["alpha.nvim/t1"; 101] }),
            "bad_request",
        ),
    ] {
        let (status, doc) = r.post(&body).await;
        assert_eq!(status, 400, "{body}: {doc}");
        assert_eq!(doc["error"]["code"], code, "{body}");
    }
    // Without a session: the credential comes first.
    let body =
        json!({ "to": "me@example.org", "ids": ["alpha.nvim/t1"], "send": true }).to_string();
    let (status, _) = r.post_as(None, &body).await;
    assert_eq!(status, 401);
    let (status, _) = r.post_as(Some("0000"), &body).await;
    assert_eq!(status, 401);
    assert!(r.sent().is_empty());
}
