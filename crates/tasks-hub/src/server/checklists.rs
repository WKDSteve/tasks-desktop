//! The routes of the checklists (tab "Lists"): the checklists of the vault with their counts, and the entries of one
//! list through its filter. Each is under `/api/`, so the guard asked for a session before a handler runs.
//!
//! The documents of the engine are passed on as it wrote them; the filter (days, tag, words, state) is the engine's
//! (`tasks.checklist`), the page draws and computes nothing (WEB-13). The writes go through `ops` (`checklist_*`,
//! `entry_*`), the attachments of an entry through `upload` and `board` as those of a task. Not for a paired phone:
//! neither route is a device route, and the operations have no device level (`device_op_level`).

use super::*;

/// The query of `checklist`: the list, the filter and a page.
const CHECKLIST_QUERY: [&str; 8] = [
    "id", "since", "until", "tag", "q", "state", "limit", "offset",
];
/// The largest offset of a page (a list holds far fewer entries).
const MAX_OFFSET: u32 = 100_000;
/// The longest text of a search (`q`) and of a tag, decoded.
const MAX_WORDS: usize = 200;
const MAX_TAG: usize = 40;

fn bad_query(why: &str) -> Response {
    error_body(StatusCode::BAD_REQUEST, "bad_query", why)
}

/// Whether `id` names a checklist: `_list-` and a slug (`a-z`, `0-9`, single hyphens).
pub(super) fn valid_list_id(id: &str) -> bool {
    id.strip_prefix("_list-").is_some_and(|slug| {
        !slug.is_empty()
            && slug.len() <= 120
            && slug
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            && !slug.starts_with('-')
            && !slug.ends_with('-')
            && !slug.contains("--")
    })
}

/// A percent-encoded text of the query (`encodeURIComponent`, with `/` left as it is): the plain bytes of that encoding,
/// `/` and `%XX`, decoded to UTF-8 without a control character; `None` for anything else.
pub(super) fn decoded_text(raw: &str, max: usize) -> Option<String> {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'%' {
            let hex = raw
                .get(i + 1..i + 3)
                .filter(|h| h.bytes().all(|c| c.is_ascii_hexdigit()))?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else if b.is_ascii_alphanumeric() || b"-_.!~*'()/".contains(&b) {
            out.push(b);
            i += 1;
        } else {
            return None;
        }
    }
    let text = String::from_utf8(out).ok()?;
    let plain = !text.trim().is_empty() && text.len() <= max && !text.chars().any(char::is_control);
    plain.then_some(text)
}

/// The question of `checklist` to the engine from the query of the route; `Err`: why it is refused. `tag` and `q` are
/// percent-decoded (`decoded_text`), the rest is plain text (`parse_query`).
pub(super) fn checklist_request(query: Option<&str>) -> Result<serde_json::Value, &'static str> {
    let mut texts: Vec<(&str, &str)> = Vec::new();
    let mut rest = Vec::new();
    for pair in query.unwrap_or("").split('&').filter(|p| !p.is_empty()) {
        match pair.split_once('=') {
            Some((key @ ("tag" | "q"), value)) => {
                if texts.iter().any(|(k, _)| *k == key) {
                    return Err("a query parameter is given twice");
                }
                texts.push((key, value));
            }
            _ => rest.push(pair),
        }
    }
    let rest = rest.join("&");
    let params = parse_query(Some(&rest), &CHECKLIST_QUERY)?;
    let mut request = serde_json::Map::new();
    let id = params
        .get("id")
        .filter(|id| valid_list_id(id))
        .ok_or("id must be _list-<slug>")?;
    request.insert("id".to_owned(), json!(id));
    for key in ["since", "until"] {
        if let Some(day) = params.get(key) {
            if crate::schedule::day_of(day).is_none() {
                return Err("since and until are days, YYYY-MM-DD");
            }
            request.insert(key.to_owned(), json!(day));
        }
    }
    for (key, raw) in texts {
        let max = if key == "tag" { MAX_TAG } else { MAX_WORDS };
        let text = decoded_text(raw, max).ok_or(if key == "tag" {
            "tag is a word of at most 40 bytes"
        } else {
            "q is a text of at most 200 bytes"
        })?;
        request.insert(key.to_owned(), json!(text));
    }
    if let Some(state) = params.get("state") {
        if !matches!(state.as_str(), "open" | "done" | "all") {
            return Err("state is open, done or all");
        }
        request.insert("state".to_owned(), json!(state));
    }
    if let Some(limit) = params.get("limit") {
        match limit.parse::<u64>() {
            Ok(n) if (1..=crate::engine::LIST_PAGE).contains(&n) => {
                request.insert("limit".to_owned(), json!(n));
            }
            _ => return Err("limit is 1 to 100"),
        }
    }
    if let Some(offset) = params.get("offset") {
        match offset.parse::<u32>() {
            Ok(n) if n <= MAX_OFFSET => {
                request.insert("offset".to_owned(), json!(n));
            }
            _ => return Err("offset is a number from 0"),
        }
    }
    Ok(serde_json::Value::Object(request))
}

/// `GET /api/tasks/checklists`: the checklists of the vault by title with their counts (`tasks.checklists`). Asked each
/// time: the state of the vault (the `rev` of the snapshot) is over the tasks.
pub(super) async fn checklists(
    State(st): State<Arc<Shared>>,
    caller: Option<axum::Extension<Caller>>,
    RawQuery(query): RawQuery,
) -> Response {
    if let Some(refused) = no_query(query.as_deref()) {
        return refused;
    }
    match ask_as(&st, is_device(caller.as_deref()), Calls::Checklists, None).await {
        Ok(reply) => json_response(StatusCode::OK, reply.text, None),
        Err(response) => response,
    }
}

/// `GET /api/tasks/checklist?id=_list-<slug>&since=&until=&tag=&q=&state=&limit=&offset=`: the entries of one list the
/// filter lets through, newest first, one page (`tasks.checklist`).
pub(super) async fn checklist(
    State(st): State<Arc<Shared>>,
    caller: Option<axum::Extension<Caller>>,
    RawQuery(query): RawQuery,
) -> Response {
    let request = match checklist_request(query.as_deref()) {
        Ok(r) => r,
        Err(why) => return bad_query(why),
    };
    match ask_as(
        &st,
        is_device(caller.as_deref()),
        Calls::Checklist,
        Some(&request),
    )
    .await
    {
        Ok(reply) => json_response(StatusCode::OK, reply.text, None),
        Err(response) => response,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_list_is_named_by_list_and_a_slug() {
        assert!(valid_list_id("_list-support"));
        assert!(valid_list_id("_list-support-faelle-2"));
        for bad in [
            "support",
            "_list-",
            "_list-Support",
            "_list--x",
            "_list-x-",
            "_list-a/b",
            "_list-ä",
        ] {
            assert!(!valid_list_id(bad), "{bad}");
        }
    }

    #[test]
    fn the_query_of_a_checklist_becomes_the_engine_s_question_or_is_refused() {
        assert_eq!(
            checklist_request(Some("id=_list-a")),
            Ok(json!({ "id": "_list-a" }))
        );
        assert_eq!(
            checklist_request(Some(
                "id=_list-a&since=2026-01-01&until=2026-01-31&tag=hiva&q=%C3%84rger%20mit%20SAP&state=open&limit=50&offset=100"
            )),
            Ok(json!({
                "id": "_list-a", "since": "2026-01-01", "until": "2026-01-31", "tag": "hiva", "q": "Ärger mit SAP",
                "state": "open", "limit": 50, "offset": 100
            }))
        );
        assert_eq!(checklist_request(None), Err("id must be _list-<slug>"));
        assert_eq!(
            checklist_request(Some("id=work/x")),
            Err("id must be _list-<slug>")
        );
        assert_eq!(
            checklist_request(Some("id=_list-a&since=2026-02-30")),
            Err("since and until are days, YYYY-MM-DD")
        );
        assert_eq!(
            checklist_request(Some("id=_list-a&state=late")),
            Err("state is open, done or all")
        );
        assert_eq!(
            checklist_request(Some("id=_list-a&limit=0")),
            Err("limit is 1 to 100")
        );
        assert_eq!(
            checklist_request(Some("id=_list-a&q=a&q=b")),
            Err("a query parameter is given twice")
        );
        assert_eq!(
            checklist_request(Some("id=_list-a&q=%0A")),
            Err("q is a text of at most 200 bytes")
        );
        assert_eq!(
            checklist_request(Some("id=_list-a&q=a b")),
            Err("q is a text of at most 200 bytes")
        );
        assert_eq!(
            checklist_request(Some(&format!("id=_list-a&tag={}", "a".repeat(41)))),
            Err("tag is a word of at most 40 bytes")
        );
        assert!(checklist_request(Some("id=_list-a&area=x")).is_err());
    }

    #[test]
    fn a_text_of_the_query_is_decoded_strictly() {
        assert_eq!(decoded_text("a%20b", 10), Some("a b".to_owned()));
        assert_eq!(decoded_text("%E2%82%AC", 10), Some("€".to_owned()));
        assert_eq!(decoded_text("%zz", 10), None);
        assert_eq!(decoded_text("%FF", 10), None, "no UTF-8");
        assert_eq!(decoded_text("%20", 10), None, "blank only");
        assert_eq!(decoded_text("abcdefghijk", 10), None, "too long");
        assert_eq!(decoded_text("a%07", 10), None, "a control character");
    }
}
