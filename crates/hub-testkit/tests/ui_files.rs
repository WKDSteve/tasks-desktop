//! The interface files: served from a table by name, with the headers of the
//! page, and nothing else is reachable through them.

use std::io::Read as _;
use std::sync::Arc;
use std::time::Duration;

use appkit_core::authn::{ManualClock, Secret, CODE_BYTES, TOKEN_BYTES};
use hub_testkit::scratch::Scratch;
use tasks_hub::classes::AreaPolicy;
use tasks_hub::client;
use tasks_hub::server::{start, HubStatus, Limits, RunningServer, ServerConfig};
use tasks_hub::ui::UiFiles;
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

fn build_dir(name: &str) -> Scratch {
    let dir = Scratch::new(&format!("uifiles-{name}"));
    std::fs::create_dir_all(dir.join("assets")).unwrap();
    std::fs::write(dir.join("index.html"), "<!doctype html><title>ui</title>").unwrap();
    std::fs::write(dir.join("assets").join("app-1.js"), "console.log(1)").unwrap();
    std::fs::write(dir.join("assets").join("app-1.css"), "body{}").unwrap();
    // Next to the build, but not part of it.
    std::fs::write(dir.join("secret.txt"), "no").unwrap();
    dir
}

async fn hub(ui: UiFiles) -> RunningServer {
    start(ServerConfig {
        devices: None,
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
        ui,
        usage: None,
        watch: None,
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn the_page_and_its_assets_are_served_with_the_page_headers() {
    let dir = build_dir("serve");
    let server = hub(UiFiles::load(&dir).unwrap()).await;
    let port = server.addr().port();

    let page = client::request(port, "GET", "/", &[], "").await.unwrap();
    assert_eq!(page.status, 200);
    assert!(page.body.contains("<title>ui</title>"));
    let csp = page.header("content-security-policy").expect("a CSP");
    assert!(csp.contains("script-src 'self'"), "{csp}");
    assert!(csp.contains("frame-ancestors 'none'"), "{csp}");
    assert!(csp.contains("default-src 'none'"), "{csp}");
    assert!(csp.contains("require-trusted-types-for 'script'"), "{csp}");
    assert!(csp.contains("trusted-types svelte-trusted-html"), "{csp}");
    assert!(
        !csp.contains("unsafe-inline") && !csp.contains("unsafe-eval"),
        "{csp}"
    );
    assert_eq!(
        page.header("cross-origin-opener-policy"),
        Some("same-origin")
    );
    assert_eq!(page.header("cache-control"), Some("no-store"));

    let js = client::request(port, "GET", "/assets/app-1.js", &[], "")
        .await
        .unwrap();
    assert_eq!(js.status, 200);
    assert!(js
        .header("content-type")
        .is_some_and(|t| t.starts_with("text/javascript")));
    assert_eq!(js.header("x-content-type-options"), Some("nosniff"));
    assert!(js.header("content-security-policy").is_some());
    // A hashed file too: the hub is local, so nothing is cached (docs/PERFORMANCE.md, "Caching of the page's files").
    assert_eq!(js.header("cache-control"), Some("no-store"));

    let css = client::request(port, "GET", "/assets/app-1.css", &[], "")
        .await
        .unwrap();
    assert_eq!(css.status, 200);
}

#[tokio::test]
async fn nothing_outside_the_table_is_reachable() {
    let dir = build_dir("table");
    let server = hub(UiFiles::load(&dir).unwrap()).await;
    let port = server.addr().port();
    for path in [
        "/assets/missing.js",
        "/assets/secret.txt",
        "/secret.txt",
        "/assets/..%2Fsecret.txt",
        "/assets/%2e%2e/secret.txt",
        "/assets/../secret.txt",
        "/assets/",
        "/index.htm",
    ] {
        let r = client::request(port, "GET", path, &[], "").await.unwrap();
        assert_eq!(r.status, 404, "{path}: {r:?}");
    }
    // A write to a file is not a thing.
    let r = client::request(
        port,
        "POST",
        "/assets/app-1.js",
        &[("Content-Type", "application/json")],
        "{}",
    )
    .await
    .unwrap();
    assert!(r.status == 405 || r.status == 403, "{r:?}");
}

#[tokio::test]
async fn without_an_interface_there_is_a_placeholder_and_no_assets() {
    let server = hub(UiFiles::none()).await;
    let port = server.addr().port();
    let page = client::request(port, "GET", "/", &[], "").await.unwrap();
    assert_eq!(page.status, 200);
    assert!(page.body.contains("not built yet"));
    let asset = client::request(port, "GET", "/assets/app.js", &[], "")
        .await
        .unwrap();
    assert_eq!(asset.status, 404);
}

#[test]
fn the_interface_in_the_binary_is_the_build_there_is() {
    let index = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("ui")
        .join("dist")
        .join("index.html");
    let embedded = UiFiles::embedded();
    assert_eq!(embedded.has_index(), index.is_file());
    if embedded.has_index() {
        let page = embedded.get("/").expect("the page");
        assert!(page.content_type.starts_with("text/html"));
        // The page names its scripts under /assets/, and they are there.
        let html = String::from_utf8_lossy(&page.bytes).into_owned();
        let src = html
            .split("src=\"")
            .nth(1)
            .and_then(|rest| rest.split('"').next())
            .expect("a script");
        let name = src.trim_start_matches("./");
        assert!(embedded.get(&format!("/{name}")).is_some(), "{src}");
    }
}

/// A GET with its own headers, the answer as bytes: a gzip body is no text, which `client::request` expects.
async fn get_raw(port: u16, path: &str, headers: &[(&str, &str)]) -> (String, Vec<u8>) {
    let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .unwrap();
    let mut request =
        format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n");
    for (name, value) in headers {
        request.push_str(&format!("{name}: {value}\r\n"));
    }
    request.push_str("\r\n");
    stream.write_all(request.as_bytes()).await.unwrap();
    let mut answer = Vec::new();
    tokio::time::timeout(Duration::from_secs(10), stream.read_to_end(&mut answer))
        .await
        .expect("the hub answers")
        .unwrap();
    let split = answer
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .expect("a head");
    let head = String::from_utf8(answer[..split].to_vec()).unwrap();
    (head.to_ascii_lowercase(), answer[split + 4..].to_vec())
}

fn gunzip(bytes: &[u8]) -> Vec<u8> {
    let mut plain = Vec::new();
    flate2::read::GzDecoder::new(bytes)
        .read_to_end(&mut plain)
        .expect("a gzip body");
    plain
}

/// A script of the size the page has: long enough that gzip makes it smaller.
fn script() -> String {
    (0..400)
        .map(|i| format!("console.log('line {i}');\n"))
        .collect()
}

/// A gzip version as `build.rs` makes it.
fn packed(bytes: &[u8]) -> Vec<u8> {
    tasks_hub::precompress::gzip(bytes).expect("smaller")
}

#[tokio::test]
async fn a_text_file_is_sent_gzip_to_a_request_that_accepts_it_and_never_cached() {
    let js: &'static str = Box::leak(script().into_boxed_str());
    let html: &'static str = Box::leak(
        format!(
            "<!doctype html><title>ui</title>{}",
            "<p>text</p>".repeat(50)
        )
        .into_boxed_str(),
    );
    let ui = UiFiles::from_static(&[
        ("index.html", "text/html; charset=utf-8", b"<!doctype html>"),
        ("m/index.html", "text/html; charset=utf-8", html.as_bytes()),
        (
            "m/assets/app-1.js",
            "text/javascript; charset=utf-8",
            js.as_bytes(),
        ),
        ("m/icons/logo.png", "image/png", b"\x89PNG not text"),
    ])
    .with_gzip([
        ("m/index.html", packed(html.as_bytes())),
        ("m/assets/app-1.js", packed(js.as_bytes())),
    ]);
    let server = hub(ui).await;
    let port = server.addr().port();

    for asked in [
        "gzip",
        "gzip, deflate, br, zstd",
        "br;q=1, gzip;q=0.8",
        "GZIP",
    ] {
        let (head, body) = get_raw(port, "/m/assets/app-1.js", &[("Accept-Encoding", asked)]).await;
        assert!(head.starts_with("http/1.1 200"), "{asked}: {head}");
        assert!(
            head.contains("\r\ncontent-encoding: gzip"),
            "{asked}: {head}"
        );
        assert!(
            head.contains("\r\nvary: accept-encoding"),
            "{asked}: {head}"
        );
        assert!(
            head.contains("\r\ncache-control: no-store"),
            "{asked}: {head}"
        );
        assert!(
            !head.contains("immutable") && !head.contains("max-age"),
            "{asked}: {head}"
        );
        assert!(
            head.contains("\r\ncontent-type: text/javascript"),
            "{asked}: {head}"
        );
        assert!(
            head.contains("\r\nx-content-type-options: nosniff"),
            "{asked}: {head}"
        );
        assert!(
            body.len() < js.len(),
            "{asked}: {} of {}",
            body.len(),
            js.len()
        );
        assert_eq!(gunzip(&body), js.as_bytes(), "{asked}");
    }
    // The phone page itself, with its own policy.
    let (head, body) = get_raw(port, "/m/", &[("Accept-Encoding", "gzip")]).await;
    assert!(head.starts_with("http/1.1 200"), "{head}");
    assert!(head.contains("\r\ncontent-encoding: gzip"), "{head}");
    assert!(head.contains("content-security-policy"), "{head}");
    assert_eq!(gunzip(&body), html.as_bytes());

    // Not accepted, refused or unknown: the plain file, still with `Vary` (the answer depends on the header).
    for asked in [
        None,
        Some("identity"),
        Some("gzip;q=0"),
        Some("br"),
        Some("zstd"),
    ] {
        let headers: Vec<(&str, &str)> =
            asked.map(|a| ("Accept-Encoding", a)).into_iter().collect();
        let (head, body) = get_raw(port, "/m/assets/app-1.js", &headers).await;
        assert!(head.starts_with("http/1.1 200"), "{asked:?}: {head}");
        assert!(!head.contains("content-encoding"), "{asked:?}: {head}");
        assert!(
            head.contains("\r\nvary: accept-encoding"),
            "{asked:?}: {head}"
        );
        assert!(
            head.contains("\r\ncache-control: no-store"),
            "{asked:?}: {head}"
        );
        assert_eq!(body, js.as_bytes(), "{asked:?}");
    }

    // A file without a version (a picture, the desktop page): as before, no `Content-Encoding`, no `Vary`.
    for path in ["/m/icons/logo.png", "/"] {
        let (head, _) = get_raw(port, path, &[("Accept-Encoding", "gzip")]).await;
        assert!(head.starts_with("http/1.1 200"), "{path}: {head}");
        assert!(
            !head.contains("content-encoding") && !head.contains("vary:"),
            "{path}: {head}"
        );
    }
}

#[tokio::test]
async fn the_embedded_phone_page_is_sent_gzip_to_a_request_that_accepts_it() {
    let embedded = UiFiles::embedded();
    let Some(script) = embedded.get("/m/sw.js").map(|f| f.bytes.clone()) else {
        println!("n/a  this build has no phone page (ui/dist-mobile): tools/build-mobile.py");
        return;
    };
    let server = hub(embedded).await;
    let port = server.addr().port();
    let (head, body) = get_raw(
        port,
        "/m/sw.js",
        &[("Accept-Encoding", "gzip, deflate, br")],
    )
    .await;
    assert!(head.starts_with("http/1.1 200"), "{head}");
    assert!(head.contains("\r\ncontent-encoding: gzip"), "{head}");
    assert!(head.contains("\r\nvary: accept-encoding"), "{head}");
    assert!(head.contains("\r\ncache-control: no-store"), "{head}");
    assert_eq!(gunzip(&body), script);
    let (head, body) = get_raw(port, "/m/", &[("Accept-Encoding", "gzip")]).await;
    assert!(head.contains("\r\ncontent-encoding: gzip"), "{head}");
    assert!(String::from_utf8(gunzip(&body)).unwrap().contains("<html"));
}
