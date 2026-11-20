//! The routes of the meetings (concept 6): the meetings of a window of days, one meeting, its invitation as iCalendar
//! and its preview picture. Each is under `/api/`, so the guard asked for a session before a handler runs.
//!
//! The documents of the engine are passed on as it wrote them. A paired phone gets none of them yet: what of a meeting
//! may reach a phone (the address to join, the participants) is decided with the phone's view of the meetings; until
//! then the answer is `403 not_for_devices` (fail closed). The writes go through `ops` (`meeting_new`, `meeting_set`,
//! `meeting_close`, `meeting_capture`, `meeting_attend`, `meeting_followups`), which refuses them to a phone as well.
//! `meeting_parse` reads a line of the quick capture into a proposal; it writes nothing.

use super::*;
use crate::meetings::{self, IcsRefusal, Invitation, MeetingFiles, ThumbError, ThumbSource};

/// The query of `meetings`: the window, an area, a status, a task, a page.
const MEETINGS_QUERY: [&str; 7] = [
    "since", "until", "area", "status", "task", "limit", "offset",
];
/// The largest offset of a page (the engine's lists are far shorter).
const MAX_OFFSET: u32 = 100_000;

/// What a phone is told on a route of the meetings.
fn not_for_devices() -> Response {
    error_body(
        StatusCode::FORBIDDEN,
        "not_for_devices",
        "the meetings are not released for devices yet",
    )
}

fn bad_query(why: &str) -> Response {
    error_body(StatusCode::BAD_REQUEST, "bad_query", why)
}

/// The question of `meetings` to the engine from the query of the route; `Err`: why it is refused.
pub(super) fn meetings_request(query: Option<&str>) -> Result<serde_json::Value, &'static str> {
    let params = parse_query(query, &MEETINGS_QUERY)?;
    let mut request = serde_json::Map::new();
    for key in ["since", "until"] {
        if let Some(day) = params.get(key) {
            if crate::schedule::day_of(day).is_none() {
                return Err("since and until are days, YYYY-MM-DD");
            }
            request.insert(key.to_owned(), json!(day));
        }
    }
    if let Some(area) = params.get("area") {
        if crate::config::valid_area_name(area).is_err() {
            return Err("area is not a name");
        }
        request.insert("area".to_owned(), json!(area));
    }
    if let Some(status) = params.get("status") {
        if !matches!(status.as_str(), "planned" | "done" | "cancelled") {
            return Err("status is planned, done or cancelled");
        }
        request.insert("status".to_owned(), json!([status]));
    }
    if let Some(task) = params.get("task") {
        if !valid_task_id(task) {
            return Err("task must be <area>/<slug>");
        }
        request.insert("task".to_owned(), json!(task));
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

/// `GET /api/tasks/meetings?since=&until=&area=&status=&task=&limit=&offset=`: the meetings whose days touch the
/// window, one page (`tasks.meetings`). A window named on both ends is held for the state of the vault; without one the
/// engine counts from today, which is asked each time.
pub(super) async fn meetings(
    State(st): State<Arc<Shared>>,
    caller: Option<axum::Extension<Caller>>,
    RawQuery(query): RawQuery,
) -> Response {
    let device = is_device(caller.as_deref());
    let request = match meetings_request(query.as_deref()) {
        Ok(r) => r,
        Err(why) => return bad_query(why),
    };
    let dated = request.get("since").is_some() && request.get("until").is_some();
    let answer = if dated {
        ask_held(
            &st,
            device,
            &format!("meetings {request}"),
            Calls::Meetings,
            Some(&request),
        )
        .await
    } else {
        ask_as(&st, device, Calls::Meetings, Some(&request))
            .await
            .map(|reply| reply.text)
    };
    match answer {
        // A phone gets the meetings of the released areas, cut (`device_cut::meetings`, MOB-02).
        Ok(text) if device => {
            let doc = serde_json::from_str::<serde_json::Value>(&text).unwrap_or_default();
            let cut = device_cut::meetings(&st.rt().classes, &doc, files_of(&st).internal_links);
            json_response(StatusCode::OK, cut.to_string(), None)
        }
        Ok(text) => json_response(StatusCode::OK, text, None),
        Err(response) => response,
    }
}

/// The id of a meeting from the query (`id=<area>/<slug>`, the namespace of the tasks); `Err`: the answer to send.
#[allow(clippy::result_large_err)]
fn meeting_id(query: Option<&str>) -> Result<String, Response> {
    let params = parse_query(query, &["id"]).map_err(bad_query)?;
    params
        .get("id")
        .filter(|id| valid_task_id(id))
        .cloned()
        .ok_or_else(|| {
            error_body(
                StatusCode::BAD_REQUEST,
                "bad_id",
                "id must be <area>/<slug>",
            )
        })
}

/// `tasks.meeting` of `id`, held for the state of the vault.
#[allow(clippy::result_large_err)]
async fn meeting_document(st: &Shared, id: &str) -> Result<String, Response> {
    ask_held(
        st,
        false,
        &format!("meeting {id}"),
        Calls::Meeting,
        Some(&json!({ "id": id })),
    )
    .await
}

/// The document of `id` read, and its entry checked to be that meeting.
#[allow(clippy::result_large_err)]
pub(super) async fn meeting_value(st: &Shared, id: &str) -> Result<serde_json::Value, Response> {
    let text = meeting_document(st, id).await?;
    let doc: serde_json::Value = serde_json::from_str(&text).map_err(|_| engine_said_nothing())?;
    if doc["kind"] != "tasks.meeting" || doc["meeting"]["id"] != id {
        return Err(engine_said_nothing());
    }
    Ok(doc)
}

fn engine_said_nothing() -> Response {
    error_body(
        StatusCode::BAD_GATEWAY,
        "engine_failed",
        "the engine could not answer",
    )
}

/// `GET /api/tasks/meeting?id=<area>/<slug>`: one meeting with its body and its sections (`tasks.meeting`).
pub(super) async fn meeting(
    State(st): State<Arc<Shared>>,
    caller: Option<axum::Extension<Caller>>,
    RawQuery(query): RawQuery,
) -> Response {
    let device = is_device(caller.as_deref());
    let id = match meeting_id(query.as_deref()) {
        Ok(id) => id,
        Err(response) => return response,
    };
    let rt = st.rt();
    // Not even asked for a meeting a phone may not see: the engine's answer would tell whether it is there.
    if device && !device_cut::released_id(&rt.classes, &id) {
        return not_found();
    }
    match meeting_document(&st, &id).await {
        Ok(text) if device => {
            let cut = serde_json::from_str::<serde_json::Value>(&text)
                .ok()
                .and_then(|doc| {
                    device_cut::meeting(&rt.classes, &doc, files_of(&st).internal_links)
                });
            match cut {
                Some(doc) => json_response(StatusCode::OK, doc.to_string(), None),
                None => not_found(),
            }
        }
        Ok(text) => json_response(StatusCode::OK, text, None),
        Err(response) => response,
    }
}

/// The longest line the quick capture reads (the engine's `meeting_parse` takes no more).
pub(super) const PARSE_MAX_BYTES: usize = 1000;

/// `POST /api/tasks/meeting_parse` with `{ "text": "<one line>" }`: the line of the quick capture read by the engine
/// into a proposal of a meeting (`tasks.meetingparse`). Nothing is written; the page shows the proposal in its form.
/// The text goes in the body, not in the address, so it is in no log of a request line.
pub(super) async fn meeting_parse(
    State(st): State<Arc<Shared>>,
    caller: Option<axum::Extension<Caller>>,
    body: Bytes,
) -> Response {
    if is_device(caller.as_deref()) {
        return not_for_devices();
    }
    let map = match vault_request(&body, &["text"]) {
        Ok(m) => m,
        Err(r) => return r,
    };
    let Some(text) = map.get("text").and_then(serde_json::Value::as_str) else {
        return error_body(
            StatusCode::BAD_REQUEST,
            "bad_text",
            "text: the line of the quick capture",
        );
    };
    if text.trim().is_empty() || text.len() > PARSE_MAX_BYTES || text.chars().any(char::is_control)
    {
        return error_body(
            StatusCode::BAD_REQUEST,
            "bad_text",
            "text is one line of at most 1000 bytes",
        );
    }
    match ask(&st, Calls::MeetingParse, Some(&json!({ "text": text }))).await {
        Ok(reply) => json_response(StatusCode::OK, reply.text, None),
        Err(response) => response,
    }
}

/// The files of the meetings of this hub, or nothing kept.
fn files_of(st: &Shared) -> Arc<MeetingFiles> {
    st.rt()
        .meetings
        .clone()
        .unwrap_or_else(|| Arc::new(MeetingFiles::none(false)))
}

/// The name of the vault in the id of an invitation: its folder's name, the same on each export.
fn vault_name(vault: Option<&std::path::Path>) -> String {
    vault
        .and_then(|v| v.file_name())
        .map_or_else(|| "tasks".to_owned(), |n| n.to_string_lossy().into_owned())
}

/// `GET /api/tasks/meeting/ics?id=<area>/<slug>`: the invitation of a meeting as an iCalendar file to save (a download;
/// nothing is sent to anyone). `UID` is `<vault>:<id>`, `SEQUENCE` grows with each change of time, place or status
/// (kept beside the settings). What it holds follows the data class of the area (`crate::meetings::ics`): a private or
/// unclassified area gives `403 not_released`.
pub(super) async fn meeting_ics(
    State(st): State<Arc<Shared>>,
    caller: Option<axum::Extension<Caller>>,
    RawQuery(query): RawQuery,
) -> Response {
    if is_device(caller.as_deref()) {
        return not_for_devices();
    }
    let id = match meeting_id(query.as_deref()) {
        Ok(id) => id,
        Err(response) => return response,
    };
    let doc = match meeting_value(&st, &id).await {
        Ok(doc) => doc,
        Err(response) => return response,
    };
    let rt = st.rt();
    // The area of the id, not a field of the answer: the class is the one of the file's place.
    let area = id.split_once('/').map_or("", |(a, _)| a);
    let shown = rt.classes.shown(area);
    let files = files_of(&st);
    let uid = format!("{}:{id}", vault_name(rt.vault.as_deref()));
    let entry = &doc["meeting"];
    let released = matches!(shown, Shown::Public | Shown::Internal);
    // A refused one counts no sequence.
    let sequence = if released {
        files.sequence(&uid, &meetings::stand_of(entry))
    } else {
        0
    };
    let invitation = Invitation {
        uid: &uid,
        sequence,
        now: jiff::Timestamp::now(),
        entry,
        participants: &doc["participants"],
        shown,
        internal_links: files.internal_links,
        zone: &files.zone,
    };
    match meetings::ics(&invitation) {
        Ok(text) => {
            let slug = id.split_once('/').map_or(id.as_str(), |(_, s)| s);
            download(text, "text/calendar; charset=utf-8", &format!("{slug}.ics"))
        }
        Err(IcsRefusal::NotReleased) => error_body(
            StatusCode::FORBIDDEN,
            "not_released",
            "the data class of this area keeps its meetings in the hub",
        ),
        Err(IcsRefusal::NoTime) => error_body(
            StatusCode::UNPROCESSABLE_ENTITY,
            "no_time",
            "this meeting has no time a calendar can take",
        ),
    }
}

/// A file to save: never shown in the page, never guessed at by the browser.
fn download(body: String, content_type: &'static str, name: &str) -> Response {
    let mut response = Response::new(Body::from(body));
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    if let Ok(value) = HeaderValue::from_str(&format!("attachment; filename=\"{name}\"")) {
        headers.insert(header::CONTENT_DISPOSITION, value);
    }
    sealed(headers);
    response
}

/// The headers of an answer that is a file, not a page: no sniffing, no scripts, not kept.
pub(super) fn sealed(headers: &mut HeaderMap) {
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        "content-security-policy",
        HeaderValue::from_static("default-src 'none'; style-src 'unsafe-inline'; sandbox"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
}

/// `GET /api/tasks/meeting/thumb?id=<area>/<slug>`: the preview of a meeting: its `cover` (or `image`, the old name)
/// made at most 96 px as PNG, else the picture of a board, else a board's drawing as it is (SVG, sealed like a file).
/// The small pictures are kept in the hub's cache, never in the vault. `404 no_image`: the meeting has none.
pub(super) async fn meeting_thumb(
    State(st): State<Arc<Shared>>,
    caller: Option<axum::Extension<Caller>>,
    RawQuery(query): RawQuery,
) -> Response {
    if is_device(caller.as_deref()) {
        return not_for_devices();
    }
    let id = match meeting_id(query.as_deref()) {
        Ok(id) => id,
        Err(response) => return response,
    };
    let doc = match meeting_value(&st, &id).await {
        Ok(doc) => doc,
        Err(response) => return response,
    };
    let Some(vault) = st.rt().vault.clone() else {
        return engine_unavailable(&st);
    };
    let files = files_of(&st);
    let made = tokio::task::spawn_blocking(move || {
        let source = meetings::thumb_source(&vault, &doc["meeting"])?;
        Some(match source {
            ThumbSource::Raster(path) => {
                meetings::thumb_png(&path, files.thumbs.as_deref()).map(|png| (png, "image/png"))
            }
            ThumbSource::Svg(path) => std::fs::read(&path)
                .map(|svg| (svg, "image/svg+xml"))
                .map_err(ThumbError::Io),
        })
    })
    .await
    .ok()
    .flatten();
    match made {
        Some(Ok((bytes, content_type))) => {
            let mut response = Response::new(Body::from(bytes));
            let headers = response.headers_mut();
            headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
            sealed(headers);
            response
        }
        Some(Err(ThumbError::NotAPicture)) => error_body(
            StatusCode::UNPROCESSABLE_ENTITY,
            "not_a_picture",
            "the picture of this meeting cannot be read",
        ),
        Some(Err(ThumbError::Io(_))) | None => error_body(
            StatusCode::NOT_FOUND,
            "no_image",
            "this meeting has no picture",
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::meetings_request;
    use serde_json::json;

    #[test]
    fn the_query_of_meetings_becomes_the_engine_s_question_or_is_refused() {
        assert_eq!(meetings_request(None).unwrap(), json!({}));
        assert_eq!(
            meetings_request(Some(
                "since=2026-11-01&until=2026-11-30&area=work&status=planned&task=work/a&limit=50&offset=100"
            ))
            .unwrap(),
            json!({
                "since": "2026-11-01", "until": "2026-11-30", "area": "work", "status": ["planned"],
                "task": "work/a", "limit": 50, "offset": 100,
            })
        );
        for bad in [
            "since=2026-13-01",
            "until=tomorrow",
            "area=../x",
            "status=held",
            "task=work",
            "limit=0",
            "limit=101",
            "offset=-1",
            "offset=100001",
            "id=work/a",
            "since=2026-11-01&since=2026-11-02",
        ] {
            assert!(meetings_request(Some(bad)).is_err(), "{bad}");
        }
    }
}
