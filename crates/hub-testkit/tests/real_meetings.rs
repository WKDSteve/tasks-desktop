//! The routes of the meetings against the real engine, over a copy of the fixture vault: a meeting is made and changed
//! through `ops`, read through `meetings` and `meeting`, given as an invitation (`meeting/ics`) whose sequence grows
//! with a change of its time, and as a preview (`meeting/thumb`) kept in the hub's cache, not in the vault. A meeting of
//! a private area gives no invitation.

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
use tasks_hub::meetings::MeetingFiles;
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
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", self.port))
            .await
            .unwrap();
        let request = format!(
            "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: {}\r\nOrigin: {}\r\nConnection: close\r\n\r\n",
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

    async fn post(&self, path: &str, content_type: &str, body: &str) -> patient::Reply {
        patient::request(
            self.port,
            "POST",
            path,
            &[
                ("Authorization", &self.session),
                ("Origin", &self.origin),
                ("Content-Type", content_type),
            ],
            body,
        )
        .await
        .unwrap()
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

fn png() -> Vec<u8> {
    let img = image::RgbImage::from_pixel(300, 150, image::Rgb([200, 30, 30]));
    let mut out = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(img)
        .write_to(&mut out, image::ImageFormat::Png)
        .unwrap();
    out.into_inner()
}

#[tokio::test]
async fn a_meeting_is_made_read_exported_and_previewed_through_the_hub() {
    let dir = Scratch::new("real-meetings");
    let vault = dir.join("vault");
    copy_dir(&fixture(), &vault);
    let settings = dir.join("settings");
    let home = Scratch::new("real-meetings-home");
    let Some(engine) = engine(&vault, &home).await else {
        return;
    };
    let control = Secret::generate(TOKEN_BYTES).unwrap();
    let mut files = MeetingFiles::in_dir(&settings, false);
    files.zone = jiff::tz::TimeZone::get("Europe/Vienna").unwrap();
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
            // The folder of the vault: the invitation's id names it, the preview reads below it.
            watch: Some(WatchConfig {
                vault: vault.clone(),
                refresh: RefreshOptions::default(),
            }),
        },
        Extras {
            meetings: Some(Arc::new(files)),
            // The files of the page's form go the way of a task's: through the upload.
            upload_dir: Some(settings.join("uploads")),
            ..Extras::default()
        },
    )
    .await
    .unwrap();
    let port = server.addr().port();
    let hub = Hub {
        port,
        origin: format!("http://127.0.0.1:{port}"),
        session: session(port, &control).await,
    };

    // Made through ops, in the public area and in the private one.
    let made = hub
        .ops(json!([{
            "op": "meeting_new", "area": "lib.nvim", "title": "Hub route sync",
            "fields": {
                "date": "2026-11-24", "time": "14:00", "end": "15:00", "location": "Raum 3",
                "online": "https://teams.microsoft.com/l/meetup-join/abc",
            },
        }]))
        .await;
    let id = made["results"][0]["id"].as_str().unwrap().to_owned();
    assert!(id.starts_with("lib.nvim/hub-route-sync"), "{made}");
    let private = hub
        .ops(json!([{
            "op": "meeting_new", "area": "cascade.nvim", "title": "Private route sync",
            "fields": { "date": "2026-11-24", "time": "09:00" },
        }]))
        .await;
    let private_id = private["results"][0]["id"].as_str().unwrap().to_owned();

    // Participants, as a person writes them (two with an address, the organizer first).
    let slug = id.split_once('/').unwrap().1.to_owned();
    let file = vault
        .join("lib.nvim")
        .join("MEETINGS")
        .join(format!("{slug}.md"));
    let text = std::fs::read_to_string(&file).unwrap();
    assert!(text.contains("## Teilnehmer"), "{text}");
    let text = text.replacen(
        "## Teilnehmer\n",
        "## Teilnehmer\n\n- [ ] Rick <rick@example.org> (Organisator)\n- [ ] Morty <morty@example.org> (optional)\n",
        1,
    );
    std::fs::write(&file, text).unwrap();

    // Read: the window and the one meeting.
    let r = hub
        .get("/api/tasks/meetings?since=2026-11-01&until=2026-11-30&area=lib.nvim")
        .await;
    assert_eq!(r.status, 200, "{}", r.body);
    let doc: Value = serde_json::from_str(&r.body).unwrap();
    assert_eq!(doc["kind"], "tasks.meetings", "{doc}");
    assert!(
        doc["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["id"] == id),
        "{doc}"
    );
    let r = hub.get(&format!("/api/tasks/meeting?id={id}")).await;
    assert_eq!(r.status, 200, "{}", r.body);
    let doc: Value = serde_json::from_str(&r.body).unwrap();
    assert_eq!(doc["meeting"]["id"], id, "{doc}");
    assert_eq!(doc["participants"].as_array().unwrap().len(), 2, "{doc}");
    let r = hub.get("/api/tasks/meetings?since=yesterday").await;
    assert_eq!(r.status, 400, "{}", r.body);

    // The quick capture: the engine reads the line into a proposal, writes nothing.
    let before = std::fs::read_dir(vault.join("lib.nvim").join("MEETINGS"))
        .unwrap()
        .count();
    let r = hub
        .post(
            "/api/tasks/meeting_parse",
            "application/json",
            r#"{"text":"24.11. 9:30 90m Workshop @Raum_3.14 https://meet.google.com/abc #lib.nvim/alpha !-15m"}"#,
        )
        .await;
    assert_eq!(r.status, 200, "{}", r.body);
    let doc: Value = serde_json::from_str(&r.body).unwrap();
    assert_eq!(doc["kind"], "tasks.meetingparse", "{doc}");
    assert_eq!(doc["title"], "Workshop", "{doc}");
    assert_eq!(doc["fields"]["time"], "09:30", "{doc}");
    assert_eq!(doc["fields"]["duration"], "90m", "{doc}");
    assert_eq!(doc["fields"]["location"], "Raum 3.14", "{doc}");
    assert_eq!(doc["fields"]["tasks"], json!(["lib.nvim/alpha"]), "{doc}");
    assert_eq!(doc["online_service"], "meet", "{doc}");
    assert_eq!(
        std::fs::read_dir(vault.join("lib.nvim").join("MEETINGS"))
            .unwrap()
            .count(),
        before,
        "a proposal writes no file"
    );
    for bad in [
        r#"{"text":""}"#,
        r#"{"text":"a
b"}"#,
        r#"{"line":"x"}"#,
        &format!(r#"{{"text":"{}"}}"#, "x".repeat(1001)),
    ] {
        let r = hub
            .post("/api/tasks/meeting_parse", "application/json", bad)
            .await;
        assert_eq!(r.status, 400, "{bad}: {}", r.body);
    }

    // The invitation: a download, with the people of a public area and its address to join.
    let r = hub.get(&format!("/api/tasks/meeting/ics?id={id}")).await;
    assert_eq!(r.status, 200, "{}", r.body);
    assert_eq!(
        r.header("content-type"),
        Some("text/calendar; charset=utf-8")
    );
    assert_eq!(
        r.header("content-disposition"),
        Some(format!("attachment; filename=\"{slug}.ics\"").as_str())
    );
    assert_eq!(r.header("x-content-type-options"), Some("nosniff"));
    let ics = r.body.replace("\r\n ", "");
    assert!(ics.contains(&format!("UID:vault:{id}\r\n")), "{ics}");
    assert!(ics.contains("SEQUENCE:0\r\n"), "{ics}");
    assert!(ics.contains("DTSTART:20261124T130000Z\r\n"), "{ics}");
    assert!(
        ics.contains("ORGANIZER;CN=\"Rick\":mailto:rick@example.org"),
        "{ics}"
    );
    assert!(
        ics.contains("ROLE=OPT-PARTICIPANT:mailto:morty@example.org"),
        "{ics}"
    );
    assert!(
        ics.contains("URL:https://teams.microsoft.com/l/meetup-join/abc"),
        "{ics}"
    );
    let again = hub.get(&format!("/api/tasks/meeting/ics?id={id}")).await;
    assert!(
        again.body.contains("SEQUENCE:0\r\n"),
        "no change, no new sequence"
    );

    // Moved through ops: the next export is a new version of the same event.
    hub.ops(
        json!([{ "op": "meeting_set", "id": id, "patch": { "time": "15:00", "end": "16:00" } }]),
    )
    .await;
    let moved = hub.get(&format!("/api/tasks/meeting/ics?id={id}")).await;
    assert_eq!(moved.status, 200, "{}", moved.body);
    assert!(moved.body.contains("SEQUENCE:1\r\n"), "{}", moved.body);
    assert!(
        moved.body.contains("DTSTART:20261124T140000Z\r\n"),
        "{}",
        moved.body
    );
    assert!(settings.join("ics-sequence.json").is_file());

    // A private area: no invitation.
    let r = hub
        .get(&format!("/api/tasks/meeting/ics?id={private_id}"))
        .await;
    assert_eq!(r.status, 403, "{}", r.body);
    assert!(r.body.contains("not_released"), "{}", r.body);

    // No picture yet: none. Then a cover in the folder form: a small PNG, kept outside the vault.
    let r = hub.get(&format!("/api/tasks/meeting/thumb?id={id}")).await;
    assert_eq!(r.status, 404, "{}", r.body);
    let folder = vault.join("lib.nvim").join("MEETINGS").join(&slug);
    std::fs::create_dir_all(folder.join("assets").join("images")).unwrap();
    std::fs::write(
        folder.join("assets").join("images").join("cover.png"),
        png(),
    )
    .unwrap();
    std::fs::rename(&file, folder.join(format!("{slug}.md"))).unwrap();
    hub.ops(
        json!([{ "op": "meeting_set", "id": id, "patch": { "image": "assets/images/cover.png" } }]),
    )
    .await;
    let (head, png) = hub
        .get_bytes(&format!("/api/tasks/meeting/thumb?id={id}"))
        .await;
    assert!(head.starts_with("HTTP/1.1 200"), "{head}");
    let lower = head.to_ascii_lowercase();
    assert!(lower.contains("content-type: image/png"), "{head}");
    assert!(lower.contains("x-content-type-options: nosniff"), "{head}");
    let small = image::load_from_memory_with_format(&png, image::ImageFormat::Png).unwrap();
    assert_eq!(
        (small.width(), small.height()),
        (96, 48),
        "made 96 px on its longer edge"
    );
    let kept: Vec<_> = std::fs::read_dir(settings.join("cache").join("thumbs"))
        .unwrap()
        .collect();
    assert_eq!(kept.len(), 1, "the preview is kept in the hub's cache");
    let r = hub
        .get("/api/tasks/meeting/thumb?id=lib.nvim/no-such-meeting")
        .await;
    assert_eq!(r.status, 404, "{}", r.body);
    let r = hub.get("/api/tasks/meeting/thumb?id=../x").await;
    assert_eq!(r.status, 400, "{}", r.body);

    // What the form of the page does once a meeting is made: its participants into `## Teilnehmer`, a picture and a
    // recording through the upload of a task (the meeting takes the folder form), the picture as its cover.
    let made = hub
        .ops(json!([{
            "op": "meeting_new", "area": "lib.nvim", "title": "Made by the form", "lang": "de",
            "fields": { "date": "2026-11-25", "time": "10:00", "duration": "30m", "tasks": ["lib.nvim/alpha"] },
        }]))
        .await;
    let formed = made["results"][0]["id"].as_str().unwrap().to_owned();
    hub.ops(json!([{
        "op": "set_section", "id": formed, "heading": "## Teilnehmer",
        "text": "- [ ] Rick <rick@example.org> (Organisator)",
    }]))
    .await;
    let upload = |kind: &'static str, name: &'static str| {
        let path = format!("/api/tasks/upload?id={formed}&kind={kind}");
        let hub = &hub;
        async move {
            let reply = patient::request(
                hub.port,
                "POST",
                &path,
                &[
                    ("Authorization", &hub.session),
                    ("Origin", &hub.origin),
                    ("Content-Type", "application/octet-stream"),
                    ("X-Upload-Name", name),
                ],
                "bytes",
            )
            .await
            .unwrap();
            assert_eq!(reply.status, 200, "{}", reply.body);
            let doc: Value = serde_json::from_str(&reply.body).unwrap();
            assert_eq!(doc["results"][0]["ok"], true, "{doc}");
            doc["results"][0]["asset"].as_str().unwrap().to_owned()
        }
    };
    let picture = upload("image", "photo.png").await;
    assert_eq!(picture, "assets/images/photo.png");
    let recording = upload("audio", "note.m4a").await;
    assert_eq!(recording, "assets/audio/note.m4a");
    hub.ops(json!([{ "op": "meeting_set", "id": formed, "patch": { "cover": picture } }]))
        .await;
    let r = hub.get(&format!("/api/tasks/meeting?id={formed}")).await;
    assert_eq!(r.status, 200, "{}", r.body);
    let doc: Value = serde_json::from_str(&r.body).unwrap();
    assert_eq!(doc["meeting"]["cover"], picture, "{doc}");
    assert_eq!(doc["meeting"]["folder"], true, "{doc}");
    let assets = doc["meeting"]["assets"].as_array().unwrap();
    assert!(assets.contains(&json!(picture)), "{doc}");
    assert!(assets.contains(&json!(recording)), "{doc}");
    assert_eq!(doc["participants"][0]["name"], "Rick", "{doc}");
    assert_eq!(doc["participants"][0]["email"], "rick@example.org", "{doc}");
    // and the task names it
    let r = hub.get("/api/tasks/task?id=lib.nvim/alpha").await;
    let task: Value = serde_json::from_str(&r.body).unwrap();
    assert!(
        task["task"]["meetings"]
            .as_array()
            .is_some_and(|m| m.contains(&json!(formed))),
        "{task}"
    );
    drop(server);
}

/// The public key a paired phone names (any valid P-256 point; the tests of the guard take the same).
const DEVICE_KEY: &str = "046b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2964fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5";

/// A paired phone attaches to a task only: the real engine's `attach` would take a meeting, a plan or a learning path
/// of a released area under its id, and the hub refuses that with `not_for_devices` before any byte is taken; the
/// meeting stays without assets. A task of the same area is still attached to.
#[tokio::test]
async fn a_paired_phone_cannot_attach_to_a_meeting_a_plan_or_a_path() {
    let dir = Scratch::new("real-meetings-phone");
    let vault = dir.join("vault");
    copy_dir(&fixture(), &vault);
    let settings = dir.join("settings");
    let home = Scratch::new("real-meetings-phone-home");
    let Some(engine) = engine(&vault, &home).await else {
        return;
    };
    let control = Secret::generate(TOKEN_BYTES).unwrap();
    let server = start_with(
        ServerConfig {
            devices: Some(settings.join("devices.json")),
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
            meetings: Some(Arc::new(MeetingFiles::in_dir(&settings, false))),
            upload_dir: Some(settings.join("uploads")),
            ..Extras::default()
        },
    )
    .await
    .unwrap();
    let port = server.addr().port();
    let hub = Hub {
        port,
        origin: format!("http://127.0.0.1:{port}"),
        session: session(port, &control).await,
    };
    let made = hub
        .ops(json!([{
            "op": "meeting_new", "area": "lib.nvim", "title": "Phone stays out",
            "fields": { "date": "2026-11-26", "time": "11:00" },
        }]))
        .await;
    let meeting = made["results"][0]["id"].as_str().unwrap().to_owned();

    // The phone, paired with a code of the PC.
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
        "/auth/device/pair",
        &[
            ("Content-Type", "application/json"),
            ("Origin", &hub.origin),
        ],
        &json!({ "code": code, "name": "Phone", "key": DEVICE_KEY }).to_string(),
    )
    .await
    .unwrap();
    assert_eq!(reply.status, 200, "{}", reply.body);
    let phone = format!(
        "Bearer {}",
        serde_json::from_str::<Value>(&reply.body).unwrap()["token"]
            .as_str()
            .unwrap()
    );
    let upload = |id: String, kind: &'static str| {
        let phone = phone.clone();
        let origin = hub.origin.clone();
        async move {
            let reply = patient::request(
                port,
                "POST",
                &format!("/api/tasks/upload?id={id}&kind={kind}"),
                &[
                    ("Authorization", &phone),
                    ("Origin", &origin),
                    ("Content-Type", "application/octet-stream"),
                    ("X-Upload-Name", "note.m4a"),
                ],
                "bytes",
            )
            .await
            .unwrap();
            let doc: Value = serde_json::from_str(&reply.body).unwrap_or(Value::Null);
            (reply.status, doc)
        }
    };
    for id in [
        meeting.clone(),
        "lib.nvim/the-plan".to_owned(),
        "lib.nvim/lua-lernen".to_owned(),
    ] {
        for kind in ["audio", "image"] {
            let (status, doc) = upload(id.clone(), kind).await;
            assert_eq!(
                (status, doc["error"]["code"].clone()),
                (403, json!("not_for_devices")),
                "{id} {kind}: {doc}"
            );
        }
    }
    let slug = meeting.split_once('/').unwrap().1;
    let meetings = vault.join("lib.nvim").join("MEETINGS");
    assert!(
        !meetings.join(slug).exists(),
        "the meeting took the folder form: an asset arrived"
    );
    for folder in [
        vault
            .join("lib.nvim")
            .join("ROADMAP")
            .join("plans")
            .join("the-plan"),
        vault
            .join("lib.nvim")
            .join("ROADMAP")
            .join("paths")
            .join("lua-lernen"),
    ] {
        assert!(
            !folder.exists(),
            "{} took the folder form",
            folder.display()
        );
    }
    // A task of the same area: attached.
    let (status, doc) = upload("lib.nvim/alpha".to_owned(), "audio").await;
    assert_eq!(status, 200, "{doc}");
    assert_eq!(doc["results"][0]["ok"], true, "{doc}");
    drop(server);
}
