//! `POST /api/tasks/board`: a whiteboard of the page's own drawing surface (concept 7.8, format `ink`) saved into
//! `assets/boards/` of a meeting, task, plan or project through the engine's `board_save`.
//!
//! The body is `{ "id", "name", "if_match"?, "ink", "svg" }`: the board as the text of its `.ink.json` and its preview as
//! the text of an SVG. Both are written to the hub's upload folder under names the hub gives (nothing of a path comes
//! from the page) and handed to the engine, which copies them below the container and replaces a board only on the
//! version read (`if_match`, else `conflict` with a free name). The files in the upload folder go when the request
//! does, whatever came of it. `board_save` is not one of the operations of `ops`: a request there names no upload
//! folder, and the page must not name one. A paired phone gets `403 not_for_devices` (fail closed): drawing a board is
//! not released for devices.

use std::io::Write as _;

use super::*;

/// The largest body: the engine takes a board and its preview of 50 MiB each; a page drawing with a picture behind
/// stays far below (the picture is made smaller before it is put in).
pub(super) const BOARD_MAX_BYTES: usize = 48 * 1024 * 1024;
/// The longest name of a board (the engine takes an asset name; the page names boards by date and time).
const MAX_NAME: usize = 80;

fn not_for_devices() -> Response {
    error_body(
        StatusCode::FORBIDDEN,
        "not_for_devices",
        "the boards are not released for devices yet",
    )
}

fn bad(code: &str, why: &str) -> Response {
    error_body(StatusCode::BAD_REQUEST, code, why)
}

/// A name of a board: letters, digits, `-` and `_`, starting with a letter or digit, no dot (the ending is the
/// format's), at most [`MAX_NAME`] bytes.
pub(super) fn valid_board_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_NAME
        && name.chars().next().is_some_and(char::is_alphanumeric)
        && name
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
}

/// An `if_match` as the engine writes an etag: `sha256:` and 16 hex digits.
pub(super) fn valid_etag(etag: &str) -> bool {
    etag.strip_prefix("sha256:")
        .is_some_and(|hex| hex.len() == 16 && hex.bytes().all(|b| b.is_ascii_hexdigit()))
}

/// A file in the upload folder while the request runs; it goes when this does.
struct Staged {
    path: PathBuf,
}

impl Drop for Staged {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Write `text` to a new file of `dir` named `<fresh>.<ending>`.
fn stage(dir: &std::path::Path, stem: &str, ending: &str, text: &str) -> std::io::Result<Staged> {
    std::fs::create_dir_all(dir)?;
    let path = dir.join(format!("{stem}.{ending}"));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)?;
    let staged = Staged { path };
    file.write_all(text.as_bytes())?;
    file.flush()?;
    Ok(staged)
}

/// A stem no other request has: the time, this process and a counter.
fn fresh_stem() -> String {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis());
    format!(
        "b{millis}-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    )
}

/// The `board_save` of a request; `if_match` only when one was given.
pub(super) fn board_op(
    id: &str,
    name: &str,
    upload: &str,
    preview: &str,
    if_match: Option<&str>,
) -> serde_json::Value {
    let mut op = json!({
        "op": "board_save", "id": id, "name": name, "format": "ink", "upload": upload, "preview": preview,
    });
    if let Some(etag) = if_match {
        op["if_match"] = json!(etag);
    }
    op
}

pub(super) async fn board(
    State(st): State<Arc<Shared>>,
    caller: Option<axum::Extension<Caller>>,
    body: Bytes,
) -> Response {
    if is_device(caller.as_deref()) {
        return not_for_devices();
    }
    let map = match vault_request(&body, &["id", "name", "if_match", "ink", "svg"]) {
        Ok(m) => m,
        Err(r) => return r,
    };
    let text = |key: &str| map.get(key).and_then(serde_json::Value::as_str);
    let Some(id) = text("id").filter(|id| valid_task_id(id)) else {
        return bad("bad_id", "id must be <area>/<slug>");
    };
    let Some(name) = text("name").filter(|n| valid_board_name(n)) else {
        return bad(
            "bad_name",
            "name: letters, digits, - and _, at most 80, no dot",
        );
    };
    let if_match = match map.get("if_match") {
        None => None,
        Some(serde_json::Value::String(etag)) if valid_etag(etag) => Some(etag.as_str()),
        Some(_) => return bad("bad_if_match", "if_match is the etag of the board"),
    };
    let (Some(ink), Some(svg)) = (text("ink"), text("svg")) else {
        return bad(
            "bad_board",
            "ink and svg are the texts of the board and its preview",
        );
    };
    // The format is the engine's to judge; the hub only holds that the board is a JSON object, not some other text.
    let ink_is_object = serde_json::from_str::<serde_json::Value>(ink).is_ok_and(|v| v.is_object());
    if !ink_is_object || !svg.trim_start().starts_with("<svg") {
        return bad(
            "bad_board",
            "ink is the board as a JSON object, svg an SVG of it",
        );
    }
    if !st.post_limit.allow() {
        return too_many();
    }
    let rt = st.rt();
    let Some(dir) = rt.upload_dir.as_deref().cloned() else {
        return error_body(
            StatusCode::NOT_FOUND,
            "not_available",
            "this hub takes no files",
        );
    };
    let (ink, svg) = (ink.to_owned(), svg.to_owned());
    let folder = dir.clone();
    let staged = tokio::task::spawn_blocking(move || {
        let stem = fresh_stem();
        let board = stage(&folder, &stem, "json", &ink)?;
        let preview = stage(&folder, &stem, "svg", &svg)?;
        Ok::<_, std::io::Error>((board, preview))
    })
    .await;
    let (board, preview) = match staged {
        Ok(Ok(files)) => files,
        Ok(Err(e)) if e.kind() == std::io::ErrorKind::StorageFull => {
            return error_body(
                StatusCode::INSUFFICIENT_STORAGE,
                "disk_full",
                "there is no room for the board on the disk of the hub",
            )
        }
        Ok(Err(e)) => {
            eprintln!("board: {e}");
            return error_body(
                StatusCode::INTERNAL_SERVER_ERROR,
                "upload_failed",
                "the board could not be written",
            );
        }
        Err(_) => {
            return error_body(
                StatusCode::INTERNAL_SERVER_ERROR,
                "upload_failed",
                "the board could not be written",
            )
        }
    };
    let file_name = |s: &Staged| {
        s.path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_owned()
    };
    let request = json!({
        "ops": [board_op(id, name, &file_name(&board), &file_name(&preview), if_match)],
        "upload_dir": dir.to_string_lossy(),
    });
    let reply = match ask(&st, Calls::Ops, Some(&request)).await {
        Ok(reply) => reply,
        Err(response) => {
            st.rt().store.request_rescan();
            return response;
        }
    };
    drop((board, preview));
    settle_write(&st, &reply.text).await;
    json_response(StatusCode::OK, reply.text, None)
}

#[cfg(test)]
mod tests {
    use super::{board_op, valid_board_name, valid_etag};

    #[test]
    fn a_board_name_is_a_plain_word_without_a_dot() {
        for good in ["board-2026-11-20-1015", "Skizze_1", "a", "Übersicht"] {
            assert!(valid_board_name(good), "{good}");
        }
        for bad in [
            "",
            "-x",
            "_x",
            "a.ink",
            "../x",
            "a/b",
            "a b",
            "a\\b",
            &"x".repeat(81),
        ] {
            assert!(!valid_board_name(bad), "{bad}");
        }
    }

    #[test]
    fn an_if_match_is_an_etag_of_the_engine() {
        assert!(valid_etag("sha256:0123456789abcdef"));
        for bad in [
            "",
            "sha256:",
            "sha256:0123456789abcdeg",
            "sha256:0123456789abcdef0",
            "md5:0123456789abcdef",
        ] {
            assert!(!valid_etag(bad), "{bad}");
        }
    }

    #[test]
    fn the_op_names_if_match_only_when_given() {
        let fresh = board_op("a/m", "b", "u.json", "u.svg", None);
        assert_eq!(fresh["format"], "ink");
        assert!(fresh.get("if_match").is_none());
        let again = board_op(
            "a/m",
            "b",
            "u.json",
            "u.svg",
            Some("sha256:0123456789abcdef"),
        );
        assert_eq!(again["if_match"], "sha256:0123456789abcdef");
    }
}
