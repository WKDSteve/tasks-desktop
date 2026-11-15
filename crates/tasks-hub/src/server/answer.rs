//! How a question to the engine is answered: the refusals and the unavailable engine.

use super::*;

/// What a request without an engine gets: the hub is up, the engine is not.
pub(super) fn engine_unavailable(st: &Shared) -> Response {
    let body = json!({ "error": {
        "code": "engine_unavailable",
        "message": "the engine is not ready",
        "problem": st.rt().status.problem,
    }});
    (StatusCode::SERVICE_UNAVAILABLE, axum::Json(body)).into_response()
}

/// Map what went wrong with a question to an answer. The engine's own
/// refusals keep their code and their message (the contract promises that
/// they hold no path of this machine); everything else is told in one word,
/// and the detail goes to the terminal of whoever runs the hub.
pub(super) fn engine_failure(error: EngineError) -> Response {
    match error {
        EngineError::Refused(r) => {
            let status = match r.code.as_str() {
                "invalid_argument" | "unsupported_schema" => StatusCode::BAD_REQUEST,
                "not_found" => StatusCode::NOT_FOUND,
                "conflict" | "exists" => StatusCode::CONFLICT,
                "forbidden" => StatusCode::FORBIDDEN,
                "locked" => StatusCode::SERVICE_UNAVAILABLE,
                // The engine could not do its job: that is the server's side.
                _ => StatusCode::BAD_GATEWAY,
            };
            // The engine is trusted to hold no path, not to be short or
            // plain: a code is a lowercase word, a message is one short line.
            let code_ok = !r.code.is_empty()
                && r.code.len() <= 48
                && r.code.bytes().all(|b| b.is_ascii_lowercase() || b == b'_');
            let code = if code_ok {
                r.code
            } else {
                "engine_failed".to_owned()
            };
            let message: String = r
                .message
                .chars()
                .filter(|c| !c.is_control())
                .take(512)
                .collect();
            let body = json!({ "error": {
                "code": code,
                "message": message,
                "retryable": r.retryable,
            }});
            (status, axum::Json(body)).into_response()
        }
        EngineError::BadRequest(message) => {
            error_body(StatusCode::BAD_REQUEST, "bad_request", &message)
        }
        EngineError::Busy => {
            let mut r = error_body(
                StatusCode::SERVICE_UNAVAILABLE,
                "busy",
                "the engine is busy, try again",
            );
            r.headers_mut()
                .insert(header::RETRY_AFTER, HeaderValue::from_static("1"));
            r
        }
        EngineError::Timeout => error_body(
            StatusCode::GATEWAY_TIMEOUT,
            "engine_timeout",
            "the engine did not answer in time",
        ),
        EngineError::OutcomeUnknown(_) => error_body(
            StatusCode::BAD_GATEWAY,
            "outcome_unknown",
            "the outcome is unknown, read again before you trust the state",
        ),
        other => {
            eprintln!("engine: {other}");
            error_body(
                StatusCode::BAD_GATEWAY,
                "engine_failed",
                "the engine could not answer",
            )
        }
    }
}

/// For a phone: the engine's refusal keeps its code, not its text (it may name a task, a plan or an area the phone may
/// not know, MOB-02).
pub(super) fn quiet_for_device(error: EngineError) -> EngineError {
    match error {
        EngineError::Refused(mut r) => {
            r.message.clear();
            EngineError::Refused(r)
        }
        other => other,
    }
}

/// `ask`, for a phone (`device`) with the engine's refusals told by their code alone (`quiet_for_device`).
// The error is the answer to send, as everywhere in this file: a response is large, and rare.
#[allow(clippy::result_large_err)]
pub(super) async fn ask_as(
    st: &Shared,
    device: bool,
    method: Method,
    params: Option<&serde_json::Value>,
) -> Result<crate::engine::Reply, Response> {
    let rt = st.rt();
    let Some(engine) = &rt.engine else {
        return Err(engine_unavailable(st));
    };
    engine
        .call(method, params)
        .await
        .map_err(|e| engine_failure(if device { quiet_for_device(e) } else { e }))
}

// The error is the answer to send, as everywhere in this file: a response is large, and rare.
#[allow(clippy::result_large_err)]
pub(super) async fn ask(
    st: &Shared,
    method: Method,
    params: Option<&serde_json::Value>,
) -> Result<crate::engine::Reply, Response> {
    let rt = st.rt();
    let Some(engine) = &rt.engine else {
        return Err(engine_unavailable(st));
    };
    engine.call(method, params).await.map_err(engine_failure)
}

/// `ask_as` for a question whose answer holds for one state of the vault (a task document, `areas`, `next`): held under
/// `key` in the table of the runtime (`Details`) for the state of the snapshot the hub holds, so asking again costs no
/// engine question until the vault changes or the entry is older than `DETAILS_TTL`. A hub that holds no snapshot asks
/// the engine and keeps nothing: these routes never make a full scan wait in front of them. An answer is kept only when
/// that snapshot is still the held one after the read (a change that came in meanwhile must not leave an old answer
/// under the new state); a refusal is never kept.
// The error is the answer to send, as everywhere in this file: a response is large, and rare.
#[allow(clippy::result_large_err)]
pub(super) async fn ask_held(
    st: &Shared,
    device: bool,
    key: &str,
    method: Method,
    params: Option<&serde_json::Value>,
) -> Result<String, Response> {
    ask_held_for(st, device, key, DETAILS_TTL, method, params).await
}

/// [`ask_held`] with the answer believed for `ttl` (`NEXT_TTL` for `next`).
// The error is the answer to send, as everywhere in this file: a response is large, and rare.
#[allow(clippy::result_large_err)]
pub(super) async fn ask_held_for(
    st: &Shared,
    device: bool,
    key: &str,
    ttl: std::time::Duration,
    method: Method,
    params: Option<&serde_json::Value>,
) -> Result<String, Response> {
    let rt = st.rt();
    let rev = rt.store.latest().and_then(|c| c.rev.clone());
    if let Some(rev) = &rev {
        let hit = rt
            .details
            .lock()
            .ok()
            .and_then(|mut d| d.get_within(rev, key, ttl));
        if let Some(doc) = hit {
            return Ok(String::from_utf8_lossy(&doc).into_owned());
        }
    }
    let reply = ask_as(st, device, method, params).await?;
    if let Some(rev) = &rev {
        let now = rt.store.latest().and_then(|c| c.rev.clone());
        let table = rt.details.lock().ok().filter(|_| now.as_ref() == Some(rev));
        if let Some(mut details) = table {
            details.put(rev, key, Bytes::from(reply.text.clone()));
        }
    }
    Ok(reply.text)
}

/// The key `areas` is held under in `Details` (a task id always has a `/`, this has none).
pub(super) const AREAS_KEY: &str = "areas";

/// The key an answer of `next` is held under in `Details`: the question to the engine is part of it.
pub(super) fn next_key(request: &serde_json::Value) -> String {
    format!("next {request}")
}
