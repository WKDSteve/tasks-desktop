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

/// `GET /api/tasks/device`: the level this device has now (`read`, `create`, `change`, `trigger`), read at each call
/// (the PC may change it at any time, `tasks-hub devices level`). The phone page offers only what it allows; the hub
/// still judges every request (`device_refusal`, the guard). A session of the PC is no device: `403 device_required`.
pub(super) async fn device(
    State(st): State<Arc<Shared>>,
    caller: Option<axum::Extension<Caller>>,
    RawQuery(query): RawQuery,
) -> Response {
    if let Some(response) = no_query(query.as_deref()) {
        return response;
    }
    let Some(Caller::Device(id)) = caller.as_deref() else {
        return error_body(
            StatusCode::FORBIDDEN,
            "device_required",
            "only a paired device has a level",
        );
    };
    // The guard let the session through a moment ago; a device revoked since has no level.
    match st.devices.as_ref().and_then(|d| d.level_of(id)) {
        Some(level) => json_response(
            StatusCode::OK,
            json!({ "kind": "tasks.device", "schema": 1, "level": level.word() }).to_string(),
            None,
        ),
        None => error_body(StatusCode::UNAUTHORIZED, "unauthorized", "session required"),
    }
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
pub(super) async fn task_document(st: &Shared, query: Option<&str>) -> Result<String, Response> {
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
    // Held for the state of the snapshot the hub holds: the document names its own `rev`, which is not the snapshot's
    // (it is made over the task and what it touches), so the state is the one of the held snapshot.
    ask_held(st, false, id, Calls::Task, Some(&json!({ "id": id }))).await
}

/// Does a paired device ask (not the PC)? A request the guard named no caller for is one: every route that answers a
/// device sits behind a session, so `None` is not expected, and the narrower answer is the safe one (fail closed).
pub(super) fn is_device(caller: Option<&Caller>) -> bool {
    !matches!(caller, Some(Caller::Pc))
}

/// The areas a phone may know: the areas of the vault (the answer of `areas` the hub holds, as the route `areas` gives
/// it) that are released; none when the engine cannot tell them (fail closed).
pub(super) async fn device_areas(st: &Shared) -> Vec<String> {
    let Ok(text) = ask_held(st, false, AREAS_KEY, Calls::Areas, None).await else {
        return Vec::new();
    };
    let classes = Arc::clone(&st.rt().classes);
    serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .map(|doc| {
            doc["areas"]
                .as_array()
                .map_or(&[][..], Vec::as_slice)
                .iter()
                .filter_map(|a| a["name"].as_str())
                .filter(|name| device_cut::released(&classes, name))
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
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
    let params = match parse_query(query.as_deref(), &["n", "actor", "area", "not_category"]) {
        Ok(p) => p,
        Err(why) => return error_body(StatusCode::BAD_REQUEST, "bad_query", why),
    };
    let mut request = serde_json::Map::new();
    if let Some(words) = params.get("not_category") {
        match not_category(words) {
            Some(list) => {
                request.insert("not_category".to_owned(), json!(list));
            }
            None => {
                return error_body(
                    StatusCode::BAD_REQUEST,
                    "bad_query",
                    "not_category is words of small letters, joined by dots",
                )
            }
        }
    }
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
    match ask_held_for(
        &st,
        false,
        &next_key(&request),
        NEXT_TTL,
        Calls::Next,
        Some(&request),
    )
    .await
    {
        Ok(text) => json_response(StatusCode::OK, text, None),
        Err(response) => response,
    }
}

/// The most categories `not_category` of `next` names (the engine knows eleven).
const NOT_CATEGORY_MAX: usize = 16;

/// `not_category` of `next` (`learning`, `learning.docs`) as the list the engine takes (capability
/// `next_not_category`), or `None` when it is not plain words: which words are categories is the engine's to say.
fn not_category(words: &str) -> Option<Vec<&str>> {
    let list: Vec<&str> = words.split('.').collect();
    let plain =
        |w: &&str| !w.is_empty() && w.len() <= 32 && w.bytes().all(|b| b.is_ascii_lowercase());
    (list.len() <= NOT_CATEGORY_MAX && list.iter().all(plain)).then_some(list)
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
    let asked = json!(request);
    let mut cut = match ask_held_for(
        st,
        true,
        &next_key(&asked),
        NEXT_TTL,
        Calls::Next,
        Some(&asked),
    )
    .await
    {
        Ok(text) => match serde_json::from_str::<serde_json::Value>(&text) {
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
    let text = match ask_held(&st, false, AREAS_KEY, Calls::Areas, None).await {
        Ok(text) => text,
        Err(response) => return response,
    };
    let Ok(doc) = serde_json::from_str::<serde_json::Value>(&text) else {
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
pub(super) const OPS_ALLOWED: [&str; 33] = [
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
    "set_section",
    "view_save",
    "view_delete",
    "attach",
    // the meetings (capability `meeting_ops`); not for devices. `board_save` is not here: its `upload` is a file of the
    // hub's folder, which a request of `ops` does not name; the page saves a board through `board` (`server/boards.rs`).
    "meeting_new",
    "meeting_set",
    "meeting_close",
    "meeting_capture",
    "meeting_attend",
    "meeting_followups",
    // the learning paths (capabilities `node_set`, `promote`, `path_reward`, `path_levels`): the state (and XP) of a
    // point, a point made a task and taken back, a reward of a level granted, the levels written; not for devices
    "node_set",
    "promote",
    "unpromote",
    "path_reward",
    "path_levels",
    // no task changes: the engine writes down the figures of today in its series (`tasks.history`); not for devices
    "history_record",
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
        // The documents held for the state (a task's, a meeting's) are dropped too: the state of the vault is its
        // Markdown files, and a write can change a document without them (a file attached to a folder lists a new
        // asset, the Markdown stays as it was), so the same state would still answer with the document of before.
        if let Ok(mut details) = st.rt().details.lock() {
            details.forget();
        }
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

/// `GET /api/tasks/finished?area=&plan=&since=&until=&limit=&offset=&ci=`: the finished tasks of the Backlogs, newest
/// first, and what all that match add up to. A read; the counting is the engine's. The days are checked by the engine.
/// `ci` is the CI states joined by dots (`pending.red`: a query value is plain text, `parse_query` takes no comma),
/// handed on as a list; the engine checks the words.
pub(super) async fn finished(State(st): State<Arc<Shared>>, RawQuery(query): RawQuery) -> Response {
    let params = match parse_query(
        query.as_deref(),
        &["area", "plan", "since", "until", "limit", "offset", "ci"],
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
    if let Some(value) = params.get("ci") {
        let states: Vec<&str> = value.split('.').collect();
        request.insert("ci".to_owned(), json!(states));
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

/// `GET /api/tasks/history?area=&since=&until=&resolution=`: the figures of the overview over time (open, ready, with a
/// value, ...), one point per day or week. A read; the series is the engine's (it writes the figures down below
/// `_Telemetry/history` of the vault), the page only draws it. The days and the resolution are checked by the engine.
pub(super) async fn history(State(st): State<Arc<Shared>>, RawQuery(query): RawQuery) -> Response {
    let params = match parse_query(query.as_deref(), &["area", "since", "until", "resolution"]) {
        Ok(p) => p,
        Err(why) => return error_body(StatusCode::BAD_REQUEST, "bad_query", why),
    };
    if let Some(area) = params.get("area")
        && crate::config::valid_area_name(area).is_err()
    {
        return error_body(StatusCode::BAD_REQUEST, "bad_query", "area is not a name");
    }
    let mut request = serde_json::Map::new();
    for key in ["area", "since", "until", "resolution"] {
        if let Some(value) = params.get(key) {
            request.insert(key.to_owned(), json!(value));
        }
    }
    let request = serde_json::Value::Object(request);
    match ask(&st, Calls::History, Some(&request)).await {
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

/// `POST /api/tasks/open` `{ "id", "kind"? }`: show the file of a task in Neovim, in a window of its own. The page names
/// the task, never a file: the engine says which file it is, the hub checks that it is a plain file inside the vault, and
/// starts the editor with that one argument (no shell). With `"kind": "competence"` the id is that of a field of
/// knowledge (`<area>/<slug>`), and the file is the one `competences` of the engine names for it.
pub(super) async fn open_file(State(st): State<Arc<Shared>>, body: Bytes) -> Response {
    let rt = st.rt();
    let Some(opener) = &rt.opener else {
        return error_body(
            StatusCode::NOT_FOUND,
            "open_unavailable",
            "this hub cannot open a file in an editor",
        );
    };
    let map = match vault_request(&body, &["id", "kind"]) {
        Ok(m) => m,
        Err(r) => return r,
    };
    let competence = match map.get("kind").map(|k| k.as_str()) {
        None | Some(Some("task")) => false,
        Some(Some("competence")) => true,
        Some(_) => {
            return error_body(
                StatusCode::BAD_REQUEST,
                "bad_kind",
                "kind is task or competence",
            )
        }
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
    let name = if competence {
        match competence_file(&st, &id).await {
            Ok(name) => name,
            Err(response) => return response,
        }
    } else {
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
        name
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

/// The file of the field of knowledge `id`, as `competences` of the engine names it (asked for the area of the id only).
// The error is the answer to send, as for the routes: a response is large, and rare.
#[allow(clippy::result_large_err)]
async fn competence_file(st: &Shared, id: &str) -> Result<String, Response> {
    let area = id.split_once('/').map_or(id, |(area, _)| area);
    let reply = ask(st, Calls::Competences, Some(&json!({ "area": area }))).await?;
    let doc: serde_json::Value = serde_json::from_str(&reply.text).unwrap_or_default();
    let items = doc["items"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    let Some(item) = items.iter().find(|item| item["id"] == id) else {
        return Err(error_body(
            StatusCode::NOT_FOUND,
            "not_found",
            "the engine knows no field of knowledge of this id",
        ));
    };
    item["file"].as_str().map(str::to_owned).ok_or_else(|| {
        error_body(
            StatusCode::BAD_GATEWAY,
            "engine_failed",
            "the engine named no file for this field of knowledge",
        )
    })
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
    let on = match switch_body(&body) {
        Ok(on) => on,
        Err(response) => return response,
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

/// `GET /api/tasks/keep_running`: whether a hub in the background stays without a page (`{ "on": bool }`); `null`: this
/// hub offers no switch, or its settings cannot be read now.
pub(super) async fn keep_running_get(State(st): State<Arc<Shared>>) -> Response {
    let Some(order) = st.rt().keep_running.clone() else {
        return axum::Json(json!({ "on": null })).into_response();
    };
    match tokio::task::spawn_blocking(move || order.is_on()).await {
        Ok(Ok(on)) => axum::Json(json!({ "on": on })).into_response(),
        _ => axum::Json(json!({ "on": null })).into_response(),
    }
}

/// `POST /api/tasks/keep_running` `{ "on": bool }`: give a hub in the background the order to stay, or take it back
/// (`keep_running` of the settings). The answer is what the settings say afterwards, not what was asked.
pub(super) async fn keep_running_set(State(st): State<Arc<Shared>>, body: Bytes) -> Response {
    let on = match switch_body(&body) {
        Ok(on) => on,
        Err(response) => return response,
    };
    let Some(order) = st.rt().keep_running.clone() else {
        return error_body(
            StatusCode::NOT_FOUND,
            "keep_running_unavailable",
            "this hub has no settings to keep the order in",
        );
    };
    let done =
        tokio::task::spawn_blocking(move || order.set(on).and_then(|()| order.is_on())).await;
    match done {
        Ok(Ok(now)) => axum::Json(json!({ "on": now })).into_response(),
        Ok(Err(why)) => error_body(StatusCode::BAD_GATEWAY, "keep_running_failed", &why),
        Err(_) => error_body(
            StatusCode::INTERNAL_SERVER_ERROR,
            "keep_running_failed",
            "the change stopped unexpectedly",
        ),
    }
}

/// `GET /api/tasks/ai_desktop`: whether ai-desktop is on this machine and running (`{ "installed", "running" }`), for
/// the switch "Show AI functions" of the page. A hub without the discovery of the family says it is not found; the web
/// variant has no such route, and its page offers no switch.
pub(super) async fn ai_desktop_get(State(st): State<Arc<Shared>>) -> Response {
    let presence = match st.rt().family.clone() {
        Some(family) => tokio::task::spawn_blocking(move || family.ai_desktop())
            .await
            .unwrap_or_default(),
        None => crate::family::Presence::default(),
    };
    axum::Json(presence).into_response()
}

/// The places in code the task `id` names, each with where it is on this machine. The engine hands over the body and the
/// refs of the task; nothing is read from the vault by the hub itself.
// The error is the answer to send, as for the routes: a response is large, and rare.
#[allow(clippy::result_large_err)]
async fn docmap_places(
    st: &Arc<Shared>,
    id: &str,
) -> Result<Vec<(crate::docmap::CodeRef, crate::docmap::Resolved)>, Response> {
    let reply = ask(st, Calls::Task, Some(&json!({ "id": id }))).await?;
    let doc: serde_json::Value = serde_json::from_str(&reply.text).unwrap_or_default();
    let body = doc["body"].as_str().unwrap_or_default();
    let refs: Vec<String> = doc["task"]["refs"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter_map(|r| r.as_str().map(str::to_owned))
        .collect();
    let places = crate::docmap::collect(body, &refs);
    let folders = st
        .rt()
        .repos
        .as_ref()
        .map(|store| store.folders())
        .unwrap_or_default();
    Ok(places
        .into_iter()
        .map(|place| {
            let found = crate::docmap::resolve(&place, &folders);
            (place, found)
        })
        .collect())
}

/// `GET /api/tasks/docmap?id=`: the places in code the task names and whether DocMap can be opened at each
/// (`{ "found", "places": [{ "label", "repo", "ok", "why"? }] }`). The label is `<file>:<lines>` relative to the repo,
/// `repo` the name of the folder: no path of this machine leaves the hub. A hub without the discovery of the family says
/// DocMap is not found, and a web variant has no such route (its page offers no button).
pub(super) async fn docmap_get(
    State(st): State<Arc<Shared>>,
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
    let family = st.rt().family.clone();
    let found = match family {
        Some(family) => tokio::task::spawn_blocking(move || family.docmap_desktop().installed)
            .await
            .unwrap_or(false),
        None => false,
    };
    let places = match docmap_places(&st, id).await {
        Ok(p) => p,
        Err(response) => return response,
    };
    let places: Vec<serde_json::Value> = places
        .iter()
        .map(|(place, found_at)| match found_at {
            crate::docmap::Resolved::Found { repo, .. } => {
                json!({ "label": place.at(), "repo": repo, "ok": true })
            }
            crate::docmap::Resolved::Refused(why) => {
                json!({ "label": place.at(), "repo": place.repo, "ok": false, "why": why })
            }
        })
        .collect();
    axum::Json(json!({ "found": found, "places": places })).into_response()
}

/// `POST /api/tasks/docmap_open` `{ "id", "index" }`: open docmap-desktop at the `index`-th place of the task (the order
/// of `docmap`). The page names the task and the number, never a path: the hub reads the place again, checks it (a path
/// inside a repo of the tiles) and starts the program with the folder and `<file>:<lines>` as arguments of their own.
pub(super) async fn docmap_open(State(st): State<Arc<Shared>>, body: Bytes) -> Response {
    let Some(family) = st.rt().family.clone() else {
        return error_body(
            StatusCode::NOT_FOUND,
            "docmap_unavailable",
            "this hub cannot open DocMap",
        );
    };
    let map = match vault_request(&body, &["id", "index"]) {
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
    let Some(index) = map
        .get("index")
        .and_then(serde_json::Value::as_u64)
        .and_then(|n| usize::try_from(n).ok())
    else {
        return error_body(StatusCode::BAD_REQUEST, "bad_index", "index is a number");
    };
    let places = match docmap_places(&st, &id).await {
        Ok(p) => p,
        Err(response) => return response,
    };
    let Some((place, found)) = places.into_iter().nth(index) else {
        return error_body(
            StatusCode::NOT_FOUND,
            "not_found",
            "the task names no such place",
        );
    };
    let crate::docmap::Resolved::Found { folder, .. } = found else {
        let crate::docmap::Resolved::Refused(why) = found else {
            unreachable!("a place is found or refused");
        };
        return error_body(StatusCode::BAD_REQUEST, "docmap_refused", why);
    };
    let at = place.at();
    let opened = tokio::task::spawn_blocking(move || family.open_docmap(&folder, &at)).await;
    match opened {
        Ok(Ok(())) => axum::Json(json!({ "ok": true })).into_response(),
        Ok(Err(why)) => error_body(StatusCode::BAD_GATEWAY, "docmap_failed", &why),
        Err(_) => error_body(
            StatusCode::INTERNAL_SERVER_ERROR,
            "docmap_failed",
            "the start stopped unexpectedly",
        ),
    }
}

/// `POST /api/tasks/agent` `{ "id", "mode", "kind" }`: hand a task to an agent of ai-desktop (`crate::agent`). The page
/// names the task and what it asks for; the engine names the file, the hub checks that it lies in the vault, reads it
/// and sends it with the secret of ai-desktop, which the page never sees. A private or unclassified area goes with
/// `private`: ai-desktop then sends it to a local model only, or asks first. The answer is the job (`job_id`, `status`,
/// `private`, `note`).
pub(super) async fn agent_send(State(st): State<Arc<Shared>>, body: Bytes) -> Response {
    let map = match vault_request(&body, &["id", "mode", "kind"]) {
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
    let mode = match vault_text(&map, "mode", 16) {
        Ok(m) if crate::agent::MODES.contains(&m.as_str()) => m,
        Ok(_) => {
            return error_body(
                StatusCode::BAD_REQUEST,
                "bad_mode",
                "mode must be prefill or run",
            )
        }
        Err(r) => return r,
    };
    let kind = match vault_text(&map, "kind", 32) {
        Ok(k) if crate::agent::KINDS.contains(&k.as_str()) => k,
        Ok(_) => {
            return error_body(
                StatusCode::BAD_REQUEST,
                "bad_kind",
                "kind is not one ai-desktop takes",
            )
        }
        Err(r) => return r,
    };
    let rt = st.rt();
    let Some(intake) = rt.agent.clone() else {
        return error_body(
            StatusCode::NOT_FOUND,
            "agent_unavailable",
            "this hub hands no task to an agent",
        );
    };
    let Some(vault) = rt.vault.clone() else {
        return engine_unavailable(&st);
    };
    // A review is of a finished task: the engine reads it from the Backlog of its area (capability `task_finished`).
    let question = if kind == "review-done" {
        json!({ "id": id, "finished": true })
    } else {
        json!({ "id": id })
    };
    let reply = match ask(&st, Calls::Task, Some(&question)).await {
        Ok(r) => r,
        Err(response) => return response,
    };
    let doc = serde_json::from_str::<serde_json::Value>(&reply.text).unwrap_or_default();
    let entry = &doc["task"];
    let Some(name) = entry["file"].as_str() else {
        return error_body(
            StatusCode::BAD_GATEWAY,
            "engine_failed",
            "the engine named no file for this task",
        );
    };
    // The area of the task; the id begins with it.
    let area = entry["area"]
        .as_str()
        .or_else(|| id.split('/').next())
        .unwrap_or_default()
        .to_owned();
    let status = entry["status"].as_str().unwrap_or("open");
    if !crate::agent::kind_fits(&kind, status) {
        return error_body(
            StatusCode::CONFLICT,
            "kind_unfit",
            "this kind is not for a task of this status",
        );
    }
    let title = entry["title"]
        .as_str()
        .filter(|t| !t.trim().is_empty())
        .unwrap_or(&id)
        .to_owned();
    let file = match crate::editor::file_in_vault(&vault, name) {
        Ok(f) => f,
        Err(why) => return error_body(StatusCode::BAD_REQUEST, "agent_refused", why),
    };
    let read = tokio::task::spawn_blocking(move || -> Result<String, &'static str> {
        let size = std::fs::metadata(&file).map_err(|_| "unreadable")?.len();
        if size > crate::agent::MAX_MARKDOWN {
            return Err("too_large");
        }
        std::fs::read_to_string(&file).map_err(|_| "unreadable")
    })
    .await;
    let markdown = match read {
        Ok(Ok(text)) => text,
        Ok(Err("too_large")) => {
            return error_body(
                StatusCode::PAYLOAD_TOO_LARGE,
                "task_too_large",
                "the task file is larger than 256 KiB, ai-desktop takes no more",
            )
        }
        _ => {
            return error_body(
                StatusCode::BAD_GATEWAY,
                "task_unreadable",
                "the task file cannot be read as text",
            )
        }
    };
    let job = crate::agent::Job {
        source: crate::agent::SOURCE.to_owned(),
        task_id: id,
        title,
        markdown,
        vault: vault.to_string_lossy().replace('\\', "/"),
        area: area.clone(),
        mode,
        kind,
        private: !rt.classes.allows(&area, crate::classes::Use::CloudRunner),
        choices: None,
    };
    match intake.send(&job).await {
        Ok(answer) => (StatusCode::CREATED, axum::Json(answer)).into_response(),
        Err(refusal) => {
            let status = if refusal == crate::agent::Refusal::NotRunning {
                StatusCode::CONFLICT
            } else {
                StatusCode::BAD_GATEWAY
            };
            error_body(status, refusal.code(), &refusal.message())
        }
    }
}

/// The kinds whose answer comes back to the page as sections to adopt (`agent_result`).
const ANSWER_KINDS: [&str; 3] = ["review-done", "prepare-decision", "handoff"];

/// The headings of the summary of a hand-over, in the order ai-desktop checks them (`docs/JOBS.md` of ai-desktop).
const SUMMARY_HEADINGS: [&str; 4] = ["## Getan", "## Commits", "## Prüfungen", "## Offen"];
/// The most the summary of a hand-over weighs, in bytes (the limit of ai-desktop; checked here again: the text comes
/// out of an agent's run).
const SUMMARY_MAX: usize = 4096;

/// The summary of a hand-over (`summary` of the job `job`) as the page may show it: `{ job_id, date, markdown }`, or the
/// reason it is none. ai-desktop cleans and checks the text; the hub does not rely on that, since the text is an
/// agent's: the schema, the job it belongs to, the date, the size, no control character but the line break and the
/// tab, and the four headings, each alone on its line and in order.
fn handoff_summary(doc: &serde_json::Value, job: &str) -> Result<serde_json::Value, String> {
    let Some(summary) = doc.get("summary").filter(|v| v.is_object()) else {
        let why = doc["summary_error"]
            .as_str()
            .map(|e| {
                e.chars()
                    .filter(|c| !c.is_control())
                    .take(200)
                    .collect::<String>()
            })
            .filter(|e| !e.is_empty())
            .unwrap_or_else(|| "the run left no summary".to_owned());
        return Err(why);
    };
    if summary["schema"].as_str() != Some("handoff-summary/1") {
        return Err("the summary is not of the schema handoff-summary/1".to_owned());
    }
    if summary["job_id"].as_str() != Some(job) {
        return Err("the summary belongs to another job".to_owned());
    }
    let date = summary["date"].as_str().unwrap_or_default();
    let b = date.as_bytes();
    let date_ok = b.len() == 10
        && b.iter().enumerate().all(|(i, c)| {
            if i == 4 || i == 7 {
                *c == b'-'
            } else {
                c.is_ascii_digit()
            }
        });
    if !date_ok {
        return Err("the date of the summary is not YYYY-MM-DD".to_owned());
    }
    let markdown = summary["markdown"].as_str().unwrap_or_default();
    if markdown.len() > SUMMARY_MAX {
        return Err("the summary is longer than 4 KiB".to_owned());
    }
    if markdown
        .chars()
        .any(|c| c.is_control() && c != '\n' && c != '\t')
    {
        return Err("the summary holds a control character".to_owned());
    }
    let mut want = SUMMARY_HEADINGS.iter();
    let mut next = want.next();
    for line in markdown.lines() {
        if next == Some(&line.trim_end()) {
            next = want.next();
        }
    }
    if next.is_some() {
        return Err("the summary lacks one of its four headings".to_owned());
    }
    Ok(json!({ "job_id": job, "date": date, "markdown": markdown }))
}
/// The most of a job's answer the engine is given: its end, where the block stands. The block itself is at most 32 KiB;
/// the engine takes a request of 256 KiB, and escaped for it (line breaks, quotes, `\uXXXX` for what is not ASCII) a
/// text can grow threefold, so 64 KiB stay below that.
const ANSWER_TAIL: usize = 64 * 1024;

/// The last `max` bytes of `text`, cut at a character.
fn tail_of(text: &str, max: usize) -> &str {
    if text.len() <= max {
        return text;
    }
    let mut start = text.len() - max;
    while !text.is_char_boundary(start) {
        start += 1;
    }
    &text[start..]
}

/// `POST /api/tasks/agent_result` `{ "job", "id", "kind" }`: where a review (`review-done`) or a prepared decision
/// (`prepare-decision`) of the task `id` stands. While the job runs or waits for a yes, its `status` (and `note`,
/// `private`); a failed or cancelled one its `error`. Once it is done, the engine takes the answer of ai-desktop apart
/// (`agent_answer`, by the rules of `:Tasks agent`): `sections` to write with `set_section` after a yes, a review's
/// `follow_up`, a decision's `questions_added`. Only that reaches the page, never the whole answer of the model; an
/// answer that breaks a rule is the engine's refusal with its reason.
pub(super) async fn agent_result(State(st): State<Arc<Shared>>, body: Bytes) -> Response {
    let map = match vault_request(&body, &["job", "id", "kind"]) {
        Ok(m) => m,
        Err(r) => return r,
    };
    let job = match job_of(&map) {
        Ok(j) => j,
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
    let kind = match vault_text(&map, "kind", 32) {
        Ok(k) if ANSWER_KINDS.contains(&k.as_str()) => k,
        Ok(_) => {
            return error_body(
                StatusCode::BAD_REQUEST,
                "bad_kind",
                "kind is review-done, prepare-decision or handoff",
            )
        }
        Err(r) => return r,
    };
    let Some(intake) = st.rt().agent.clone() else {
        return error_body(
            StatusCode::NOT_FOUND,
            "agent_unavailable",
            "this hub hands no task to an agent",
        );
    };
    let doc = match intake.job(&job).await {
        Ok(doc) => doc,
        Err(refusal) => return agent_refusal(&refusal),
    };
    let mut out = serde_json::Map::new();
    if doc["status"].as_str() != Some("done") {
        for key in ["status", "error", "note", "private"] {
            if let Some(v) = doc.get(key).filter(|v| !v.is_null()) {
                out.insert(key.to_owned(), v.clone());
            }
        }
        return axum::Json(serde_json::Value::Object(out)).into_response();
    }
    if kind == "handoff" {
        // No engine: the summary is the job's own, checked here; only it (never `output`) reaches the page.
        out.insert("status".to_owned(), json!("done"));
        match handoff_summary(&doc, &job) {
            Ok(summary) => out.insert("summary".to_owned(), summary),
            Err(why) => out.insert("summary_error".to_owned(), json!(why)),
        };
        return axum::Json(serde_json::Value::Object(out)).into_response();
    }
    let output = tail_of(doc["output"].as_str().unwrap_or_default(), ANSWER_TAIL);
    let question = json!({ "kind": kind, "output": output, "id": id });
    let reply = match ask(&st, Calls::AgentAnswer, Some(&question)).await {
        Ok(r) => r,
        Err(response) => return response,
    };
    let answer = serde_json::from_str::<serde_json::Value>(&reply.text).unwrap_or_default();
    out.insert("status".to_owned(), json!("done"));
    for key in ["sections", "follow_up", "questions_added"] {
        if let Some(v) = answer.get(key).filter(|v| !v.is_null()) {
            out.insert(key.to_owned(), v.clone());
        }
    }
    axum::Json(serde_json::Value::Object(out)).into_response()
}

/// The most an intent `wkd-intent/1` weighs (UTF-8 bytes, measured before it is parsed): the limit of the schema.
const INTENT_MAX_BYTES: usize = 64 * 1024;

/// `POST /api/tasks/intent` `{ "text" }`: "Paste an intent". `text` is the intent as the person pasted it or as the
/// file they chose holds it (`wkd-intent/1`, appkit `schemas/wkd-intent/1`). It is untrusted input: more than 64 KiB
/// is refused before it is parsed, anything that is not one JSON object as well, and the rest is the engine's check
/// (its `intent`: schema, an action tasks offers, the class, no absolute path, lengths, control characters, the run
/// URL), every problem in the message. The hub asks without `yes`, always: the answer is what the engine *would* do
/// (`would_create`, `exists` with the task that holds the finding already, `shown` or `not_found` for `tasks.show`),
/// and nothing is written here. The page shows its form; a task is made through `ops` after the person's *Create*.
pub(super) async fn intent_check(State(st): State<Arc<Shared>>, body: Bytes) -> Response {
    let map = match vault_request(&body, &["text"]) {
        Ok(m) => m,
        Err(r) => return r,
    };
    let Some(text) = map.get("text").and_then(serde_json::Value::as_str) else {
        return error_body(
            StatusCode::BAD_REQUEST,
            "bad_intent",
            "text: the intent as text",
        );
    };
    if text.len() > INTENT_MAX_BYTES {
        return error_body(
            StatusCode::BAD_REQUEST,
            "intent_too_large",
            "the intent is larger than 64 KiB",
        );
    }
    let intent = match serde_json::from_str::<serde_json::Value>(text) {
        Ok(doc) if doc.is_object() => doc,
        _ => {
            return error_body(
                StatusCode::BAD_REQUEST,
                "bad_intent",
                "the intent is not one JSON object",
            )
        }
    };
    // Never `yes`: the engine says what it would do.
    match ask(&st, Calls::Intent, Some(&json!({ "intent": intent }))).await {
        Ok(reply) => json_response(StatusCode::OK, reply.text, None),
        Err(response) => response,
    }
}

/// The longest free text a draft takes (a note, a piece of a mail; ai-desktop would take more).
const DRAFT_TEXT_MAX: usize = 64 * 1024;
/// The lists of `choices` of a draft, as ai-desktop takes them (`docs/JOBS.md` "Drafts" of ai-desktop).
const DRAFT_LISTS: [&str; 5] = ["areas", "kinds", "tags", "categories", "plans"];

/// The most names a list of `choices` holds (ai-desktop takes no more).
const DRAFT_LIST_MAX: usize = 1000;

/// Is `name` one ai-desktop takes in a list of `choices`: `[A-Za-z0-9._/-]`, 1-200 bytes, not `.` or `..`?
fn draft_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 200
        && name != "."
        && name != ".."
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._/-".contains(&b))
}

/// The `choices` of a draft from what the engine said: the areas (`areas`), the kinds and the categories (the ranges
/// of `hello`), and the tags and the plans of the snapshot. Each list holds every name once, sorted, at most
/// `DRAFT_LIST_MAX`; a name ai-desktop would refuse (`draft_name`) is left out, and so is an empty list (ai-desktop
/// takes a missing one as empty). `Err` when no area or no kind is left: a draft needs both.
fn draft_choices(
    areas: &serde_json::Value,
    enums: &serde_json::Value,
    snapshot: &serde_json::Value,
) -> Result<serde_json::Value, &'static str> {
    let strings = |list: &serde_json::Value| -> Vec<String> {
        list.as_array()
            .into_iter()
            .flatten()
            .filter_map(|v| v.as_str().map(str::to_owned))
            .collect()
    };
    let tasks = || snapshot["tasks"].as_array().into_iter().flatten();
    let mut lists: [(&str, Vec<String>); 5] = [
        (
            "areas",
            areas["areas"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|a| a["name"].as_str().map(str::to_owned))
                .chain(tasks().filter_map(|t| t["area"].as_str().map(str::to_owned)))
                .collect(),
        ),
        ("kinds", strings(&enums["kind"])),
        ("tags", tasks().flat_map(|t| strings(&t["tags"])).collect()),
        ("categories", strings(&enums["category"])),
        (
            "plans",
            snapshot["plans"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|p| p["id"].as_str().map(str::to_owned))
                .collect(),
        ),
    ];
    let mut out = serde_json::Map::new();
    for (key, names) in &mut lists {
        debug_assert!(DRAFT_LISTS.contains(key));
        names.retain(|n| draft_name(n));
        names.sort();
        names.dedup();
        names.truncate(DRAFT_LIST_MAX);
        if !names.is_empty() {
            out.insert((*key).to_owned(), json!(names));
        }
    }
    if !out.contains_key("areas") || !out.contains_key("kinds") {
        return Err("the engine named no area or no kind a draft could use");
    }
    Ok(serde_json::Value::Object(out))
}

/// The `choices` of a draft, asked of the engine now (WEB-13: the page sends none, the hub trusts no list of a page).
// The error is the answer to send, as with `ask`: a response is large, and rare.
#[allow(clippy::result_large_err)]
async fn vault_choices(st: &Shared) -> Result<serde_json::Value, Response> {
    let parse = |text: &str| serde_json::from_str::<serde_json::Value>(text).unwrap_or_default();
    let areas = parse(&ask_held(st, false, AREAS_KEY, Calls::Areas, None).await?);
    let hello = parse(&ask(st, Calls::Hello, None).await?.text);
    let cached = st.rt().store.current().await.map_err(engine_failure)?;
    let snapshot = serde_json::from_slice::<serde_json::Value>(&cached.text).unwrap_or_default();
    draft_choices(&areas, &hello["enums"], &snapshot)
        .map_err(|why| error_body(StatusCode::BAD_GATEWAY, "engine_failed", why))
}

/// The answer to the page when the job did not reach ai-desktop.
fn agent_refusal(refusal: &crate::agent::Refusal) -> Response {
    let status = if *refusal == crate::agent::Refusal::NotRunning {
        StatusCode::CONFLICT
    } else {
        StatusCode::BAD_GATEWAY
    };
    error_body(status, refusal.code(), &refusal.message())
}

/// `POST /api/tasks/draft` `{ "text" }`: "Suggest fields" of the new-task form. The free text and the values of the
/// vault (`vault_choices`: asked of the engine here, the page names none) go to ai-desktop as a job of the kind
/// `draft-task`; its area is not chosen yet, so it goes as private (ai-desktop runs a local model at once and holds
/// any other for a yes, `draft_confirm`, or is put away after a no, `draft_drop`). Nothing is created: the page reads
/// the draft (`draft_job`) and fills its form. The answer is the job (`job_id`, `status`, `private`, `note`).
pub(super) async fn draft_send(State(st): State<Arc<Shared>>, body: Bytes) -> Response {
    let map = match vault_request(&body, &["text"]) {
        Ok(m) => m,
        Err(r) => return r,
    };
    // Lines are allowed in the text (vault_text refuses them); ai-desktop refuses any other control character.
    let text = match map.get("text").and_then(serde_json::Value::as_str) {
        Some(t) if !t.trim().is_empty() && t.len() <= DRAFT_TEXT_MAX => t.to_owned(),
        _ => {
            return error_body(
                StatusCode::BAD_REQUEST,
                "bad_text",
                "text: 1 byte to 64 KiB",
            )
        }
    };
    let rt = st.rt();
    let Some(intake) = rt.agent.clone() else {
        return error_body(
            StatusCode::NOT_FOUND,
            "agent_unavailable",
            "this hub hands no task to an agent",
        );
    };
    let Some(vault) = rt.vault.clone() else {
        return engine_unavailable(&st);
    };
    let choices = match vault_choices(&st).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let first: String = text
        .trim()
        .lines()
        .next()
        .unwrap_or("")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(80)
        .collect();
    let job = crate::agent::Job {
        source: crate::agent::SOURCE.to_owned(),
        task_id: "draft/new".to_owned(),
        title: if first.is_empty() {
            "New task".to_owned()
        } else {
            first
        },
        markdown: text,
        vault: vault.to_string_lossy().replace('\\', "/"),
        area: String::new(),
        mode: "run".to_owned(),
        kind: "draft-task".to_owned(),
        private: true,
        choices: Some(choices),
    };
    match intake.send(&job).await {
        Ok(answer) => (StatusCode::CREATED, axum::Json(answer)).into_response(),
        Err(refusal) => agent_refusal(&refusal),
    }
}

/// The job id of a draft route: the 16 hex digits ai-desktop gives.
#[allow(clippy::result_large_err)]
fn draft_job_id(body: &Bytes) -> Result<String, Response> {
    let map = vault_request(body, &["job"])?;
    job_of(&map)
}

/// The field `job` of a request: the 16 hex digits of a job of ai-desktop.
// The error is the answer to send, as with `ask`: a response is large, and rare.
#[allow(clippy::result_large_err)]
fn job_of(map: &serde_json::Map<String, serde_json::Value>) -> Result<String, Response> {
    match map.get("job").and_then(serde_json::Value::as_str) {
        Some(id)
            if id.len() == 16 && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) =>
        {
            Ok(id.to_owned())
        }
        _ => Err(error_body(
            StatusCode::BAD_REQUEST,
            "bad_job",
            "job: the 16 hex digits of a job of ai-desktop",
        )),
    }
}

/// The job `id` of ai-desktop, if this hub sent it (`source`) as one of `kinds` and, with `waiting`, it still waits for
/// the person's yes (`needs_confirmation`). The draft and split routes act on no other job: an id the page knows (a
/// running review) is neither shown, run nor put away through them.
#[allow(clippy::result_large_err)]
async fn own_job(
    intake: &Arc<dyn crate::agent::JobIntake>,
    id: &str,
    kinds: &[&str],
    waiting: bool,
) -> Result<serde_json::Value, Response> {
    let doc = intake.job(id).await.map_err(|r| agent_refusal(&r))?;
    check_own(doc, kinds, waiting)
}

/// The checks of `own_job` on the job `doc` that ai-desktop gave.
#[allow(clippy::result_large_err)]
fn check_own(
    doc: serde_json::Value,
    kinds: &[&str],
    waiting: bool,
) -> Result<serde_json::Value, Response> {
    let own = doc["source"].as_str() == Some(crate::agent::SOURCE)
        && doc["kind"].as_str().is_some_and(|k| kinds.contains(&k));
    if !own {
        return Err(error_body(
            StatusCode::CONFLICT,
            "not_own_job",
            "this job is not one this route acts on",
        ));
    }
    if waiting && doc["status"].as_str() != Some("needs_confirmation") {
        return Err(error_body(
            StatusCode::CONFLICT,
            "not_waiting",
            "this job does not wait for a yes",
        ));
    }
    Ok(doc)
}

/// `POST /api/tasks/draft_job` `{ "job" }`: where a draft stands. The page asks until `status` is no longer `running`;
/// then `draft` (the checked fields, schema `tasks-draft/1`) or `draft_error` says what to fill in. Only these fields
/// of the job reach the page (not the text it was given, not the model's whole answer).
pub(super) async fn draft_job(State(st): State<Arc<Shared>>, body: Bytes) -> Response {
    let id = match draft_job_id(&body) {
        Ok(id) => id,
        Err(r) => return r,
    };
    let Some(intake) = st.rt().agent.clone() else {
        return error_body(
            StatusCode::NOT_FOUND,
            "agent_unavailable",
            "this hub hands no task to an agent",
        );
    };
    match own_job(&intake, &id, &["draft-task"], false).await {
        Ok(doc) => {
            let mut out = serde_json::Map::new();
            for key in ["status", "draft", "draft_error", "error", "note", "private"] {
                if let Some(v) = doc.get(key).filter(|v| !v.is_null()) {
                    out.insert(key.to_owned(), v.clone());
                }
            }
            axum::Json(serde_json::Value::Object(out)).into_response()
        }
        Err(r) => r,
    }
}

/// `POST /api/tasks/draft_confirm` `{ "job" }`: the person said yes on the page to sending the text to a model that is
/// not local (`needs_confirmation`); the hub runs the job with the control secret.
pub(super) async fn draft_confirm(State(st): State<Arc<Shared>>, body: Bytes) -> Response {
    let id = match draft_job_id(&body) {
        Ok(id) => id,
        Err(r) => return r,
    };
    let Some(intake) = st.rt().agent.clone() else {
        return error_body(
            StatusCode::NOT_FOUND,
            "agent_unavailable",
            "this hub hands no task to an agent",
        );
    };
    // Also the yes of a split (`split_confirm` is this route).
    if let Err(r) = own_job(&intake, &id, &["draft-task", "split-plan"], true).await {
        return r;
    }
    match intake.confirm(&id).await {
        Ok(()) => axum::Json(json!({ "status": "running" })).into_response(),
        Err(refusal) => agent_refusal(&refusal),
    }
}

/// `POST /api/tasks/draft_drop` `{ "job" }`: nobody waits for this job any more (the person said no to sending the
/// text, or closed the form while it asked); the hub puts it away in ai-desktop with the control secret
/// (`DELETE /jobs/<id>`), so that it does not stay in the dashboard with the free text. A job that is gone already
/// counts as put away.
pub(super) async fn draft_drop(State(st): State<Arc<Shared>>, body: Bytes) -> Response {
    let id = match draft_job_id(&body) {
        Ok(id) => id,
        Err(r) => return r,
    };
    let Some(intake) = st.rt().agent.clone() else {
        return error_body(
            StatusCode::NOT_FOUND,
            "agent_unavailable",
            "this hub hands no task to an agent",
        );
    };
    // Also the no of a split (`split_drop` is this route). A job that ai-desktop no longer knows (it restarted) is
    // put away already: 404 on the read counts as dropped, as the delete does.
    match intake.job(&id).await {
        Ok(doc) => {
            if let Err(r) = check_own(doc, &["draft-task", "split-plan"], true) {
                return r;
            }
        }
        Err(crate::agent::Refusal::Refused { status: 404, .. }) => {
            return axum::Json(json!({ "status": "dropped" })).into_response();
        }
        Err(refusal) => return agent_refusal(&refusal),
    }
    match intake.discard(&id).await {
        Ok(()) => axum::Json(json!({ "status": "dropped" })).into_response(),
        Err(refusal) => agent_refusal(&refusal),
    }
}

/// The plan file of `id` (`<area>/<slug>`): `<area>/ROADMAP/plans/<slug>.md`, or its folder form
/// `<area>/ROADMAP/plans/<slug>/<slug>.md`; checked to lie in the vault.
fn plan_file(vault: &std::path::Path, id: &str) -> Option<PathBuf> {
    let (area, slug) = id.split_once('/')?;
    [
        format!("{area}/ROADMAP/plans/{slug}.md"),
        format!("{area}/ROADMAP/plans/{slug}/{slug}.md"),
    ]
    .into_iter()
    .find_map(|name| {
        crate::editor::file_in_vault(vault, &name)
            .ok()
            .filter(|f| f.is_file())
    })
}

/// One line of the list of a plan's tasks: `- <id> (<status>, phase <phase>): <title>`.
fn plan_task_line(task: &serde_json::Value, status: &str) -> Option<String> {
    let id = task["id"].as_str()?;
    let one = |s: &str| s.replace(['\r', '\n'], " ");
    Some(format!(
        "- {id} ({status}, phase {}): {}",
        one(task["phase"].as_str().unwrap_or("-")),
        one(task["title"].as_str().unwrap_or(""))
    ))
}

/// `POST /api/tasks/split` `{ "plan" }`: "Split into tasks" of a plan. The hub reads the plan file and appends the list
/// of the plan's tasks, open (the snapshot) and finished (the engine's `finished`), so that the drafts do not repeat
/// them, and sends it to ai-desktop as a job of the kind `split-plan`, run at once (`docs/JOBS.md` "Splitting a plan"
/// of ai-desktop). A private or unclassified area goes as private. Nothing is created: the page reads the drafts
/// (`split_job`), the person ticks them, and the page creates the ticked ones through `ops`.
pub(super) async fn split_send(State(st): State<Arc<Shared>>, body: Bytes) -> Response {
    let map = match vault_request(&body, &["plan"]) {
        Ok(m) => m,
        Err(r) => return r,
    };
    let id = match vault_text(&map, "plan", 200) {
        Ok(id) if valid_task_id(&id) => id,
        Ok(_) => {
            return error_body(
                StatusCode::BAD_REQUEST,
                "bad_plan",
                "plan must be <area>/<slug>",
            )
        }
        Err(r) => return r,
    };
    let rt = st.rt();
    let Some(intake) = rt.agent.clone() else {
        return error_body(
            StatusCode::NOT_FOUND,
            "agent_unavailable",
            "this hub hands no task to an agent",
        );
    };
    let Some(vault) = rt.vault.clone() else {
        return engine_unavailable(&st);
    };
    let cached = match rt.store.current().await {
        Ok(c) => c,
        Err(error) => return engine_failure(error),
    };
    let snapshot = serde_json::from_slice::<serde_json::Value>(&cached.text).unwrap_or_default();
    let Some(plan) = snapshot["plans"]
        .as_array()
        .and_then(|plans| plans.iter().find(|p| p["id"].as_str() == Some(id.as_str())))
        .cloned()
    else {
        return error_body(
            StatusCode::NOT_FOUND,
            "plan_not_found",
            "there is no open plan of this id",
        );
    };
    let mut lines: Vec<String> = snapshot["tasks"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|t| t["plan"].as_str() == Some(id.as_str()))
        .filter_map(|t| plan_task_line(t, t["status"].as_str().unwrap_or("open")))
        .collect();
    // The finished ones, page by page (the engine gives at most `LIST_PAGE` a page; five pages are plenty for a plan).
    let mut offset = 0u64;
    for _ in 0..5 {
        let Ok(reply) = ask(
            &st,
            Calls::Finished,
            Some(&json!({ "plan": id, "limit": crate::engine::LIST_PAGE, "offset": offset })),
        )
        .await
        else {
            break;
        };
        let doc = serde_json::from_str::<serde_json::Value>(&reply.text).unwrap_or_default();
        lines.extend(
            doc["items"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|t| plan_task_line(t, "done")),
        );
        match doc["next_offset"].as_u64() {
            Some(next) if next > offset => offset = next,
            _ => break,
        }
    }
    lines.sort();
    lines.dedup();
    let file = {
        let vault = vault.clone();
        let id = id.clone();
        tokio::task::spawn_blocking(move || -> Result<String, &'static str> {
            let file = plan_file(&vault, &id).ok_or("missing")?;
            let size = std::fs::metadata(&file).map_err(|_| "missing")?.len();
            if size > crate::agent::MAX_MARKDOWN / 2 {
                return Err("too_large");
            }
            std::fs::read_to_string(&file).map_err(|_| "missing")
        })
        .await
    };
    let text = match file {
        Ok(Ok(text)) => text,
        Ok(Err("too_large")) => {
            return error_body(
                StatusCode::PAYLOAD_TOO_LARGE,
                "plan_too_large",
                "the plan file is larger than 128 KiB",
            )
        }
        _ => {
            return error_body(
                StatusCode::BAD_GATEWAY,
                "plan_unreadable",
                "the plan file cannot be read",
            )
        }
    };
    let listed = if lines.is_empty() {
        "(none yet)".to_owned()
    } else {
        lines.join("\n")
    };
    let mut markdown = format!("{}\n\n## Tasks of this plan\n\n{listed}\n", text.trim());
    if markdown.len() as u64 > crate::agent::MAX_MARKDOWN {
        // Many tasks: the list is cut at a line, and says so.
        let mut cut = (crate::agent::MAX_MARKDOWN as usize).saturating_sub(64);
        while !markdown.is_char_boundary(cut) {
            cut -= 1;
        }
        let at = markdown[..cut].rfind('\n').unwrap_or(cut);
        markdown.truncate(at);
        markdown.push_str("\n- (the list is cut here)\n");
    }
    let area = id.split('/').next().unwrap_or_default().to_owned();
    let title = plan["title"]
        .as_str()
        .filter(|t| !t.trim().is_empty())
        .unwrap_or(&id)
        .replace(['\r', '\n'], " ");
    let job = crate::agent::Job {
        source: crate::agent::SOURCE.to_owned(),
        task_id: id,
        title,
        markdown,
        vault: vault.to_string_lossy().replace('\\', "/"),
        area: area.clone(),
        mode: "run".to_owned(),
        kind: "split-plan".to_owned(),
        private: !rt.classes.allows(&area, crate::classes::Use::CloudRunner),
        choices: None,
    };
    match intake.send(&job).await {
        Ok(answer) => (StatusCode::CREATED, axum::Json(answer)).into_response(),
        Err(refusal) => agent_refusal(&refusal),
    }
}

/// The last block between `<!-- split:begin -->` and `<!-- split:end -->` of an answer, or None.
fn split_block(output: &str) -> Option<&str> {
    const BEGIN: &str = "<!-- split:begin -->";
    const END: &str = "<!-- split:end -->";
    let start = output.rfind(BEGIN)? + BEGIN.len();
    let end = output[start..].find(END)? + start;
    Some(output[start..end].trim())
}

/// `POST /api/tasks/split_job` `{ "job" }`: where a split stands. Once it is done, `block` is the JSON of its drafts
/// (the last block of the answer, at most 64 KiB), `block_error` says why there is none. The rest of the answer and the
/// text sent do not reach the page.
pub(super) async fn split_job(State(st): State<Arc<Shared>>, body: Bytes) -> Response {
    let id = match draft_job_id(&body) {
        Ok(id) => id,
        Err(r) => return r,
    };
    let Some(intake) = st.rt().agent.clone() else {
        return error_body(
            StatusCode::NOT_FOUND,
            "agent_unavailable",
            "this hub hands no task to an agent",
        );
    };
    match own_job(&intake, &id, &["split-plan"], false).await {
        Ok(doc) => {
            let mut out = serde_json::Map::new();
            for key in ["status", "error", "note", "private"] {
                if let Some(v) = doc.get(key).filter(|v| !v.is_null()) {
                    out.insert(key.to_owned(), v.clone());
                }
            }
            if doc["status"].as_str() == Some("done") {
                match doc["output"].as_str().and_then(split_block) {
                    Some(block) if block.len() <= 64 * 1024 => {
                        out.insert("block".to_owned(), json!(block));
                    }
                    Some(_) => {
                        out.insert(
                            "block_error".to_owned(),
                            json!("the drafts are larger than 64 KiB"),
                        );
                    }
                    None => {
                        out.insert(
                            "block_error".to_owned(),
                            json!("the answer holds no block of drafts"),
                        );
                    }
                }
            }
            axum::Json(serde_json::Value::Object(out)).into_response()
        }
        Err(r) => r,
    }
}

/// The body of a switch, `{ "on": true | false }` and nothing else; `Err`: the answer to send.
// The error is the answer to send, as with `ask`: a response is large, and rare.
#[allow(clippy::result_large_err)]
fn switch_body(body: &[u8]) -> Result<bool, Response> {
    match serde_json::from_slice::<serde_json::Value>(body) {
        Ok(doc) => match (
            doc.as_object().map(serde_json::Map::len),
            doc["on"].as_bool(),
        ) {
            (Some(1), Some(on)) => Ok(on),
            _ => Err(error_body(
                StatusCode::BAD_REQUEST,
                "bad_request",
                "the body is { \"on\": true | false }",
            )),
        },
        Err(_) => Err(error_body(
            StatusCode::BAD_REQUEST,
            "bad_request",
            "the body is not JSON",
        )),
    }
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
    // The desktop page takes a photo or records a video as an attachment of a task (the detail's Video and Image
    // buttons): its permissions allow the camera and the microphone to this origin. The browser still asks the
    // person each time; the phone page, the data routes and the policy of the page stay as they are.
    .with_page_capture()
    // What a paired phone reaches (appkit `MOB-02`, fail closed): exactly the routes tasks-mobile asks, nothing the
    // desktop page alone needs (the vaults, events, search, sheets, repos ...). `ops` is released at `create` and
    // judges each operation and its fields itself (`device_op_level`, `device_op_fields`). `upload` adds a file to a
    // task that is there, which changes it: `change`.
    .with_device_route(crate::IDENTITY.route("snapshot"), Level::Read)
    .with_device_route(crate::IDENTITY.route("areas"), Level::Read)
    .with_device_route(crate::IDENTITY.route("next"), Level::Read)
    .with_device_route(crate::IDENTITY.route("task"), Level::Read)
    .with_device_route(crate::IDENTITY.route("done_preview"), Level::Read)
    // What this device may do now, so the phone page offers only that (the hub still judges every request).
    .with_device_route(crate::IDENTITY.route("device"), Level::Read)
    // The test sheets of a task, run by the testing hub (`server/testing.rs`): reading what there is and where a run
    // stands is `read`; starting one is `trigger`, with the phone's confirmation of that very request.
    .with_device_route(crate::IDENTITY.route("testing_sheets"), Level::Read)
    .with_device_route(crate::IDENTITY.route("testing_run"), Level::Read)
    .with_device_route(crate::IDENTITY.route("testing_start"), Level::Trigger)
    // The learning paths of the released areas, cut for a phone (`device_cut::paths`, `device_cut::path`).
    .with_device_route(crate::IDENTITY.route("paths"), Level::Read)
    // The meetings of the released areas, cut for a phone (`device_cut::meetings`, `device_cut::meeting`).
    .with_device_route(crate::IDENTITY.route("meetings"), Level::Read)
    .with_device_route(crate::IDENTITY.route("meeting"), Level::Read)
    .with_device_route(crate::IDENTITY.route("path"), Level::Read)
    // The page Lernen of the phone: the next steps and the series of the released areas (`learn::read_for`).
    .with_device_route(crate::IDENTITY.route("learn_next"), Level::Read)
    .with_device_route(crate::IDENTITY.route("learn_history"), Level::Read)
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
        // A participant ticked present: only where the people of the meeting may reach the phone (`device_refusal`).
        "set" | "done" | "node_set" | "meeting_capture" | "meeting_attend" => Some(Level::Change),
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
        // A learning point ticked: its state and the reason of `seen` or `dropped`, and `ack` once the person confirmed
        // closing a point under `{safety}` on the phone (the engine refuses such a point without it); no note, no XP.
        "node_set" => &["op", "id", "point", "state", "reason", "ack", "if_match"],
        // A line of the minutes written on the phone: text, a task, a decision or a question, or a photo or a voice note
        // the phone uploaded to the meeting before (`device_op_shape`).
        "meeting_capture" => &["op", "id", "entry"],
        // A participant ticked present or not, by number or by name.
        "meeting_attend" => &["op", "id", "n", "name", "present", "if_match"],
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
    if name == "meeting_capture" {
        return map
            .get("entry")
            .and_then(serde_json::Value::as_object)
            .is_some_and(device_capture_entry);
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

/// The entry of a `meeting_capture` of a phone: a line of text (`text`, `task`, `decision`, `question`; its text and a
/// time, never a file), or a photo or a voice note (`photo`, `audio`) that names its file in the folder of its kind, as
/// the upload of a phone puts it (`kind=image` into `assets/images/`, `kind=audio` into `assets/audio/`): one plain name,
/// no folder below, no `..`. A board, a file elsewhere in the folder or anything else is not for a phone.
fn device_capture_entry(entry: &serde_json::Map<String, serde_json::Value>) -> bool {
    let kind = entry.get("kind").and_then(serde_json::Value::as_str);
    match kind {
        Some("text" | "task" | "decision" | "question") => entry
            .keys()
            .all(|k| matches!(k.as_str(), "kind" | "text" | "at")),
        Some(media @ ("photo" | "audio")) => {
            let folder = if media == "photo" {
                "assets/images/"
            } else {
                "assets/audio/"
            };
            entry
                .keys()
                .all(|k| matches!(k.as_str(), "kind" | "text" | "asset" | "at"))
                && entry
                    .get("asset")
                    .and_then(serde_json::Value::as_str)
                    .and_then(|asset| asset.strip_prefix(folder))
                    .is_some_and(plain_asset_name)
        }
        _ => false,
    }
}

/// A file name as the upload of the hub makes it (`upload::clean_name`): letters, digits and `_ . -`, starting with a
/// letter, a digit or `_`, no `..`, at most 120 bytes; nothing of a path.
fn plain_asset_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 120
        && !name.contains("..")
        && name
            .chars()
            .next()
            .is_some_and(|c| c.is_alphanumeric() || c == '_')
        && name
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '_' | '.' | '-'))
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
        let area = device_cut::op_area(op);
        if !area.is_some_and(|area| device_cut::released(&st.rt().classes, area)) {
            return Some(not_found());
        }
        // The people of a meeting are ticked only where they may reach the phone: a public area, an internal one
        // with the settings' `meetings.internal_people` (fail closed).
        if op["op"] == "meeting_attend"
            && !area.is_some_and(|area| {
                device_cut::meeting_people(&st.rt().classes, area, super::meetings::release_of(st))
            })
        {
            return Some(error_body(
                StatusCode::FORBIDDEN,
                "not_for_devices",
                "the people of this meeting are not released for devices",
            ));
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

    #[test]
    fn the_choices_of_a_draft_are_the_engines_names_once_sorted_and_only_those_ai_desktop_takes() {
        use super::{draft_choices, DRAFT_LIST_MAX};
        use serde_json::json;
        let areas = json!({ "areas": [{ "name": "beta" }, { "name": "alpha.nvim" }, { "name": "with space" }] });
        let enums =
            json!({ "kind": ["task", "bug", "task"], "category": ["docs"], "prio": [1, 2] });
        let snapshot = json!({
            "tasks": [
                { "id": "gamma/a", "area": "gamma", "tags": ["ui", "ux", "ui"] },
                { "id": "beta/b", "area": "beta", "tags": ["..", "a b", ""] },
            ],
            "plans": [{ "id": "beta/plan-1" }, { "id": 7 }],
        });
        assert_eq!(
            draft_choices(&areas, &enums, &snapshot).unwrap(),
            json!({
                "areas": ["alpha.nvim", "beta", "gamma"],
                "kinds": ["bug", "task"],
                "tags": ["ui", "ux"],
                "categories": ["docs"],
                "plans": ["beta/plan-1"],
            })
        );
        // No more than ai-desktop takes in a list.
        let many: Vec<serde_json::Value> = (0..1500)
            .map(|i| json!({ "name": format!("a{i:04}") }))
            .collect();
        let cut = draft_choices(&json!({ "areas": many }), &enums, &json!({})).unwrap();
        assert_eq!(cut["areas"].as_array().unwrap().len(), DRAFT_LIST_MAX);
        assert!(
            cut.get("tags").is_none() && cut.get("plans").is_none(),
            "{cut}"
        );
        // A draft needs an area and a kind: an engine that names none gets no job.
        assert!(draft_choices(&json!({}), &enums, &json!({})).is_err());
        assert!(draft_choices(&areas, &json!({}), &snapshot).is_err());
        assert!(draft_choices(&areas, &json!(null), &json!(null)).is_err());
    }
}

#[cfg(test)]
mod handoff_summary_rules {
    use super::handoff_summary;
    use serde_json::json;

    const JOB: &str = "0123456789abcdef";
    const GOOD: &str =
        "## Getan\n- x\n\n## Commits\nrepo@abc1234\n\n## Prüfungen\nCLEAN\n\n## Offen\nnothing\n";

    fn doc(markdown: &str) -> serde_json::Value {
        json!({ "summary": {
            "schema": "handoff-summary/1", "job_id": JOB, "date": "2026-11-23", "markdown": markdown
        } })
    }

    #[test]
    fn a_summary_that_keeps_the_rules_passes_as_it_is() {
        let got = handoff_summary(&doc(GOOD), JOB).unwrap();
        assert_eq!(got["markdown"], GOOD);
        assert_eq!(
            (got["job_id"].as_str(), got["date"].as_str()),
            (Some(JOB), Some("2026-11-23"))
        );
    }

    #[test]
    fn a_summary_that_breaks_a_rule_is_refused_with_its_reason() {
        let mut other_job = doc(GOOD);
        other_job["summary"]["job_id"] = json!("ffffffffffffffff");
        let mut schema = doc(GOOD);
        schema["summary"]["schema"] = json!("handoff-summary/2");
        let mut date = doc(GOOD);
        date["summary"]["date"] = json!("23.11.2026");
        for (name, d, part) in [
            ("another job", other_job, "another job"),
            ("schema", schema, "schema"),
            ("date", date, "YYYY-MM-DD"),
            (
                "too long",
                doc(&format!("{GOOD}{}", "x".repeat(4096))),
                "4 KiB",
            ),
            (
                "control",
                doc(&GOOD.replace("nothing", "no\u{1b}[31mthing")),
                "control",
            ),
            (
                "heading",
                doc(&GOOD.replace("## Offen", "Offen")),
                "headings",
            ),
            (
                "order",
                doc("## Commits\n## Getan\n## Prüfungen\n## Offen\n"),
                "headings",
            ),
            ("none", json!({ "summary_error": "no block" }), "no block"),
            ("neither", json!({}), "no summary"),
        ] {
            let why = handoff_summary(&d, JOB).expect_err(name);
            assert!(why.contains(part), "{name}: {why}");
        }
    }

    #[test]
    fn the_reason_an_agent_run_left_is_cleaned_of_control_characters() {
        let why = handoff_summary(&json!({ "summary_error": "a\u{7}b\nc" }), JOB).unwrap_err();
        assert_eq!(why, "abc");
    }
}
