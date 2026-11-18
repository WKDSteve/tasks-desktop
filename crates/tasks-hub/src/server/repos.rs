//! The routes of the repo tiles (`crate::repos`): the document, the image of a tile, adding a folder and saving the
//! groups. The page sends ids and texts, a path only when a folder is added (checked as a vault folder is, never sent
//! back); every answer of a write is the new document. The folders below `REPOS_DIR` are suggested by name
//! (`repo_suggest`), and a name of that list stands for the folder of that name there.

use std::collections::BTreeMap;

use super::*;
use crate::repos::{self, Group, Refused, Store};

/// The longest name of a repo or title of a group, in characters (as the file holds them).
const TEXT_MAX: usize = repos::MAX_TEXT;

fn unavailable() -> Response {
    error_body(
        StatusCode::NOT_FOUND,
        "repos_unavailable",
        "this hub keeps no repo tiles",
    )
}

/// The areas of the vault, as the engine names them; none when it cannot say (a tile then opens no area).
async fn area_names(st: &Arc<Shared>) -> Vec<String> {
    let Ok(text) = ask_held(st, false, AREAS_KEY, Calls::Areas, None).await else {
        return Vec::new();
    };
    let Ok(doc) = serde_json::from_str::<serde_json::Value>(&text) else {
        return Vec::new();
    };
    doc["areas"]
        .as_array()
        .map_or(&[][..], Vec::as_slice)
        .iter()
        .filter_map(|a| a["name"].as_str().map(str::to_owned))
        .collect()
}

async fn document(st: &Arc<Shared>, store: &Store) -> serde_json::Value {
    let areas = area_names(st).await;
    let policy = Arc::clone(&st.rt().classes);
    store.document(&areas, &policy)
}

fn refused(st_doc: serde_json::Value, why: Refused) -> Response {
    match why {
        Refused::Bad(message) => error_body(StatusCode::BAD_REQUEST, "bad_request", &message),
        Refused::Io(message) => {
            error_body(StatusCode::INTERNAL_SERVER_ERROR, "write_failed", &message)
        }
        Refused::Stale => {
            let body = json!({
                "error": { "code": "stale", "message": "the tiles changed meanwhile: here is what they are now" },
                "document": st_doc,
            });
            json_response(StatusCode::CONFLICT, body.to_string(), None)
        }
    }
}

/// `GET /api/tasks/repos`: the tiles of this device (`hub.repos`): groups, titles, each repo with its name, the last
/// part of its folder, whether it has an image and its area. No path.
pub(super) async fn repos(State(st): State<Arc<Shared>>, RawQuery(query): RawQuery) -> Response {
    if let Some(response) = no_query(query.as_deref()) {
        return response;
    }
    let Some(store) = st.rt().repos.clone() else {
        return unavailable();
    };
    json_response(
        StatusCode::OK,
        document(&st, &store).await.to_string(),
        None,
    )
}

/// `GET /api/tasks/repos/image?id=`: the image of a tile as bytes of a fixed type, with a policy that lets nothing in
/// it run (an SVG is code). 404 `no_image` when the repo has none.
pub(super) async fn repo_image(
    State(st): State<Arc<Shared>>,
    RawQuery(query): RawQuery,
) -> Response {
    let Some(store) = st.rt().repos.clone() else {
        return unavailable();
    };
    let id = match parse_query(query.as_deref(), &["id"]) {
        Ok(q) => q.get("id").cloned().unwrap_or_default(),
        Err(why) => return error_body(StatusCode::BAD_REQUEST, "bad_request", why),
    };
    if !repos::valid_id(&id) {
        return error_body(
            StatusCode::BAD_REQUEST,
            "bad_id",
            "id is 8 lowercase letters or digits",
        );
    }
    let found = tokio::task::spawn_blocking(move || store.image(&id))
        .await
        .ok()
        .flatten();
    let Some(image) = found else {
        return error_body(StatusCode::NOT_FOUND, "no_image", "this repo has no image");
    };
    let mut response = Response::new(Body::from(image.bytes));
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(image.content_type),
    );
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        "content-security-policy",
        HeaderValue::from_static("default-src 'none'; style-src 'unsafe-inline'; sandbox"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

/// The most folders the suggestions name.
const SUGGEST_MAX: usize = 500;

/// Is `name` the name of a folder a suggestion may be, and `repo_add` takes for the folder of that name below
/// `REPOS_DIR`: one plain part of a path (no separator, no drive, not `.` or `..`, no leading dot, no control
/// character), at most 255 bytes?
fn suggestion_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 255
        && !name.starts_with('.')
        && !name.ends_with(['.', ' '])
        && !name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])
        && !name.chars().any(char::is_control)
}

/// The names of the folders directly below `root` that are no tile yet (`taken`), sorted without regard to case, at
/// most `SUGGEST_MAX`; the flag says that there were more. Files, hidden folders and names `suggestion_name` refuses
/// are left out. A folder that cannot be read gives none.
fn suggestions(root: &std::path::Path, taken: &[PathBuf]) -> (Vec<String>, bool) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return (Vec::new(), false);
    };
    let mut names: Vec<String> = entries
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .filter(|e| !hidden_on_disk(e))
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|name| suggestion_name(name))
        .filter(|name| {
            let folder = root.join(name);
            !taken.iter().any(|t| same_folder(t, &folder))
        })
        .collect();
    names.sort_by_key(|n| n.to_lowercase());
    let more = names.len() > SUGGEST_MAX;
    names.truncate(SUGGEST_MAX);
    (names, more)
}

/// Whether the folder of `entry` is hidden by the file system: on Windows the attributes hidden or system (what
/// Explorer leaves out, `$RECYCLE.BIN` and `System Volume Information` of a drive root), elsewhere nothing beyond the
/// leading dot `suggestion_name` refuses. The attributes come with the listing, no further look at the disk.
fn hidden_on_disk(entry: &std::fs::DirEntry) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const HIDDEN_OR_SYSTEM: u32 = 0x2 | 0x4;
        entry
            .metadata()
            .map_or(true, |m| m.file_attributes() & HIDDEN_OR_SYSTEM != 0)
    }
    #[cfg(not(windows))]
    {
        let _ = entry;
        false
    }
}

/// Whether two paths name one folder as the person writes them: the separators and, on Windows, the case of the
/// letters do not tell them apart. (No look at the disk: a tile keeps the path it was added with.)
fn same_folder(a: &std::path::Path, b: &std::path::Path) -> bool {
    let plain = |p: &std::path::Path| {
        let text = p.to_string_lossy().replace('\\', "/");
        let text = text.trim_end_matches('/').to_owned();
        if cfg!(windows) {
            text.to_lowercase()
        } else {
            text
        }
    };
    plain(a) == plain(b)
}

/// `GET /api/tasks/repos/suggest`: the folders below `REPOS_DIR` that are no tile yet, by name (`hub.repo_suggestions`:
/// `folders`, `truncated`). Names only, never a path; a hub that knows no `REPOS_DIR` answers with an empty list.
pub(super) async fn repo_suggest(
    State(st): State<Arc<Shared>>,
    RawQuery(query): RawQuery,
) -> Response {
    if let Some(response) = no_query(query.as_deref()) {
        return response;
    }
    let rt = st.rt();
    let Some(store) = rt.repos.clone() else {
        return unavailable();
    };
    let root = rt.snapshot_root.clone();
    let listed = tokio::task::spawn_blocking(move || match root {
        Some(root) => suggestions(&root, &store.folders()),
        None => (Vec::new(), false),
    })
    .await
    .unwrap_or_default();
    let body = json!({
        "schema": 1,
        "kind": "hub.repo_suggestions",
        "folders": listed.0,
        "truncated": listed.1,
    });
    json_response(StatusCode::OK, body.to_string(), None)
}

/// `GET /api/tasks/repos/status?id=[&fresh=1]`: the state of the repo of a tile (`hub.repo_status`): its checkout
/// (`local`: clean, dirty, unpushed, behind, diverged, with the numbers and the branch) and the CI of its newest pushed
/// commit (`ci`: green, red, running, queued, approval, cancelled, skipped, none, with the address of the run and, for
/// a commit that waits for approval, the command that approves it). `unavailable` with a `reason` of a fixed set when
/// `git` or `gh` is missing, not logged in or offline. The hub throttles the questions per repo (`repos::status`);
/// `fresh` asks `git` again now. No folder is named.
pub(super) async fn repo_status(
    State(st): State<Arc<Shared>>,
    RawQuery(query): RawQuery,
) -> Response {
    let rt = st.rt();
    let (Some(store), Some(status)) = (rt.repos.clone(), rt.repo_status.clone()) else {
        return unavailable();
    };
    let (id, fresh) = match parse_query(query.as_deref(), &["id", "fresh"]) {
        Ok(q) => (
            q.get("id").cloned().unwrap_or_default(),
            q.get("fresh").cloned(),
        ),
        Err(why) => return error_body(StatusCode::BAD_REQUEST, "bad_request", why),
    };
    if !repos::valid_id(&id) {
        return error_body(
            StatusCode::BAD_REQUEST,
            "bad_id",
            "id is 8 lowercase letters or digits",
        );
    }
    let fresh = match fresh.as_deref() {
        None => false,
        Some("1") => true,
        Some(_) => return error_body(StatusCode::BAD_REQUEST, "bad_request", "fresh is 1"),
    };
    let Some(folder) = store.folder(&id) else {
        return error_body(StatusCode::NOT_FOUND, "not_found", "there is no such tile");
    };
    let mut doc = status.look(&folder, fresh).await;
    doc["id"] = json!(id);
    json_response(StatusCode::OK, doc.to_string(), None)
}

/// `POST /api/tasks/repos/add` `{ "path", "name"?, "group" }`: a folder as a tile of a group. The path is checked as a
/// vault folder is (whole, local, there) and never sent back, not in an error either. A `path` that is one plain name
/// (`suggestion_name`, what `repo_suggest` lists) is the folder of that name below `REPOS_DIR`.
pub(super) async fn repo_add(State(st): State<Arc<Shared>>, body: Bytes) -> Response {
    let Some(store) = st.rt().repos.clone() else {
        return unavailable();
    };
    let map = match vault_request(&body, &["path", "name", "group"]) {
        Ok(m) => m,
        Err(r) => return r,
    };
    let path = match vault_text(&map, "path", 1024) {
        Ok(p) => p,
        Err(r) => return r,
    };
    let group = match vault_text(&map, "group", repos::ID_LEN) {
        Ok(g) => g,
        Err(r) => return r,
    };
    let name = if map.contains_key("name") {
        match vault_text(&map, "name", TEXT_MAX) {
            Ok(n) => Some(n),
            Err(r) => return r,
        }
    } else {
        None
    };
    let path = match st.rt().snapshot_root.as_deref() {
        Some(root) if suggestion_name(&path) => root.join(&path).to_string_lossy().into_owned(),
        _ => path,
    };
    let folder = match crate::app::checked_folder(&path) {
        Ok(f) => f,
        Err(why) => return error_body(StatusCode::BAD_REQUEST, "bad_folder", &why),
    };
    let added = {
        let store = Arc::clone(&store);
        tokio::task::spawn_blocking(move || store.add(&folder, name.as_deref(), &group)).await
    };
    match added {
        Ok(Ok(())) => json_response(
            StatusCode::OK,
            document(&st, &store).await.to_string(),
            None,
        ),
        Ok(Err(why)) => refused(document(&st, &store).await, why),
        Err(_) => error_body(
            StatusCode::INTERNAL_SERVER_ERROR,
            "write_failed",
            "the change stopped unexpectedly",
        ),
    }
}

/// `POST /api/tasks/repos/save` `{ "rev", "groups", "names" }`: the groups (their order, titles and tiles) and the
/// names of the repos, on the state the page read: another `rev` is a 409 with the document as it is now.
pub(super) async fn repo_save(State(st): State<Arc<Shared>>, body: Bytes) -> Response {
    let Some(store) = st.rt().repos.clone() else {
        return unavailable();
    };
    let map = match vault_request(&body, &["rev", "groups", "names"]) {
        Ok(m) => m,
        Err(r) => return r,
    };
    let rev = match vault_text(&map, "rev", 64) {
        Ok(r) => r,
        Err(r) => return r,
    };
    let groups: Vec<Group> =
        match serde_json::from_value(map.get("groups").cloned().unwrap_or(json!([]))) {
            Ok(g) => g,
            Err(_) => {
                return error_body(
                    StatusCode::BAD_REQUEST,
                    "bad_request",
                    "groups: a list of { id, title, tiles }",
                )
            }
        };
    let names: BTreeMap<String, String> =
        match serde_json::from_value(map.get("names").cloned().unwrap_or(json!({}))) {
            Ok(n) => n,
            Err(_) => {
                return error_body(
                    StatusCode::BAD_REQUEST,
                    "bad_request",
                    "names: an object of id to name",
                )
            }
        };
    let saved = {
        let store = Arc::clone(&store);
        tokio::task::spawn_blocking(move || store.save(&rev, groups, &names)).await
    };
    match saved {
        Ok(Ok(())) => json_response(
            StatusCode::OK,
            document(&st, &store).await.to_string(),
            None,
        ),
        Ok(Err(why)) => refused(document(&st, &store).await, why),
        Err(_) => error_body(
            StatusCode::INTERNAL_SERVER_ERROR,
            "write_failed",
            "the change stopped unexpectedly",
        ),
    }
}

/// `POST /api/tasks/repos/open` `{ "id", "what": "folder" | "nvim" }`: show the folder of a tile in the file manager, or
/// start Neovim in it. The page names the tile, never a folder; the hub starts the program with the folder as its one
/// argument (no shell).
pub(super) async fn repo_open(State(st): State<Arc<Shared>>, body: Bytes) -> Response {
    let Some(store) = st.rt().repos.clone() else {
        return unavailable();
    };
    let Some(opener) = st.rt().opener.clone() else {
        return error_body(
            StatusCode::NOT_FOUND,
            "open_unavailable",
            "this hub cannot open a folder",
        );
    };
    let map = match vault_request(&body, &["id", "what"]) {
        Ok(m) => m,
        Err(r) => return r,
    };
    let id = match vault_text(&map, "id", repos::ID_LEN) {
        Ok(id) if repos::valid_id(&id) => id,
        Ok(_) => {
            return error_body(
                StatusCode::BAD_REQUEST,
                "bad_id",
                "id is 8 lowercase letters or digits",
            )
        }
        Err(r) => return r,
    };
    let what = map
        .get("what")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_owned();
    if what != "folder" && what != "nvim" {
        return error_body(
            StatusCode::BAD_REQUEST,
            "bad_request",
            "what is folder or nvim",
        );
    }
    let Some(folder) = store.folder(&id) else {
        return error_body(StatusCode::NOT_FOUND, "not_found", "there is no such tile");
    };
    if !folder.is_dir() {
        return error_body(
            StatusCode::NOT_FOUND,
            "folder_missing",
            "the folder of the tile is not there",
        );
    }
    let opened = tokio::task::spawn_blocking(move || {
        if what == "folder" {
            opener.reveal(&folder)
        } else {
            opener.open(&folder, None)
        }
    })
    .await;
    match opened {
        Ok(Ok(())) => axum::Json(json!({ "ok": true })).into_response(),
        Ok(Err(why)) => error_body(StatusCode::BAD_GATEWAY, "open_failed", &why),
        Err(_) => error_body(
            StatusCode::INTERNAL_SERVER_ERROR,
            "open_failed",
            "the start stopped unexpectedly",
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `REPOS_DIR` on a drive root: the folders Windows keeps there (hidden, system) are no suggestion; the plain ones
    /// are.
    #[cfg(windows)]
    #[test]
    fn a_drive_root_suggests_no_folder_windows_hides() {
        let drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".to_owned());
        let root = PathBuf::from(format!("{drive}\\"));
        let (names, _) = suggestions(&root, &[]);
        for hidden in ["$Recycle.Bin", "System Volume Information"] {
            if root.join(hidden).exists() {
                assert!(
                    !names.iter().any(|n| n.eq_ignore_ascii_case(hidden)),
                    "{hidden} in {names:?}"
                );
            }
        }
        if root.join("Windows").is_dir() {
            assert!(names.iter().any(|n| n == "Windows"), "{names:?}");
        }
    }
}
