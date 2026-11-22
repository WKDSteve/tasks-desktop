//! The routes of the learning paths (concept "Lernplan" 11.3): the open paths with their progress, and one path with
//! its tree. Each is under `/api/`, so the guard asked for a session before a handler runs.
//!
//! The documents of the engine are passed on as it wrote them; the page draws them and computes nothing (WEB-13). They
//! are asked each time and not held for the state of the vault: that state (the `rev` of the snapshot) is over the
//! tasks, and a path changed by `node_set` would come back as it was before. A paired phone gets the paths of the
//! released areas only, cut field by field (`device_cut::paths`, `device_cut::path`, MOB-02): nothing of another area,
//! no file of the folder, a link only as a web address. The writes go through `ops` (`node_set`, `promote`,
//! `unpromote`); a phone may tick a point (`node_set` with a state and a reason, `device_op_level`), nothing else.

use super::*;

fn bad_query(why: &str) -> Response {
    error_body(StatusCode::BAD_REQUEST, "bad_query", why)
}

/// The question of `paths` to the engine from the query of the route; `Err`: why it is refused.
pub(super) fn paths_request(query: Option<&str>) -> Result<serde_json::Value, &'static str> {
    let params = parse_query(query, &["area", "include_done", "levels"])?;
    let mut request = serde_json::Map::new();
    if let Some(area) = params.get("area") {
        if crate::config::valid_area_name(area).is_err() {
            return Err("area is not a name");
        }
        request.insert("area".to_owned(), json!(area));
    }
    // The finished paths too (capability `requires`): the competence map draws the roots of a chain.
    match params.get("include_done").map(String::as_str) {
        None => {}
        Some("1") => {
            request.insert("include_done".to_owned(), json!(true));
        }
        Some(_) => return Err("include_done is 1 or absent"),
    }
    // Every line of `## Level` of each path (capability `paths_levels`): the badges and rewards without a request per path.
    match params.get("levels").map(String::as_str) {
        None => {}
        Some("1") => {
            request.insert("levels".to_owned(), json!(true));
        }
        Some(_) => return Err("levels is 1 or absent"),
    }
    Ok(serde_json::Value::Object(request))
}

/// `GET /api/tasks/paths?area=&include_done=1&levels=1`: the open learning paths with their progress, no tree
/// (`tasks.paths`); with `include_done` the finished ones too, with `levels` every level of each.
pub(super) async fn paths(
    State(st): State<Arc<Shared>>,
    caller: Option<axum::Extension<Caller>>,
    RawQuery(query): RawQuery,
) -> Response {
    let device = is_device(caller.as_deref());
    let request = match paths_request(query.as_deref()) {
        Ok(r) => r,
        Err(why) => return bad_query(why),
    };
    match ask_as(&st, device, Calls::Paths, Some(&request)).await {
        Ok(reply) if device => {
            let doc = serde_json::from_str::<serde_json::Value>(&reply.text).unwrap_or_default();
            let cut = device_cut::paths(&st.rt().classes, &doc);
            json_response(StatusCode::OK, cut.to_string(), None)
        }
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
    let device = is_device(caller.as_deref());
    let id = match path_id(query.as_deref()) {
        Ok(id) => id,
        Err(why) => return error_body(StatusCode::BAD_REQUEST, "bad_id", why),
    };
    let rt = st.rt();
    // Not even asked for a path a phone may not see: the engine's answer would tell whether it is there.
    if device && !device_cut::released_id(&rt.classes, &id) {
        return not_found();
    }
    match ask_as(&st, device, Calls::Path, Some(&json!({ "id": id }))).await {
        Ok(reply) if device => {
            let cut = serde_json::from_str::<serde_json::Value>(&reply.text)
                .ok()
                .and_then(|doc| device_cut::path(&rt.classes, &doc));
            match cut {
                Some(doc) => json_response(StatusCode::OK, doc.to_string(), None),
                None => not_found(),
            }
        }
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
        assert_eq!(
            paths_request(Some("include_done=1&area=learning")),
            Ok(json!({ "area": "learning", "include_done": true }))
        );
        assert_eq!(
            paths_request(Some("include_done=yes")),
            Err("include_done is 1 or absent")
        );
        assert_eq!(
            paths_request(Some("levels=1")),
            Ok(json!({ "levels": true }))
        );
        assert_eq!(
            paths_request(Some("levels=0")),
            Err("levels is 1 or absent")
        );
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
