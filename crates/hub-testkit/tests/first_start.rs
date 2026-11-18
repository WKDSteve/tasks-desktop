//! The first start in the page: a hub that is not set up shows what is missing, asks for the vault in the folder dialog
//! and for Neovim in the file dialog (here the seams of the dialogs), and offers the installation. The page names no
//! path, a step is only taken while it is what the hub misses, and every route wants the session.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use appkit_core::authn::{ManualClock, Secret, CODE_BYTES, TOKEN_BYTES};
use appkit_hub::setup::InstallOffer;
use hub_testkit::scratch::Scratch;
use serde_json::Value;
use tasks_hub::classes::AreaPolicy;
use tasks_hub::client;
use tasks_hub::config::Env;
use tasks_hub::editor::{FileOpener, HubOpener};
use tasks_hub::firststart::FirstStart;
use tasks_hub::server::{
    start_with, Extras, HubStatus, Limits, RunningServer, ServerConfig, VaultTarget,
};

/// The hub's side of the steps, as a record of what was asked: no settings, no install, no engine.
struct FakeFirstStart {
    calls: Mutex<Vec<String>>,
    offer: InstallOffer,
    /// The program the file dialog "returns" (`None`: closed).
    program: Option<PathBuf>,
    /// The example vault of the engine (`None`: this hub has none).
    example: Option<PathBuf>,
    /// How many of the next `set_vault` are refused.
    refuse_vault: Mutex<usize>,
}

fn status(problem: Option<&'static str>) -> HubStatus {
    HubStatus {
        engine_ready: false,
        problem,
        capabilities: Vec::new(),
    }
}

fn target(problem: Option<&'static str>) -> VaultTarget {
    VaultTarget {
        engine: None,
        status: status(problem),
        vault: None,
        policy: None,
    }
}

impl FirstStart for FakeFirstStart {
    fn install_offer(&self) -> Result<InstallOffer, String> {
        Ok(self.offer)
    }

    fn can_pick_program(&self) -> bool {
        true
    }

    fn pick_program(&self) -> Result<Option<PathBuf>, String> {
        self.calls.lock().unwrap().push("pick program".to_owned());
        Ok(self.program.clone())
    }

    fn set_nvim(&self, nvim: PathBuf) -> appkit_hub::BoxFuture<'_, Result<VaultTarget, String>> {
        self.calls
            .lock()
            .unwrap()
            .push(format!("nvim {}", nvim.display()));
        Box::pin(async { Ok(target(None)) })
    }

    fn set_vault(&self, folder: PathBuf) -> appkit_hub::BoxFuture<'_, Result<VaultTarget, String>> {
        self.calls
            .lock()
            .unwrap()
            .push(format!("vault {}", folder.display()));
        let mut refuse = self.refuse_vault.lock().unwrap();
        if *refuse > 0 {
            *refuse -= 1;
            return Box::pin(async { Err("the engine did not start on it".to_owned()) });
        }
        drop(refuse);
        // The vault is there now; Neovim is what is missing next.
        Box::pin(async { Ok(target(Some("nvim_not_found"))) })
    }

    fn install(&self, autostart: bool, shortcut: bool) -> Result<(), String> {
        self.calls
            .lock()
            .unwrap()
            .push(format!("install autostart={autostart} shortcut={shortcut}"));
        Ok(())
    }

    fn example_vault(&self) -> Option<PathBuf> {
        self.example.clone()
    }

    fn decline_install(&self) -> Result<(), String> {
        self.calls.lock().unwrap().push("decline".to_owned());
        Ok(())
    }
}

struct Rig {
    server: RunningServer,
    first: Arc<FakeFirstStart>,
    log: PathBuf,
    folder: PathBuf,
    token: String,
    _base: Scratch,
}

/// A hub whose engine stops at `problem`. `pick`: what the folder dialog "returns" (`Some("")`: closed; `None`: the
/// vault folder the rig made).
async fn rig(
    name: &str,
    problem: Option<&'static str>,
    pick: Option<&str>,
    offer: InstallOffer,
) -> Rig {
    let base = Scratch::new(&format!("first-start-{name}"));
    let folder = base.join("my vault");
    std::fs::create_dir_all(&folder).unwrap();
    let log = base.join("dialogs.log");
    let pick = pick.map_or_else(|| folder.to_string_lossy().into_owned(), str::to_owned);
    let opener = Arc::new(HubOpener::new(
        None,
        Env::from_pairs([
            (
                "TASKS_DESKTOP_EDITOR_LOG",
                log.to_string_lossy().into_owned(),
            ),
            ("TASKS_DESKTOP_PICK_RESULT", pick),
        ]),
    ));
    // The example vault the engine brings (a rig named `...-no-example` has none).
    let example = base.join("engine").join("examples").join("vault");
    for (file, text) in [
        ("tasks-vault.json", "{}"),
        (
            "demo.nvim/ROADMAP/tasks/first.md",
            "---\ntitle: First\n---\n",
        ),
        ("docs/ROADMAP/tasks/readme.md", "---\ntitle: Readme\n---\n"),
    ] {
        let at = example.join(file);
        std::fs::create_dir_all(at.parent().unwrap()).unwrap();
        std::fs::write(at, text).unwrap();
    }
    let first = Arc::new(FakeFirstStart {
        calls: Mutex::new(Vec::new()),
        offer,
        program: Some(base.join("nvim").join("nvim.exe")),
        example: (!name.ends_with("no-example")).then_some(example),
        refuse_vault: Mutex::new(0),
    });
    let control = Secret::generate(TOKEN_BYTES).unwrap();
    let cfg = ServerConfig {
        devices: None,
        addr: "127.0.0.1:0".parse().unwrap(),
        limits: Limits::default(),
        clock: Arc::new(ManualClock::new()),
        pairing_ttl: Duration::from_secs(60),
        control_secret: control.clone(),
        instance: Secret::generate(CODE_BYTES).unwrap(),
        status: status(problem),
        engine: None,
        policy: Arc::new(AreaPolicy::default()),
        usage: None,
        ui: tasks_hub::ui::UiFiles::none(),
        watch: None,
    };
    let server = start_with(
        cfg,
        Extras {
            opener: Some(opener as Arc<dyn FileOpener>),
            first_start: Some(Arc::clone(&first) as Arc<dyn FirstStart>),
            ..Extras::default()
        },
    )
    .await
    .unwrap();
    let token = pair(&server, &control).await;
    Rig {
        server,
        first,
        log,
        folder,
        token,
        _base: base,
    }
}

async fn pair(server: &RunningServer, control: &Secret) -> String {
    let port = server.addr().port();
    let auth = format!("Bearer {}", control.to_hex());
    let reply = client::request(
        port,
        "POST",
        "/api/control/pair",
        &[
            ("Content-Type", "application/json"),
            ("Authorization", &auth),
        ],
        "{}",
    )
    .await
    .unwrap();
    let code = serde_json::from_str::<Value>(&reply.body).unwrap()["code"]
        .as_str()
        .unwrap()
        .to_owned();
    let origin = format!("http://127.0.0.1:{port}");
    let reply = client::request(
        port,
        "POST",
        "/auth/exchange",
        &[("Content-Type", "application/json"), ("Origin", &origin)],
        &format!(r#"{{"code":"{code}"}}"#),
    )
    .await
    .unwrap();
    serde_json::from_str::<Value>(&reply.body).unwrap()["token"]
        .as_str()
        .unwrap()
        .to_owned()
}

async fn call(r: &Rig, method: &str, route: &str, body: &str, session: bool) -> (u16, Value) {
    let auth = format!("Bearer {}", r.token);
    let origin = format!("http://127.0.0.1:{}", r.server.addr().port());
    let mut headers: Vec<(&str, &str)> = vec![("Origin", &origin)];
    if method == "POST" {
        headers.push(("Content-Type", "application/json"));
    }
    if session {
        headers.push(("Authorization", &auth));
    }
    let reply = client::request(r.server.addr().port(), method, route, &headers, body)
        .await
        .unwrap();
    (
        reply.status,
        serde_json::from_str(&reply.body).unwrap_or(Value::Null),
    )
}

async fn post(r: &Rig, route: &str, body: &str) -> (u16, Value) {
    call(r, "POST", route, body, true).await
}

fn calls(r: &Rig) -> Vec<String> {
    r.first.calls.lock().unwrap().clone()
}

fn dialogs(r: &Rig) -> Vec<String> {
    std::fs::read_to_string(&r.log)
        .map(|t| t.lines().map(str::to_owned).collect())
        .unwrap_or_default()
}

async fn hello_problem(r: &Rig) -> Value {
    let (_, doc) = call(r, "GET", "/api/tasks/setup", "", true).await;
    doc["problem"].clone()
}

#[tokio::test]
async fn a_hub_without_a_vault_says_what_is_missing_and_what_it_offers() {
    let r = rig("state", Some("no_vault"), None, InstallOffer::Install).await;
    let (status, doc) = call(&r, "GET", "/api/tasks/setup", "", true).await;
    assert_eq!(status, 200, "{doc}");
    assert_eq!(doc["problem"], "no_vault");
    assert_eq!(doc["install"], "install");
    assert_eq!(doc["pick_program"], true);
    // The session comes first, for every route of the first start.
    assert_eq!(call(&r, "GET", "/api/tasks/setup", "", false).await.0, 401);
    // What "Open the example vault" would copy is said before anything is written: its areas and its size, no path.
    assert_eq!(
        doc["example"],
        serde_json::json!({ "areas": ["demo.nvim", "docs"], "files": 3 })
    );
    for route in [
        "setup_vault",
        "setup_example",
        "setup_nvim",
        "setup_install",
    ] {
        let (status, _) = call(&r, "POST", &format!("/api/tasks/{route}"), "{}", false).await;
        assert_eq!(status, 401, "{route}");
    }
    assert!(calls(&r).is_empty() && dialogs(&r).is_empty());
}

#[tokio::test]
async fn the_vault_is_chosen_in_the_dialog_checked_and_kept_and_the_next_step_is_told() {
    let r = rig("vault", Some("no_vault"), None, InstallOffer::Install).await;
    // The page names no folder.
    let (status, _) = post(&r, "/api/tasks/setup_vault", r#"{"path":"C:/Windows"}"#).await;
    assert_eq!(status, 400);
    assert!(dialogs(&r).is_empty(), "a refused request showed no dialog");

    let (status, doc) = post(&r, "/api/tasks/setup_vault", "{}").await;
    assert_eq!(status, 200, "{doc}");
    assert_eq!(doc["chosen"], true);
    assert_eq!(doc["problem"], "nvim_not_found");
    assert_eq!(dialogs(&r), ["pick"]);
    assert_eq!(calls(&r), [format!("vault {}", r.folder.display())]);
    // The hub reads what the step left: Neovim is missing now, so the vault step is closed.
    assert_eq!(hello_problem(&r).await, "nvim_not_found");
    let (status, _) = post(&r, "/api/tasks/setup_vault", "{}").await;
    assert_eq!(status, 409);
    assert_eq!(dialogs(&r).len(), 1, "no dialog when the step is not open");
}

#[tokio::test]
async fn a_closed_dialog_or_a_folder_that_is_not_one_keeps_nothing() {
    let closed = rig("closed", Some("no_vault"), Some(""), InstallOffer::Install).await;
    let (status, doc) = post(&closed, "/api/tasks/setup_vault", "{}").await;
    assert_eq!(
        (status, &doc["chosen"]),
        (200, &Value::Bool(false)),
        "{doc}"
    );
    assert!(calls(&closed).is_empty());

    let gone = rig(
        "gone",
        Some("vault_not_a_directory"),
        Some("Z:/no/such/folder/here"),
        InstallOffer::Install,
    )
    .await;
    let (status, doc) = post(&gone, "/api/tasks/setup_vault", "{}").await;
    assert_eq!(status, 400, "{doc}");
    assert_eq!(doc["error"]["code"], "vault_refused");
    // The answer names no path.
    assert!(!doc.to_string().contains("no/such"), "{doc}");
    assert!(calls(&gone).is_empty());

    let share = format!("{0}{0}no-such-host{0}share", '\\');
    let remote = rig(
        "remote",
        Some("no_vault"),
        Some(&share),
        InstallOffer::Install,
    )
    .await;
    let (status, doc) = post(&remote, "/api/tasks/setup_vault", "{}").await;
    assert_eq!(status, 400, "{doc}");
    assert!(calls(&remote).is_empty());
}

#[tokio::test]
async fn a_hub_that_is_set_up_takes_no_vault_and_no_neovim_from_the_page() {
    let r = rig("set-up", None, None, InstallOffer::Installed).await;
    assert_eq!(post(&r, "/api/tasks/setup_vault", "{}").await.0, 409);
    assert_eq!(post(&r, "/api/tasks/setup_nvim", "{}").await.0, 409);
    assert!(dialogs(&r).is_empty() && calls(&r).is_empty());
}

#[tokio::test]
async fn neovim_is_chosen_in_the_file_dialog_only_while_it_is_missing() {
    let early = rig("nvim-early", Some("no_vault"), None, InstallOffer::Install).await;
    assert_eq!(post(&early, "/api/tasks/setup_nvim", "{}").await.0, 409);
    assert!(calls(&early).is_empty());

    for problem in ["nvim_not_found", "nvim_too_old", "nvim_probe_failed"] {
        let r = rig(
            &format!("nvim-{problem}"),
            Some(problem),
            None,
            InstallOffer::Install,
        )
        .await;
        assert_eq!(
            post(&r, "/api/tasks/setup_nvim", r#"{"path":"x"}"#).await.0,
            400
        );
        let (status, doc) = post(&r, "/api/tasks/setup_nvim", "{}").await;
        assert_eq!(status, 200, "{problem}: {doc}");
        assert_eq!(doc["problem"], Value::Null);
        let program = r.first.program.clone().unwrap();
        assert_eq!(
            calls(&r),
            [
                "pick program".to_owned(),
                format!("nvim {}", program.display())
            ],
            "{problem}"
        );
        assert_eq!(hello_problem(&r).await, Value::Null);
    }
}

#[tokio::test]
async fn the_installation_is_started_or_declined_as_the_page_says() {
    let r = rig("install", Some("no_vault"), None, InstallOffer::Install).await;
    let (status, _) = post(&r, "/api/tasks/setup_install", r#"{"autostart":"yes"}"#).await;
    assert_eq!(status, 400);
    let (status, _) = post(
        &r,
        "/api/tasks/setup_install",
        r#"{"decline":true,"shortcut":true}"#,
    )
    .await;
    assert_eq!(status, 400);
    assert!(calls(&r).is_empty());

    let (status, _) = post(
        &r,
        "/api/tasks/setup_install",
        r#"{"autostart":true,"shortcut":false}"#,
    )
    .await;
    assert_eq!(status, 202);
    let (status, _) = post(&r, "/api/tasks/setup_install", r#"{"decline":true}"#).await;
    assert_eq!(status, 200);
    assert_eq!(
        calls(&r),
        ["install autostart=true shortcut=false", "decline"]
    );

    let installed = rig("installed", None, None, InstallOffer::Installed).await;
    assert_eq!(
        post(&installed, "/api/tasks/setup_install", "{}").await.0,
        409
    );
    assert!(calls(&installed).is_empty());
}

#[tokio::test]
async fn the_example_vault_is_copied_into_the_chosen_empty_folder_and_kept_as_the_vault() {
    let r = rig("example", Some("no_vault"), None, InstallOffer::Install).await;
    // The page names no folder.
    let (status, _) = post(&r, "/api/tasks/setup_example", r#"{"path":"C:/Windows"}"#).await;
    assert_eq!(status, 400);
    assert!(dialogs(&r).is_empty(), "a refused request showed no dialog");
    assert!(std::fs::read_dir(&r.folder).unwrap().next().is_none());

    let (status, doc) = post(&r, "/api/tasks/setup_example", "{}").await;
    assert_eq!(status, 200, "{doc}");
    assert_eq!(doc["chosen"], true);
    assert_eq!(dialogs(&r), ["pick"]);
    // The copy is the vault: the folder the person chose, never the folder of the engine.
    assert_eq!(calls(&r), [format!("vault {}", r.folder.display())]);
    assert!(r.folder.join("tasks-vault.json").is_file());
    assert_eq!(
        std::fs::read_to_string(r.folder.join("demo.nvim/ROADMAP/tasks/first.md")).unwrap(),
        "---\ntitle: First\n---\n"
    );
    // The step is closed now: no second dialog, nothing copied again.
    assert_eq!(post(&r, "/api/tasks/setup_example", "{}").await.0, 409);
    assert_eq!(dialogs(&r).len(), 1);
}

#[tokio::test]
async fn a_copy_the_hub_does_not_take_as_its_vault_goes_again() {
    let r = rig(
        "example-refused",
        Some("no_vault"),
        None,
        InstallOffer::Install,
    )
    .await;
    *r.first.refuse_vault.lock().unwrap() = 1;
    let (status, doc) = post(&r, "/api/tasks/setup_example", "{}").await;
    assert_eq!(
        (status, doc["error"]["code"].as_str()),
        (400, Some("vault_refused")),
        "{doc}"
    );
    assert!(
        std::fs::read_dir(&r.folder).unwrap().next().is_none(),
        "the copy was taken back"
    );
    // The same folder, chosen again, is taken.
    let (status, doc) = post(&r, "/api/tasks/setup_example", "{}").await;
    assert_eq!(status, 200, "{doc}");
    assert!(r.folder.join("tasks-vault.json").is_file());
}

#[tokio::test]
async fn the_example_is_never_copied_over_something_and_a_closed_dialog_writes_nothing() {
    // The folder the dialog returns holds a file of the person.
    let used = rig(
        "example-used",
        Some("no_vault"),
        None,
        InstallOffer::Install,
    )
    .await;
    std::fs::write(used.folder.join("mine.txt"), "mine").unwrap();
    let (status, doc) = post(&used, "/api/tasks/setup_example", "{}").await;
    assert_eq!(
        (status, doc["error"]["code"].as_str()),
        (400, Some("not_empty")),
        "{doc}"
    );
    let whole = used.folder.to_string_lossy().into_owned();
    assert!(
        !doc.to_string().contains(&whole),
        "no path in a refusal: {doc}"
    );
    assert_eq!(
        std::fs::read_dir(&used.folder).unwrap().count(),
        1,
        "nothing was copied beside the file"
    );
    assert!(
        calls(&used).is_empty(),
        "the folder was not kept as the vault"
    );
    assert_eq!(hello_problem(&used).await, "no_vault");

    // The dialog was closed.
    let closed = rig(
        "example-closed",
        Some("no_vault"),
        Some(""),
        InstallOffer::Install,
    )
    .await;
    let (status, doc) = post(&closed, "/api/tasks/setup_example", "{}").await;
    assert_eq!(
        (status, doc["chosen"].as_bool()),
        (200, Some(false)),
        "{doc}"
    );
    assert!(calls(&closed).is_empty());

    // A hub that has no example offers none and shows no dialog for it.
    let none = rig(
        "example-no-example",
        Some("no_vault"),
        None,
        InstallOffer::Install,
    )
    .await;
    let (_, state) = call(&none, "GET", "/api/tasks/setup", "", true).await;
    assert!(state["example"].is_null(), "{state}");
    let (status, doc) = post(&none, "/api/tasks/setup_example", "{}").await;
    assert_eq!(
        (status, doc["error"]["code"].as_str()),
        (404, Some("no_example")),
        "{doc}"
    );
    assert!(dialogs(&none).is_empty());

    // A hub that is set up does not open an example over its vault.
    let ready = rig("example-ready", None, None, InstallOffer::Installed).await;
    assert_eq!(post(&ready, "/api/tasks/setup_example", "{}").await.0, 409);
    assert!(dialogs(&ready).is_empty());
}
