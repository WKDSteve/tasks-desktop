//! What a paired phone is given (appkit `MOB-02`, docs/MOBILE.md "Data classes, fail closed"): the hub cuts, never the
//! phone. A route released for devices answers a device only with the areas of the class `public` or `internal`; an
//! area without a class, or a private one, stays on the PC. The PC (`Caller::Pc`) gets the documents as the engine
//! wrote them.
//!
//! The cut keeps what it names, not what it does not know: a task is copied field by field from a list of fields that
//! carry nothing of another task (no path, no reference, no problem text), and a list of ids keeps only the ids of
//! released areas. A new field of the engine reaches a phone only once it is named here.
//!
//! No document tells the state of the whole vault: its `rev` and `digest` move with every change, also in an area the
//! phone may not see. A snapshot gets a `rev` of its own, made over what the phone is given (`device_rev`); the other
//! documents get none.

use serde_json::{Map, Value};

use crate::classes::{AreaPolicy, Shown};

/// Is `area` released for a device?
pub(crate) fn released(classes: &AreaPolicy, area: &str) -> bool {
    matches!(classes.shown(area), Shown::Public | Shown::Internal)
}

/// The area of a task id (`<area>/<slug>`).
fn area_of(id: &str) -> Option<&str> {
    id.split_once('/').map(|(area, _)| area)
}

/// Is `id` a task of a released area?
pub(crate) fn released_id(classes: &AreaPolicy, id: &str) -> bool {
    area_of(id).is_some_and(|area| released(classes, area))
}

/// The fields of a task entry a phone is given; each holds only something of this task.
const TASK_FIELDS: &[&str] = &[
    "id",
    "area",
    "slug",
    "title",
    "status",
    "kind",
    "prio",
    "order",
    "effort",
    "effort_days",
    "value",
    "roi",
    "actor",
    "severity",
    "waits_for",
    "created",
    "updated",
    "remind",
    "due",
    "start",
    "repeat",
    "repeat_from",
    "phase",
    "done_in",
    "tags",
    "category",
    "summary",
    "folder",
    "valid",
    "open_questions",
    "etag",
];

/// The fields of a task entry that name other tasks: only the released ones stay.
const TASK_ID_LISTS: &[&str] = &["blocked_by", "after"];

/// The fields of the head of a document (who wrote it, when). Not its `rev` and `digest`: those are of the whole vault.
const HEAD_FIELDS: &[&str] = &["kind", "schema", "plugin", "engine", "generated_at"];

/// A `rev` for a phone: a hash over what it is given, so it moves only with that (`sha256:` and 32 hex digits).
fn device_rev(doc: &Value) -> String {
    use sha2::{Digest, Sha256};
    let hash = Sha256::digest(doc.to_string().as_bytes());
    let hex: String = hash[..16].iter().map(|b| format!("{b:02x}")).collect();
    format!("sha256:{hex}")
}

fn copy(from: &Value, fields: &[&str]) -> Map<String, Value> {
    let mut out = Map::new();
    for field in fields {
        if let Some(value) = from.get(*field) {
            out.insert((*field).to_owned(), value.clone());
        }
    }
    out
}

fn ids(classes: &AreaPolicy, list: &Value) -> Value {
    Value::Array(
        list.as_array()
            .map_or(&[][..], Vec::as_slice)
            .iter()
            .filter(|id| id.as_str().is_some_and(|id| released_id(classes, id)))
            .cloned()
            .collect(),
    )
}

/// A task entry for a phone, or `None` when its area is not released.
pub(crate) fn task_entry(classes: &AreaPolicy, task: &Value) -> Option<Value> {
    let id = task["id"].as_str()?;
    let area = task["area"].as_str().or_else(|| area_of(id))?;
    if !released(classes, area) || !released_id(classes, id) {
        return None;
    }
    let mut out = copy(task, TASK_FIELDS);
    for field in TASK_ID_LISTS {
        if let Some(list) = task.get(*field) {
            out.insert((*field).to_owned(), ids(classes, list));
        }
    }
    // The plan and the project of a task are not in `TASK_FIELDS`: a task of a released area may belong to a plan of a
    // private one, whose name would tell of it. A phone sees the plans of the snapshot (`plans`), not which task is in
    // which.
    Some(Value::Object(out))
}

/// Is this plan (or project) one a phone may know: its own area (the area of its id, where its file is) and every area
/// it holds released (what is made of several areas has the class of the highest of them).
fn released_plan(classes: &AreaPolicy, plan: &Value) -> bool {
    let areas = plan["areas"].as_array().map_or(&[][..], Vec::as_slice);
    plan["id"]
        .as_str()
        .is_some_and(|id| released_id(classes, id))
        && !areas.is_empty()
        && areas
            .iter()
            .all(|a| a.as_str().is_some_and(|a| released(classes, a)))
}

/// The plans (or projects) a phone is given, with their own fields only. What a plan names outside itself stays only
/// when the phone may know it too: its target (a task) when that task is of a released area, its project when that
/// project is given too (`projects`); otherwise the field is left out.
fn plans(classes: &AreaPolicy, list: &Value, projects: &[String]) -> Vec<Value> {
    list.as_array()
        .map_or(&[][..], Vec::as_slice)
        .iter()
        .filter(|plan| released_plan(classes, plan))
        .map(|plan| {
            let mut out = copy(plan, PLAN_FIELDS);
            if out
                .get("target")
                .is_some_and(|t| !t.as_str().is_some_and(|t| released_id(classes, t)))
            {
                out.remove("target");
            }
            if out
                .get("project")
                .is_some_and(|p| !p.as_str().is_some_and(|p| projects.iter().any(|k| k == p)))
            {
                out.remove("project");
            }
            Value::Object(out)
        })
        .collect()
}

/// The ids of the plans (or projects) of `list` a phone may know.
fn plan_ids(classes: &AreaPolicy, list: &Value) -> Vec<String> {
    list.as_array()
        .map_or(&[][..], Vec::as_slice)
        .iter()
        .filter(|plan| released_plan(classes, plan))
        .filter_map(|plan| plan["id"].as_str().map(str::to_owned))
        .collect()
}

const PLAN_FIELDS: &[&str] = &[
    "id",
    "title",
    "status",
    "areas",
    "target",
    "phase_order",
    "gate",
    "project",
    "phase",
    "etag",
    "valid",
];

/// `tasks.snapshot` for a phone: the tasks, areas, reminders, plans and projects of released areas, and the counts of
/// what is left. The head of the plan (paths, cycles, conflicts, warnings), the estimate and the folders that could not
/// be read stay on the PC.
pub(crate) fn snapshot(classes: &AreaPolicy, doc: &Value) -> Value {
    let mut out = copy(doc, HEAD_FIELDS);
    let tasks: Vec<Value> = doc["tasks"]
        .as_array()
        .map_or(&[][..], Vec::as_slice)
        .iter()
        .filter_map(|t| task_entry(classes, t))
        .collect();
    let areas: Vec<Value> = doc["areas"]
        .as_array()
        .map_or(&[][..], Vec::as_slice)
        .iter()
        .filter(|a| a["name"].as_str().is_some_and(|n| released(classes, n)))
        .cloned()
        .collect();
    let unlisted: Vec<Value> = doc["unlisted"]
        .as_array()
        .map_or(&[][..], Vec::as_slice)
        .iter()
        .filter(|u| u["id"].as_str().is_some_and(|id| released_id(classes, id)))
        .map(|u| Value::Object(copy(u, &["id", "status", "code"])))
        .collect();
    let mut by_status = Map::new();
    for task in &tasks {
        if let Some(status) = task["status"].as_str() {
            let n = by_status.get(status).and_then(Value::as_u64).unwrap_or(0);
            by_status.insert(status.to_owned(), Value::from(n + 1));
        }
    }
    out.insert(
        "counts".to_owned(),
        serde_json::json!({ "listed": tasks.len(), "unlisted": unlisted.len(), "by_status": by_status }),
    );
    if let Some(reminders) = doc["reminders"].as_array() {
        let kept: Vec<Value> = reminders
            .iter()
            .filter(|r| r["id"].as_str().is_some_and(|id| released_id(classes, id)))
            .map(|r| {
                Value::Object(copy(
                    r,
                    &["id", "area", "title", "remind", "etag", "done_in"],
                ))
            })
            .collect();
        out.insert("reminders".to_owned(), Value::Array(kept));
    }
    if let Some(groups) = doc["area_groups"].as_array() {
        let kept: Vec<Value> = groups
            .iter()
            .filter_map(|g| {
                let members = g["members"].as_array()?;
                // A group with a member that is not released would tell its counts of that member: it stays on the PC.
                members
                    .iter()
                    .all(|m| m.as_str().is_some_and(|m| released(classes, m)))
                    .then(|| g.clone())
            })
            .collect();
        out.insert("area_groups".to_owned(), Value::Array(kept));
    }
    let projects = plan_ids(classes, &doc["projects"]);
    out.insert(
        "plans".to_owned(),
        Value::Array(plans(classes, &doc["plans"], &projects)),
    );
    // A project names no project; its `project` field, if any, is dropped as one not given.
    out.insert(
        "projects".to_owned(),
        Value::Array(plans(classes, &doc["projects"], &[])),
    );
    out.insert("areas".to_owned(), Value::Array(areas));
    out.insert("unlisted".to_owned(), Value::Array(unlisted));
    out.insert("tasks".to_owned(), Value::Array(tasks));
    let rev = device_rev(&Value::Object(out.clone()));
    out.insert("rev".to_owned(), Value::from(rev));
    Value::Object(out)
}

/// A brief of a task (`tasks.next`) for a phone, or `None`.
fn brief(classes: &AreaPolicy, task: &Value) -> Option<Value> {
    let id = task["id"].as_str()?;
    released_id(classes, id).then(|| {
        Value::Object(copy(
            task,
            &["id", "title", "status", "prio", "effort", "reason"],
        ))
    })
}

/// `tasks.next` for a phone: the proposals of released areas (the first of them leads); the counts of the vault, which
/// hold every area, stay on the PC.
pub(crate) fn next(classes: &AreaPolicy, doc: &Value) -> Value {
    let mut out = copy(doc, HEAD_FIELDS);
    let mut picks: Vec<Value> = std::iter::once(&doc["task"])
        .chain(
            doc["alternatives"]
                .as_array()
                .map_or(&[][..], Vec::as_slice),
        )
        .filter_map(|t| brief(classes, t))
        .collect();
    let cdx: Vec<Value> = doc["cdx"]
        .as_array()
        .map_or(&[][..], Vec::as_slice)
        .iter()
        .filter_map(|t| brief(classes, t))
        .collect();
    if !picks.is_empty() {
        out.insert("task".to_owned(), picks.remove(0));
    }
    out.insert("alternatives".to_owned(), Value::Array(picks));
    out.insert("cdx".to_owned(), Value::Array(cdx));
    out.insert("freed".to_owned(), ids(classes, &doc["freed"]));
    Value::Object(out)
}

/// The proposals of a cut `tasks.next`, in order: its pick, then its alternatives.
pub(crate) fn next_picks(cut: &Value) -> Vec<Value> {
    std::iter::once(&cut["task"])
        .filter(|t| t.is_object())
        .chain(
            cut["alternatives"]
                .as_array()
                .map_or(&[][..], Vec::as_slice),
        )
        .cloned()
        .collect()
}

/// Put `picks` into a cut `tasks.next`: the first leads, the rest are the alternatives.
pub(crate) fn set_picks(cut: &mut Value, mut picks: Vec<Value>) {
    let Some(map) = cut.as_object_mut() else {
        return;
    };
    map.remove("task");
    if !picks.is_empty() {
        map.insert("task".to_owned(), picks.remove(0));
    }
    map.insert("alternatives".to_owned(), Value::Array(picks));
}

/// `tasks.task` for a phone, or `None` (the hub answers `not_found`) when the task is not of a released area.
pub(crate) fn task(classes: &AreaPolicy, doc: &Value) -> Option<Value> {
    let entry = task_entry(classes, &doc["task"])?;
    let mut out = copy(
        doc,
        &[
            "kind",
            "schema",
            "plugin",
            "engine",
            "generated_at",
            "body",
            "body_truncated",
            "steps",
            "questions",
        ],
    );
    out.insert("task".to_owned(), entry);
    Some(Value::Object(out))
}

/// `tasks.donepreview` for a phone, or `None` when the task is not of a released area. What finishing it frees is told
/// only for released areas; a plan or project it closes only when every area of it is released (the snapshot of the
/// phone names those).
pub(crate) fn done_preview(
    classes: &AreaPolicy,
    doc: &Value,
    released_plans: &[String],
) -> Option<Value> {
    let id = doc["id"].as_str()?;
    if !released_id(classes, id) {
        return None;
    }
    let mut out = copy(
        doc,
        &[
            "kind",
            "schema",
            "plugin",
            "engine",
            "generated_at",
            "id",
            "already",
            "area",
            "bucket",
            "to",
            "resumed",
            "steps_ticked",
            "next_round",
            "etag",
            "confirm",
        ],
    );
    for field in ["plan", "closes_plan", "closes_project"] {
        if let Some(name) = doc[field]
            .as_str()
            .filter(|n| released_plans.iter().any(|p| p == n))
        {
            out.insert(field.to_owned(), Value::from(name));
        }
    }
    if doc.get("freed").is_some() {
        out.insert("freed".to_owned(), ids(classes, &doc["freed"]));
    }
    Some(Value::Object(out))
}

/// The ids of the plans and projects a phone is given in `snapshot`.
pub(crate) fn released_plans(classes: &AreaPolicy, snapshot: &Value) -> Vec<String> {
    plan_ids(classes, &snapshot["plans"])
        .into_iter()
        .chain(plan_ids(classes, &snapshot["projects"]))
        .collect()
}

/// The fields of one entry of `tasks.result` a phone is given: what became of its operation. Not the files, the notes
/// (paths of documents), the index, the text of an error (it may name what the phone may not know).
const RESULT_FIELDS: &[&str] = &[
    "n",
    "op",
    "ok",
    "outcome",
    "etag_before",
    "etag_after",
    "to",
    "steps_ticked",
];

/// `tasks.result` (of `ops`, of an upload) for a phone: each entry with its own fields, the ids it names only of
/// released areas, the plans and projects it closed only when the phone may know them (`released_plans`), an error as
/// its code alone.
pub(crate) fn result(classes: &AreaPolicy, doc: &Value, released_plans: &[String]) -> Value {
    let mut out = copy(doc, HEAD_FIELDS);
    for field in ["client_op_id", "dry_run", "ok"] {
        if let Some(value) = doc.get(field) {
            out.insert(field.to_owned(), value.clone());
        }
    }
    let entries: Vec<Value> = doc["results"]
        .as_array()
        .map_or(&[][..], Vec::as_slice)
        .iter()
        .map(|entry| {
            let mut e = copy(entry, RESULT_FIELDS);
            if let Some(id) = entry["id"].as_str().filter(|id| released_id(classes, id)) {
                e.insert("id".to_owned(), Value::from(id));
            }
            e.insert(
                "changed_ids".to_owned(),
                ids(classes, &entry["changed_ids"]),
            );
            for field in ["plans_closed", "projects_closed"] {
                if let Some(list) = entry[field].as_array() {
                    let kept: Vec<Value> = list
                        .iter()
                        .filter(|p| {
                            p.as_str()
                                .is_some_and(|p| released_plans.iter().any(|k| k == p))
                        })
                        .cloned()
                        .collect();
                    e.insert(field.to_owned(), Value::Array(kept));
                }
            }
            // Undoing a change of the phone's own task: the operation as the engine gives it, for a released task.
            if entry["inverse"]["id"]
                .as_str()
                .is_some_and(|id| released_id(classes, id))
            {
                e.insert("inverse".to_owned(), entry["inverse"].clone());
            }
            if let Some(error) = entry["error"].as_object() {
                let mut kept = copy(&Value::Object(error.clone()), &["code", "retryable"]);
                kept.insert("message".to_owned(), Value::from(""));
                e.insert("error".to_owned(), Value::Object(kept));
            }
            Value::Object(e)
        })
        .collect();
    out.insert("results".to_owned(), Value::Array(entries));
    Value::Object(out)
}

/// The area an operation of `ops` touches: the area of its task, or the area a new task goes to.
pub(crate) fn op_area(op: &Value) -> Option<&str> {
    match op["op"].as_str() {
        Some("new") => op["area"].as_str(),
        _ => op["id"].as_str().and_then(area_of),
    }
}

/// The kind of the file `tasks-hub phone export` writes (the third way to a phone: a file it opens, read only).
pub(crate) const PHONE_EXPORT_KIND: &str = "tasks.phone_export";

/// The most proposals of `tasks.next` an export holds: the pick and two alternatives, as a phone asks by default.
const EXPORT_PICKS: usize = 3;

/// `tasks.phone_export`: what a paired phone would be given (`snapshot` and `next`, cut as for a device, MOB-02), as one
/// document for a file. `classes_asked: true` says the hub cut it by the data classes; `areas` names each area it holds
/// with its class as `data_class`, as `/api/tasks/areas` does (only `public` and `internal`), so the phone can refuse a
/// file that holds anything else (fail closed). `exported_at` is when it was written (UTC, `YYYY-MM-DDTHH:MM:SSZ`); the documents keep the time the engine wrote them.
pub(crate) fn phone_export(
    classes: &AreaPolicy,
    snapshot_doc: &Value,
    next_doc: &Value,
    exported_at: &str,
) -> Value {
    let snap = snapshot(classes, snapshot_doc);
    let mut next_cut = next(classes, next_doc);
    let mut picks = next_picks(&next_cut);
    picks.truncate(EXPORT_PICKS);
    set_picks(&mut next_cut, picks);
    let areas: Vec<Value> = snap["areas"]
        .as_array()
        .map_or(&[][..], Vec::as_slice)
        .iter()
        .filter_map(|a| a["name"].as_str())
        .filter_map(|name| {
            let class = match classes.shown(name) {
                Shown::Public => "public",
                Shown::Internal => "internal",
                Shown::Private | Shown::Unclassified => return None,
            };
            Some(serde_json::json!({ "name": name, "data_class": class }))
        })
        .collect();
    serde_json::json!({
        "kind": PHONE_EXPORT_KIND,
        "schema": 1,
        "classes_asked": true,
        "exported_at": exported_at,
        "areas": areas,
        "snapshot": snap,
        "next": next_cut,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::classes::{Class, Entry};
    use serde_json::json;
    use std::collections::BTreeMap;

    fn classes() -> AreaPolicy {
        AreaPolicy::new(BTreeMap::from([
            (
                "open".to_owned(),
                Entry {
                    class: Class::Internal,
                    repo: None,
                },
            ),
            (
                "pub".to_owned(),
                Entry {
                    class: Class::Public,
                    repo: None,
                },
            ),
            (
                "secret".to_owned(),
                Entry {
                    class: Class::Private,
                    repo: None,
                },
            ),
        ]))
        .unwrap()
    }

    #[test]
    fn a_snapshot_keeps_only_released_areas_and_no_word_of_the_others() {
        let doc = json!({
            "kind": "tasks.snapshot", "schema": 1, "rev": "rev:000001", "digest": "sha256:1",
            "counts": { "listed": 3, "unlisted": 1, "by_status": { "open": 2, "doing": 1 } },
            "areas": [
                { "name": "open", "open": 1, "by_status": { "open": 1 } },
                { "name": "secret", "open": 1, "by_status": { "open": 1 } },
                { "name": "nameless", "open": 1, "by_status": { "doing": 1 } },
            ],
            "area_groups": [{ "name": "g", "members": ["open", "secret"], "open": 2, "by_status": {} }],
            "reminders": [
                { "id": "open/r", "area": "open", "title": "R", "remind": "2026-11-12" },
                { "id": "secret/r", "area": "secret", "title": "Hidden reminder", "remind": "2026-11-12" },
            ],
            "unlisted": [{ "id": "secret/u", "status": "done", "code": "done-in-roadmap" }],
            "plan": { "critical_path": { "path": ["secret/a"] }, "warnings": [{ "code": "x", "msg": "secret/a" }] },
            "plans": [
                { "id": "open/p-open", "title": "Open plan", "areas": ["open"], "phase_order": [], "valid": true },
                { "id": "open/p-mixed", "title": "Mixed plan", "areas": ["open", "secret"], "phase_order": [], "valid": true },
            ],
            "projects": [],
            "tasks": [
                { "id": "open/a", "area": "open", "slug": "a", "title": "A", "status": "open",
                  "blocked_by": ["secret/a", "open/b"], "after": [], "refs": ["secret/a"],
                  "file": "E:/vault/open/ROADMAP/tasks/a.md", "problems": [{ "code": "x", "msg": "secret/a" }],
                  "plan": "open/p-mixed", "tags": [], "category": [] },
                { "id": "secret/a", "area": "secret", "slug": "a", "title": "Hidden title", "status": "doing" },
                { "id": "nameless/a", "area": "nameless", "slug": "a", "title": "Unclassified title", "status": "open" },
            ],
            "incomplete": ["E:/vault/secret"],
            "estimate": { "quick_wins": ["secret/a"] },
        });
        let cut = snapshot(&classes(), &doc);
        let text = cut.to_string();
        for word in [
            "secret",
            "Hidden",
            "nameless",
            "Unclassified",
            "Mixed",
            "E:/vault",
        ] {
            assert!(!text.contains(word), "{word} in {text}");
        }
        assert_eq!(cut["tasks"][0]["id"], "open/a");
        assert_eq!(cut["tasks"][0]["blocked_by"], json!(["open/b"]));
        assert_eq!(cut["tasks"].as_array().unwrap().len(), 1);
        assert_eq!(
            cut["areas"],
            json!([{ "name": "open", "open": 1, "by_status": { "open": 1 } }])
        );
        assert_eq!(
            cut["counts"],
            json!({ "listed": 1, "unlisted": 0, "by_status": { "open": 1 } })
        );
        assert_eq!(cut["plans"][0]["id"], "open/p-open");
        assert_eq!(cut["reminders"].as_array().unwrap().len(), 1);
        assert_eq!(cut["kind"], "tasks.snapshot");
        // Not the vault's `rev`: one of its own, over what the phone is given; no `digest`.
        let rev = cut["rev"].as_str().unwrap();
        assert!(rev.starts_with("sha256:") && rev.len() == 39, "{rev}");
        assert!(cut.get("digest").is_none());
    }

    #[test]
    fn next_task_and_done_preview_tell_nothing_of_an_area_that_is_not_released() {
        let c = classes();
        let doc = json!({
            "kind": "tasks.next", "task": { "id": "secret/a", "title": "Hidden" },
            "alternatives": [{ "id": "open/a", "title": "A" }, { "id": "pub/b", "title": "B" }],
            "cdx": [{ "id": "secret/c", "title": "Hidden" }], "freed": ["secret/a", "open/a"],
            "ready": { "area": 1, "vault": 9 }, "incomplete": ["secret"],
        });
        let cut = next(&c, &doc);
        assert_eq!(cut["task"]["id"], "open/a");
        assert_eq!(
            cut["alternatives"],
            json!([{ "id": "pub/b", "title": "B" }])
        );
        assert!(
            !cut.to_string().contains("secret") && !cut.to_string().contains("Hidden"),
            "{cut}"
        );

        let task_doc = json!({ "kind": "tasks.task", "task": { "id": "secret/a", "area": "secret" }, "body": "x" });
        assert!(task(&c, &task_doc).is_none());
        let task_doc = json!({ "kind": "tasks.task", "task": { "id": "open/a", "area": "open",
            "blocked_by": ["secret/z"], "file": "E:/x" }, "body": "text", "steps": [] });
        let cut = task(&c, &task_doc).unwrap();
        assert_eq!(cut["body"], "text");
        assert_eq!(cut["task"]["blocked_by"], json!([]));
        assert!(cut["task"].get("file").is_none());

        let preview =
            json!({ "kind": "tasks.donepreview", "id": "secret/a", "to": "x", "confirm": "c" });
        assert!(done_preview(&c, &preview, &[]).is_none());
        let preview = json!({ "kind": "tasks.donepreview", "id": "open/a", "to": "x", "confirm": "c",
            "freed": ["secret/b", "open/b"], "closes_plan": "open/p-mixed", "plan": "open/p-open" });
        let cut = done_preview(&c, &preview, &["open/p-open".to_owned()]).unwrap();
        assert_eq!(cut["freed"], json!(["open/b"]));
        assert_eq!(cut["plan"], "open/p-open");
        assert!(cut.get("closes_plan").is_none());
        assert_eq!(cut["confirm"], "c");
    }

    #[test]
    fn the_area_of_an_operation() {
        assert_eq!(
            op_area(&json!({ "op": "new", "area": "secret", "title": "t" })),
            Some("secret")
        );
        assert_eq!(
            op_area(&json!({ "op": "set", "id": "secret/a" })),
            Some("secret")
        );
        assert_eq!(op_area(&json!({ "op": "set" })), None);
    }

    #[test]
    fn the_rev_of_a_phone_moves_only_with_what_it_is_given() {
        let c = classes();
        let doc = |hidden: &str, shown: &str| {
            json!({ "kind": "tasks.snapshot", "rev": format!("rev:{hidden}{shown}"), "tasks": [
                { "id": "secret/a", "area": "secret", "title": hidden, "status": "open" },
                { "id": "open/a", "area": "open", "title": shown, "status": "open" },
            ]})
        };
        let rev = |d: &Value| snapshot(&c, d)["rev"].as_str().unwrap().to_owned();
        assert_eq!(rev(&doc("one", "x")), rev(&doc("two", "x")));
        assert_ne!(rev(&doc("one", "x")), rev(&doc("one", "y")));
    }

    #[test]
    fn a_result_keeps_its_own_fields_and_ids_of_released_areas() {
        let c = classes();
        let doc = json!({ "kind": "tasks.result", "rev": "r", "digest": "d", "ok": true, "dry_run": false,
            "client_op_id": "c", "results": [{ "n": 1, "op": "done", "id": "open/a", "ok": true, "outcome": "done",
            "changed_ids": ["open/a", "secret/b"], "plans_closed": ["open/p", "secret/q"], "notes": ["x"],
            "file": "open/a.md", "error": { "code": "conflict", "message": "secret/b", "retryable": false } }] });
        let cut = result(&c, &doc, &["open/p".to_owned()]);
        assert!(!cut.to_string().contains("secret"), "{cut}");
        assert_eq!(cut["results"][0]["plans_closed"], json!(["open/p"]));
        assert!(cut.get("rev").is_none() && cut["results"][0].get("file").is_none());
        assert_eq!(cut["client_op_id"], "c");
    }

    #[test]
    fn a_phone_export_holds_no_private_or_unclassified_area() {
        let c = classes();
        let snap = json!({ "kind": "tasks.snapshot", "schema": 1, "rev": "rev:1",
            "areas": [{ "name": "open", "open": 1 }, { "name": "pub", "open": 1 },
                      { "name": "secret", "open": 1 }, { "name": "nameless", "open": 1 }],
            "tasks": [
                { "id": "open/a", "area": "open", "title": "A", "status": "open" },
                { "id": "pub/b", "area": "pub", "title": "B", "status": "open" },
                { "id": "secret/a", "area": "secret", "title": "Hidden", "status": "open" },
                { "id": "nameless/a", "area": "nameless", "title": "Unclassified", "status": "open" },
            ] });
        let next_doc = json!({ "kind": "tasks.next", "task": { "id": "secret/a", "title": "Hidden" },
            "alternatives": [{ "id": "open/a" }, { "id": "pub/b" }, { "id": "open/c" }, { "id": "open/d" }],
            "cdx": [] });
        let doc = phone_export(&c, &snap, &next_doc, "2026-11-13T10:00:00Z");
        let text = doc.to_string();
        for word in ["secret", "Hidden", "nameless", "Unclassified", "private"] {
            assert!(!text.contains(word), "{word} in {text}");
        }
        assert_eq!(doc["kind"], PHONE_EXPORT_KIND);
        assert_eq!(doc["classes_asked"], true);
        assert_eq!(doc["exported_at"], "2026-11-13T10:00:00Z");
        assert_eq!(
            doc["areas"],
            json!([{ "name": "open", "data_class": "internal" }, { "name": "pub", "data_class": "public" }])
        );
        assert_eq!(doc["snapshot"]["tasks"].as_array().unwrap().len(), 2);
        assert_eq!(doc["next"]["task"]["id"], "open/a");
        assert_eq!(doc["next"]["alternatives"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn a_request_without_a_caller_is_taken_as_a_device() {
        use super::super::Caller;
        assert!(super::super::routes::is_device(None));
        assert!(super::super::routes::is_device(Some(&Caller::Device(
            "d".into()
        ))));
        assert!(!super::super::routes::is_device(Some(&Caller::Pc)));
    }
}
