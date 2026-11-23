//! "Open in DocMap": the page names a task and a number, the engine hands over the body and the refs, the hub reads the
//! places, finds the repo among the tiles of this device and starts docmap-desktop with the folder and `<file>:<lines>`.
//! Here the start is the test seam: the arguments are written to a log.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use appkit_core::authn::{ManualClock, Secret, CODE_BYTES, TOKEN_BYTES};
use hub_testkit::patient;
use hub_testkit::scratch::Scratch;
use serde_json::Value;
use tasks_hub::classes::AreaPolicy;
use tasks_hub::client;
use tasks_hub::config::Env;
use tasks_hub::engine::{CliEngine, CliEngineConfig, Engine};
use tasks_hub::family::{Discovered, FamilyApps};
use tasks_hub::repos::{Repo, ReposFile, Store};
use tasks_hub::server::{
    start_with, Extras, HubStatus, Limits, RunningServer, ServerConfig, WatchConfig,
};
use tasks_hub::store::RefreshOptions;

struct Rig {
    server: RunningServer,
    vault: PathBuf,
    log: PathBuf,
    /// The folder of the repos of this device (`alpha`, `beta`).
    repos: PathBuf,
    token: String,
    _base: Scratch,
}

const BLOCK: &str = r#"## Kontext

```code-ref
{ "schema": "code-ref/1", "repo": "alpha", "file": "lua/a.lua", "lines": [22, 41] }
```

```code-ref
{ "schema": "code-ref/1", "repo": "alpha", "file": "../outside.lua", "lines": [1, 1] }
```
"#;

/// What the hub knows of the family.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Family {
    /// No discovery at all.
    None,
    /// docmap-desktop is there (its start is logged).
    App,
    /// docmap-desktop is not there; the page of a repo is opened in the browser (its opening is logged); the machine
    /// is the one named.
    Page(Option<&'static str>),
}

async fn rig(name: &str, body: &str, refs: &str, discovery: bool) -> Rig {
    rig_with(
        name,
        body,
        refs,
        if discovery { Family::App } else { Family::None },
    )
    .await
}

async fn rig_with(name: &str, body: &str, refs: &str, kind: Family) -> Rig {
    let base = Scratch::new(&format!("docmap-{name}"));
    let vault = base.join("vault");
    let tasks = vault.join("alpha.nvim").join("ROADMAP").join("tasks");
    std::fs::create_dir_all(&tasks).unwrap();
    std::fs::write(tasks.join("t1.md"), "---\ntitle: t1\n---\n").unwrap();
    std::fs::write(vault.join(".fake-n"), "1").unwrap();
    std::fs::write(
        vault.join(".fake-task-file"),
        "alpha.nvim/ROADMAP/tasks/t1.md",
    )
    .unwrap();
    std::fs::write(vault.join(".fake-task-body"), body).unwrap();
    std::fs::write(vault.join(".fake-task-refs"), refs).unwrap();
    // Two repos of this device: alpha holds lua/a.lua, beta holds lua/b.lua.
    let alpha = base.join("repos").join("alpha");
    let beta = base.join("repos").join("beta");
    std::fs::create_dir_all(alpha.join("lua")).unwrap();
    std::fs::create_dir_all(beta.join("lua")).unwrap();
    std::fs::write(alpha.join("lua").join("a.lua"), "x").unwrap();
    std::fs::write(beta.join("lua").join("b.lua"), "x").unwrap();
    std::fs::write(base.join("repos").join("outside.lua"), "x").unwrap();
    let config = base.join("config");
    std::fs::create_dir_all(&config).unwrap();
    let mut file = ReposFile::default();
    file.repos.insert(
        "aaaaaaa1".to_owned(),
        Repo {
            path: alpha,
            name: "alpha".to_owned(),
        },
    );
    file.repos.insert(
        "bbbbbbb1".to_owned(),
        Repo {
            path: beta,
            name: "beta".to_owned(),
        },
    );
    std::fs::write(
        config.join(tasks_hub::repos::FILE),
        tasks_hub::repos::text_of(&file).unwrap(),
    )
    .unwrap();
    let log = base.join("docmap.log");
    let family: Option<Arc<dyn FamilyApps>> = match kind {
        Family::None => None,
        Family::App => Some(Arc::new(Discovered::new(Env::from_pairs([(
            "TASKS_DESKTOP_DOCMAP_LOG",
            log.to_string_lossy().into_owned(),
        )])))),
        Family::Page(machine) => {
            let mut pairs = vec![(
                "TASKS_DESKTOP_DOCMAP_PAGE_LOG".to_owned(),
                log.to_string_lossy().into_owned(),
            )];
            if let Some(role) = machine {
                pairs.push(("NVIM_MACHINE_ROLE".to_owned(), role.to_owned()));
            }
            Some(Arc::new(Discovered::new(Env::from_pairs(pairs))))
        }
    };
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
    let cfg = ServerConfig {
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
        policy: Arc::new(AreaPolicy::default()),
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
    };
    let server = start_with(
        cfg,
        Extras {
            family,
            repos: Some(Arc::new(Store::open(&config))),
            ..Extras::default()
        },
    )
    .await
    .unwrap();
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
    let token = serde_json::from_str::<Value>(&reply.body).unwrap()["token"]
        .as_str()
        .unwrap()
        .to_owned();
    Rig {
        repos: base.join("repos"),
        server,
        vault,
        log,
        token,
        _base: base,
    }
}

async fn call(r: &Rig, method: &str, route: &str, body: &str) -> (u16, Value) {
    let auth = format!("Bearer {}", r.token);
    let origin = format!("http://127.0.0.1:{}", r.server.addr().port());
    let headers = vec![
        ("Content-Type", "application/json"),
        ("Authorization", auth.as_str()),
        ("Origin", origin.as_str()),
    ];
    let reply = patient::request(r.server.addr().port(), method, route, &headers, body)
        .await
        .unwrap();
    (
        reply.status,
        serde_json::from_str(&reply.body).unwrap_or(Value::Null),
    )
}

fn started(r: &Rig) -> Vec<String> {
    std::fs::read_to_string(&r.log)
        .map(|t| t.lines().map(str::to_owned).collect())
        .unwrap_or_default()
}

#[tokio::test]
async fn the_places_of_a_task_are_listed_without_a_path_and_one_is_opened() {
    let r = rig(
        "list",
        BLOCK,
        "lua/b.lua:5-9\nlua/missing.lua:3\nnot a ref\n",
        true,
    )
    .await;
    let (status, doc) = call(&r, "GET", "/api/tasks/docmap?id=alpha.nvim/t1", "").await;
    assert_eq!(status, 200, "{doc}");
    assert_eq!(doc["found"], true, "{doc}");
    let places = doc["places"].as_array().unwrap();
    let labels: Vec<_> = places
        .iter()
        .map(|p| p["label"].as_str().unwrap())
        .collect();
    // The block that leaves the repo is not a place; the refs come after the blocks; a ref no repo holds is listed
    // as not openable.
    assert_eq!(
        labels,
        ["lua/a.lua:22-41", "lua/b.lua:5-9", "lua/missing.lua:3"],
        "{doc}"
    );
    assert_eq!(
        places
            .iter()
            .map(|p| p["ok"].as_bool().unwrap())
            .collect::<Vec<_>>(),
        [true, true, false],
        "{doc}"
    );
    assert_eq!(places[1]["repo"], "beta", "{doc}");
    // Not a path of this machine anywhere in the answer.
    assert!(!doc.to_string().contains("repos"), "{doc}");

    let (status, doc) = call(
        &r,
        "POST",
        "/api/tasks/docmap_open",
        r#"{"id":"alpha.nvim/t1","index":1}"#,
    )
    .await;
    assert_eq!(status, 200, "{doc}");
    let seen = started(&r);
    assert_eq!(seen.len(), 1, "{seen:?}");
    let parts: Vec<_> = seen[0].split('\t').collect();
    assert_eq!(parts[0], "--open-at");
    assert!(parts[1].ends_with("beta"), "{seen:?}");
    assert_eq!(parts[2], "lua/b.lua:5-9");
}

#[tokio::test]
async fn a_place_no_repo_holds_and_a_number_out_of_range_start_nothing() {
    let r = rig("refused", BLOCK, "lua/missing.lua:3\n", true).await;
    for (body, status, code) in [
        (r#"{"id":"alpha.nvim/t1","index":1}"#, 400, "docmap_refused"),
        (r#"{"id":"alpha.nvim/t1","index":7}"#, 404, "not_found"),
        (r#"{"id":"alpha.nvim/t1","index":-1}"#, 400, "bad_index"),
        (r#"{"id":"../x","index":0}"#, 400, "bad_id"),
        (
            r#"{"id":"alpha.nvim/t1","index":0,"file":"/etc/passwd"}"#,
            400,
            "",
        ),
    ] {
        let (s, doc) = call(&r, "POST", "/api/tasks/docmap_open", body).await;
        assert_eq!(s, status, "{body}: {doc}");
        if !code.is_empty() {
            assert_eq!(doc["error"]["code"], code, "{body}: {doc}");
        }
    }
    assert!(started(&r).is_empty(), "something was started");
    let _ = &r.vault;
}

#[tokio::test]
async fn a_task_without_places_lists_none_and_a_hub_without_discovery_finds_no_docmap() {
    let r = rig(
        "none",
        "Just text, `lua/a.lua:3` inline.\n",
        "alpha.nvim/other\n",
        true,
    )
    .await;
    let (_, doc) = call(&r, "GET", "/api/tasks/docmap?id=alpha.nvim/t1", "").await;
    assert_eq!(doc["places"].as_array().map(Vec::len), Some(0), "{doc}");
    let r = rig("nodisc", BLOCK, "", false).await;
    let (status, doc) = call(&r, "GET", "/api/tasks/docmap?id=alpha.nvim/t1", "").await;
    assert_eq!(
        (status, doc["found"].clone()),
        (200, Value::Bool(false)),
        "{doc}"
    );
    let (status, doc) = call(
        &r,
        "POST",
        "/api/tasks/docmap_open",
        r#"{"id":"alpha.nvim/t1","index":0}"#,
    )
    .await;
    assert_eq!(
        (status, doc["error"]["code"].as_str()),
        (404, Some("docmap_unavailable")),
        "{doc}"
    );
}

/// The generated page of `repo` (a tile of the rig) in `out_dir`, and its `.docmap.json` if there is one.
fn write_page(r: &Rig, repo: &str, config: Option<&str>, out_dir: &str) {
    let folder = r.repos.join(repo);
    std::fs::create_dir_all(folder.join(out_dir)).unwrap();
    std::fs::write(folder.join(out_dir).join("index.html"), "<html></html>").unwrap();
    if let Some(config) = config {
        std::fs::write(folder.join(".docmap.json"), config).unwrap();
    }
}

const NODE_BLOCK: &str = r#"```code-ref
{ "schema": "code-ref/1", "repo": "alpha", "file": "lua/a.lua", "lines": [22, 41], "docmap": { "node": "alpha.core x" } }
```

```code-ref
{ "schema": "code-ref/1", "repo": "beta", "file": "lua/b.lua", "lines": [1, 2] }
```
"#;

#[tokio::test]
async fn without_docmap_desktop_the_page_of_the_repo_is_the_way_when_it_is_there() {
    let r = rig_with("page", NODE_BLOCK, "", Family::Page(None)).await;
    // alpha has its page in the default folder, beta has none: only the first is a button, and the answer names the way.
    write_page(&r, "alpha", None, "docs/map");
    let (status, doc) = call(&r, "GET", "/api/tasks/docmap?id=alpha.nvim/t1", "").await;
    assert_eq!(status, 200, "{doc}");
    assert_eq!(doc["found"], false, "docmap-desktop is not there: {doc}");
    let places = doc["places"].as_array().unwrap();
    assert_eq!(places[0]["ok"], true, "{doc}");
    assert_eq!(places[0]["way"], "page", "{doc}");
    assert_eq!(places[1]["ok"], false, "{doc}");
    assert!(places[1].get("way").is_none(), "{doc}");
    // The page sees no path of this machine and no name of the file of the page.
    assert!(!doc.to_string().contains("repos"), "{doc}");
    assert!(!doc.to_string().contains("index.html"), "{doc}");

    // Opening the one with a page: the page of alpha, at the node, nothing else.
    let (status, doc) = call(
        &r,
        "POST",
        "/api/tasks/docmap_open",
        r#"{"id":"alpha.nvim/t1","index":0}"#,
    )
    .await;
    assert_eq!(status, 200, "{doc}");
    let seen = started(&r);
    assert_eq!(seen.len(), 1, "{seen:?}");
    let parts: Vec<_> = seen[0].split('\t').collect();
    assert!(parts[0].ends_with("alpha"), "{seen:?}");
    assert_eq!(
        parts[1..],
        ["docs/map/index.html", "alpha.core x"],
        "{seen:?}"
    );
    // The place without a page is refused, and nothing more is opened.
    let (status, doc) = call(
        &r,
        "POST",
        "/api/tasks/docmap_open",
        r#"{"id":"alpha.nvim/t1","index":1}"#,
    )
    .await;
    assert_eq!(
        (status, doc["error"]["code"].as_str()),
        (502, Some("docmap_failed")),
        "{doc}"
    );
    assert_eq!(started(&r).len(), 1);
}

#[tokio::test]
async fn the_page_is_where_the_docmap_json_of_the_repo_puts_it_and_nowhere_else() {
    let r = rig_with("outdir", NODE_BLOCK, "", Family::Page(None)).await;
    write_page(
        &r,
        "alpha",
        Some(r#"{ "out_dir": "build/site/" }"#),
        "build/site",
    );
    // beta: a page in the default folder, but its config sends the page out of the repo.
    write_page(
        &r,
        "beta",
        Some(r#"{ "out_dir": "../elsewhere" }"#),
        "docs/map",
    );
    let (_, doc) = call(&r, "GET", "/api/tasks/docmap?id=alpha.nvim/t1", "").await;
    let ways: Vec<_> = doc["places"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["way"].as_str().unwrap_or("-").to_owned())
        .collect();
    assert_eq!(ways, ["page", "-"], "{doc}");
    call(
        &r,
        "POST",
        "/api/tasks/docmap_open",
        r#"{"id":"alpha.nvim/t1","index":0}"#,
    )
    .await;
    assert!(
        started(&r)[0].contains("build/site/index.html"),
        "{:?}",
        started(&r)
    );
}

#[tokio::test]
async fn docmap_desktop_wins_over_the_page_and_the_workstation_shows_no_button() {
    // With the app: the way is the app, even where a page exists.
    let r = rig_with("app", NODE_BLOCK, "", Family::App).await;
    write_page(&r, "alpha", None, "docs/map");
    let (_, doc) = call(&r, "GET", "/api/tasks/docmap?id=alpha.nvim/t1", "").await;
    assert_eq!(doc["places"][0]["way"], "app", "{doc}");
    // On the workstation (MASCHINE-04): no page way, no button, and an open is refused.
    let r = rig_with("ws", NODE_BLOCK, "", Family::Page(Some("Workstation"))).await;
    write_page(&r, "alpha", None, "docs/map");
    let (_, doc) = call(&r, "GET", "/api/tasks/docmap?id=alpha.nvim/t1", "").await;
    assert_eq!(doc["places"][0]["ok"], false, "{doc}");
    let (status, _) = call(
        &r,
        "POST",
        "/api/tasks/docmap_open",
        r#"{"id":"alpha.nvim/t1","index":0}"#,
    )
    .await;
    assert_eq!(status, 502);
    assert!(started(&r).is_empty());
}
