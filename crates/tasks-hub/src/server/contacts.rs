//! The routes of the contacts (Office concept, wave 3): the contacts of the vault by name, and one contact with its
//! notes. Each is under `/api/`, so the guard asked for a session before a handler runs.
//!
//! A contact is a person of a third party: a mail address and a phone number are theirs. The documents of the engine
//! are passed on as it wrote them (it names no address and no number in any message), the page draws them and computes
//! nothing (WEB-13). A paired phone gets them cut (`device_cut::contacts`, `device_cut::contact`, MOB-02): only
//! contacts of released areas, their mail addresses, numbers and text only where the data is released (a `public` area,
//! an `internal` one with the settings' `meetings.internal_people`). The operations `contact_new`, `contact_set` and
//! `contact_delete` are done by a phone only there, at `create` or `change` (`device_op_level`, `device_refusal`). The
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
pub(super) async fn contacts(
    State(st): State<Arc<Shared>>,
    caller: Option<axum::Extension<Caller>>,
    RawQuery(query): RawQuery,
) -> Response {
    let request = match contacts_request(query.as_deref()) {
        Ok(r) => r,
        Err(why) => return bad_query(why),
    };
    let device = is_device(caller.as_deref());
    match ask_as(&st, device, Calls::Contacts, Some(&request)).await {
        // A phone gets the contacts of the released areas, cut (`device_cut::contacts`, MOB-02).
        Ok(reply) if device => {
            let doc = serde_json::from_str::<serde_json::Value>(&reply.text).unwrap_or_default();
            let cut =
                device_cut::contacts(&st.rt().classes, &doc, super::meetings::release_of(&st));
            json_response(StatusCode::OK, cut.to_string(), None)
        }
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
pub(super) async fn contact(
    State(st): State<Arc<Shared>>,
    caller: Option<axum::Extension<Caller>>,
    RawQuery(query): RawQuery,
) -> Response {
    let id = match contact_id(query.as_deref()) {
        Ok(id) => id,
        Err(why) => return error_body(StatusCode::BAD_REQUEST, "bad_id", why),
    };
    let device = is_device(caller.as_deref());
    // Not even asked for a contact a phone may not see: the engine's answer would tell whether it is there.
    if device && !device_cut::released_id(&st.rt().classes, &id) {
        return not_found();
    }
    match ask_as(&st, device, Calls::Contact, Some(&json!({ "id": id }))).await {
        Ok(reply) if device => {
            let cut = serde_json::from_str::<serde_json::Value>(&reply.text)
                .ok()
                .and_then(|doc| {
                    device_cut::contact(&st.rt().classes, &doc, super::meetings::release_of(&st))
                });
            match cut {
                Some(doc) => json_response(StatusCode::OK, doc.to_string(), None),
                None => not_found(),
            }
        }
        Ok(reply) => json_response(StatusCode::OK, reply.text, None),
        Err(response) => response,
    }
}

/// The plain words of the query of `contacts_export`; `tag` and `org` are percent-decoded (`decoded_text`).
const EXPORT_QUERY: [&str; 6] = ["format", "area", "version", "delimiter", "bom", "raw"];
/// The longest tag or organisation of the filter of `contacts_export` (the engine's longest list entry).
const MAX_FILTER: usize = 300;

/// The question of `contacts_export` to the engine from the query of the route; `Err`: why it is refused. `delimiter`
/// is a word (`comma`, `semicolon`, `tab`), `bom` and `raw` are `1` or absent.
pub(super) fn contacts_export_request(
    query: Option<&str>,
) -> Result<serde_json::Value, &'static str> {
    let mut texts: Vec<(&str, &str)> = Vec::new();
    let mut rest = Vec::new();
    for pair in query.unwrap_or("").split('&').filter(|p| !p.is_empty()) {
        match pair.split_once('=') {
            Some((key @ ("tag" | "org"), value)) => {
                if texts.iter().any(|(k, _)| *k == key) {
                    return Err("a query parameter is given twice");
                }
                texts.push((key, value));
            }
            _ => rest.push(pair),
        }
    }
    let rest = rest.join("&");
    let params = parse_query(Some(&rest), &EXPORT_QUERY)?;
    let mut request = serde_json::Map::new();
    let format = params
        .get("format")
        .filter(|f| matches!(f.as_str(), "vcf" | "csv"))
        .ok_or("format is vcf or csv")?;
    request.insert("format".to_owned(), json!(format));
    if let Some(area) = params.get("area") {
        if crate::config::valid_area_name(area).is_err() {
            return Err("area is not a name");
        }
        request.insert("area".to_owned(), json!(area));
    }
    if let Some(version) = params.get("version") {
        if format != "vcf" || !matches!(version.as_str(), "3" | "4") {
            return Err("version is 3 or 4, for vcf");
        }
        request.insert("version".to_owned(), json!(version));
    }
    if let Some(delimiter) = params.get("delimiter") {
        let d = match delimiter.as_str() {
            "comma" => ",",
            "semicolon" => ";",
            "tab" => "tab",
            _ => return Err("delimiter is comma, semicolon or tab"),
        };
        if format != "csv" {
            return Err("delimiter is for csv");
        }
        request.insert("delimiter".to_owned(), json!(d));
    }
    for key in ["bom", "raw"] {
        match params.get(key).map(String::as_str) {
            None => {}
            Some("1") if format == "csv" => {
                request.insert(key.to_owned(), json!(true));
            }
            Some(_) => return Err("bom and raw are 1 or absent, for csv"),
        }
    }
    for (key, raw) in texts {
        let text = super::checklists::decoded_text(raw, MAX_FILTER)
            .ok_or("tag and org are texts of at most 300 bytes")?;
        request.insert(key.to_owned(), json!(text));
    }
    Ok(serde_json::Value::Object(request))
}

/// `GET /api/tasks/contacts_export?format=vcf|csv&area=&tag=&org=&version=&delimiter=&bom=1&raw=1`: the contacts as
/// one file text (`tasks.contacts_export`) for the page to hand to the person as a download. The text holds mail
/// addresses and numbers: it is passed on and never logged. Not for a phone (no device route).
pub(super) async fn contacts_export(
    State(st): State<Arc<Shared>>,
    RawQuery(query): RawQuery,
) -> Response {
    let request = match contacts_export_request(query.as_deref()) {
        Ok(r) => r,
        Err(why) => return bad_query(why),
    };
    match ask(&st, Calls::ContactsExport, Some(&request)).await {
        Ok(reply) => json_response(StatusCode::OK, reply.text, None),
        Err(response) => response,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_query_of_contacts_export_becomes_the_engine_s_question_or_is_refused() {
        assert_eq!(
            contacts_export_request(Some(
                "format=csv&area=work&delimiter=semicolon&bom=1&raw=1&tag=a%20b&org=X%26Y"
            )),
            Ok(json!({
                "format": "csv", "area": "work", "delimiter": ";", "bom": true, "raw": true,
                "tag": "a b", "org": "X&Y"
            }))
        );
        assert_eq!(
            contacts_export_request(Some("format=vcf&version=3")),
            Ok(json!({ "format": "vcf", "version": "3" }))
        );
        assert_eq!(contacts_export_request(None), Err("format is vcf or csv"));
        assert_eq!(
            contacts_export_request(Some("format=pdf")),
            Err("format is vcf or csv")
        );
        assert_eq!(
            contacts_export_request(Some("format=csv&version=4")),
            Err("version is 3 or 4, for vcf")
        );
        assert_eq!(
            contacts_export_request(Some("format=vcf&delimiter=comma")),
            Err("delimiter is for csv")
        );
        assert_eq!(
            contacts_export_request(Some("format=csv&delimiter=pipe")),
            Err("delimiter is comma, semicolon or tab")
        );
        assert_eq!(
            contacts_export_request(Some("format=vcf&raw=1")),
            Err("bom and raw are 1 or absent, for csv")
        );
        assert_eq!(
            contacts_export_request(Some("format=csv&area=..")),
            Err("area is not a name")
        );
        assert!(contacts_export_request(Some("format=csv&tag=a&tag=b")).is_err());
        assert!(
            contacts_export_request(Some("format=csv&tag=%01")).is_err(),
            "a control character"
        );
        assert!(
            contacts_export_request(Some("format=csv&out=x")).is_err(),
            "no path of the hub"
        );
    }

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
