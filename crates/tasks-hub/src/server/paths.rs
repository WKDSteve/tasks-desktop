//! The routes of the learning paths (concept "Lernplan" 11.3): the open paths with their progress, and one path with
//! its tree. Each is under `/api/`, so the guard asked for a session before a handler runs.
//!
//! The documents of the engine are passed on as it wrote them; the page draws them and computes nothing (WEB-13). They
//! are asked each time and not held for the state of the vault: that state (the `rev` of the snapshot) is over the
//! tasks, and a path changed by `node_set` would come back as it was before. A paired phone gets none of them yet: what
//! of a path may reach a phone is decided with the phone's view of them; until then the answer is
//! `403 not_for_devices` (fail closed). The writes go through `ops` (`node_set`, `promote`, `unpromote`), which refuses
//! them to a phone as well.

use super::*;

/// What a phone is told on a route of the learning paths.
fn not_for_devices() -> Response {
    error_body(
        StatusCode::FORBIDDEN,
        "not_for_devices",
        "the learning paths are not released for devices yet",
    )
}

fn bad_query(why: &str) -> Response {
    error_body(StatusCode::BAD_REQUEST, "bad_query", why)
}

/// The question of `paths` to the engine from the query of the route; `Err`: why it is refused.
pub(super) fn paths_request(query: Option<&str>) -> Result<serde_json::Value, &'static str> {
    let params = parse_query(query, &["area"])?;
    let mut request = serde_json::Map::new();
    if let Some(area) = params.get("area") {
        if crate::config::valid_area_name(area).is_err() {
            return Err("area is not a name");
        }
        request.insert("area".to_owned(), json!(area));
    }
    Ok(serde_json::Value::Object(request))
}

/// `GET /api/tasks/paths?area=`: the open learning paths with their progress, no tree (`tasks.paths`).
pub(super) async fn paths(
    State(st): State<Arc<Shared>>,
    caller: Option<axum::Extension<Caller>>,
    RawQuery(query): RawQuery,
) -> Response {
    if is_device(caller.as_deref()) {
        return not_for_devices();
    }
    let request = match paths_request(query.as_deref()) {
        Ok(r) => r,
        Err(why) => return bad_query(why),
    };
    match ask_as(&st, false, Calls::Paths, Some(&request)).await {
        Ok(reply) => json_response(StatusCode::OK, reply.text, None),
        Err(response) => response,
    }
}

/// The id of a path from the query (`id=<area>/<slug>`, the namespace of the tasks); `Err`: why it is refused.
pub(super) fn path_id(query: Option<&str>) -> Result<String, &'static str> {
    let params = parse_query(query, &["id"])?;
    params
        .get("id")
        .filter(|id| valid_task_id(id))
        .cloned()
        .ok_or("id must be <area>/<slug>")
}

/// `GET /api/tasks/path?id=<area>/<slug>`: one learning path with its body and its tree (`tasks.path`).
pub(super) async fn path(
    State(st): State<Arc<Shared>>,
    caller: Option<axum::Extension<Caller>>,
    RawQuery(query): RawQuery,
) -> Response {
    if is_device(caller.as_deref()) {
        return not_for_devices();
    }
    let id = match path_id(query.as_deref()) {
        Ok(id) => id,
        Err(why) => return error_body(StatusCode::BAD_REQUEST, "bad_id", why),
    };
    match ask_as(&st, false, Calls::Path, Some(&json!({ "id": id }))).await {
        Ok(reply) => json_response(StatusCode::OK, reply.text, None),
        Err(response) => response,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_query_of_paths_becomes_the_engine_s_question_or_is_refused() {
        assert_eq!(paths_request(None), Ok(json!({})));
        assert_eq!(
            paths_request(Some("area=learning")),
            Ok(json!({ "area": "learning" }))
        );
        assert_eq!(paths_request(Some("area=..")), Err("area is not a name"));
        assert!(paths_request(Some("id=a/b")).is_err());
    }

    #[test]
    fn a_path_is_named_by_an_id_of_the_tasks() {
        assert_eq!(
            path_id(Some("id=learning%2Flua")),
            Err("a query value is not plain text")
        );
        assert_eq!(
            path_id(Some("id=learning/lua")),
            Ok("learning/lua".to_owned())
        );
        assert_eq!(path_id(Some("id=lua")), Err("id must be <area>/<slug>"));
        assert_eq!(path_id(None), Err("id must be <area>/<slug>"));
        assert!(path_id(Some("id=a/b&area=x")).is_err());
    }
}
