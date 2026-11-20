//! `GET /api/tasks/asset?kind=task|plan|project|path|meeting&id=<area>/<slug>&file=assets/...`: an image file of a
//! container, for the page to draw in a text, as an icon, a cover or a badge (`crate::assets`).
//!
//! The folder comes from the engine (the `file` of a task, a path or a meeting) or from its layout (a plan or a
//! project in its folder form), never from the page; the page names only the path below `assets/`, which is checked
//! before and after every link is followed. The answer is sealed like a meeting's preview (`nosniff`, a CSP with
//! `sandbox`, `no-store`). A paired phone gets none: what of a container may reach a phone is decided with the phone's
//! view of it; until then `403 not_for_devices` (fail closed).

use super::*;
use crate::assets::{self, Owner, Refusal};

fn not_for_devices() -> Response {
    error_body(
        StatusCode::FORBIDDEN,
        "not_for_devices",
        "the assets are not released for devices yet",
    )
}

fn missing() -> Response {
    error_body(
        StatusCode::NOT_FOUND,
        "no_asset",
        "the container has no such image",
    )
}

/// The query of `asset`: the owner, its id and the path below `assets/`; `Err`: why it is refused.
pub(super) fn asset_request(query: Option<&str>) -> Result<(Owner, String, String), &'static str> {
    let params = parse_query(query, &["kind", "id", "file"])?;
    let owner = params
        .get("kind")
        .and_then(|k| Owner::from_word(k))
        .ok_or("kind is task, plan, project, path or meeting")?;
    let id = params
        .get("id")
        .filter(|id| valid_task_id(id))
        .cloned()
        .ok_or("id must be <area>/<slug>")?;
    let file = params
        .get("file")
        .filter(|f| assets::valid_asset_path(f))
        .cloned()
        .ok_or("file is an image below assets/")?;
    Ok((owner, id, file))
}

/// The file of the container relative to the vault, when it is in its folder form; `Ok(None)`: it has no folder (or
/// is not there); `Err`: the answer to send (the engine failed).
#[allow(clippy::result_large_err)]
async fn container_file(st: &Shared, owner: Owner, id: &str) -> Result<Option<String>, Response> {
    let entry_file = |doc: &serde_json::Value, key: &str| {
        let entry = &doc[key];
        (entry["id"] == id && entry["folder"] == true)
            .then(|| entry["file"].as_str().map(str::to_owned))
            .flatten()
    };
    match owner {
        Owner::Task => {
            let text = match task_document(st, Some(&format!("id={id}"))).await {
                Ok(text) => text,
                Err(response) if response.status() == StatusCode::NOT_FOUND => return Ok(None),
                Err(response) => return Err(response),
            };
            let doc: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
            Ok(entry_file(&doc, "task"))
        }
        Owner::Path => match ask_as(st, false, Calls::Path, Some(&json!({ "id": id }))).await {
            Ok(reply) => {
                let doc: serde_json::Value = serde_json::from_str(&reply.text).unwrap_or_default();
                Ok(entry_file(&doc, "path"))
            }
            Err(response) if response.status() == StatusCode::NOT_FOUND => Ok(None),
            Err(response) => Err(response),
        },
        Owner::Meeting => match self::meetings::meeting_value(st, id).await {
            Ok(doc) => Ok(entry_file(&doc, "meeting")),
            Err(response) if response.status() == StatusCode::NOT_FOUND => Ok(None),
            Err(response) => Err(response),
        },
        Owner::Plan | Owner::Project => {
            let (area, slug) = id.split_once('/').unwrap_or_default();
            Ok(owner.folder_file(area, slug))
        }
    }
}

/// `GET /api/tasks/asset`: the image, sealed; `400 bad_query`, `404 no_asset`, `413 too_large`.
pub(super) async fn asset(
    State(st): State<Arc<Shared>>,
    caller: Option<axum::Extension<Caller>>,
    RawQuery(query): RawQuery,
) -> Response {
    if is_device(caller.as_deref()) {
        return not_for_devices();
    }
    let (owner, id, file) = match asset_request(query.as_deref()) {
        Ok(q) => q,
        Err(why) => return error_body(StatusCode::BAD_REQUEST, "bad_query", why),
    };
    let Some(vault) = st.rt().vault.clone() else {
        return engine_unavailable(&st);
    };
    let container = match container_file(&st, owner, &id).await {
        Ok(Some(file)) => file,
        Ok(None) => return missing(),
        Err(response) => return response,
    };
    let read = tokio::task::spawn_blocking(move || {
        let (path, kind) = assets::resolve(&vault, &container, &file)?;
        std::fs::read(path)
            .map(|bytes| (bytes, kind))
            .map_err(|_| Refusal::Missing)
    })
    .await;
    match read {
        Ok(Ok((bytes, kind))) => {
            let mut response = Response::new(Body::from(bytes));
            let headers = response.headers_mut();
            headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(kind));
            self::meetings::sealed(headers);
            response
        }
        Ok(Err(Refusal::TooLarge)) => error_body(
            StatusCode::PAYLOAD_TOO_LARGE,
            "too_large",
            "the image is larger than the page is given",
        ),
        Ok(Err(Refusal::BadPath)) => error_body(
            StatusCode::BAD_REQUEST,
            "bad_query",
            "file is an image below assets/",
        ),
        Ok(Err(Refusal::Missing)) | Err(_) => missing(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_query_of_asset_names_an_owner_an_id_and_an_image_below_assets() {
        assert_eq!(
            asset_request(Some("kind=task&id=a/t&file=assets/images/x.svg")),
            Ok((
                Owner::Task,
                "a/t".to_owned(),
                "assets/images/x.svg".to_owned()
            ))
        );
        assert_eq!(
            asset_request(Some("kind=meeting&id=a/m&file=assets/c.PNG")),
            Ok((Owner::Meeting, "a/m".to_owned(), "assets/c.PNG".to_owned()))
        );
        for bad in [
            "",
            "kind=task&id=a/t",
            "kind=board&id=a/t&file=assets/x.png",
            "kind=task&id=../x&file=assets/x.png",
            "kind=task&id=a/t&file=x.png",
            "kind=task&id=a/t&file=assets/../t.md",
            "kind=task&id=a/t&file=assets/x.txt",
            "kind=task&id=a/t&file=/assets/x.png",
            "kind=task&id=a/t&file=assets%2F..%2Fx.png",
            "kind=task&id=a/t&file=assets/x.png&file=assets/y.png",
            "kind=task&id=a/t&file=assets/x.png&url=https://x",
        ] {
            assert!(asset_request(Some(bad)).is_err(), "{bad}");
        }
    }
}
