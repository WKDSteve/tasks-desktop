//! The routes of the repo tiles (`crate::repos`): the document, the image of a tile, adding a folder and saving the
//! groups. The page sends ids and texts, a path only when a folder is added (checked as a vault folder is, never sent
//! back); every answer of a write is the new document.

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
    let Ok(reply) = ask(st, Calls::Areas, None).await else {
        return Vec::new();
    };
    let Ok(doc) = serde_json::from_str::<serde_json::Value>(&reply.text) else {
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

/// `POST /api/tasks/repos/add` `{ "path", "name"?, "group" }`: a folder as a tile of a group. The path is checked as a
/// vault folder is (whole, local, there) and never sent back, not in an error either.
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
