//! The state of a repo of the tiles over a real hub, with a `git` and a `gh` that only answer: the route tells the
//! checkout and the CI of the tile asked for, in the folder of that tile, names no folder, and refuses what is no
//! tile, no session or a hub that looks at no repos.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use appkit_core::authn::{ManualClock, Secret, CODE_BYTES, TOKEN_BYTES};
use hub_testkit::scratch::Scratch;
use serde_json::{json, Value};
use tasks_hub::classes::AreaPolicy;
use tasks_hub::client;
use tasks_hub::repos::status::{Said, Silent, Status, Tool, Tools};
use tasks_hub::repos::Store;
use tasks_hub::server::{
    start_with, BoxFuture, Extras, HubStatus, Limits, RunningServer, ServerConfig,
};

/// A `git` that says "one file changed, one commit ahead" and a `gh` whose newest pushed commit waits for approval;
/// both write down the folder they were asked in.
#[derive(Default)]
struct Answering {
    asked: Mutex<Vec<(Tool, PathBuf)>>,
}

impl Tools for Answering {
    fn ask<'a>(
        &'a self,
        tool: Tool,
        args: &'a [&'a str],
        cwd: &'a Path,
    ) -> BoxFuture<'a, Result<Said, Silent>> {
        Box::pin(async move {
            self.asked.lock().unwrap().push((tool, cwd.to_path_buf()));
            let stdout = match (tool, args.get(1).copied()) {
                (Tool::Git, _) => "## main...origin/main [ahead 1]\n M a.rs\n",
                (Tool::Gh, Some("list")) => {
                    r#"[{"databaseId":5,"status":"completed","conclusion":"failure","headSha":"abc1234","url":"https://github.com/o/streamtap/actions/runs/5"}]"#
                }
                (Tool::Gh, _) => {
                    r#"{"jobs":[{"conclusion":"failure","steps":[{"name":"Set up runner","conclusion":"failure"}]}]}"#
                }
            };
            Ok(Said {
                code: Some(0),
                stdout: stdout.to_owned(),
                stderr: String::new(),
            })
        })
    }
}

struct Rig {
    server: RunningServer,
    token: String,
    tools: Arc<Answering>,
    _config: Scratch,
}

async fn rig(name: &str, looks: bool) -> Rig {
    let config = Scratch::new(&format!("repo-status-{name}"));
    let control = Secret::generate(TOKEN_BYTES).unwrap();
    let tools = Arc::new(Answering::default());
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
            repos: Some(Arc::new(Store::open(&config))),
            repo_status: looks.then(|| Arc::new(Status::new(Arc::clone(&tools) as Arc<dyn Tools>))),
            ..Extras::default()
        },
    )
    .await
    .unwrap();
    let port = server.addr().port();
    let origin = format!("http://127.0.0.1:{port}");
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
        server,
        token,
        tools,
        _config: config,
    }
}

async fn get_as(r: &Rig, token: Option<&str>, path: &str) -> (u16, Value, String) {
    let auth = token.map(|t| format!("Bearer {t}"));
    let headers: Vec<(&str, &str)> = auth
        .as_deref()
        .map(|a| vec![("Authorization", a)])
        .unwrap_or_default();
    let reply = client::request(r.server.addr().port(), "GET", path, &headers, "")
        .await
        .unwrap();
    (
        reply.status,
        serde_json::from_str(&reply.body).unwrap_or(Value::Null),
        reply.body,
    )
}

async fn get(r: &Rig, path: &str) -> (u16, Value, String) {
    get_as(r, Some(&r.token), path).await
}

async fn post(r: &Rig, path: &str, body: &Value) -> Value {
    let auth = format!("Bearer {}", r.token);
    let origin = format!("http://127.0.0.1:{}", r.server.addr().port());
    let reply = client::request(
        r.server.addr().port(),
        "POST",
        path,
        &[
            ("Content-Type", "application/json"),
            ("Origin", &origin),
            ("Authorization", &auth),
        ],
        &body.to_string(),
    )
    .await
    .unwrap();
    assert_eq!(reply.status, 200, "{}", reply.body);
    serde_json::from_str(&reply.body).unwrap()
}

/// A tile for `folder`; its id.
async fn tile(r: &Rig, folder: &Path) -> String {
    let (_, doc, _) = get(r, "/api/tasks/repos").await;
    post(
        r,
        "/api/tasks/repos/save",
        &json!({ "rev": doc["rev"], "groups": [{ "id": "gggg0001", "title": "UI", "tiles": [] }], "names": {} }),
    )
    .await;
    let doc = post(
        r,
        "/api/tasks/repos/add",
        &json!({ "path": folder.to_string_lossy(), "group": "gggg0001" }),
    )
    .await;
    doc["repos"]
        .as_object()
        .unwrap()
        .keys()
        .next()
        .unwrap()
        .clone()
}

#[tokio::test]
async fn the_state_of_a_tile_is_asked_in_its_folder_and_names_no_folder() {
    let r = rig("state", true).await;
    let repo = Scratch::new("repo-status-repo");
    let id = tile(&r, &repo).await;

    let (status, doc, body) = get(&r, &format!("/api/tasks/repos/status?id={id}")).await;
    assert_eq!(status, 200, "{doc}");
    assert_eq!(
        doc,
        json!({
            "kind": "hub.repo_status",
            "id": id,
            "local": { "state": "dirty", "branch": "main", "changed": 1, "ahead": 1, "behind": 0, "gone": false },
            "ci": {
                "state": "approval",
                "url": "https://github.com/o/streamtap/actions/runs/5",
                "sha": "abc1234",
                "trust": "testing ci trust o/streamtap abc1234",
            },
        })
    );
    let folder = repo.to_string_lossy().into_owned();
    assert!(
        !body.contains(&folder) && !body.contains(&folder.replace('\\', "\\\\")),
        "the folder is never sent: {body}"
    );
    // git, the list of gh, and the jobs of the failed run: each in the folder of the tile.
    let asked = r.tools.asked.lock().unwrap().clone();
    assert_eq!(
        asked.iter().map(|(tool, _)| *tool).collect::<Vec<_>>(),
        [Tool::Git, Tool::Gh, Tool::Gh]
    );
    assert!(asked.iter().all(|(_, cwd)| cwd == &*repo), "{asked:?}");

    // Asked again at once: the hub holds both answers, nothing is started.
    let (status, again, _) = get(&r, &format!("/api/tasks/repos/status?id={id}")).await;
    assert_eq!(status, 200);
    assert_eq!(again, doc);
    assert_eq!(r.tools.asked.lock().unwrap().len(), 3);
    // A fresh look asks git again, and gh not before its answer is some seconds old.
    let (status, _, _) = get(&r, &format!("/api/tasks/repos/status?id={id}&fresh=1")).await;
    assert_eq!(status, 200);
    let asked = r.tools.asked.lock().unwrap().clone();
    assert_eq!(asked.len(), 4);
    assert_eq!(asked[3].0, Tool::Git);
}

#[tokio::test]
async fn what_is_no_tile_no_session_or_no_such_hub_is_refused_and_nothing_is_started() {
    let r = rig("refused", true).await;
    let repo = Scratch::new("repo-status-refused");
    let id = tile(&r, &repo).await;
    for (path, status, code) in [
        ("/api/tasks/repos/status", 400, "bad_id"),
        // The query takes plain values only: an encoded one is refused before it is read as an id.
        ("/api/tasks/repos/status?id=..%2F..%2Fx", 400, "bad_request"),
        ("/api/tasks/repos/status?id=UPPER123", 400, "bad_id"),
        ("/api/tasks/repos/status?id=zzzzzzzz", 404, "not_found"),
        (
            "/api/tasks/repos/status?id=zzzzzzzz&path=C:%5C",
            400,
            "bad_request",
        ),
    ] {
        let (got, doc, _) = get(&r, path).await;
        assert_eq!(got, status, "{path}: {doc}");
        assert_eq!(doc["error"]["code"], code, "{path}");
    }
    let (got, doc, _) = get(&r, &format!("/api/tasks/repos/status?id={id}&fresh=yes")).await;
    assert_eq!(got, 400, "{doc}");
    // Without a session: the credential comes first.
    let (got, _, _) = get_as(&r, None, &format!("/api/tasks/repos/status?id={id}")).await;
    assert_eq!(got, 401);
    let (got, _, _) = get_as(
        &r,
        Some("0000"),
        &format!("/api/tasks/repos/status?id={id}"),
    )
    .await;
    assert_eq!(got, 401);
    assert!(r.tools.asked.lock().unwrap().is_empty());

    // A hub that looks at no repos says so.
    let none = rig("none", false).await;
    let repo = Scratch::new("repo-status-none");
    let id = tile(&none, &repo).await;
    let (got, doc, _) = get(&none, &format!("/api/tasks/repos/status?id={id}")).await;
    assert_eq!(got, 404, "{doc}");
    assert_eq!(doc["error"]["code"], "repos_unavailable");
}
