//! `POST /api/tasks/upload?id=<area>/<slug>`: a file from the page becomes an asset of the task.
//!
//! The body is the file as it is, streamed to disk under a name the hub gives it, in a folder of the hub's own below its
//! configuration; the engine takes it from there (`from: upload`) and the hub removes it afterwards, whatever came of
//! it. There is no limit on the size and none on the type: what guards the machine is the disk, asked for the room up
//! front when the size is known. The name the person sees travels in `X-Upload-Name`, percent-encoded, and is cleaned
//! here to what the engine takes as an asset name.

use std::io::Write as _;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use super::*;

/// A transfer that sends nothing for this long is over: the guard sets no time on this route.
const STALLED_AFTER: Duration = Duration::from_secs(60);
/// A file from this size on is refused by GitHub on a push: a vault that is a Git repository is told, not stopped.
const LARGE_FOR_GIT: u64 = 100 * 1024 * 1024;
/// The longest asset name: a file name has room for 255 bytes, and the slug's folder is in the path as well.
const MAX_NAME_BYTES: usize = 120;
/// A file left behind by a hub that was killed is gone after this long.
const LEFTOVER_AFTER: Duration = Duration::from_secs(24 * 60 * 60);

/// The file while it is on its way; it goes when this does, also when the request is abandoned.
struct Incoming {
    path: PathBuf,
}

impl Drop for Incoming {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// A file name the hub gives: unique here, and nothing of it comes from the page.
fn fresh_name() -> String {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis());
    format!(
        "u{millis}-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}

/// Percent-decoding of the name the page sends. What does not decode stays as it is; the name is cleaned afterwards.
fn percent_decoded(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = (bytes[i] == b'%')
            .then(|| text.get(i + 1..i + 3))
            .flatten()
            .and_then(|h| u8::from_str_radix(h, 16).ok());
        if let Some(byte) = hex {
            out.push(byte);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// What the engine takes as an asset name: the last part of a path, letters and digits of any language and `_ . -`, no
/// `..`, starting with a letter, a digit or `_`, not ending in a dot. Nothing left of it: `upload`.
fn clean_name(name: &str) -> String {
    let last = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let mut out = String::new();
    for c in last.trim().chars() {
        let keep = c.is_alphanumeric() || matches!(c, '_' | '.' | '-');
        let c = if keep { c } else { '-' };
        // Two dots in a row are what the engine refuses, and they say nothing in a name.
        if c == '.' && out.ends_with('.') {
            continue;
        }
        out.push(c);
    }
    let out = out.trim_start_matches(['.', '-']).trim_end_matches('.');
    let mut short = String::new();
    // The end stays: it is the kind of the file.
    let (stem, ext) = match out.rsplit_once('.') {
        Some((stem, ext)) if ext.len() <= 16 && !stem.is_empty() => (stem, Some(ext)),
        _ => (out, None),
    };
    let room = MAX_NAME_BYTES - ext.map_or(0, |e| e.len() + 1);
    for c in stem.chars() {
        if short.len() + c.len_utf8() > room {
            break;
        }
        short.push(c);
    }
    let short = short.trim_end_matches('.');
    if short.is_empty() {
        return "upload".to_owned();
    }
    match ext {
        Some(ext) => format!("{short}.{ext}"),
        None => short.to_owned(),
    }
}

/// Remove what a hub that was killed left in the folder.
pub(super) fn sweep_leftovers(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|at| at.elapsed().ok())
            .is_some_and(|age| age > LEFTOVER_AFTER);
        if old {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

fn too_little_room() -> Response {
    error_body(
        StatusCode::INSUFFICIENT_STORAGE,
        "disk_full",
        "there is no room for the file on the disk of the hub",
    )
}

/// The file in the hub's folder, written as it arrives. With a known size the room is taken first, so that a disk that
/// is too small says so before the transfer.
#[allow(clippy::result_large_err)]
async fn receive(dir: PathBuf, size: Option<u64>, body: Body) -> Result<(Incoming, u64), Response> {
    let failed = |e: std::io::Error| {
        if e.kind() == std::io::ErrorKind::StorageFull {
            too_little_room()
        } else {
            eprintln!("upload: {e}");
            error_body(
                StatusCode::INTERNAL_SERVER_ERROR,
                "upload_failed",
                "the file could not be written",
            )
        }
    };
    let (mut file, incoming) = tokio::task::spawn_blocking(move || {
        std::fs::create_dir_all(&dir)?;
        let path = dir.join(fresh_name());
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)?;
        let incoming = Incoming { path };
        if let Some(size) = size {
            file.set_len(size)?;
        }
        Ok::<_, std::io::Error>((file, incoming))
    })
    .await
    .map_err(|_| too_little_room())?
    .map_err(failed)?;

    let mut stream = body.into_data_stream();
    let mut written = 0u64;
    loop {
        let next = std::future::poll_fn(|cx| Pin::new(&mut stream).poll_next(cx));
        let chunk = match tokio::time::timeout(STALLED_AFTER, next).await {
            Err(_) => {
                return Err(error_body(
                    StatusCode::REQUEST_TIMEOUT,
                    "upload_stalled",
                    "the transfer stopped",
                ));
            }
            Ok(None) => break,
            Ok(Some(Err(_))) => {
                return Err(error_body(
                    StatusCode::BAD_REQUEST,
                    "upload_broken",
                    "the transfer broke off",
                ));
            }
            Ok(Some(Ok(chunk))) => chunk,
        };
        written += chunk.len() as u64;
        file = tokio::task::spawn_blocking(move || file.write_all(&chunk).map(|()| file))
            .await
            .map_err(|_| too_little_room())?
            .map_err(failed)?;
    }
    // Fewer bytes than were announced is a transfer that broke off, whatever the connection says.
    if size.is_some_and(|s| s != written) {
        return Err(error_body(
            StatusCode::BAD_REQUEST,
            "upload_broken",
            "the transfer broke off",
        ));
    }
    tokio::task::spawn_blocking(move || file.flush())
        .await
        .map_err(|_| too_little_room())?
        .map_err(failed)?;
    Ok((incoming, written))
}

pub(super) async fn upload(
    State(st): State<Arc<Shared>>,
    RawQuery(query): RawQuery,
    headers: HeaderMap,
    body: Body,
) -> Response {
    let params = match parse_query(query.as_deref(), &["id"]) {
        Ok(p) => p,
        Err(why) => return error_body(StatusCode::BAD_REQUEST, "bad_query", why),
    };
    let Some(id) = params.get("id").filter(|id| valid_task_id(id)).cloned() else {
        return error_body(
            StatusCode::BAD_REQUEST,
            "bad_id",
            "id must be <area>/<slug>",
        );
    };
    let rt = st.rt();
    let Some(dir) = rt.upload_dir.as_deref().cloned() else {
        return error_body(
            StatusCode::NOT_FOUND,
            "not_available",
            "this hub takes no files",
        );
    };
    let Ok(Some(raw_name)) = single(&headers, &UPLOAD_NAME) else {
        return error_body(
            StatusCode::BAD_REQUEST,
            "bad_name",
            "X-Upload-Name names the file",
        );
    };
    let name = clean_name(&percent_decoded(&raw_name));
    let size = match single(&headers, &header::CONTENT_LENGTH) {
        Ok(Some(text)) => text.parse::<u64>().ok(),
        _ => None,
    };
    if !st.post_limit.allow() {
        return too_many();
    }
    let (incoming, written) = match receive(dir.clone(), size, body).await {
        Ok(done) => done,
        Err(response) => return response,
    };
    let Some(file_name) = incoming.path.file_name().and_then(|n| n.to_str()) else {
        return error_body(
            StatusCode::INTERNAL_SERVER_ERROR,
            "upload_failed",
            "the file could not be written",
        );
    };
    let request = json!({
        "ops": [{ "op": "attach", "id": id, "from": "upload", "upload": file_name, "name": name }],
        "upload_dir": dir.to_string_lossy(),
    });
    let reply = match ask(&st, Calls::Ops, Some(&request)).await {
        Ok(reply) => reply,
        Err(response) => {
            st.rt().store.request_rescan();
            return response;
        }
    };
    drop(incoming);
    settle_write(&st, &reply.text).await;
    let large_for_git = written >= LARGE_FOR_GIT
        && rt
            .vault
            .as_ref()
            .is_some_and(|vault| vault.join(".git").exists());
    if !large_for_git {
        return json_response(StatusCode::OK, reply.text, None);
    }
    let mut doc: serde_json::Value = match serde_json::from_str(&reply.text) {
        Ok(doc) => doc,
        Err(_) => return json_response(StatusCode::OK, reply.text, None),
    };
    doc["large_for_git"] = serde_json::Value::Bool(true);
    json_response(StatusCode::OK, doc.to_string(), None)
}

/// The header with the name of the file.
static UPLOAD_NAME: header::HeaderName = header::HeaderName::from_static("x-upload-name");

#[cfg(test)]
mod tests {
    use super::{clean_name, percent_decoded};

    #[test]
    fn a_name_is_what_the_engine_takes_as_an_asset() {
        assert_eq!(clean_name("report.pdf"), "report.pdf");
        assert_eq!(clean_name("My Report (2).pdf"), "My-Report--2-.pdf");
        assert_eq!(clean_name(r"C:\Users\me\secret.txt"), "secret.txt");
        assert_eq!(clean_name("../../etc/passwd"), "passwd");
        assert_eq!(clean_name("..hidden"), "hidden");
        assert_eq!(clean_name("a..b.txt"), "a.b.txt");
        assert_eq!(clean_name("trailing."), "trailing");
        assert_eq!(clean_name("Übersicht.md"), "Übersicht.md");
        assert_eq!(clean_name("a\u{85}b"), "a-b");
        for nothing in ["", "...", "---", "/", " "] {
            assert_eq!(clean_name(nothing), "upload", "{nothing:?}");
        }
        let long = format!("{}.tar", "x".repeat(400));
        let short = clean_name(&long);
        assert!(short.len() <= 120, "{}", short.len());
        assert!(short.ends_with(".tar"));
    }

    #[test]
    fn a_name_comes_percent_encoded() {
        assert_eq!(percent_decoded("a%20b.txt"), "a b.txt");
        assert_eq!(percent_decoded("%C3%9Cbersicht.md"), "Übersicht.md");
        assert_eq!(percent_decoded("100%"), "100%");
        assert_eq!(percent_decoded("%zz"), "%zz");
    }
}
