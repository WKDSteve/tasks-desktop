//! The reads of the tab "Lernpläne" over all learning paths (concept "Reiter Lernpläne" 3-11): what to learn next, the
//! notes and sources, the evidence, the series of the learning figures and the competences. Each is under `/api/`, so
//! the guard asked for a session before a handler runs; none is a route of a paired phone (`with_device_route` names
//! none of them), the phone page has no such view yet.
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
        &["kind", "area", "path", "include_done", "limit"],
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
            let decoded = decoded.trim();
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
    take_path(&params, &mut request)?;
    take_done(&params, &mut request)?;
    take_number(&params, "limit", 1..=500, "limit is 1 to 500", &mut request)?;
    Ok(serde_json::Value::Object(request))
}

/// The question of `learn_evidence` from the query (`competence`, `area`, `path`, `include_done`).
pub(super) fn learn_evidence_request(
    query: Option<&str>,
) -> Result<serde_json::Value, &'static str> {
    let params = parse_query(query, &["competence", "area", "path", "include_done"])?;
    let mut request = serde_json::Map::new();
    if let Some(id) = params.get("competence") {
        if !valid_task_id(id) {
            return Err("competence must be <area>/<slug>");
        }
        request.insert("competence".to_owned(), json!(id));
    }
    take_area(&params, &mut request)?;
    take_path(&params, &mut request)?;
    take_done(&params, &mut request)?;
    Ok(serde_json::Value::Object(request))
}

/// The question of `learn_history` from the query (`since`, `until`, `step`, `area`, `path`).
pub(super) fn learn_history_request(
    query: Option<&str>,
) -> Result<serde_json::Value, &'static str> {
    let params = parse_query(query, &["since", "until", "step", "area", "path"])?;
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
    take_path(&params, &mut request)?;
    Ok(serde_json::Value::Object(request))
}

/// The question of `competences` from the query (`area`).
pub(super) fn competences_request(query: Option<&str>) -> Result<serde_json::Value, &'static str> {
    let params = parse_query(query, &["area"])?;
    let mut request = serde_json::Map::new();
    take_area(&params, &mut request)?;
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

/// `GET /api/tasks/learn_next?area=&path=&machine=&n=`: for every running learning path the next points to learn
/// (`tasks.learn_next`, capability `learn_next`).
pub(super) async fn learn_next(
    State(st): State<Arc<Shared>>,
    RawQuery(query): RawQuery,
) -> Response {
    read(&st, Calls::LearnNext, learn_next_request(query.as_deref())).await
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
/// (`tasks.learn_history`, capability `learn_history`).
pub(super) async fn learn_history(
    State(st): State<Arc<Shared>>,
    RawQuery(query): RawQuery,
) -> Response {
    read(
        &st,
        Calls::LearnHistory,
        learn_history_request(query.as_deref()),
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
}
