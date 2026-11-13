//! The test sheets of a task, run on the PC by the testing hub, asked for by a phone of tasks through this hub
//! (`crate::testing_link`). Three routes, released for devices:
//!
//! - `GET /api/tasks/testing_sheets?id=<area>/<slug>` (`read`): the sheets that name the task.
//! - `GET /api/tasks/testing_run` (`read`): where the run stands; a run that is not of a task a phone may see is told as
//!   `other`, with nothing of it.
//! - `POST /api/tasks/testing_start` `{ "id": "<area>/<slug>" }` (`trigger`): start the sheets of that task. The guard
//!   has checked the phone's confirmation of this very request before this runs; this hub then confirms the one request
//!   to the testing hub with its own key. One confirmation, one run.
//!
//! A task of an area that is not released for devices is not there for a phone (`404 not_found`, MOB-02), and the
//! testing hub is not even asked. Its refusals come back by their code, never its words.

use super::*;
use appkit_mobile::link::{LinkError, Method};

/// The longest list of sheets passed on, and the longest name of one.
const MAX_SHEETS: usize = 50;
const MAX_SHEET_NAME: usize = 200;

/// The task of the query or the body, if it is a task id, and for a device only of a released area.
// The refusal is the answer itself, built once and sent: boxing it would gain nothing.
#[allow(clippy::result_large_err)]
fn task_for(st: &Shared, caller: Option<&Caller>, id: Option<&str>) -> Result<String, Response> {
    let Some(id) = id.filter(|id| routes::valid_task_id(id)) else {
        return Err(error_body(
            StatusCode::BAD_REQUEST,
            "bad_id",
            "id is <area>/<slug>",
        ));
    };
    if routes::is_device(caller) && !device_cut::released_id(&st.rt().classes, id) {
        return Err(routes::not_found());
    }
    Ok(id.to_owned())
}

/// The way to the testing hub, or the answer that says why there is none.
// The refusal is the answer itself, built once and sent: boxing it would gain nothing.
#[allow(clippy::result_large_err)]
async fn link(
    st: &Shared,
) -> Result<(Arc<appkit_mobile::link::Link>, crate::testing_link::Target), Response> {
    let Some(testing) = st.rt().testing.clone() else {
        return Err(error_body(
            StatusCode::NOT_FOUND,
            "testing_unavailable",
            "this hub has no way to the testing hub",
        ));
    };
    match testing.get().await {
        Ok(Some(link)) => Ok((link, testing.target().clone())),
        Ok(None) => Err(error_body(
            StatusCode::CONFLICT,
            "testing_not_linked",
            "this hub is not paired with the testing hub (tasks-hub testing link)",
        )),
        Err(_) => Err(error_body(
            StatusCode::INTERNAL_SERVER_ERROR,
            "testing_link_unreadable",
            "the pairing with the testing hub cannot be read",
        )),
    }
}

/// A failure of the way to the testing hub, as this hub answers it.
fn link_failure(error: &LinkError) -> Response {
    match error {
        LinkError::Refused { status, code } => {
            let status = StatusCode::from_u16(*status)
                .ok()
                .filter(|s| s.is_client_error() || s.is_server_error())
                .unwrap_or(StatusCode::BAD_GATEWAY);
            // Only a code of plain letters is passed on; anything else is the testing hub's own business.
            let code = if !code.is_empty()
                && code.len() <= 40
                && code.bytes().all(|b| b.is_ascii_lowercase() || b == b'_')
            {
                code.as_str()
            } else {
                "testing_refused"
            };
            error_body(status, code, "the testing hub refused")
        }
        LinkError::Unpaired => error_body(
            StatusCode::CONFLICT,
            "testing_unpaired",
            "the testing hub does not know this hub any more (tasks-hub testing link)",
        ),
        LinkError::Net(appkit_mobile::link::NetError::AnswerLost) => error_body(
            StatusCode::GATEWAY_TIMEOUT,
            "testing_answer_lost",
            "the testing hub did not answer in time",
        ),
        _ => error_body(
            StatusCode::SERVICE_UNAVAILABLE,
            "testing_unreachable",
            "the testing hub cannot be reached",
        ),
    }
}

/// The answer of the testing hub as JSON, or why it is not one.
// The refusal is the answer itself, built once and sent: boxing it would gain nothing.
#[allow(clippy::result_large_err)]
fn answer(response: &appkit_mobile::link::Response) -> Result<serde_json::Value, Response> {
    if !(200..300).contains(&response.status) {
        let code = serde_json::from_slice::<serde_json::Value>(&response.body)
            .ok()
            .and_then(|d| d["error"]["code"].as_str().map(str::to_owned))
            .unwrap_or_default();
        return Err(link_failure(&LinkError::Refused {
            status: response.status,
            code,
        }));
    }
    serde_json::from_slice(&response.body).map_err(|_| {
        error_body(
            StatusCode::BAD_GATEWAY,
            "testing_bad_reply",
            "the testing hub answered something else",
        )
    })
}

/// The id of a task, as a query value (`<area>/<slug>` holds only letters, digits, `.`, `_`, `-` and the slash).
fn query_id(id: &str) -> String {
    id.replace('/', "%2F")
}

/// `GET /api/tasks/testing_sheets?id=`: the names of the sheets that name the task.
pub(super) async fn testing_sheets(
    State(st): State<Arc<Shared>>,
    caller: Option<axum::Extension<Caller>>,
    RawQuery(query): RawQuery,
) -> Response {
    let params = match parse_query(query.as_deref(), &["id"]) {
        Ok(p) => p,
        Err(why) => return error_body(StatusCode::BAD_REQUEST, "bad_query", why),
    };
    let id = match task_for(&st, caller.as_deref(), params.get("id").map(String::as_str)) {
        Ok(id) => id,
        Err(response) => return response,
    };
    // No way to the testing hub, or no repo of the fleet for the area, is the usual case of most tasks, not an error:
    // no sheets (`linked` says which), so a page asks without a failed request for every task it opens.
    let none = |linked: bool| {
        json_response(
            StatusCode::OK,
            json!({ "kind": "tasks.testing_sheets", "schema": 1, "id": id, "linked": linked, "sheets": [] })
                .to_string(),
            None,
        )
    };
    let (link, target) = match link(&st).await {
        Ok(l) => l,
        Err(response)
            if matches!(
                response.status(),
                StatusCode::NOT_FOUND | StatusCode::CONFLICT
            ) =>
        {
            return none(false);
        }
        Err(response) => return response,
    };
    let path = format!("{}?task={}", target.sheets_path, query_id(&id));
    let doc = match link.fetch(Method::Get, &path, &[], None).await {
        Ok(r) if r.status == 404 => return none(true),
        Ok(r) => match answer(&r) {
            Ok(doc) => doc,
            Err(response) => return response,
        },
        Err(e) => return link_failure(&e),
    };
    let sheets: Vec<String> = doc["sheets"]
        .as_array()
        .map_or(&[][..], Vec::as_slice)
        .iter()
        .filter_map(|s| s.as_str())
        .filter(|s| !s.is_empty() && s.len() <= MAX_SHEET_NAME && !s.chars().any(char::is_control))
        .take(MAX_SHEETS)
        .map(str::to_owned)
        .collect();
    json_response(
        StatusCode::OK,
        json!({ "kind": "tasks.testing_sheets", "schema": 1, "id": id, "linked": true, "sheets": sheets })
            .to_string(),
        None,
    )
}

/// The run of the testing hub as a phone may see it: the run of a task of a released area with its state, any other
/// run only as `other`.
fn run_for(st: &Shared, caller: Option<&Caller>, doc: &serde_json::Value) -> serde_json::Value {
    let device = routes::is_device(caller);
    let classes = &st.rt().classes;
    cut_run(doc, |task| {
        !device || device_cut::released_id(classes, task)
    })
}

/// [`run_for`] with what may be shown as `shown(task id)`.
fn cut_run(doc: &serde_json::Value, shown: impl Fn(&str) -> bool) -> serde_json::Value {
    let run = &doc["run"];
    let cut = if run.is_null() {
        serde_json::Value::Null
    } else {
        let task = run["task"].as_str().filter(|t| routes::valid_task_id(t));
        if run["what"] == "task" && task.is_some_and(&shown) {
            let mut out = serde_json::Map::new();
            out.insert("what".to_owned(), json!("task"));
            out.insert("task".to_owned(), json!(task));
            for field in ["id", "running", "exit", "verdict", "started", "ended"] {
                if let Some(v) = run.get(field).filter(|v| {
                    v.is_number()
                        || v.is_boolean()
                        || v.is_null()
                        || v.as_str().is_some_and(|s| s.len() <= 64)
                }) {
                    out.insert(field.to_owned(), v.clone());
                }
            }
            serde_json::Value::Object(out)
        } else {
            json!({ "what": "other", "running": run["running"].as_bool().unwrap_or(false) })
        }
    };
    json!({
        "kind": "tasks.testing_run",
        "schema": 1,
        "available": doc["available"].as_bool().unwrap_or(false),
        "run": cut,
    })
}

/// `GET /api/tasks/testing_run`: where the run of the testing hub stands.
pub(super) async fn testing_run(
    State(st): State<Arc<Shared>>,
    caller: Option<axum::Extension<Caller>>,
    RawQuery(query): RawQuery,
) -> Response {
    if let Some(response) = no_query(query.as_deref()) {
        return response;
    }
    let (link, target) = match link(&st).await {
        Ok(l) => l,
        Err(response) => return response,
    };
    match link.fetch(Method::Get, &target.run_path, &[], None).await {
        Ok(r) => match answer(&r) {
            Ok(doc) => json_response(
                StatusCode::OK,
                run_for(&st, caller.as_deref(), &doc).to_string(),
                None,
            ),
            Err(response) => response,
        },
        Err(e) => link_failure(&e),
    }
}

/// `POST /api/tasks/testing_start` `{ "id": "<area>/<slug>" }`: start the sheets of the task at the testing hub.
pub(super) async fn testing_start(
    State(st): State<Arc<Shared>>,
    caller: Option<axum::Extension<Caller>>,
    body: axum::body::Bytes,
) -> Response {
    let doc: serde_json::Value = match serde_json::from_slice(&body) {
        Ok(d) => d,
        Err(_) => return error_body(StatusCode::BAD_REQUEST, "bad_body", "a JSON object"),
    };
    let fields_ok = doc
        .as_object()
        .is_some_and(|o| o.len() == 1 && o.contains_key("id"));
    if !fields_ok {
        return error_body(
            StatusCode::BAD_REQUEST,
            "bad_body",
            "{ \"id\": \"<area>/<slug>\" } only",
        );
    }
    let id = match task_for(&st, caller.as_deref(), doc["id"].as_str()) {
        Ok(id) => id,
        Err(response) => return response,
    };
    let (link, target) = match link(&st).await {
        Ok(l) => l,
        Err(response) => return response,
    };
    // The body the testing hub takes, made here: nothing of the phone's request goes on but the checked id.
    let forward = json!({ "task": id }).to_string();
    match link.trigger(&target.start_path, forward.as_bytes()).await {
        Ok(r) => match answer(&r) {
            Ok(doc) => json_response(
                StatusCode::ACCEPTED,
                run_for(&st, caller.as_deref(), &doc).to_string(),
                None,
            ),
            Err(response) => response,
        },
        Err(e) => link_failure(&e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_run_is_told_only_for_a_task_that_may_be_shown_and_only_its_own_fields() {
        let doc = |task: &str| {
            json!({ "kind": "hub.run", "available": true, "run": { "id": "r1", "key": "secret.nvim", "what": "task",
                "task": task, "running": true, "exit": null, "verdict": null, "started": 1, "ended": null,
                "output": "line of the run" } })
        };
        let shown = |t: &str| t.starts_with("open/");
        let cut = cut_run(&doc("open/a"), shown);
        assert_eq!(cut["run"]["task"], "open/a");
        assert_eq!(cut["run"]["running"], true);
        assert!(
            cut["run"].get("output").is_none() && cut["run"].get("key").is_none(),
            "{cut}"
        );
        // A task of an area a phone may not see, or a run that is no run of a task: `other`, with nothing of it.
        for other in [
            doc("secret/a"),
            json!({ "available": true, "run": { "what": "suite", "key": "x", "running": false } }),
        ] {
            let cut = cut_run(&other, shown);
            assert_eq!(
                cut["run"],
                json!({ "what": "other", "running": other["run"]["running"] }),
                "{cut}"
            );
        }
        assert!(cut_run(&json!({ "available": false, "run": null }), shown)["run"].is_null());
    }

    #[test]
    fn a_refusal_of_the_testing_hub_keeps_its_status_and_a_plain_code_only() {
        let code = |r: Response| r.status();
        assert_eq!(
            code(link_failure(&LinkError::Refused {
                status: 409,
                code: "busy".into()
            })),
            StatusCode::CONFLICT
        );
        // A status that is no error, or a code with other characters, is not passed on as it is.
        assert_eq!(
            code(link_failure(&LinkError::Refused {
                status: 200,
                code: "x".into()
            })),
            StatusCode::BAD_GATEWAY
        );
        assert_eq!(
            code(link_failure(&LinkError::Unpaired)),
            StatusCode::CONFLICT
        );
        assert_eq!(
            code(link_failure(&LinkError::Net(
                appkit_mobile::link::NetError::AnswerLost
            ))),
            StatusCode::GATEWAY_TIMEOUT
        );
    }
}
