//! The routes of the contacts (Office concept, wave 3): the contacts of the vault by name, and one contact with its
//! notes. Each is under `/api/`, so the guard asked for a session before a handler runs.
//!
//! A contact is a person of a third party: a mail address and a phone number are theirs. The documents of the engine
//! are passed on as it wrote them (it names no address and no number in any message), the page draws them and computes
//! nothing (WEB-13). A paired phone gets none of it: the routes are no device routes (fail closed, MOB-02), and the
//! operations `contact_new`, `contact_set` and `contact_delete` have no level for a device (`device_op_level`). The
//! writes go through `ops`.

use super::*;

/// The query of `contacts`: an area and a page; the tag and the organisation are filtered by the page.
const CONTACTS_QUERY: [&str; 3] = ["area", "limit", "offset"];
/// The largest offset of a page (the engine's lists are far shorter).
const MAX_OFFSET: u32 = 100_000;

fn bad_query(why: &str) -> Response {
    error_body(StatusCode::BAD_REQUEST, "bad_query", why)
}

/// The question of `contacts` to the engine from the query of the route; `Err`: why it is refused.
pub(super) fn contacts_request(query: Option<&str>) -> Result<serde_json::Value, &'static str> {
    let params = parse_query(query, &CONTACTS_QUERY)?;
    let mut request = serde_json::Map::new();
    if let Some(area) = params.get("area") {
        if crate::config::valid_area_name(area).is_err() {
            return Err("area is not a name");
        }
        request.insert("area".to_owned(), json!(area));
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

/// `GET /api/tasks/contacts?area=&limit=&offset=`: the contacts by name, one page (`tasks.contacts`). Asked each time:
/// the state of the vault (the `rev` of the snapshot) is over the tasks, a contact written would come back as it was.
pub(super) async fn contacts(State(st): State<Arc<Shared>>, RawQuery(query): RawQuery) -> Response {
    let request = match contacts_request(query.as_deref()) {
        Ok(r) => r,
        Err(why) => return bad_query(why),
    };
    match ask(&st, Calls::Contacts, Some(&request)).await {
        Ok(reply) => json_response(StatusCode::OK, reply.text, None),
        Err(response) => response,
    }
}

/// The id of a contact from the query (`id=<area>/<slug>`, the namespace of the tasks); `Err`: why it is refused.
pub(super) fn contact_id(query: Option<&str>) -> Result<String, &'static str> {
    let params = parse_query(query, &["id"])?;
    params
        .get("id")
        .filter(|id| valid_task_id(id))
        .cloned()
        .ok_or("id must be <area>/<slug>")
}

/// `GET /api/tasks/contact?id=<area>/<slug>`: one contact with its text and its notes (`tasks.contact`).
pub(super) async fn contact(State(st): State<Arc<Shared>>, RawQuery(query): RawQuery) -> Response {
    let id = match contact_id(query.as_deref()) {
        Ok(id) => id,
        Err(why) => return error_body(StatusCode::BAD_REQUEST, "bad_id", why),
    };
    match ask(&st, Calls::Contact, Some(&json!({ "id": id }))).await {
        Ok(reply) => json_response(StatusCode::OK, reply.text, None),
        Err(response) => response,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_query_of_contacts_becomes_the_engine_s_question_or_is_refused() {
        assert_eq!(contacts_request(None), Ok(json!({})));
        assert_eq!(
            contacts_request(Some("area=work&limit=50&offset=100")),
            Ok(json!({ "area": "work", "limit": 50, "offset": 100 }))
        );
        assert_eq!(contacts_request(Some("area=..")), Err("area is not a name"));
        assert_eq!(contacts_request(Some("limit=0")), Err("limit is 1 to 100"));
        assert_eq!(
            contacts_request(Some("offset=-1")),
            Err("offset is a number from 0")
        );
        assert!(contacts_request(Some("org=x")).is_err());
    }

    #[test]
    fn a_contact_is_named_by_an_id_of_the_tasks() {
        assert_eq!(contact_id(Some("id=work/rick")), Ok("work/rick".to_owned()));
        assert_eq!(contact_id(Some("id=rick")), Err("id must be <area>/<slug>"));
        assert!(contact_id(Some("area=work")).is_err());
    }
}
