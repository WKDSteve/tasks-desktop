//! The data routes: each is under `/api/`, so the guard asked for a session before a handler runs.

use super::*;

// ── data routes ─────────────────────────────────────────────────────────────
//
// Each of these is under `/api/`, so the guard has asked for a session
// before the handler runs. The documents of the engine are passed on as the
// engine wrote them; the hub adds only the class of an area (`hub.areas`).

pub(super) async fn snapshot(
    State(st): State<Arc<Shared>>,
    caller: Option<axum::Extension<Caller>>,
    RawQuery(query): RawQuery,
    headers: HeaderMap,
) -> Response {
    if let Some(response) = no_query(query.as_deref()) {
        return response;
    }
    let rt = st.rt();
    if !rt.store.has_engine() {
        return engine_unavailable(&st);
    }
    let cached = match rt.store.current().await {
        Ok(c) => c,
        Err(error) => return engine_failure(error),
    };
    // A phone gets the released areas only (MOB-02), cut each time (the classes may have changed): no ETag, the PC's
    // would name the whole vault.
    if is_device(caller.as_deref()) {
        return match serde_json::from_slice::<serde_json::Value>(&cached.text) {
            Ok(doc) => json_response(
                StatusCode::OK,
                device_cut::snapshot(&rt.classes, &doc).to_string(),
                None,
            ),
            Err(_) => engine_failed(),
        };
    }
    if let Some(etag) = &cached.etag {
        let seen = single(&headers, &header::IF_NONE_MATCH).ok().flatten();
        if seen.is_some_and(|h| etag_matches(&h, etag)) {
            return not_modified(etag);
        }
    }
    json_response(StatusCode::OK, cached.text.clone(), cached.etag.as_deref())
}

/// `<area>/<slug>`: two plain names. The engine says whether the task is
/// there; this only keeps anything else from ever reaching it.
pub(super) fn valid_task_id(id: &str) -> bool {
    let Some((area, slug)) = id.split_once('/') else {
        return false;
    };
    let plain = |t: &str| {
        t.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
    };
    crate::config::valid_area_name(area).is_ok()
        && plain(area)
        && !slug.is_empty()
        && slug.len() <= 128
        && !slug.starts_with('.')
        && plain(slug)
}

pub(super) async fn task(
    State(st): State<Arc<Shared>>,
    caller: Option<axum::Extension<Caller>>,
    RawQuery(query): RawQuery,
) -> Response {
    let device = is_device(caller.as_deref());
    let rt = st.rt();
    // Not even asked for a task a phone may not see: the engine's answer would tell whether it is there.
    if device
        && parse_query(query.as_deref(), &["id"])
            .ok()
            .and_then(|p| p.get("id").cloned())
            .is_some_and(|id| !device_cut::released_id(&rt.classes, &id))
    {
        return not_found();
    }
    match task_document(&st, query.as_deref()).await {
        Ok(text) if device => {
            let cut = serde_json::from_str::<serde_json::Value>(&text)
                .ok()
                .and_then(|doc| device_cut::task(&rt.classes, &doc));
            match cut {
                Some(doc) => json_response(StatusCode::OK, doc.to_string(), None),
                None => not_found(),
            }
        }
        Ok(text) => json_response(StatusCode::OK, text, None),
        Err(response) => response,
    }
}

/// The document of `task?id=`, from the details the hub holds or from the engine; `Err`: the answer to send.
// The error is the answer to send, as with `ask`: a response is large, and rare.
#[allow(clippy::result_large_err)]
async fn task_document(st: &Shared, query: Option<&str>) -> Result<String, Response> {
    let query = query.map(str::to_owned);
    let params = match parse_query(query.as_deref(), &["id"]) {
        Ok(p) => p,
        Err(why) => return Err(error_body(StatusCode::BAD_REQUEST, "bad_query", why)),
    };
    let Some(id) = params.get("id").filter(|id| valid_task_id(id)) else {
        return Err(error_body(
            StatusCode::BAD_REQUEST,
            "bad_id",
            "id must be <area>/<slug>",
        ));
    };
    // The state of the vault the answer is for: the held snapshot's, so a
    // repeated look at a task costs no engine question. A hub that holds no
    // snapshot asks the engine and keeps nothing: this route never makes a
    // full scan wait in front of a task.
    let rt = st.rt();
    let rev = rt.store.latest().and_then(|c| c.rev.clone());
    if let Some(rev) = &rev {
        let hit = rt.details.lock().ok().and_then(|mut d| d.get(rev, id));
        if let Some(doc) = hit {
            return Ok(String::from_utf8_lossy(&doc).into_owned());
        }
    }
    match ask(st, Calls::Task, Some(&json!({ "id": id }))).await {
        Ok(reply) => {
            // The document names its own `rev`, which is not the snapshot's
            // (it is made over the task and what it touches), so the state is
            // the one of the held snapshot. Kept only when that snapshot is
            // still the held one after the read: a change that came in
            // meanwhile must not leave an old document under the new state.
            if let Some(rev) = &rev {
                let now = rt.store.latest().and_then(|c| c.rev.clone());
                let table = rt.details.lock().ok().filter(|_| now.as_ref() == Some(rev));
                if let Some(mut details) = table {
                    details.put(rev, id, Bytes::from(reply.text.clone()));
                }
            }
            Ok(reply.text)
        }
        Err(response) => Err(response),
    }
}

/// Does a paired device ask (not the PC)? A request the guard named no caller for is one: every route that answers a
/// device sits behind a session, so `None` is not expected, and the narrower answer is the safe one (fail closed).
pub(super) fn is_device(caller: Option<&Caller>) -> bool {
    !matches!(caller, Some(Caller::Pc))
}

/// The ids of the plans and projects a phone may know, from the snapshot the hub holds.
pub(super) fn device_plans(st: &Shared) -> Vec<String> {
    let rt = st.rt();
    rt.store
        .latest()
        .and_then(|c| serde_json::from_slice::<serde_json::Value>(&c.text).ok())
        .map(|snap| device_cut::released_plans(&rt.classes, &snap))
        .unwrap_or_default()
}

/// What a write answers a phone: `tasks.result` cut (`device_cut::result`), with the plans it may know.
pub(super) fn device_result(st: &Shared, text: &str, plans: &[String]) -> Response {
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(doc) => json_response(
            StatusCode::OK,
            device_cut::result(&st.rt().classes, &doc, plans).to_string(),
            None,
        ),
        Err(_) => engine_failed(),
    }
}

/// What a phone is told of a task it may not see, or that is not there: the same.
pub(super) fn not_found() -> Response {
    error_body(StatusCode::NOT_FOUND, "not_found", "no such task")
}

fn engine_failed() -> Response {
    error_body(
        StatusCode::BAD_GATEWAY,
        "engine_failed",
        "the engine could not answer",
    )
}

pub(super) async fn next(
    State(st): State<Arc<Shared>>,
    caller: Option<axum::Extension<Caller>>,
    RawQuery(query): RawQuery,
) -> Response {
    let params = match parse_query(query.as_deref(), &["n", "actor", "area"]) {
        Ok(p) => p,
        Err(why) => return error_body(StatusCode::BAD_REQUEST, "bad_query", why),
    };
    let mut request = serde_json::Map::new();
    let mut asked_n = None;
    if let Some(n) = params.get("n") {
        match n.parse::<u8>() {
            Ok(n) if n <= 10 => {
                request.insert("n".to_owned(), json!(n));
                asked_n = Some(n);
            }
            _ => return error_body(StatusCode::BAD_REQUEST, "bad_query", "n is 0 to 10"),
        }
    }
    if let Some(actor) = params.get("actor") {
        request.insert("actor".to_owned(), json!(actor));
    }
    if let Some(area) = params.get("area") {
        if crate::config::valid_area_name(area).is_err() {
            return error_body(StatusCode::BAD_REQUEST, "bad_query", "area is not a name");
        }
        request.insert("area".to_owned(), json!(area));
    }
    // A phone asks only for an area it may see.
    if is_device(caller.as_deref())
        && params
            .get("area")
            .is_some_and(|area| !device_cut::released(&st.rt().classes, area))
    {
        return not_found();
    }
    if is_device(caller.as_deref()) {
        return device_next(&st, request, asked_n).await;
    }
    let request = serde_json::Value::Object(request);
    match ask(&st, Calls::Next, Some(&request)).await {
        Ok(reply) => json_response(StatusCode::OK, reply.text, None),
        Err(response) => response,
    }
}

/// How many alternatives the engine proposes when it is not told (`tasks.next`).
const NEXT_DEFAULT_N: usize = 2;
/// The most alternatives the engine proposes (`tasks.next`).
const NEXT_MAX_N: u8 = 10;

/// `next` for a phone. The engine picks over the whole vault, and what it picks in an area the phone may not see is cut
/// away: so it is asked for the most, and when the cut holds fewer than asked, each released area is asked in turn
/// (in the order of the snapshot) until there are enough. The pick of the vault leads; the cut is shortened to what was
/// asked.
async fn device_next(
    st: &Shared,
    mut request: serde_json::Map<String, serde_json::Value>,
    asked_n: Option<u8>,
) -> Response {
    let wanted = 1 + asked_n.map_or(NEXT_DEFAULT_N, usize::from);
    let scoped = request.contains_key("area");
    request.insert("n".to_owned(), json!(NEXT_MAX_N));
    let rt = st.rt();
    let mut cut = match ask_as(st, true, Calls::Next, Some(&json!(request))).await {
        Ok(reply) => match serde_json::from_str::<serde_json::Value>(&reply.text) {
            Ok(doc) => device_cut::next(&rt.classes, &doc),
            Err(_) => return engine_failed(),
        },
        Err(response) => return response,
    };
    let mut picks = device_cut::next_picks(&cut);
    if picks.len() < wanted && !scoped {
        let areas: Vec<String> = rt
            .store
            .latest()
            .and_then(|c| serde_json::from_slice::<serde_json::Value>(&c.text).ok())
            .map(|snap| {
                snap["areas"]
                    .as_array()
                    .map_or(&[][..], Vec::as_slice)
                    .iter()
                    .filter_map(|a| a["name"].as_str())
                    .filter(|name| device_cut::released(&rt.classes, name))
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();
        for area in areas {
            if picks.len() >= wanted {
                break;
            }
            request.insert("area".to_owned(), json!(area));
            let Ok(reply) = ask_as(st, true, Calls::Next, Some(&json!(request))).await else {
                continue;
            };
            let Ok(doc) = serde_json::from_str::<serde_json::Value>(&reply.text) else {
                continue;
            };
            for pick in device_cut::next_picks(&device_cut::next(&rt.classes, &doc)) {
                if !picks.iter().any(|p| p["id"] == pick["id"]) {
                    picks.push(pick);
                }
            }
        }
    }
    picks.truncate(wanted);
    device_cut::set_picks(&mut cut, picks);
    json_response(StatusCode::OK, cut.to_string(), None)
}

/// `GET /api/tasks/about`: what this build is and which engine it runs (versions and commits, the
/// platform, the pins of `engine.lock`), for the Info dialog and a bug report (APP-09). Nothing in
/// it names a path, a vault or a person (ENG-06). Without an engine, or with one that does not
/// answer, the part of the app is still told: that is when a report is needed most.
pub(super) async fn about(State(st): State<Arc<Shared>>, RawQuery(query): RawQuery) -> Response {
    if let Some(response) = no_query(query.as_deref()) {
        return response;
    }
    let rt = st.rt();
    // An engine that is there but does not answer is told apart from no engine: the report says which.
    let mut problem: Option<&'static str> = None;
    let engine = match &rt.engine {
        None => None,
        Some(engine) => match engine.call(Calls::Hello, None).await {
            Ok(reply) => match serde_json::from_str::<serde_json::Value>(&reply.text) {
                Ok(doc) => Some(doc["engine"].clone()),
                Err(_) => {
                    problem = Some("engine_failed");
                    None
                }
            },
            Err(error) => {
                problem = Some(about_problem(&error));
                None
            }
        },
    };
    let body = crate::about::document(engine.as_ref(), problem);
    json_response(StatusCode::OK, body.to_string(), None)
}

/// A short, fixed word for why the engine did not answer `hello` (no text of the engine, no path).
fn about_problem(error: &EngineError) -> &'static str {
    match error {
        EngineError::Refused(_) => "engine_refused",
        EngineError::BadRequest(_) => "bad_request",
        EngineError::Busy => "engine_busy",
        EngineError::Timeout => "engine_timeout",
        EngineError::Spawn(_) => "engine_spawn",
        EngineError::Process(_) | EngineError::Failed { .. } | EngineError::OutcomeUnknown(_) => {
            "engine_failed"
        }
        EngineError::Protocol(_) => "engine_protocol",
    }
}

/// The areas, each with the class it is shown with. An area the file does
/// not name is `unclassified`; so the list tells a person what still needs
/// a decision.
pub(super) async fn areas(
    State(st): State<Arc<Shared>>,
    caller: Option<axum::Extension<Caller>>,
    RawQuery(query): RawQuery,
) -> Response {
    let device = is_device(caller.as_deref());
    if let Some(response) = no_query(query.as_deref()) {
        return response;
    }
    let reply = match ask(&st, Calls::Areas, None).await {
        Ok(r) => r,
        Err(response) => return response,
    };
    let Ok(doc) = serde_json::from_str::<serde_json::Value>(&reply.text) else {
        return error_body(
            StatusCode::BAD_GATEWAY,
            "engine_failed",
            "the engine could not answer",
        );
    };
    let mut out = Vec::new();
    let mut unclassified = Vec::new();
    let mut private = Vec::new();
    let classes = Arc::clone(&st.rt().classes);
    for area in doc["areas"].as_array().map_or(&[][..], Vec::as_slice) {
        let Some(name) = area["name"].as_str() else {
            continue;
        };
        let shown = classes.shown(name);
        // A phone is told only of the released areas, not even the names of the others (MOB-02).
        if device && !matches!(shown, Shown::Public | Shown::Internal) {
            continue;
        }
        match shown {
            Shown::Unclassified => unclassified.push(name.to_owned()),
            Shown::Private => private.push(name.to_owned()),
            Shown::Public | Shown::Internal => {}
        }
        let mut entry = area.clone();
        entry["data_class"] = json!(shown);
        out.push(entry);
    }
    let body = json!({
        "schema": 1,
        "kind": "hub.areas",
        "areas": out,
        "unclassified": unclassified,
        "private": private,
    });
    json_response(StatusCode::OK, body.to_string(), None)
}

/// `GET /api/tasks/search?q=<escaped text>&limit=<1..50>`: the tasks whose
/// text holds every word of the query, best first, each with a piece of the
/// text around the match (marks in UTF-16 units). The text comes from the
/// index the hub keeps; while there is none, `status` says so.
pub(super) async fn search_route(
    State(st): State<Arc<Shared>>,
    RawQuery(query): RawQuery,
) -> Response {
    let rt = st.rt();
    let Some(index) = &rt.search else {
        return engine_unavailable(&st);
    };
    let (text, limit) = match search::parse_request(query.as_deref()) {
        Ok(parsed) => parsed,
        Err(why) => return error_body(StatusCode::BAD_REQUEST, "bad_query", why),
    };
    let query = match search::Query::parse(&text) {
        Ok(q) => q,
        Err(why) => return error_body(StatusCode::BAD_REQUEST, "bad_query", why),
    };
    let (status, tasks, partial, outcome) = match index.status() {
        search::Status::Ready { items, partial } => {
            ("ready", items, partial, index.search(&query, limit))
        }
        search::Status::Building => ("building", 0, false, None),
        search::Status::Failed => ("failed", 0, false, None),
    };
    let hits: Vec<serde_json::Value> = outcome
        .as_ref()
        .map(|o| {
            o.hits
                .iter()
                .map(|h| {
                    json!({
                        "id": h.id,
                        "score": h.score,
                        "snippet": {
                            "text": h.snippet.text,
                            "marks": h.snippet.marks,
                            "more_before": h.snippet.more_before,
                            "more_after": h.snippet.more_after,
                        },
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let body = json!({
        "schema": 1,
        "kind": "hub.search",
        "status": status,
        "indexed": tasks,
        "partial": partial,
        "total": outcome.as_ref().map_or(0, |o| o.total),
        "hits": hits,
    });
    json_response(StatusCode::OK, body.to_string(), None)
}

/// The operations the page may ask for. `move_area` asked as a dry run is the
/// report of what the move would break; without it the engine moves the task. A dry
/// run of `plan_new` names the plan without making it. `tick_step`, `add_steps`, `answer`, `append_note` and `set_body` change the text of one open task
/// (a step, the answer to a question, a line of the notes, the text); the engine checks the version and the text. `view_save` and `view_delete` make,
/// replace and delete a saved view (a small file of the vault, not a task); the engine checks the view and its version.
/// `attach` makes the image on the clipboard of this machine, or its newest screenshot, an asset of a task: the request
/// names no path (the folders are the hub's settings, `attach_dirs`, added by `with_attach_dirs`), and the answer holds
/// the path below the task and its link, never the image. `project_new`, `plan_set` and `project_set` make a project file
/// and change the frontmatter of an open plan or project file (the project level); the engine judges the relation.
/// `plan_close` and `project_close` finish a plan or a project by hand; the engine refuses while something holds it open.
pub(super) const OPS_ALLOWED: [&str; 20] = [
    "set",
    "new",
    "reorder",
    "done",
    "move_area",
    "plan_new",
    "project_new",
    "plan_set",
    "project_set",
    "plan_close",
    "project_close",
    "tick_step",
    "answer",
    "add_steps",
    "append_note",
    "reopen",
    "set_body",
    "view_save",
    "view_delete",
    "attach",
];
/// The fields of a request of `ops` (the engine checks the rest, strictly).
pub(super) const OPS_FIELDS: [&str; 4] = ["schema", "client_op_id", "dry_run", "ops"];
/// The most operations in one request (the engine's limit).
pub(super) const OPS_MAX: usize = 100;

/// The form and the size of a request of `ops`, before an engine process is
/// asked: what is plainly not one is refused here, the rules of the tasks
/// are the engine's. Returns the request to send on.
pub(super) fn check_ops_request(body: &[u8]) -> Result<serde_json::Value, String> {
    let value: serde_json::Value =
        serde_json::from_slice(body).map_err(|_| "the body is not JSON".to_owned())?;
    let Some(map) = value.as_object() else {
        return Err("the request must be a JSON object".to_owned());
    };
    if let Some(key) = map.keys().find(|k| !OPS_FIELDS.contains(&k.as_str())) {
        return Err(format!("unknown field {key:.40} in the request"));
    }
    let Some(ops) = map.get("ops").and_then(serde_json::Value::as_array) else {
        return Err("ops must be a list".to_owned());
    };
    if ops.is_empty() || ops.len() > OPS_MAX {
        return Err(format!("ops holds 1 to {OPS_MAX} operations"));
    }
    for (i, op) in ops.iter().enumerate() {
        let name = op
            .get("op")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| format!("ops[{}] has no op", i + 1))?;
        if !OPS_ALLOWED.contains(&name) {
            return Err(format!("ops[{}]: unknown operation", i + 1));
        }
    }
    // One screenshot a request: each reads the clipboard of this machine (seconds on Windows), and a hundred would run
    // into the time the engine has.
    if ops
        .iter()
        .filter(|op| op.get("op").and_then(serde_json::Value::as_str) == Some("attach"))
        .count()
        > 1
    {
        return Err("at most one attach in a request".to_owned());
    }
    if let Some(id) = map.get("client_op_id") {
        let ok = id.as_str().is_some_and(|s| {
            (1..=64).contains(&s.len())
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b':' | b'-'))
        });
        if !ok {
            return Err("client_op_id is 1 to 64 letters, digits and . _ : -".to_owned());
        }
    }
    if map.get("dry_run").is_some_and(|d| !d.is_boolean()) {
        return Err("dry_run must be true or false".to_owned());
    }
    Ok(value)
}

/// The folders of `attach` with `from: latest` are the hub's (its settings), never the page's: the door above refuses
/// `attach_dirs` from a page. With none, `latest` is refused here without asking the engine (only the clipboard is
/// read); with some, the request carries them to the engine.
pub(super) fn with_attach_dirs(
    mut request: serde_json::Value,
    dirs: &[String],
) -> Result<serde_json::Value, String> {
    let latest = request["ops"].as_array().is_some_and(|ops| {
        ops.iter()
            .any(|op| op["op"] == "attach" && op["from"] == "latest")
    });
    if !latest {
        return Ok(request);
    }
    if dirs.is_empty() {
        return Err(
            "no screenshot folders are set for the hub (attach_dirs in config.json): only the clipboard is read"
                .to_owned(),
        );
    }
    request["attach_dirs"] = serde_json::json!(dirs);
    Ok(request)
}

/// The most ids and the most assumptions a question of `estimate` holds (the engine's limit too).
pub(super) const ESTIMATE_MAX: usize = 1000;

/// The form and the size of a question of `estimate`, before an engine process is asked: what is plainly not one is
/// refused here, the values are judged by the engine. Returns the parameters to send on.
pub(super) fn check_estimate_request(body: &[u8]) -> Result<serde_json::Value, String> {
    let value: serde_json::Value =
        serde_json::from_slice(body).map_err(|_| "the body is not JSON".to_owned())?;
    let Some(map) = value.as_object() else {
        return Err("the request must be a JSON object".to_owned());
    };
    if let Some(key) = map.keys().find(|k| !matches!(k.as_str(), "ids" | "assume")) {
        return Err(format!("unknown field {key:.40} in the request"));
    }
    if let Some(ids) = map.get("ids") {
        let list = ids
            .as_array()
            .ok_or_else(|| "ids must be a list".to_owned())?;
        if list.len() > ESTIMATE_MAX {
            return Err(format!("ids holds at most {ESTIMATE_MAX} ids"));
        }
        if !list.iter().all(|id| id.as_str().is_some_and(valid_task_id)) {
            return Err("every id must be <area>/<slug>".to_owned());
        }
    }
    if let Some(assume) = map.get("assume") {
        let list = assume
            .as_array()
            .ok_or_else(|| "assume must be a list".to_owned())?;
        if list.len() > ESTIMATE_MAX {
            return Err(format!("assume holds at most {ESTIMATE_MAX} entries"));
        }
        for (i, entry) in list.iter().enumerate() {
            let at = i + 1;
            let Some(entry) = entry.as_object() else {
                return Err(format!("assume[{at}] must be an object"));
            };
            if let Some(key) = entry
                .keys()
                .find(|k| !matches!(k.as_str(), "id" | "effort" | "value"))
            {
                return Err(format!("assume[{at}]: unknown field {key:.40}"));
            }
            if !entry
                .get("id")
                .and_then(serde_json::Value::as_str)
                .is_some_and(valid_task_id)
            {
                return Err(format!("assume[{at}].id must be <area>/<slug>"));
            }
            if entry.get("effort").is_some_and(|e| {
                !e.as_str()
                    .is_some_and(|s| !s.is_empty() && s.len() <= 12 && s.is_ascii())
            }) {
                return Err(format!("assume[{at}].effort must be a short word"));
            }
            if entry.get("value").is_some_and(|v| !v.is_i64()) {
                return Err(format!("assume[{at}].value must be a whole number"));
            }
        }
    }
    Ok(value)
}

/// `POST /api/tasks/estimate`: the figures of an estimate for some tasks, also as they would be with other efforts
/// and values (`assume`). A read: nothing is written, nothing is scanned. The sums are the engine's, never the
/// page's.
pub(super) async fn estimate(State(st): State<Arc<Shared>>, body: Bytes) -> Response {
    let request = match check_estimate_request(&body) {
        Ok(r) => r,
        Err(why) => return error_body(StatusCode::BAD_REQUEST, "bad_request", &why),
    };
    match ask(&st, Calls::Estimate, Some(&request)).await {
        Ok(reply) => json_response(StatusCode::OK, reply.text, None),
        Err(response) => response,
    }
}

/// What follows a write: a scan when it changed something or met a file the snapshot does not hold yet, so that the next
/// read is the new state and the open streams hear of it.
pub(super) async fn settle_write(st: &Shared, reply: &str) {
    let wrote = serde_json::from_str::<serde_json::Value>(reply)
        .ok()
        .and_then(|d| {
            d.get("results")
                .and_then(serde_json::Value::as_array)
                .map(|a| {
                    a.iter().any(|e| {
                        e.get("changed_ids")
                            .and_then(serde_json::Value::as_array)
                            .is_some_and(|ids| !ids.is_empty())
                    })
                })
        })
        // A document this hub cannot read for it: scan anyway.
        .unwrap_or(true);
    // A refusal as a conflict says the engine read a file the snapshot does not hold yet (changed outside, the
    // watcher has not scanned): the page reads the list again after it and must get that version, or its next
    // write is refused the same way.
    let conflict = serde_json::from_str::<serde_json::Value>(reply)
        .ok()
        .and_then(|d| {
            d.get("results")
                .and_then(serde_json::Value::as_array)
                .map(|a| {
                    a.iter().any(|e| {
                        e.pointer("/error/code").and_then(serde_json::Value::as_str)
                            == Some("conflict")
                    })
                })
        })
        .unwrap_or(false);
    if wrote || conflict {
        let _ = st.rt().store.refresh("ops").await;
    }
    if let Some(usage) = &st.rt().usage {
        usage.touched();
    }
}

/// `POST /api/tasks/ops`: changes, through the one door of the engine. The
/// answer is the engine's `tasks.result`, with a part that failed told per
/// operation (not all-or-nothing). A write that changed something is
/// followed by a scan before the answer, so that the next read is the new
/// state, and the open streams hear of it.
pub(super) async fn ops(
    State(st): State<Arc<Shared>>,
    caller: Option<axum::Extension<Caller>>,
    body: Bytes,
) -> Response {
    let request = match check_ops_request(&body) {
        Ok(r) => r,
        Err(why) => {
            // A request that is not one still counts as a mutation.
            if !st.post_limit.allow() {
                return too_many();
            }
            return error_body(StatusCode::BAD_REQUEST, "bad_request", &why);
        }
    };
    // A device does only the operations released for it, at its level; a dry run too (it would tell what it may not
    // do). Before anything of the PC is looked at: the settings of the PC (its screenshot folders) are none of its
    // business.
    if let Some(refused) = device_refusal(&st, caller.as_deref(), &request) {
        return refused;
    }
    let request = match with_attach_dirs(request, &st.rt().attach_dirs) {
        Ok(r) => r,
        Err(why) => {
            if !st.post_limit.allow() {
                return too_many();
            }
            return error_body(StatusCode::BAD_REQUEST, "attach_no_folders", &why);
        }
    };
    let dry_run = request.get("dry_run").and_then(serde_json::Value::as_bool) == Some(true);
    // A dry run changes nothing and was counted by the guard only: it costs the writes nothing.
    if !dry_run && !st.post_limit.allow() {
        return too_many();
    }
    let device = is_device(caller.as_deref());
    // The plans a phone may know, before the write (a plan it closes is one of them).
    let plans = if device {
        device_plans(&st)
    } else {
        Vec::new()
    };
    let reply = match ask_as(&st, device, Calls::Ops, Some(&request)).await {
        Ok(reply) => reply,
        Err(response) => {
            // A write that ended without an answer may have been carried out:
            // look again, so the page does not stand on an old state.
            st.rt().store.request_rescan();
            return response;
        }
    };
    if !dry_run {
        settle_write(&st, &reply.text).await;
    }
    if device {
        return device_result(&st, &reply.text, &plans);
    }
    json_response(StatusCode::OK, reply.text, None)
}

/// `GET /api/tasks/done_preview?id=`: what finishing a task would do, and
/// the token that `done` needs for exactly that version of the file.
pub(super) async fn done_preview(
    State(st): State<Arc<Shared>>,
    caller: Option<axum::Extension<Caller>>,
    RawQuery(query): RawQuery,
) -> Response {
    let params = match parse_query(query.as_deref(), &["id"]) {
        Ok(p) => p,
        Err(why) => return error_body(StatusCode::BAD_REQUEST, "bad_query", why),
    };
    let Some(id) = params.get("id").filter(|id| valid_task_id(id)) else {
        return error_body(
            StatusCode::BAD_REQUEST,
            "bad_id",
            "id must be <area>/<slug>",
        );
    };
    let rt = st.rt();
    let device = is_device(caller.as_deref());
    // Not even asked: the engine's answer would tell whether the task is there.
    if device && !device_cut::released_id(&rt.classes, id) {
        return not_found();
    }
    match ask(&st, Calls::DonePreview, Some(&json!({ "id": id }))).await {
        Ok(reply) if device => {
            // The plans the phone may know are the ones of its snapshot.
            let plans = rt
                .store
                .latest()
                .and_then(|c| serde_json::from_slice::<serde_json::Value>(&c.text).ok())
                .map(|snap| device_cut::released_plans(&rt.classes, &snap))
                .unwrap_or_default();
            let cut = serde_json::from_str::<serde_json::Value>(&reply.text)
                .ok()
                .and_then(|doc| device_cut::done_preview(&rt.classes, &doc, &plans));
            match cut {
                Some(doc) => json_response(StatusCode::OK, doc.to_string(), None),
                None => not_found(),
            }
        }
        Ok(reply) => json_response(StatusCode::OK, reply.text, None),
        Err(response) => response,
    }
}

/// `GET /api/tasks/sheet_snap?name=<repo>/TESTS/__snapshots__/<path>.snap`: the text of a snapshot a test-sheet block
/// names, read from the plugin checkouts (`REPOS_DIR`). The page sends the name the block holds, never a path; the
/// hub keeps everything but a snapshot file of a checkout out (`snapshots::read_snapshot`).
pub(super) async fn sheet_snap(
    State(st): State<Arc<Shared>>,
    RawQuery(query): RawQuery,
) -> Response {
    let params = match parse_query(query.as_deref(), &["name"]) {
        Ok(p) => p,
        Err(why) => return error_body(StatusCode::BAD_REQUEST, "bad_query", why),
    };
    let Some(name) = params.get("name") else {
        return error_body(StatusCode::BAD_REQUEST, "bad_query", "name is required");
    };
    let Some(root) = st.rt().snapshot_root.clone() else {
        return error_body(
            StatusCode::NOT_FOUND,
            "snapshots_unavailable",
            "this hub knows no folder of plugin checkouts",
        );
    };
    let name = name.clone();
    let read = tokio::task::spawn_blocking(move || crate::snapshots::read_snapshot(&root, &name))
        .await
        .unwrap_or(Err("the snapshot could not be read"));
    match read {
        Ok(text) => axum::Json(json!({ "text": text })).into_response(),
        Err(why) => error_body(StatusCode::NOT_FOUND, "snapshot_refused", why),
    }
}

/// `GET /api/tasks/links`: where the areas hang together (the links between the open tasks of different areas). A
/// read without parameters; the finding of the links is the engine's.
pub(super) async fn links(State(st): State<Arc<Shared>>, RawQuery(query): RawQuery) -> Response {
    if let Some(response) = no_query(query.as_deref()) {
        return response;
    }
    match ask(&st, Calls::Links, None).await {
        Ok(reply) => json_response(StatusCode::OK, reply.text, None),
        Err(response) => response,
    }
}

/// `GET /api/tasks/plan_compare`: the open plans side by side (tasks, effort, the rest of each plan's critical path, the
/// pace of the last weeks). A read without parameters; every figure is the engine's.
pub(super) async fn plan_compare(
    State(st): State<Arc<Shared>>,
    RawQuery(query): RawQuery,
) -> Response {
    if let Some(response) = no_query(query.as_deref()) {
        return response;
    }
    match ask(&st, Calls::PlanCompare, None).await {
        Ok(reply) => json_response(StatusCode::OK, reply.text, None),
        Err(response) => response,
    }
}

/// `GET /api/tasks/enums`: the ranges of the fields (status, kind, prio, value, effort, ...) as the engine names them in
/// its `hello`, so that the page offers what the engine accepts and keeps no list of its own. A read without
/// parameters; the engine alone says what the ranges are.
pub(super) async fn enums(State(st): State<Arc<Shared>>, RawQuery(query): RawQuery) -> Response {
    if let Some(response) = no_query(query.as_deref()) {
        return response;
    }
    let reply = match ask(&st, Calls::Hello, None).await {
        Ok(reply) => reply,
        Err(response) => return response,
    };
    let ranges = serde_json::from_str::<serde_json::Value>(&reply.text)
        .ok()
        .and_then(|doc| doc.get("enums").filter(|e| e.is_object()).cloned());
    match ranges {
        Some(enums) => axum::Json(json!({ "kind": "hub.enums", "enums": enums })).into_response(),
        // An engine older than the ranges in its hello.
        None => error_body(
            StatusCode::BAD_GATEWAY,
            "engine_failed",
            "the engine named no ranges of fields",
        ),
    }
}

/// `GET /api/tasks/finished?area=&plan=&since=&until=&limit=&offset=`: the finished tasks of the Backlogs, newest first, and
/// what all that match add up to. A read; the counting is the engine's. The days are checked by the engine.
pub(super) async fn finished(State(st): State<Arc<Shared>>, RawQuery(query): RawQuery) -> Response {
    let params = match parse_query(
        query.as_deref(),
        &["area", "plan", "since", "until", "limit", "offset"],
    ) {
        Ok(p) => p,
        Err(why) => return error_body(StatusCode::BAD_REQUEST, "bad_query", why),
    };
    let mut request = serde_json::Map::new();
    for key in ["area", "plan", "since", "until"] {
        if let Some(value) = params.get(key) {
            request.insert(key.to_owned(), json!(value));
        }
    }
    for key in ["limit", "offset"] {
        if let Some(value) = params.get(key) {
            let Ok(n) = value.parse::<u32>() else {
                return error_body(
                    StatusCode::BAD_REQUEST,
                    "bad_query",
                    "limit and offset are whole numbers",
                );
            };
            request.insert(key.to_owned(), json!(n));
        }
    }
    let request = serde_json::Value::Object(request);
    match ask(&st, Calls::Finished, Some(&request)).await {
        Ok(reply) => json_response(StatusCode::OK, reply.text, None),
        Err(response) => response,
    }
}

/// `GET /api/tasks/waits?area=`: what the parked tasks wait for (per `waits_for` key the number of tasks and their areas,
/// the parked ones without a reason). A read; the counting is the engine's.
pub(super) async fn waits(State(st): State<Arc<Shared>>, RawQuery(query): RawQuery) -> Response {
    let params = match parse_query(query.as_deref(), &["area"]) {
        Ok(p) => p,
        Err(why) => return error_body(StatusCode::BAD_REQUEST, "bad_query", why),
    };
    let mut request = serde_json::Map::new();
    if let Some(area) = params.get("area") {
        if crate::config::valid_area_name(area).is_err() {
            return error_body(StatusCode::BAD_REQUEST, "bad_query", "area is not a name");
        }
        request.insert("area".to_owned(), json!(area));
    }
    let request = serde_json::Value::Object(request);
    match ask(&st, Calls::Waits, Some(&request)).await {
        Ok(reply) => json_response(StatusCode::OK, reply.text, None),
        Err(response) => response,
    }
}

/// The orders of `tasks list --sort` that the engine takes in the contract (`default` is the plan's order). A word
/// outside this list never reaches the engine.
const SORTS: [&str; 12] = [
    "default",
    "prio-effort",
    "severity",
    "frecency",
    "roi",
    "due",
    "created-desc",
    "created-asc",
    "updated-desc",
    "updated-asc",
    "remind",
    "title",
];

/// `GET /api/tasks/groupings`: the fields the open tasks can be grouped by, with the values of each and how it is written
/// (`set`, `tags`, `move_area`, or not at all). A read without parameters; which fields there are and what they allow is the
/// engine's: the page names no field and no value itself.
pub(super) async fn groupings(
    State(st): State<Arc<Shared>>,
    RawQuery(query): RawQuery,
) -> Response {
    if let Some(response) = no_query(query.as_deref()) {
        return response;
    }
    match ask(&st, Calls::Groupings, None).await {
        Ok(reply) => json_response(StatusCode::OK, reply.text, None),
        Err(response) => response,
    }
}

/// `GET /api/tasks/views`: the saved views of the vault (a selection, a grouping and how it is drawn), each with the version of
/// its file. A read without parameters; the views are the engine's, kept in the vault, so they are the same on every machine.
pub(super) async fn views(State(st): State<Arc<Shared>>, RawQuery(query): RawQuery) -> Response {
    if let Some(response) = no_query(query.as_deref()) {
        return response;
    }
    match ask(&st, Calls::Views, None).await {
        Ok(reply) => json_response(StatusCode::OK, reply.text, None),
        Err(response) => response,
    }
}

/// `GET /api/tasks/lists`: the named lists of the engine (built-in, saved with the editor, from its configuration), read
/// only. The page shows them next to its own and lays their option words onto its filter; nothing is written.
pub(super) async fn lists(State(st): State<Arc<Shared>>, RawQuery(query): RawQuery) -> Response {
    if let Some(response) = no_query(query.as_deref()) {
        return response;
    }
    match ask(&st, Calls::Lists, None).await {
        Ok(reply) => json_response(StatusCode::OK, reply.text, None),
        Err(response) => response,
    }
}

/// `GET /api/tasks/order?sort=&area=`: the ids of the open tasks in the order of `sort` (the plan's order without it), all
/// in one answer. A read; the order is the engine's, the page only lays the tasks it holds along the ids.
pub(super) async fn order(State(st): State<Arc<Shared>>, RawQuery(query): RawQuery) -> Response {
    let params = match parse_query(query.as_deref(), &["sort", "area"]) {
        Ok(p) => p,
        Err(why) => return error_body(StatusCode::BAD_REQUEST, "bad_query", why),
    };
    let mut request = serde_json::Map::new();
    if let Some(sort) = params.get("sort") {
        if !SORTS.contains(&sort.as_str()) {
            return error_body(
                StatusCode::BAD_REQUEST,
                "bad_sort",
                "sort must be default, prio-effort, severity, frecency or roi",
            );
        }
        request.insert("sort".to_owned(), json!(sort));
    }
    if let Some(area) = params.get("area") {
        if crate::config::valid_area_name(area).is_err() {
            return error_body(StatusCode::BAD_REQUEST, "bad_query", "area is not a name");
        }
        request.insert("area".to_owned(), json!(area));
    }
    let request = serde_json::Value::Object(request);
    match ask(&st, Calls::Order, Some(&request)).await {
        Ok(reply) => json_response(StatusCode::OK, reply.text, None),
        Err(response) => response,
    }
}

/// `GET /api/tasks/plan_for?id=&direction=`: the tasks a task needs before it can start (`direction=needs`, the
/// default) or the tasks that wait for it (`direction=unlocks`), with the edges between them. A read; the walk of the
/// graph is the engine's.
pub(super) async fn plan_for(State(st): State<Arc<Shared>>, RawQuery(query): RawQuery) -> Response {
    let params = match parse_query(query.as_deref(), &["id", "direction"]) {
        Ok(p) => p,
        Err(why) => return error_body(StatusCode::BAD_REQUEST, "bad_query", why),
    };
    let Some(id) = params.get("id").filter(|id| valid_task_id(id)) else {
        return error_body(
            StatusCode::BAD_REQUEST,
            "bad_id",
            "id must be <area>/<slug>",
        );
    };
    let direction = params.get("direction").map_or("needs", String::as_str);
    if !matches!(direction, "needs" | "unlocks") {
        return error_body(
            StatusCode::BAD_REQUEST,
            "bad_direction",
            "direction must be needs or unlocks",
        );
    }
    let request = json!({ "id": id, "direction": direction });
    match ask(&st, Calls::PlanFor, Some(&request)).await {
        Ok(reply) => json_response(StatusCode::OK, reply.text, None),
        Err(response) => response,
    }
}

/// `POST /api/tasks/open` `{ "id" }`: show the file of a task in Neovim, in a window of its own. The page names the
/// task, never a file: the engine says which file it is, the hub checks that it is a plain file inside the vault, and
/// starts the editor with that one argument (no shell).
pub(super) async fn open_file(State(st): State<Arc<Shared>>, body: Bytes) -> Response {
    let rt = st.rt();
    let Some(opener) = &rt.opener else {
        return error_body(
            StatusCode::NOT_FOUND,
            "open_unavailable",
            "this hub cannot open a file in an editor",
        );
    };
    let map = match vault_request(&body, &["id"]) {
        Ok(m) => m,
        Err(r) => return r,
    };
    let id = match vault_text(&map, "id", 200) {
        Ok(id) if valid_task_id(&id) => id,
        Ok(_) => {
            return error_body(
                StatusCode::BAD_REQUEST,
                "bad_id",
                "id must be <area>/<slug>",
            )
        }
        Err(r) => return r,
    };
    let rt = st.rt();
    let Some(vault) = rt.vault.clone() else {
        return engine_unavailable(&st);
    };
    let reply = match ask(&st, Calls::Task, Some(&json!({ "id": id }))).await {
        Ok(r) => r,
        Err(response) => return response,
    };
    let name = serde_json::from_str::<serde_json::Value>(&reply.text)
        .ok()
        .and_then(|doc| doc["task"]["file"].as_str().map(str::to_owned));
    let Some(name) = name else {
        return error_body(
            StatusCode::BAD_GATEWAY,
            "engine_failed",
            "the engine named no file for this task",
        );
    };
    let file = match crate::editor::file_in_vault(&vault, &name) {
        Ok(f) => f,
        Err(why) => return error_body(StatusCode::BAD_REQUEST, "open_refused", why),
    };
    match opener.open(&file, None) {
        Ok(()) => axum::Json(json!({ "ok": true })).into_response(),
        Err(why) => error_body(StatusCode::BAD_GATEWAY, "open_failed", &why),
    }
}

/// `POST /api/tasks/vault_reveal` `{}`: show the folder of the vault the hub reads in the file manager. The page names
/// nothing: the folder is the one the hub holds.
pub(super) async fn vault_reveal(State(st): State<Arc<Shared>>, body: Bytes) -> Response {
    if let Err(r) = vault_request(&body, &[]) {
        return r;
    }
    let rt = st.rt();
    let Some(opener) = &rt.opener else {
        return error_body(
            StatusCode::NOT_FOUND,
            "open_unavailable",
            "this hub cannot open a folder",
        );
    };
    let Some(vault) = rt.vault.clone() else {
        return engine_unavailable(&st);
    };
    if !vault.is_dir() {
        return error_body(
            StatusCode::NOT_FOUND,
            "vault_missing",
            "the folder of the vault is not there",
        );
    }
    match opener.reveal(&vault) {
        Ok(()) => axum::Json(json!({ "ok": true })).into_response(),
        Err(why) => error_body(StatusCode::BAD_GATEWAY, "open_failed", &why),
    }
}

/// `GET /api/tasks/sheet_run`: where the run of test sheets stands.
pub(super) async fn sheet_run_state(State(st): State<Arc<Shared>>) -> Response {
    match st.rt().sheet_run.clone() {
        Some(job) => axum::Json(job.state()).into_response(),
        None => error_body(
            StatusCode::NOT_FOUND,
            "sheet_run_unavailable",
            "this hub cannot run test sheets",
        ),
    }
}

/// `POST /api/tasks/sheet_run` `{ "id": "<area>/<slug>" }`: run the test sheets of that task, unless a run is under way. The
/// page names a task and nothing else: which sheets, where they lie and whether they may run is decided behind the engine.
pub(super) async fn sheet_run_start(State(st): State<Arc<Shared>>, body: Bytes) -> Response {
    let map = match vault_request(&body, &["id"]) {
        Ok(m) => m,
        Err(r) => return r,
    };
    let Some(id) = map
        .get("id")
        .and_then(serde_json::Value::as_str)
        .filter(|id| valid_task_id(id))
    else {
        return error_body(
            StatusCode::BAD_REQUEST,
            "bad_id",
            "id must be the id of a task",
        );
    };
    match st.rt().sheet_run.clone() {
        Some(job) => axum::Json(job.start(id)).into_response(),
        None => error_body(
            StatusCode::NOT_FOUND,
            "sheet_run_unavailable",
            "this hub cannot run test sheets",
        ),
    }
}

/// `GET /api/tasks/check_all`: where the check over all vaults stands.
pub(super) async fn check_all_state(State(st): State<Arc<Shared>>) -> Response {
    match st.rt().all_vaults.clone() {
        Some(job) => axum::Json(job.state()).into_response(),
        None => error_body(
            StatusCode::NOT_FOUND,
            "check_all_unavailable",
            "this hub has no list of vaults",
        ),
    }
}

/// `POST /api/tasks/check_all` `{}`: start it, unless it runs. The page names no vault.
pub(super) async fn check_all_start(State(st): State<Arc<Shared>>, body: Bytes) -> Response {
    if let Err(r) = vault_request(&body, &[]) {
        return r;
    }
    match st.rt().all_vaults.clone() {
        Some(job) => axum::Json(job.start()).into_response(),
        None => error_body(
            StatusCode::NOT_FOUND,
            "check_all_unavailable",
            "this hub has no list of vaults",
        ),
    }
}

/// `GET /api/tasks/autostart`: whether the hub starts at login (`{ "on": true | false }`); `{ "on": null }` where this
/// system cannot tell or this hub has no such entry: the page then offers no switch.
pub(super) async fn autostart_get(State(st): State<Arc<Shared>>) -> Response {
    let Some(login) = st.rt().login.clone() else {
        return axum::Json(json!({ "on": null })).into_response();
    };
    match tokio::task::spawn_blocking(move || login.is_on()).await {
        Ok(on) => axum::Json(json!({ "on": on })).into_response(),
        Err(_) => axum::Json(json!({ "on": null })).into_response(),
    }
}

/// `POST /api/tasks/autostart` `{ "on": bool }`: register the hub at login, or take it away. The answer is what the
/// system says afterwards, not what was asked.
pub(super) async fn autostart_set(State(st): State<Arc<Shared>>, body: Bytes) -> Response {
    let on = match serde_json::from_slice::<serde_json::Value>(&body) {
        Ok(doc) => match (
            doc.as_object().map(serde_json::Map::len),
            doc["on"].as_bool(),
        ) {
            (Some(1), Some(on)) => on,
            _ => {
                return error_body(
                    StatusCode::BAD_REQUEST,
                    "bad_request",
                    "the body is { \"on\": true | false }",
                )
            }
        },
        Err(_) => {
            return error_body(
                StatusCode::BAD_REQUEST,
                "bad_request",
                "the body is not JSON",
            )
        }
    };
    let Some(login) = st.rt().login.clone() else {
        return error_body(
            StatusCode::NOT_FOUND,
            "autostart_unavailable",
            "this hub has no login entry",
        );
    };
    let done = tokio::task::spawn_blocking(move || login.set(on).map(|()| login.is_on())).await;
    match done {
        Ok(Ok(now)) => axum::Json(json!({ "on": now })).into_response(),
        Ok(Err(why)) => error_body(StatusCode::BAD_GATEWAY, "autostart_failed", &why),
        Err(_) => error_body(
            StatusCode::INTERNAL_SERVER_ERROR,
            "autostart_failed",
            "the change stopped unexpectedly",
        ),
    }
}

/// `POST /api/tasks/vault_pick` `{}`: show the folder dialog of the system on the machine of the hub and answer with
/// the folder the person chose (`{ "path" }`) or that the dialog was closed (`{ "path": null }`). The page names
/// nothing; what the answer holds is the person's own choice, put in the field of the form to look at and change.
pub(super) async fn vault_pick(State(st): State<Arc<Shared>>, body: Bytes) -> Response {
    if let Err(r) = vault_request(&body, &[]) {
        return r;
    }
    let rt = st.rt();
    let Some(opener) = rt.opener.clone() else {
        return error_body(
            StatusCode::NOT_FOUND,
            "open_unavailable",
            "this hub cannot show a folder dialog",
        );
    };
    // The dialog waits for the person: it runs on a thread of its own, not on one of the server.
    match tokio::task::spawn_blocking(move || opener.pick_folder()).await {
        Ok(Ok(chosen)) => axum::Json(json!({
            "path": chosen.map(|p| p.to_string_lossy().into_owned()),
        }))
        .into_response(),
        Ok(Err(why)) => error_body(StatusCode::BAD_GATEWAY, "pick_failed", &why),
        Err(_) => error_body(
            StatusCode::INTERNAL_SERVER_ERROR,
            "pick_failed",
            "the folder dialog stopped unexpectedly",
        ),
    }
}

/// `POST /api/tasks/vault_create` `{ "path", "area", "confirm": true }`: make a folder that is new (or empty) a vault
/// with one area. It writes on the machine of the hub, so the person has been asked and the body says so; it does not
/// register the vault (the page does that with `vaults/add`, as for any folder).
pub(super) async fn vault_create(body: Bytes) -> Response {
    let map = match vault_request(&body, &["path", "area", "confirm"]) {
        Ok(m) => m,
        Err(r) => return r,
    };
    if map.get("confirm") != Some(&serde_json::Value::Bool(true)) {
        return error_body(
            StatusCode::BAD_REQUEST,
            "not_confirmed",
            "a new vault is made only after the person confirmed it",
        );
    }
    let path = match vault_text(&map, "path", 1024) {
        Ok(p) => p,
        Err(r) => return r,
    };
    let area = match vault_text(&map, "area", 128) {
        Ok(a) => a,
        Err(r) => return r,
    };
    let path = std::path::PathBuf::from(path);
    let made = tokio::task::spawn_blocking(move || crate::newvault::create(&path, &area)).await;
    match made {
        Ok(Ok(())) => axum::Json(json!({ "ok": true })).into_response(),
        Ok(Err(refused)) => error_body(StatusCode::BAD_REQUEST, refused.code, refused.why),
        Err(_) => error_body(
            StatusCode::INTERNAL_SERVER_ERROR,
            "vault_create_failed",
            "the vault could not be made",
        ),
    }
}

/// `POST /api/tasks/rescan`: a client that got the focus again asks for a
/// full scan. Many asks while one runs are one scan.
pub(super) async fn rescan(State(st): State<Arc<Shared>>) -> Response {
    let rt = st.rt();
    if !rt.store.has_engine() {
        return engine_unavailable(&st);
    }
    rt.store.request_rescan();
    // The page asks for this when its window gets the focus back.
    if let Some(usage) = &st.rt().usage {
        usage.touched();
    }
    (StatusCode::ACCEPTED, axum::Json(json!({ "ok": true }))).into_response()
}

/// What this app tells the guard: its `hello` and the two POST routes that have the coarse limit of
/// `ops`. `ops` takes writes and dry runs (only its body tells them apart: the writes are counted
/// again, strictly, by the handler). `estimate` is a read that is a POST (its question is too long
/// for a query): it changes nothing.
pub(super) fn guard_rules() -> GuardRules {
    GuardRules::new(
        crate::IDENTITY.route("hello"),
        [
            crate::IDENTITY.route("ops"),
            crate::IDENTITY.route("estimate"),
        ],
    )
    .with_upload_path(crate::IDENTITY.route("upload"))
    // The phone page (tasks-mobile) under /m/, with its manifest, its worker and the Trusted Types policy it
    // registers the worker with (tasks-mobile/src/lib/worker.ts).
    .with_installable_page("/m", MOBILE_WORKER_POLICY)
    // The phone page records a voice note for a new task: only under /m/ the microphone is let on (and media from its
    // own blobs, to hear the note before it is sent); the desktop page keeps it off.
    .with_installable_microphone()
    // What a paired phone reaches (appkit `MOB-02`, fail closed): exactly the routes tasks-mobile asks, nothing the
    // desktop page alone needs (the vaults, events, search, sheets, repos ...). `ops` is released at `create` and
    // judges each operation and its fields itself (`device_op_level`, `device_op_fields`). `upload` adds a file to a
    // task that is there, which changes it: `change`.
    .with_device_route(crate::IDENTITY.route("snapshot"), Level::Read)
    .with_device_route(crate::IDENTITY.route("areas"), Level::Read)
    .with_device_route(crate::IDENTITY.route("next"), Level::Read)
    .with_device_route(crate::IDENTITY.route("task"), Level::Read)
    .with_device_route(crate::IDENTITY.route("done_preview"), Level::Read)
    .with_device_route(crate::IDENTITY.route("ops"), Level::Create)
    .with_device_route(crate::IDENTITY.route("upload"), Level::Change)
    // A new phone reads, creates and changes; it never triggers (the PC raises one device at a time, if ever).
    .with_device_default_level(Level::Change)
}

/// The level a device needs for one operation of `ops`; `None`: the operation is not for devices at all. Only what
/// tasks-mobile sends: a new task and the answer to a question create, a status and finishing a task change. The rest
/// stays on the PC: `attach` reads the clipboard of this machine, the others (plans, projects, views, order, moving a
/// task to another area, the text of a task) the phone page does not offer.
pub(super) fn device_op_level(op: &str) -> Option<Level> {
    match op {
        "new" | "answer" => Some(Level::Create),
        "set" | "done" => Some(Level::Change),
        _ => None,
    }
}

/// The fields a device may send in one operation: exactly what tasks-mobile sends (`src/lib/types.ts`). An operation the
/// phone may do is no way to the rest: no title, order, plan, project or reminder through `set`, no `force` that breaks
/// another's claim, no `by` that acts for someone else.
pub(super) fn device_op_fields(op: &str) -> &'static [&'static str] {
    match op {
        "new" => &["op", "area", "title", "body"],
        "set" => &["op", "id", "patch", "if_match"],
        "answer" => &["op", "id", "question", "option", "if_match"],
        "done" => &["op", "id", "confirm"],
        _ => &[],
    }
}

/// What a device may set through `set`: the status, nothing else.
pub(super) const DEVICE_PATCH_FIELDS: [&str; 1] = ["status"];

/// Whether one operation of a device holds only the fields released for it (`device_op_fields`, `DEVICE_PATCH_FIELDS`).
pub(super) fn device_op_shape(op: &serde_json::Value) -> bool {
    let Some(map) = op.as_object() else {
        return false;
    };
    let name = map
        .get("op")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("");
    let fields = device_op_fields(name);
    if !map.keys().all(|k| fields.contains(&k.as_str())) {
        return false;
    }
    if name != "set" {
        return true;
    }
    map.get("patch")
        .and_then(serde_json::Value::as_object)
        .is_some_and(|patch| {
            !patch.is_empty()
                && patch
                    .keys()
                    .all(|k| DEVICE_PATCH_FIELDS.contains(&k.as_str()))
        })
}

/// For a request of a device: refuse it when one of its operations, or one of their fields, is not for devices, or
/// needs more than the level the device has now. `None` for the PC, and for a device that may do all of them.
fn device_refusal(
    st: &Shared,
    caller: Option<&Caller>,
    request: &serde_json::Value,
) -> Option<Response> {
    let id = match caller {
        Some(Caller::Pc) => return None,
        Some(Caller::Device(id)) => id,
        // No caller: no session (`is_device`), nothing is done.
        None => {
            return Some(error_body(
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "session required",
            ))
        }
    };
    // The guard let the session through a moment ago; a device that is gone since gets nothing.
    let has = st.devices.as_ref().and_then(|d| d.level_of(id));
    let ops = request["ops"].as_array().map_or(&[][..], Vec::as_slice);
    let mut needed = Level::Read;
    for op in ops {
        match op["op"].as_str().and_then(device_op_level) {
            Some(level) if device_op_shape(op) => needed = needed.max(level),
            _ => {
                return Some(error_body(
                    StatusCode::FORBIDDEN,
                    "not_for_devices",
                    "this operation, or one of its fields, is not released for devices",
                ))
            }
        }
        // A task, or a new task's area, the phone may not see is not there for it (MOB-02).
        if !device_cut::op_area(op).is_some_and(|area| device_cut::released(&st.rt().classes, area))
        {
            return Some(not_found());
        }
    }
    match has {
        Some(has) if has >= needed => None,
        Some(_) => Some(error_body(
            StatusCode::FORBIDDEN,
            "level_too_low",
            "this device may not do this; the PC can raise its level",
        )),
        None => Some(error_body(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "session required",
        )),
    }
}

/// The Trusted Types policy of the phone page, named in tasks-mobile (`src/lib/worker.ts`).
pub(super) const MOBILE_WORKER_POLICY: &str = "tasks-mobile-worker";

#[cfg(test)]
mod sort_words {
    use super::SORTS;
    use std::path::PathBuf;

    /// The quoted words between `open` and `close` that follow `marker` in `text`.
    fn words_after(text: &str, marker: &str, open: char, close: char) -> Vec<String> {
        let from = text
            .find(marker)
            .unwrap_or_else(|| panic!("{marker:?} not found"))
            + marker.len();
        let rest = &text[from..];
        let start = rest.find(open).expect("opening bracket") + 1;
        let end = rest[start..].find(close).expect("closing bracket");
        rest[start..start + end]
            .split(',')
            .map(|w| w.trim().trim_matches(|c| c == '"' || c == '\'').to_owned())
            .filter(|w| !w.is_empty())
            .collect()
    }

    fn repo_file(parts: &[&str]) -> String {
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..");
        path.extend(parts);
        std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
    }

    #[test]
    fn the_words_of_the_hub_are_those_of_the_page() {
        let page = words_after(
            &repo_file(&["ui", "src", "lib", "sort.ts"]),
            "export const SORTS =",
            '[',
            ']',
        );
        assert_eq!(
            page, SORTS,
            "ui/src/lib/sort.ts and SORTS of the hub differ"
        );
    }

    /// The engine of the checkout the CI pins (`TASKS_ENGINE_DIR`); a machine without one skips this part.
    #[test]
    fn the_words_of_the_hub_are_those_of_the_engine() {
        let Some(dir) = std::env::var_os("TASKS_ENGINE_DIR") else {
            eprintln!("skipped: TASKS_ENGINE_DIR is not set");
            return;
        };
        let model = PathBuf::from(dir)
            .join("lua")
            .join("tasks_nvim")
            .join("model.lua");
        let text =
            std::fs::read_to_string(&model).unwrap_or_else(|e| panic!("{}: {e}", model.display()));
        let engine = words_after(&text, "M.SORTS =", '{', '}');
        assert_eq!(
            engine, SORTS,
            "model.SORTS of the engine and SORTS of the hub differ"
        );
    }
}
