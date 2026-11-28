//! The reads of the tab "Lernpläne" over all learning paths (concept "Reiter Lernpläne" 3-11): what to learn next, the
//! notes and sources, the evidence, the series of the learning figures and the competences. Each is under `/api/`, so
//! the guard asked for a session before a handler runs. A paired phone has two of them, for its page Lernen (MOB-02),
//! each cut field by field to the paths of released areas (`device_cut::learn_next`, `device_cut::learn_history`).
//! `learn_history` is asked of the engine for the released areas alone (`areas`; none released: none asked), so the
//! sums and the streak of the series are the engine's over what the phone may know. `learn_next` takes no `areas` (its
//! figures are per path, nothing is summed): it is asked as asked, an area that is not released answers nothing
//! without asking. The others are not routes of a phone.
//!
//! The documents of the engine are passed on as it wrote them; the page draws them and computes nothing (WEB-13). The
//! hub checks the shape of a parameter (a name, a word of a list, a number in range); what it means is the engine's.

use super::*;

fn bad_query(why: &str) -> Response {
    error_body(StatusCode::BAD_REQUEST, "bad_query", why)
}

type Params = std::collections::HashMap<String, String>;

/// `area` as the engine's `area`, refused when it is not a name.
fn take_area(
    params: &Params,
    request: &mut serde_json::Map<String, serde_json::Value>,
) -> Result<(), &'static str> {
    if let Some(area) = params.get("area") {
        if crate::config::valid_area_name(area).is_err() {
            return Err("area is not a name");
        }
        request.insert("area".to_owned(), json!(area));
    }
    Ok(())
}

/// The most names `areas` may give (the area filter of the page names a few).
const AREAS_MAX: usize = 32;

/// `areas` (several areas or area groups, joined by `/`, which no area name holds) as the engine's `areas` list,
/// refused when a part is not a name; for the reads whose engine method takes a list (the area filter of the page
/// with several names).
fn take_areas(
    params: &Params,
    request: &mut serde_json::Map<String, serde_json::Value>,
) -> Result<(), &'static str> {
    if let Some(list) = params.get("areas") {
        let names: Vec<&str> = list.split('/').collect();
        if names.len() > AREAS_MAX {
            return Err("areas names at most 32 areas");
        }
        if names
            .iter()
            .any(|name| crate::config::valid_area_name(name).is_err())
        {
            return Err("areas are names joined by /");
        }
        request.insert("areas".to_owned(), json!(names));
    }
    Ok(())
}

/// `path` (one id of a learning path) as the engine's `paths: [id]`.
fn take_path(
    params: &Params,
    request: &mut serde_json::Map<String, serde_json::Value>,
) -> Result<(), &'static str> {
    if let Some(id) = params.get("path") {
        if !valid_task_id(id) {
            return Err("path must be <area>/<slug>");
        }
        request.insert("paths".to_owned(), json!([id]));
    }
    Ok(())
}

/// `include_done=1` as the engine's `include_done: true`.
fn take_done(
    params: &Params,
    request: &mut serde_json::Map<String, serde_json::Value>,
) -> Result<(), &'static str> {
    match params.get("include_done").map(String::as_str) {
        None => Ok(()),
        Some("1") => {
            request.insert("include_done".to_owned(), json!(true));
            Ok(())
        }
        Some(_) => Err("include_done is 1 or absent"),
    }
}

/// A whole number within `range` (`why` when it is not).
fn take_number(
    params: &Params,
    key: &str,
    range: std::ops::RangeInclusive<u32>,
    why: &'static str,
    request: &mut serde_json::Map<String, serde_json::Value>,
) -> Result<(), &'static str> {
    if let Some(value) = params.get(key) {
        let n = value
            .parse::<u32>()
            .ok()
            .filter(|n| range.contains(n))
            .ok_or(why)?;
        request.insert(key.to_owned(), json!(n));
    }
    Ok(())
}

/// A word of `words` (`why` when it is none).
fn take_word(
    params: &Params,
    key: &str,
    words: &[&str],
    why: &'static str,
    request: &mut serde_json::Map<String, serde_json::Value>,
) -> Result<(), &'static str> {
    if let Some(value) = params.get(key) {
        if !words.contains(&value.as_str()) {
            return Err(why);
        }
        request.insert(key.to_owned(), json!(value));
    }
    Ok(())
}

/// A day `YYYY-MM-DD` (its shape; whether it is a day of the calendar is the engine's).
fn take_day(
    params: &Params,
    key: &str,
    request: &mut serde_json::Map<String, serde_json::Value>,
) -> Result<(), &'static str> {
    if let Some(value) = params.get(key) {
        let b = value.as_bytes();
        let day = b.len() == 10
            && b.iter().enumerate().all(|(i, c)| {
                if i == 4 || i == 7 {
                    *c == b'-'
                } else {
                    c.is_ascii_digit()
                }
            });
        if !day {
            return Err("since and until are days, YYYY-MM-DD");
        }
        request.insert(key.to_owned(), json!(value));
    }
    Ok(())
}

/// The question of `learn_next` from the query (`area`, `path`, `machine`, `n`).
pub(super) fn learn_next_request(query: Option<&str>) -> Result<serde_json::Value, &'static str> {
    let params = parse_query(query, &["area", "path", "machine", "n"])?;
    let mut request = serde_json::Map::new();
    take_area(&params, &mut request)?;
    take_path(&params, &mut request)?;
    take_word(
        &params,
        "machine",
        &["private", "workstation", "wsl"],
        "machine is private, workstation or wsl",
        &mut request,
    )?;
    take_number(&params, "n", 1..=20, "n is 1 to 20", &mut request)?;
    Ok(serde_json::Value::Object(request))
}

/// The most bytes of the search text of `learn_notes` (the engine's bound).
const NOTES_QUERY_MAX: usize = 200;

/// The question of `learn_notes` from the query: `q` the search text (escaped as `encodeURIComponent` writes it, as
/// for `/api/tasks/search`), `kind`, `area`, `path`, `include_done`, `limit`.
pub(super) fn learn_notes_request(query: Option<&str>) -> Result<serde_json::Value, &'static str> {
    let raw = query.unwrap_or("");
    let (text, rest): (Vec<&str>, Vec<&str>) = raw
        .split('&')
        .filter(|p| !p.is_empty())
        .partition(|p| p.starts_with("q="));
    let params = parse_query(
        Some(&rest.join("&")),
        &["kind", "area", "areas", "path", "include_done", "limit"],
    )?;
    let mut request = serde_json::Map::new();
    match text.as_slice() {
        [] => {}
        [one] => {
            let (decoded, _) = appkit_hub::search::parse_request(Some(one))?;
            if decoded.len() > NOTES_QUERY_MAX {
                return Err("q is at most 200 bytes");
            }
            if decoded.chars().any(char::is_control) {
                return Err("q holds a control character");
            }
            // Trimmed as JavaScript's `String.prototype.trim` does, so that the web variant (ui/src/web/learnQuery.ts)
            // asks the engine the same: Rust's `trim` keeps U+FEFF, JavaScript's removes it (U+0085, which only
            // Rust's removes, is a control character and refused above).
            let decoded = decoded.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
            if !decoded.is_empty() {
                request.insert("query".to_owned(), json!(decoded));
            }
        }
        _ => return Err("q is given twice"),
    }
    take_word(
        &params,
        "kind",
        &["note", "link", "image"],
        "kind is note, link or image",
        &mut request,
    )?;
    take_area(&params, &mut request)?;
    take_areas(&params, &mut request)?;
    take_path(&params, &mut request)?;
    take_done(&params, &mut request)?;
    take_number(&params, "limit", 1..=500, "limit is 1 to 500", &mut request)?;
    Ok(serde_json::Value::Object(request))
}

/// The question of `learn_evidence` from the query (`competence`, `area`, `areas`, `path`, `include_done`).
pub(super) fn learn_evidence_request(
    query: Option<&str>,
) -> Result<serde_json::Value, &'static str> {
    let params = parse_query(
        query,
        &["competence", "area", "areas", "path", "include_done"],
    )?;
    let mut request = serde_json::Map::new();
    if let Some(id) = params.get("competence") {
        if !valid_task_id(id) {
            return Err("competence must be <area>/<slug>");
        }
        request.insert("competence".to_owned(), json!(id));
    }
    take_area(&params, &mut request)?;
    take_areas(&params, &mut request)?;
    take_path(&params, &mut request)?;
    take_done(&params, &mut request)?;
    Ok(serde_json::Value::Object(request))
}

/// The question of `learn_history` from the query (`since`, `until`, `step`, `area`, `areas`, `path`).
pub(super) fn learn_history_request(
    query: Option<&str>,
) -> Result<serde_json::Value, &'static str> {
    let params = parse_query(query, &["since", "until", "step", "area", "areas", "path"])?;
    let mut request = serde_json::Map::new();
    take_day(&params, "since", &mut request)?;
    take_day(&params, "until", &mut request)?;
    take_word(
        &params,
        "step",
        &["day", "week", "month"],
        "step is day, week or month",
        &mut request,
    )?;
    take_area(&params, &mut request)?;
    take_areas(&params, &mut request)?;
    take_path(&params, &mut request)?;
    Ok(serde_json::Value::Object(request))
}

/// The question of `competences` from the query (`area`, `areas`).
pub(super) fn competences_request(query: Option<&str>) -> Result<serde_json::Value, &'static str> {
    let params = parse_query(query, &["area", "areas"])?;
    let mut request = serde_json::Map::new();
    take_area(&params, &mut request)?;
    take_areas(&params, &mut request)?;
    Ok(serde_json::Value::Object(request))
}

/// Ask `method` with the question `request` made of the query, and pass the engine's document on.
async fn read(
    st: &Shared,
    method: Method,
    request: Result<serde_json::Value, &'static str>,
) -> Response {
    let request = match request {
        Ok(r) => r,
        Err(why) => return bad_query(why),
    };
    match ask(st, method, Some(&request)).await {
        Ok(reply) => json_response(StatusCode::OK, reply.text, None),
        Err(response) => response,
    }
}

/// The question of a phone: the areas it asked for (`area`), or all of them, narrowed to the released ones, as `areas`;
/// an area it may not know is as if it were not there. An empty list asks for no path at all (the engine's scope).
async fn for_device(st: &Shared, mut request: serde_json::Value) -> serde_json::Value {
    let released = device_areas(st).await;
    let asked = request
        .get("area")
        .and_then(|a| a.as_str())
        .map(str::to_owned);
    let areas: Vec<String> = match asked {
        Some(area) => released.into_iter().filter(|a| *a == area).collect(),
        None => released,
    };
    if let Some(map) = request.as_object_mut() {
        map.remove("area");
        map.insert("areas".to_owned(), json!(areas));
    }
    request
}

/// How a read of a phone is narrowed before the engine is asked: to its released areas (`areas`, for a read whose sums
/// are over its scope), or only refused for an area asked that is not released (the cut does the rest).
#[derive(Clone, Copy)]
enum Narrow {
    Areas,
    AskedArea,
}

/// A read a phone has: narrowed as `narrow` says, the answer cut by `cut`.
async fn read_for(
    st: &Shared,
    caller: Option<&Caller>,
    method: Method,
    request: Result<serde_json::Value, &'static str>,
    narrow: Narrow,
    cut: fn(&crate::classes::AreaPolicy, &serde_json::Value) -> serde_json::Value,
) -> Response {
    let device = is_device(caller);
    let request = match (request, narrow) {
        (Err(why), _) => return bad_query(why),
        (Ok(r), Narrow::Areas) if device => {
            let narrowed = for_device(st, r.clone()).await;
            match ask_as(st, device, method, Some(&narrowed)).await {
                // The areas came from the answer of `areas` the hub holds (`device_areas`). One that went since (deleted
                // or renamed in an empty area, which moves no state) makes the engine refuse the whole read as
                // `not_found` (unknown area): the held answer is dropped and the read asked once more with the areas
                // read anew.
                Err(response) if response.status() == StatusCode::NOT_FOUND => {
                    if let Ok(mut held) = st.rt().details.lock() {
                        held.drop_one(AREAS_KEY);
                    }
                    for_device(st, r).await
                }
                Ok(reply) => {
                    let doc =
                        serde_json::from_str::<serde_json::Value>(&reply.text).unwrap_or_default();
                    return json_response(
                        StatusCode::OK,
                        cut(&st.rt().classes, &doc).to_string(),
                        None,
                    );
                }
                Err(response) => return response,
            }
        }
        (Ok(r), Narrow::AskedArea) if device => {
            let asked = r.get("area").and_then(|a| a.as_str());
            if asked.is_some_and(|area| !device_cut::released(&st.rt().classes, area)) {
                // an area the phone may not know: as if it had no path, the engine is not asked
                let empty = json!({ "kind": "tasks.learn_next", "items": [], "incomplete": [] });
                return json_response(
                    StatusCode::OK,
                    cut(&st.rt().classes, &empty).to_string(),
                    None,
                );
            }
            r
        }
        (Ok(r), _) => r,
    };
    match ask_as(st, device, method, Some(&request)).await {
        Ok(reply) if device => {
            let doc = serde_json::from_str::<serde_json::Value>(&reply.text).unwrap_or_default();
            json_response(
                StatusCode::OK,
                cut(&st.rt().classes, &doc).to_string(),
                None,
            )
        }
        Ok(reply) => json_response(StatusCode::OK, reply.text, None),
        Err(response) => response,
    }
}

/// `GET /api/tasks/learn_next?area=&path=&machine=&n=`: for every running learning path the next points to learn
/// (`tasks.learn_next`, capability `learn_next`); for a phone those of the released areas, cut.
pub(super) async fn learn_next(
    State(st): State<Arc<Shared>>,
    caller: Option<axum::Extension<Caller>>,
    RawQuery(query): RawQuery,
) -> Response {
    read_for(
        &st,
        caller.as_deref(),
        Calls::LearnNext,
        learn_next_request(query.as_deref()),
        Narrow::AskedArea,
        device_cut::learn_next,
    )
    .await
}

/// `GET /api/tasks/learn_notes?q=&kind=&area=&path=&include_done=1&limit=`: the notes, links and images of the learning
/// points of all paths (`tasks.learn_notes`, capability `learn_notes`); the engine searches.
pub(super) async fn learn_notes(
    State(st): State<Arc<Shared>>,
    RawQuery(query): RawQuery,
) -> Response {
    read(
        &st,
        Calls::LearnNotes,
        learn_notes_request(query.as_deref()),
    )
    .await
}

/// `GET /api/tasks/learn_evidence?competence=&area=&path=&include_done=1`: the evidence of all learning paths
/// (`tasks.learn_evidence`, capability `learn_evidence`).
pub(super) async fn learn_evidence(
    State(st): State<Arc<Shared>>,
    RawQuery(query): RawQuery,
) -> Response {
    read(
        &st,
        Calls::LearnEvidence,
        learn_evidence_request(query.as_deref()),
    )
    .await
}

/// `GET /api/tasks/learn_history?since=&until=&step=&area=&path=`: the series of the learning figures over a window
/// (`tasks.learn_history`, capability `learn_history`); for a phone over the released areas, cut.
pub(super) async fn learn_history(
    State(st): State<Arc<Shared>>,
    caller: Option<axum::Extension<Caller>>,
    RawQuery(query): RawQuery,
) -> Response {
    read_for(
        &st,
        caller.as_deref(),
        Calls::LearnHistory,
        learn_history_request(query.as_deref()),
        Narrow::Areas,
        device_cut::learn_history,
    )
    .await
}

/// `GET /api/tasks/competences?area=`: the fields of knowledge with their stages and the scale (`tasks.competences`,
/// capability `competences`).
pub(super) async fn competences(
    State(st): State<Arc<Shared>>,
    RawQuery(query): RawQuery,
) -> Response {
    read(
        &st,
        Calls::Competences,
        competences_request(query.as_deref()),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_query_of_learn_next_becomes_the_engine_s_question_or_is_refused() {
        assert_eq!(learn_next_request(None), Ok(json!({})));
        assert_eq!(
            learn_next_request(Some("area=learning&machine=wsl&n=5&path=learning/lua")),
            Ok(json!({ "area": "learning", "machine": "wsl", "n": 5, "paths": ["learning/lua"] }))
        );
        assert_eq!(
            learn_next_request(Some("machine=mac")),
            Err("machine is private, workstation or wsl")
        );
        assert_eq!(learn_next_request(Some("n=0")), Err("n is 1 to 20"));
        assert_eq!(learn_next_request(Some("n=21")), Err("n is 1 to 20"));
        assert_eq!(
            learn_next_request(Some("area=..")),
            Err("area is not a name")
        );
        assert_eq!(
            learn_next_request(Some("path=lua")),
            Err("path must be <area>/<slug>")
        );
        assert!(learn_next_request(Some("id=a/b")).is_err());
    }

    #[test]
    fn the_search_text_of_learn_notes_is_unescaped_and_bounded() {
        assert_eq!(learn_notes_request(None), Ok(json!({})));
        assert_eq!(
            learn_notes_request(Some(
                "q=Shell%20%C3%BCben&kind=link&include_done=1&limit=50"
            )),
            Ok(json!({ "query": "Shell üben", "kind": "link", "include_done": true, "limit": 50 }))
        );
        // Only blanks: no search, every note.
        assert_eq!(learn_notes_request(Some("q=%20%20")), Ok(json!({})));
        // U+FEFF counts as a blank, as in the web variant: no search, and trimmed off a search text.
        assert_eq!(learn_notes_request(Some("q=%EF%BB%BF%20")), Ok(json!({})));
        assert_eq!(
            learn_notes_request(Some("q=%EF%BB%BF%20Shell%20%EF%BB%BF")),
            Ok(json!({ "query": "Shell" }))
        );
        assert_eq!(
            learn_notes_request(Some("q=a&q=b")),
            Err("q is given twice")
        );
        assert_eq!(
            learn_notes_request(Some("q=a%0Ab")),
            Err("q holds a control character")
        );
        assert_eq!(
            learn_notes_request(Some(&format!("q={}", "a".repeat(201)))),
            Err("q is at most 200 bytes")
        );
        assert_eq!(
            learn_notes_request(Some("q=a<b")),
            Err("a query value is not escaped text")
        );
        assert_eq!(
            learn_notes_request(Some("kind=video")),
            Err("kind is note, link or image")
        );
        assert_eq!(
            learn_notes_request(Some("limit=501")),
            Err("limit is 1 to 500")
        );
        assert!(learn_notes_request(Some("query=x")).is_err());
    }

    #[test]
    fn the_query_of_learn_evidence_names_a_competence_by_its_id() {
        assert_eq!(
            learn_evidence_request(Some("competence=ALL/betriebssysteme&include_done=1")),
            Ok(json!({ "competence": "ALL/betriebssysteme", "include_done": true }))
        );
        assert_eq!(
            learn_evidence_request(Some("competence=os")),
            Err("competence must be <area>/<slug>")
        );
        assert_eq!(
            learn_evidence_request(Some("include_done=yes")),
            Err("include_done is 1 or absent")
        );
    }

    #[test]
    fn the_window_of_learn_history_is_days_and_a_step() {
        assert_eq!(
            learn_history_request(Some(
                "since=2026-11-01&until=2026-11-22&step=week&area=learning"
            )),
            Ok(
                json!({ "since": "2026-11-01", "until": "2026-11-22", "step": "week", "area": "learning" })
            )
        );
        assert_eq!(
            learn_history_request(Some("since=2026-1-01")),
            Err("since and until are days, YYYY-MM-DD")
        );
        assert_eq!(
            learn_history_request(Some("until=20261122xx")),
            Err("since and until are days, YYYY-MM-DD")
        );
        assert_eq!(
            learn_history_request(Some("step=year")),
            Err("step is day, week or month")
        );
    }

    #[test]
    fn the_query_of_competences_is_an_area_at_most() {
        assert_eq!(competences_request(None), Ok(json!({})));
        assert_eq!(
            competences_request(Some("area=ALL")),
            Ok(json!({ "area": "ALL" }))
        );
        assert!(competences_request(Some("path=a/b")).is_err());
    }

    #[test]
    fn several_areas_are_names_joined_by_a_slash() {
        let both = json!({ "areas": ["lib.nvim", "ALL"] });
        assert_eq!(
            competences_request(Some("areas=lib.nvim/ALL")),
            Ok(both.clone())
        );
        assert_eq!(
            learn_notes_request(Some("areas=lib.nvim/ALL")),
            Ok(both.clone())
        );
        assert_eq!(
            learn_evidence_request(Some("areas=lib.nvim/ALL")),
            Ok(both.clone())
        );
        assert_eq!(learn_history_request(Some("areas=lib.nvim/ALL")), Ok(both));
        // a part that is no name: an empty one (a slash at the end or two in a row), a dot at the start
        for bad in ["areas=a/", "areas=a//b", "areas=/a", "areas=.git"] {
            assert_eq!(
                competences_request(Some(bad)),
                Err("areas are names joined by /"),
                "{bad}"
            );
        }
        let many = vec!["a"; 33].join("/");
        assert_eq!(
            learn_history_request(Some(&format!("areas={many}"))),
            Err("areas names at most 32 areas")
        );
        // the engine method of paths and learn_next takes no list
        assert!(learn_next_request(Some("areas=a/b")).is_err());
    }
}
