//! What a paired phone is given (appkit `MOB-02`, docs/MOBILE.md "Data classes, fail closed"): the hub cuts, never the
//! phone. A route released for devices answers a device only with the areas of the class `public` or `internal`; an
//! area without a class, or a private one, stays on the PC. The PC (`Caller::Pc`) gets the documents as the engine
//! wrote them.
//!
//! The cut keeps what it names, not what it does not know: a task is copied field by field from a list of fields that
//! carry nothing of another task (no path, no reference, no problem text), and a list of ids keeps only the ids of
//! released areas. A new field of the engine reaches a phone only once it is named here.

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

/// The fields of the head of a document (who wrote it, when, for which state).
const HEAD_FIELDS: &[&str] = &[
    "kind",
    "schema",
    "plugin",
    "engine",
    "generated_at",
    "rev",
    "digest",
];

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
    // The plan and the project of a task are kept when every area they hold is released (see `plans`).
    Some(Value::Object(out))
}

/// The plans (or projects) a phone is given: those whose every area is released (what is made of several areas has the
/// class of the highest of them), with their own fields only.
fn plans(classes: &AreaPolicy, list: &Value, fields: &[&str]) -> Vec<Value> {
    list.as_array()
        .map_or(&[][..], Vec::as_slice)
        .iter()
        .filter(|plan| {
            let areas = plan["areas"].as_array().map_or(&[][..], Vec::as_slice);
            !areas.is_empty()
                && areas
                    .iter()
                    .all(|a| a.as_str().is_some_and(|a| released(classes, a)))
        })
        .map(|plan| Value::Object(copy(plan, fields)))
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
    out.insert(
        "plans".to_owned(),
        Value::Array(plans(classes, &doc["plans"], PLAN_FIELDS)),
    );
    out.insert(
        "projects".to_owned(),
        Value::Array(plans(classes, &doc["projects"], PLAN_FIELDS)),
    );
    out.insert("areas".to_owned(), Value::Array(areas));
    out.insert("unlisted".to_owned(), Value::Array(unlisted));
    out.insert("tasks".to_owned(), Value::Array(tasks));
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
            "rev",
            "digest",
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
            "digest",
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

/// The ids of the plans and projects a phone is given in `snapshot` (every area released).
pub(crate) fn released_plans(classes: &AreaPolicy, snapshot: &Value) -> Vec<String> {
    plans(classes, &snapshot["plans"], &["id"])
        .into_iter()
        .chain(plans(classes, &snapshot["projects"], &["id"]))
        .filter_map(|p| p["id"].as_str().map(str::to_owned))
        .collect()
}

/// The area an operation of `ops` touches: the area of its task, or the area a new task goes to.
pub(crate) fn op_area(op: &Value) -> Option<&str> {
    match op["op"].as_str() {
        Some("new") => op["area"].as_str(),
        _ => op["id"].as_str().and_then(area_of),
    }
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
                { "id": "p-open", "title": "Open plan", "areas": ["open"], "phase_order": [], "valid": true },
                { "id": "p-mixed", "title": "Mixed plan", "areas": ["open", "secret"], "phase_order": [], "valid": true },
            ],
            "projects": [],
            "tasks": [
                { "id": "open/a", "area": "open", "slug": "a", "title": "A", "status": "open",
                  "blocked_by": ["secret/a", "open/b"], "after": [], "refs": ["secret/a"],
                  "file": "E:/vault/open/ROADMAP/tasks/a.md", "problems": [{ "code": "x", "msg": "secret/a" }],
                  "plan": "p-mixed", "tags": [], "category": [] },
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
        assert_eq!(cut["plans"][0]["id"], "p-open");
        assert_eq!(cut["reminders"].as_array().unwrap().len(), 1);
        assert_eq!(cut["kind"], "tasks.snapshot");
        assert_eq!(cut["rev"], "rev:000001");
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
            "freed": ["secret/b", "open/b"], "closes_plan": "p-mixed", "plan": "p-open" });
        let cut = done_preview(&c, &preview, &["p-open".to_owned()]).unwrap();
        assert_eq!(cut["freed"], json!(["open/b"]));
        assert_eq!(cut["plan"], "p-open");
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
}
