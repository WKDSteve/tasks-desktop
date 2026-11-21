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

/// The value of `file` as the page sends it: percent-encoded, since a name may have a space or a letter of any
/// language. Strict: every byte that is not escaped is plain (letters, digits, `. _ - /`), every `%` is followed by two
/// hex digits, the result is UTF-8, and no escape stands for `/`, `\` or a control character (a separator only as it is
/// written). The path is judged afterwards like any other (`valid_asset_path`: no `..`, no root, no drive).
fn decoded_file(raw: &str) -> Option<String> {
    if raw.is_empty() || raw.len() > 3 * 512 {
        return None;
    }
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'%' {
            let hex = raw
                .get(i + 1..i + 3)
                .filter(|h| h.bytes().all(|c| c.is_ascii_hexdigit()))?;
            let byte = u8::from_str_radix(hex, 16).ok()?;
            if byte == b'/' || byte == b'\\' || byte < 0x20 || byte == 0x7f {
                return None;
            }
            out.push(byte);
            i += 3;
        } else if b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-' | b'/') {
            out.push(b);
            i += 1;
        } else {
            return None;
        }
    }
    String::from_utf8(out).ok()
}

/// The query of `asset`: the owner, its id and the path below `assets/`; `Err`: why it is refused. `file` alone is
/// percent-decoded (`decoded_file`); `kind` and `id` stay plain text (`parse_query`).
pub(super) fn asset_request(query: Option<&str>) -> Result<(Owner, String, String), &'static str> {
    let mut file_raw = None;
    let mut rest = Vec::new();
    for pair in query.unwrap_or("").split('&').filter(|p| !p.is_empty()) {
        match pair.split_once('=') {
            Some(("file", value)) => {
                if file_raw.replace(value).is_some() {
                    return Err("a query parameter is given twice");
                }
            }
            _ => rest.push(pair),
        }
    }
    let rest = rest.join("&");
    let params = parse_query(Some(&rest), &["kind", "id"])?;
    let owner = params
        .get("kind")
        .and_then(|k| Owner::from_word(k))
        .ok_or("kind is task, plan, project, path or meeting")?;
    let id = params
        .get("id")
        .filter(|id| valid_task_id(id))
        .cloned()
        .ok_or("id must be <area>/<slug>")?;
    let file = file_raw
        .and_then(decoded_file)
        .filter(|f| assets::valid_asset_path(f))
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

/// The tag of an asset's bytes: their length and a digest of them, so a file replaced by one of another content is
/// told apart even when the copy kept the old time of the file.
pub(super) fn content_tag(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(bytes);
    let short: String = digest[..12].iter().map(|b| format!("{b:02x}")).collect();
    format!("a{}-{short}", bytes.len())
}

/// `GET /api/tasks/asset`: the image, sealed, with an `ETag` of its bytes; `304` when `If-None-Match` names them;
/// `400 bad_query`, `404 no_asset`, `413 too_large`.
pub(super) async fn asset(
    State(st): State<Arc<Shared>>,
    caller: Option<axum::Extension<Caller>>,
    headers: HeaderMap,
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
    let seen = single(&headers, &header::IF_NONE_MATCH).ok().flatten();
    let read = tokio::task::spawn_blocking(move || {
        let (path, kind) = assets::resolve(&vault, &container, &file)?;
        std::fs::read(path)
            .map(|bytes| (bytes, kind))
            .map_err(|_| Refusal::Missing)
    })
    .await;
    match read {
        Ok(Ok((bytes, kind))) => {
            // The page asks again with the tag it holds (a file replaced by hand under the same name is no event of
            // the vault): the same bytes answer 304 and the page keeps its picture.
            let tag = content_tag(&bytes);
            if seen.is_some_and(|h| etag_matches(&h, &tag)) {
                return not_modified(&tag);
            }
            let mut response = Response::new(Body::from(bytes));
            let headers = response.headers_mut();
            headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(kind));
            if let Ok(value) = HeaderValue::from_str(&format!("\"{tag}\"")) {
                headers.insert(header::ETAG, value);
            }
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

    /// A name with a space or a letter of any language comes percent-encoded, as the page sends it, and is read; an
    /// escape for a separator, a way up, a control character or one that does not decode stays refused.
    #[test]
    fn the_file_of_asset_may_be_percent_encoded_and_is_still_a_plain_path_below_assets() {
        for (query, file) in [
            (
                "kind=task&id=a/t&file=assets/mein%20bild.png",
                "assets/mein bild.png",
            ),
            (
                "kind=path&id=a/p&file=assets/%C3%BCbersicht.svg",
                "assets/übersicht.svg",
            ),
            ("kind=task&id=a/t&file=assets/a%2eb.png", "assets/a.b.png"),
        ] {
            assert_eq!(
                asset_request(Some(query)).map(|(_, _, f)| f),
                Ok(file.to_owned()),
                "{query}"
            );
        }
        for bad in [
            "kind=task&id=a/t&file=assets/%2e%2e/t.png",
            "kind=task&id=a/t&file=assets%2fx.png",
            "kind=task&id=a/t&file=assets/x%5c..%5ct.png",
            "kind=task&id=a/t&file=assets/x%0a.png",
            "kind=task&id=a/t&file=assets/x%7f.png",
            "kind=task&id=a/t&file=assets/x%c2%85.png",
            "kind=task&id=a/t&file=assets/x%zz.png",
            "kind=task&id=a/t&file=assets/x%+5.png",
            "kind=task&id=a/t&file=assets/x%ff.png",
            "kind=task&id=a/t&file=assets/x%3a.png",
            "kind=task&id=a/t&file=assets/a b.png",
            "kind=task&id=a/t&file=assets/x.png&file=assets/y.png",
            "kind=task&id=a%2ft&file=assets/x.png",
        ] {
            assert!(asset_request(Some(bad)).is_err(), "{bad}");
        }
    }
}
