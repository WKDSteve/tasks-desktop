//! The routes of the repo tiles over a real hub: the document, a group and a tile, the image of a tile with its policy,
//! the folders that are refused (never named in the answer), and a save on a state that is gone.

use std::sync::Arc;
use std::time::Duration;

use appkit_core::authn::{ManualClock, Secret, CODE_BYTES, TOKEN_BYTES};
use hub_testkit::scratch::Scratch;
use serde_json::{json, Value};
use tasks_hub::classes::AreaPolicy;
use tasks_hub::client;
use tasks_hub::repos::Store;
use tasks_hub::server::{start_with, Extras, HubStatus, Limits, RunningServer, ServerConfig};

struct Rig {
    server: RunningServer,
    token: String,
    _config: Scratch,
}

async fn rig(name: &str) -> Rig {
    let config = Scratch::new(&format!("repos-route-{name}"));
    let control = Secret::generate(TOKEN_BYTES).unwrap();
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
        server,
        token,
        _config: config,
    }
}

async fn get(r: &Rig, path: &str) -> client::Reply {
    let auth = format!("Bearer {}", r.token);
    client::request(
        r.server.addr().port(),
        "GET",
        path,
        &[("Authorization", &auth)],
        "",
    )
    .await
    .unwrap()
}

async fn post(r: &Rig, path: &str, body: &Value) -> (u16, Value, String) {
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
    (
        reply.status,
        serde_json::from_str(&reply.body).unwrap_or(Value::Null),
        reply.body,
    )
}

const SVG: &str = r#"<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>"#;

#[tokio::test]
async fn a_group_and_a_tile_are_made_and_the_image_comes_with_a_policy_that_runs_nothing() {
    let r = rig("tile").await;
    let repo = Scratch::new("repos-route-repo");
    std::fs::write(repo.join("logo.svg"), SVG).unwrap();

    let first = get(&r, "/api/tasks/repos").await;
    assert_eq!(first.status, 200);
    let doc: Value = serde_json::from_str(&first.body).unwrap();
    assert_eq!(doc["kind"], "hub.repos");
    assert_eq!(doc["groups"], json!([]));

    let (status, doc, _) = post(&r, "/api/tasks/repos/save", &json!({
        "rev": doc["rev"], "groups": [{ "id": "gggg0001", "title": "UI", "tiles": [] }], "names": {}
    }))
    .await;
    assert_eq!(status, 200, "{doc}");
    let path = repo.to_string_lossy().into_owned();
    let (status, doc, body) = post(
        &r,
        "/api/tasks/repos/add",
        &json!({ "path": path, "group": "gggg0001" }),
    )
    .await;
    assert_eq!(status, 200, "{doc}");
    assert!(
        !body.contains(&path) && !body.contains(&path.replace('\\', "\\\\")),
        "the path is never sent back: {body}"
    );
    let (id, tile) = doc["repos"]
        .as_object()
        .unwrap()
        .iter()
        .next()
        .map(|(k, v)| (k.clone(), v.clone()))
        .unwrap();
    assert_eq!(tile["image"], true);
    assert_eq!(
        tile["label"],
        json!(repo.file_name().unwrap().to_string_lossy())
    );
    assert_eq!(doc["groups"][0]["tiles"], json!([id]));

    let image = get(&r, &format!("/api/tasks/repos/image?id={id}")).await;
    assert_eq!(image.status, 200);
    assert_eq!(image.header("content-type"), Some("image/svg+xml"));
    assert_eq!(image.header("x-content-type-options"), Some("nosniff"));
    assert!(image
        .header("content-security-policy")
        .unwrap()
        .contains("sandbox"));
    assert_eq!(image.body, SVG);
    assert_eq!(
        get(&r, "/api/tasks/repos/image?id=nothere1").await.status,
        404
    );
    assert_eq!(get(&r, "/api/tasks/repos/image?id=../x").await.status, 400);
}

#[tokio::test]
async fn a_folder_that_is_not_one_is_refused_without_its_path_and_an_old_state_is_a_409_with_the_new_one(
) {
    let r = rig("refused").await;
    let doc: Value = serde_json::from_str(&get(&r, "/api/tasks/repos").await.body).unwrap();
    let old = doc["rev"].clone();
    let (status, _, _) = post(
        &r,
        "/api/tasks/repos/save",
        &json!({
            "rev": old, "groups": [{ "id": "gggg0001", "title": "UI", "tiles": [] }], "names": {}
        }),
    )
    .await;
    assert_eq!(status, 200);
    for path in [
        r"\\host\share\repo",
        "relative/repo",
        "C:/no/such/folder/at/all",
    ] {
        let (status, doc, body) = post(
            &r,
            "/api/tasks/repos/add",
            &json!({ "path": path, "group": "gggg0001" }),
        )
        .await;
        assert_eq!(status, 400, "{path}: {doc}");
        assert!(
            !body.contains("host") && !body.contains("relative") && !body.contains("no/such"),
            "{body}"
        );
    }
    let (status, doc, _) = post(
        &r,
        "/api/tasks/repos/save",
        &json!({ "rev": old, "groups": [], "names": {} }),
    )
    .await;
    assert_eq!(status, 409);
    assert_eq!(doc["error"]["code"], "stale");
    assert_eq!(doc["document"]["groups"][0]["title"], "UI");
    // A field the route does not take, and a group that names a repo that is not there.
    let rev = doc["document"]["rev"].clone();
    assert_eq!(
        post(
            &r,
            "/api/tasks/repos/save",
            &json!({ "rev": rev, "groups": [], "path": "x" })
        )
        .await
        .0,
        400
    );
    let (status, _, _) = post(&r, "/api/tasks/repos/save", &json!({
        "rev": rev, "groups": [{ "id": "gggg0001", "title": "UI", "tiles": ["zzzz9999"] }], "names": {}
    }))
    .await;
    assert_eq!(status, 400);
}
