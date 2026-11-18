//! The route of the reminders by e-mail (`crate::mail`): the page names reminders and one address, the hub writes the
//! mail from the snapshot it holds and answers with it (the preview), or sends it. What may be in a mail is decided
//! here, by the classes of this device, never by the page.

use serde::Deserialize;

use super::*;
use crate::mail::{self, Lang};

/// `POST /api/tasks/reminders/mail`.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    /// The one address the mail goes to.
    to: String,
    /// The tasks whose reminders are chosen.
    ids: Vec<String>,
    /// `en` (also when left out) or `de`: the language of the mail.
    #[serde(default)]
    lang: Option<String>,
    /// Send it; left out or false: only say what would be sent.
    #[serde(default)]
    send: bool,
}

/// `POST /api/tasks/reminders/mail` `{ "to", "ids", "lang"?, "send"? }`: the mail with the chosen reminders.
///
/// The answer is `hub.reminders_mail`: `subject` and `text` as they are sent, `included` (the ids in the mail),
/// `left_out` (`{ id, reason }` with `private`, `unclassified` or `unknown`: only tasks of `public` and `internal`
/// areas are ever in a mail), `account` (whether this hub can send at all) and `sent`. With `send`: 400
/// `nothing_to_send` when no chosen reminder may go, 409 `mail_not_set_up` on a hub without a mail account, 502
/// `mail_failed` with the reason of the transport. Nothing of a left out task but its id is in the answer.
pub(super) async fn reminders_mail(State(st): State<Arc<Shared>>, body: Bytes) -> Response {
    let Ok(request) = serde_json::from_slice::<Request>(&body) else {
        return error_body(
            StatusCode::BAD_REQUEST,
            "bad_request",
            "the body is { to, ids, lang?, send? }",
        );
    };
    if !mail::valid_address(&request.to) {
        return error_body(
            StatusCode::BAD_REQUEST,
            "bad_address",
            "to is one e-mail address",
        );
    }
    if request.ids.is_empty() || request.ids.len() > mail::MAX_ITEMS {
        return error_body(
            StatusCode::BAD_REQUEST,
            "bad_request",
            "ids names 1 to 100 tasks",
        );
    }
    if request.ids.iter().any(|id| !valid_task_id(id)) {
        return error_body(StatusCode::BAD_REQUEST, "bad_id", "an id is <area>/<slug>");
    }
    let lang = match request.lang.as_deref() {
        None | Some("en") => Lang::En,
        Some("de") => Lang::De,
        Some(_) => {
            return error_body(StatusCode::BAD_REQUEST, "bad_request", "lang is en or de");
        }
    };
    let rt = st.rt();
    if !rt.store.has_engine() {
        return engine_unavailable(&st);
    }
    let cached = match rt.store.current().await {
        Ok(c) => c,
        Err(error) => return engine_failure(error),
    };
    let policy = Arc::clone(&rt.classes);
    let (to, ids) = (request.to, request.ids);
    let composed = tokio::task::spawn_blocking(move || {
        let doc = serde_json::from_slice::<serde_json::Value>(&cached.text).ok()?;
        Some(mail::compose(&doc, &ids, &to, lang, &|area| {
            policy.shown(area)
        }))
    })
    .await
    .ok()
    .flatten();
    let Some(composed) = composed else {
        return error_body(
            StatusCode::BAD_GATEWAY,
            "engine_failed",
            "the list of the engine cannot be read",
        );
    };
    let transport = rt.mail.clone();
    let mut sent = false;
    if request.send {
        if composed.included.is_empty() {
            return error_body(
                StatusCode::BAD_REQUEST,
                "nothing_to_send",
                "none of the chosen reminders may go into a mail",
            );
        }
        let Some(transport) = &transport else {
            return error_body(
                StatusCode::CONFLICT,
                "mail_not_set_up",
                "this hub has no mail account yet",
            );
        };
        if let Err(why) = transport.send(&composed.message).await {
            // The reason is the transport's, made for the person; it is cut so that an answer of a server cannot
            // flood the page.
            let why: String = why.chars().filter(|c| !c.is_control()).take(200).collect();
            return error_body(StatusCode::BAD_GATEWAY, "mail_failed", &why);
        }
        sent = true;
    }
    let left_out: Vec<serde_json::Value> = composed
        .left_out
        .iter()
        .map(|(id, why)| json!({ "id": id, "reason": why.code() }))
        .collect();
    let answer = json!({
        "kind": "hub.reminders_mail",
        "account": transport.is_some(),
        "sent": sent,
        "to": composed.message.to,
        "subject": composed.message.subject,
        "text": composed.message.text,
        "included": composed.included,
        "left_out": left_out,
    });
    json_response(StatusCode::OK, answer.to_string(), None)
}
