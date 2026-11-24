//! The image files of a container (`asset`) against the real engine, over a copy of the fixture vault: a task, a plan,
//! a learning path and a meeting in their folder form hand on the images below their `assets/`, sealed, and nothing
//! else: not a file outside `assets/`, not a link out of it, not a container without a folder, not a phone.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use appkit_core::authn::{ManualClock, Secret, CODE_BYTES, TOKEN_BYTES};
use hub_testkit::engine_home::engine_env;
use hub_testkit::patient;
use hub_testkit::scratch::Scratch;
use serde_json::{json, Value};
use tasks_hub::classes::{AreaPolicy, Class, Entry};
use tasks_hub::config::{Env, FileConfig, TasksSettings};
use tasks_hub::discovery::{discover, SetupProblem};
use tasks_hub::engine::{probe, CliEngine, Engine};
use tasks_hub::server::{start_with, Extras, HubStatus, Limits, ServerConfig, WatchConfig};
use tasks_hub::store::RefreshOptions;

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), target).unwrap();
        }
    }
}

fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("e2e")
        .join("fixture")
        .join("vault")
}

async fn engine(vault: &Path, home: &Scratch) -> Option<Arc<dyn Engine>> {
    let file = FileConfig {
        vault: Some(vault.to_path_buf()),
        app: TasksSettings {
            extra_areas: ["ALL", "nvim-config"]
                .iter()
                .map(|s| (*s).to_owned())
                .collect(),
            ..TasksSettings::default()
        },
        ..FileConfig::default()
    };
    let setup = match discover(&file, &Env::from_process()).await {
        Ok(s) => s,
        Err(
            p @ (SetupProblem::NvimNotFound { .. }
            | SetupProblem::NvimTooOld { .. }
            | SetupProblem::NvimProbeFailed(_)
            | SetupProblem::EngineNotFound { .. }
            | SetupProblem::LibNotFound { .. }),
        ) => {
            assert!(
                std::env::var_os("TASKS_DESKTOP_REQUIRE_ENGINE").is_none(),
                "the engine is required but not usable: {p}"
            );
            eprintln!("skipped: {p}");
            return None;
        }
        Err(other) => panic!("{other}"),
    };
    let engine = CliEngine::new(tasks_hub::engine::cli_config_from_setup(
        &setup,
        engine_env(home),
    ));
    let info = probe(&engine).await.expect("the engine answers hello");
    if !info.capabilities.iter().any(|c| c == "meeting_ops") {
        assert!(
            std::env::var_os("TASKS_DESKTOP_REQUIRE_ENGINE").is_none(),
            "the engine has no meeting_ops: engine.lock names an older one than the checkout"
        );
        eprintln!("skipped: the engine has no meeting_ops");
        return None;
    }
    Some(Arc::new(engine))
}

/// `lib.nvim` is public, `cascade.nvim` private.
fn policy() -> AreaPolicy {
    let mut areas = BTreeMap::new();
    for (area, class) in [
        ("lib.nvim", Class::Public),
        ("cascade.nvim", Class::Private),
    ] {
        areas.insert(area.to_owned(), Entry { class, repo: None });
    }
    AreaPolicy::new(areas).unwrap()
}

struct Hub {
    port: u16,
    origin: String,
    session: String,
}

impl Hub {
    async fn get(&self, path: &str) -> patient::Reply {
        patient::request(
            self.port,
            "GET",
            path,
            &[("Authorization", &self.session), ("Origin", &self.origin)],
            "",
        )
        .await
        .unwrap()
    }

    /// A GET whose answer is no text (a picture): its head and its body as bytes.
    async fn get_bytes(&self, path: &str) -> (String, Vec<u8>) {
        self.get_bytes_if(path, None).await
    }

    /// `get_bytes`, with `If-None-Match: <tag>` when a tag is given.
    async fn get_bytes_if(&self, path: &str, tag: Option<&str>) -> (String, Vec<u8>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", self.port))
            .await
            .unwrap();
        let condition = tag.map_or(String::new(), |t| format!("If-None-Match: {t}\r\n"));
        let request = format!(
            "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: {}\r\nOrigin: {}\r\n{condition}Connection: close\r\n\r\n",
            self.port, self.session, self.origin
        );
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut reply = Vec::new();
        tokio::time::timeout(patient::TIMEOUT, stream.read_to_end(&mut reply))
            .await
            .unwrap()
            .unwrap();
        let end = reply
            .windows(4)
            .position(|w| w == b"\r\n\r\n")
            .expect("a head");
        let head = String::from_utf8_lossy(&reply[..end]).into_owned();
        assert!(
            !head
                .to_ascii_lowercase()
                .contains("transfer-encoding: chunked"),
            "{head}"
        );
        (head, reply[end + 4..].to_vec())
    }

    async fn ops(&self, ops: Value) -> Value {
        let reply = patient::request(
            self.port,
            "POST",
            "/api/tasks/ops",
            &[
                ("Authorization", &self.session),
                ("Origin", &self.origin),
                ("Content-Type", "application/json"),
            ],
            &json!({ "ops": ops }).to_string(),
        )
        .await
        .unwrap();
        assert_eq!(reply.status, 200, "{}", reply.body);
        let doc: Value = serde_json::from_str(&reply.body).unwrap();
        assert_eq!(doc["results"][0]["ok"], true, "{doc}");
        doc
    }
}

async fn session(port: u16, control: &Secret) -> String {
    let origin = format!("http://127.0.0.1:{port}");
    let auth = format!("Bearer {}", control.to_hex());
    let reply = patient::request(
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
    let reply = patient::request(
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
    format!("Bearer {token}")
}

/// A drawing that would run a script, load a page and reach the network if it were markup of the page.
const EVIL_SVG: &str = r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)"><script>alert(2)</script><foreignObject><iframe src="https://tracker.example/"></iframe></foreignObject><image href="https://tracker.example/pixel.png"/></svg>"#;

/// The file `rel` of the vault into its folder form (`<dir>/<slug>.md` to `<dir>/<slug>/<slug>.md`), with assets.
fn folderize(vault: &Path, rel: &str, assets: &[(&str, &[u8])]) -> PathBuf {
    let file = vault.join(rel);
    let slug = file.file_stem().unwrap().to_owned();
    let folder = file.parent().unwrap().join(&slug);
    std::fs::create_dir_all(&folder).unwrap();
    let mut name = slug.clone();
    name.push(".md");
    std::fs::rename(&file, folder.join(name)).unwrap();
    for (path, bytes) in assets {
        let target = folder.join(path);
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(target, bytes).unwrap();
    }
    folder
}

#[tokio::test]
async fn the_images_below_assets_of_a_container_are_handed_on_sealed_and_nothing_else() {
    let dir = Scratch::new("real-assets");
    let vault = dir.join("vault");
    copy_dir(&fixture(), &vault);
    let home = Scratch::new("real-assets-home");
    let roadmap = "lib.nvim/ROADMAP";
    let png: &[u8] = b"\x89PNG\r\n\x1a\nnot really";
    let task = folderize(
        &vault,
        &format!("{roadmap}/tasks/alpha.md"),
        &[
            ("assets/images/evil.svg", EVIL_SVG.as_bytes()),
            ("assets/p.png", png),
            ("notes.txt", b"not an asset"),
        ],
    );
    folderize(
        &vault,
        &format!("{roadmap}/plans/the-plan.md"),
        &[("assets/c.webp", b"RIFF")],
    );
    folderize(
        &vault,
        &format!("{roadmap}/paths/lua-lernen.md"),
        &[("assets/badges/star.gif", b"GIF89a")],
    );
    // A plain task's folder is the folder of all tasks: an `assets/` there is no asset of beta's (nor of any task's).
    let shared = vault
        .join("lib.nvim")
        .join("ROADMAP")
        .join("tasks")
        .join("assets");
    std::fs::create_dir_all(&shared).unwrap();
    std::fs::write(shared.join("p.png"), png).unwrap();
    let Some(engine) = engine(&vault, &home).await else {
        return;
    };
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
                engine_ready: true,
                problem: None,
                capabilities: Vec::new(),
            },
            engine: Some(engine),
            policy: Arc::new(policy()),
            usage: None,
            ui: tasks_hub::ui::UiFiles::none(),
            watch: Some(WatchConfig {
                vault: vault.clone(),
                refresh: RefreshOptions::default(),
            }),
        },
        Extras::default(),
    )
    .await
    .unwrap();
    let port = server.addr().port();
    let hub = Hub {
        port,
        origin: format!("http://127.0.0.1:{port}"),
        session: session(port, &control).await,
    };

    // The images of a task, a plan and a path, each with its type, sealed.
    for (query, kind, bytes) in [
        (
            "kind=task&id=lib.nvim/alpha&file=assets/images/evil.svg",
            "image/svg+xml",
            EVIL_SVG.as_bytes(),
        ),
        (
            "kind=task&id=lib.nvim/alpha&file=assets/p.png",
            "image/png",
            png,
        ),
        (
            "kind=plan&id=lib.nvim/the-plan&file=assets/c.webp",
            "image/webp",
            b"RIFF".as_slice(),
        ),
        (
            "kind=path&id=lib.nvim/lua-lernen&file=assets/badges/star.gif",
            "image/gif",
            b"GIF89a".as_slice(),
        ),
    ] {
        let (head, body) = hub.get_bytes(&format!("/api/tasks/asset?{query}")).await;
        assert!(head.starts_with("HTTP/1.1 200"), "{query}: {head}");
        let lower = head.to_ascii_lowercase();
        assert!(
            lower.contains(&format!("content-type: {kind}")),
            "{query}: {head}"
        );
        assert!(lower.contains("x-content-type-options: nosniff"), "{head}");
        assert!(
            lower.contains("content-security-policy: default-src 'none'"),
            "{head}"
        );
        assert!(lower.contains("sandbox"), "{head}");
        assert!(lower.contains("cache-control: no-store"), "{head}");
        // The picture is shown in the page; saved, it carries the name of its file and nothing the page chose.
        let name = query.rsplit('/').next().unwrap().to_ascii_lowercase();
        assert!(
            lower.contains(&format!("content-disposition: inline; filename=\"{name}\"")),
            "{query}: {head}"
        );
        assert_eq!(body, bytes, "{query}");
    }

    // A file replaced by hand under the same name is no event of the vault: the page asks again with the tag it holds.
    // The same bytes answer 304 (no body); other bytes of the same length (a copy may keep the old time of the file)
    // answer 200 with the new picture and a new tag.
    let png_path = "/api/tasks/asset?kind=task&id=lib.nvim/alpha&file=assets/p.png";
    let tag_of = |head: &str| -> String {
        head.lines()
            .find_map(|l| {
                let (name, value) = l.split_once(':')?;
                name.eq_ignore_ascii_case("etag")
                    .then(|| value.trim().to_owned())
            })
            .unwrap_or_else(|| panic!("an ETag: {head}"))
    };
    let (head, _) = hub.get_bytes(png_path).await;
    let first = tag_of(&head);
    let (head, body) = hub.get_bytes_if(png_path, Some(&first)).await;
    assert!(head.starts_with("HTTP/1.1 304"), "the same bytes: {head}");
    assert!(body.is_empty(), "a 304 has no body");
    let other: &[u8] = b"\x89PNG\r\n\x1a\nnot rEally";
    assert_eq!(
        other.len(),
        png.len(),
        "the same length: only the bytes tell"
    );
    std::fs::write(task.join("assets").join("p.png"), other).unwrap();
    let (head, body) = hub.get_bytes_if(png_path, Some(&first)).await;
    assert!(head.starts_with("HTTP/1.1 200"), "other bytes: {head}");
    assert_eq!(body, other, "the new picture");
    assert_ne!(tag_of(&head), first, "and a new tag");
    std::fs::write(task.join("assets").join("p.png"), png).unwrap();

    // A meeting made through ops, then in its folder form with a cover.
    let made = hub
        .ops(json!([{
            "op": "meeting_new", "area": "lib.nvim", "title": "Asset route sync",
            "fields": { "date": "2026-11-24", "time": "14:00" },
        }]))
        .await;
    let meeting = made["results"][0]["id"].as_str().unwrap().to_owned();
    let slug = meeting.split_once('/').unwrap().1.to_owned();
    folderize(
        &vault,
        &format!("lib.nvim/MEETINGS/{slug}.md"),
        &[("assets/images/cover.png", png)],
    );
    let path = format!("/api/tasks/asset?kind=meeting&id={meeting}&file=assets/images/cover.png");
    let mut answer = (String::new(), Vec::new());
    for _ in 0..50 {
        answer = hub.get_bytes(&path).await;
        if answer.0.starts_with("HTTP/1.1 200") {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(
        answer.0.starts_with("HTTP/1.1 200"),
        "the meeting's cover once its folder is read: {}",
        answer.0
    );
    assert_eq!(answer.1, png);

    // Nothing else: no such file, a file outside assets/, a link out of assets/, a container without a folder, a
    // container that is not there, a path that is not plain.
    for (query, code) in [
        ("kind=task&id=lib.nvim/alpha&file=assets/none.png", 404),
        ("kind=task&id=lib.nvim/beta&file=assets/p.png", 404),
        ("kind=task&id=lib.nvim/no-such-task&file=assets/p.png", 404),
        ("kind=plan&id=lib.nvim/no-such-plan&file=assets/c.webp", 404),
        ("kind=path&id=lib.nvim/the-plan&file=assets/c.webp", 404),
        ("kind=project&id=lib.nvim/the-plan&file=assets/c.webp", 404),
        ("kind=task&id=lib.nvim/alpha&file=assets/../notes.txt", 400),
        ("kind=task&id=lib.nvim/alpha&file=assets/../alpha.md", 400),
        ("kind=task&id=lib.nvim/alpha&file=notes.txt", 400),
        ("kind=task&id=lib.nvim/alpha&file=assets%2Fp.png", 400),
        ("kind=task&id=../x&file=assets/p.png", 400),
    ] {
        // Read as bytes: a wrong answer here may be a picture.
        let (head, _) = hub.get_bytes(&format!("/api/tasks/asset?{query}")).await;
        assert!(
            head.starts_with(&format!("HTTP/1.1 {code}")),
            "{query}: {head}"
        );
    }
    let link = task.join("assets").join("out.png");
    #[cfg(windows)]
    let made = std::os::windows::fs::symlink_file(task.join("alpha.md"), &link);
    #[cfg(unix)]
    let made = std::os::unix::fs::symlink(task.join("alpha.md"), &link);
    if made.is_ok() {
        let r = hub
            .get("/api/tasks/asset?kind=task&id=lib.nvim/alpha&file=assets/out.png")
            .await;
        assert_eq!(r.status, 404, "a link out of assets/: {}", r.body);
    } else {
        println!("n/a  this account may not make links");
    }
}
