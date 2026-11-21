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

/// The fields of a path entry a phone is given: what is of this path alone. Left out: the other areas it names
/// (`areas`), the plan or task it serves (`target`, `project`), its file and its folder (`file`, `folder`, `assets`,
/// `cover`), and the faults of its file as text (`problems`).
const PATH_FIELDS: &[&str] = &[
    "id", "area", "slug", "title", "status", "summary", "has_tree", "points", "progress", "links",
    "created", "updated", "etag", "valid", "xp",
];

/// The fields of a learning point a phone is given. Left out: the line of the file and an image of the folder (the
/// files of a path are not released for devices); `link` only as a web address, `promoted` only as a task of a released
/// area.
const NODE_FIELDS: &[&str] = &[
    "index",
    "key",
    "parent",
    "depth",
    "state",
    "derived",
    "closed",
    "mark",
    "children",
    "progress",
    "xp",
    "xp_from",
    "xp_progress",
    "label",
    "note",
    "reason",
];

/// The fields of a level of a path a phone is given (its badge is a file of the folder: left out).
const LEVEL_FIELDS: &[&str] = &[
    "number",
    "name",
    "kind",
    "threshold",
    "reached",
    "given",
    "reward",
    "ref",
];

/// The level reached, as a path entry carries it (its badge left out).
const REACHED_FIELDS: &[&str] = &[
    "level",
    "name",
    "percent",
    "finished",
    "next",
    "open_rewards",
];

/// An icon a phone draws without the files of the vault: an emoji or a word, never a file.
fn plain_icon(icon: &Value) -> Option<Value> {
    matches!(icon["kind"].as_str(), Some("emoji" | "word")).then(|| icon.clone())
}

/// A path entry for a phone, or `None` when the path is not of a released area.
pub(crate) fn path_entry(classes: &AreaPolicy, entry: &Value) -> Option<Value> {
    let id = entry["id"].as_str()?;
    if !released_id(classes, id) || entry["area"].as_str() != area_of(id) {
        return None;
    }
    let mut out = copy(entry, PATH_FIELDS);
    if let Some(icon) = plain_icon(&entry["icon"]) {
        out.insert("icon".to_owned(), icon);
    }
    if entry["level"].is_object() {
        out.insert(
            "level".to_owned(),
            Value::Object(copy(&entry["level"], REACHED_FIELDS)),
        );
    }
    Some(Value::Object(out))
}

/// `tasks.paths` for a phone: the paths of released areas. Which areas could not be read is told only as `partial`
/// (the engine's texts may name others).
pub(crate) fn paths(classes: &AreaPolicy, doc: &Value) -> Value {
    let mut out = copy(doc, &["kind", "schema", "plugin", "engine", "generated_at"]);
    let items: Vec<Value> = doc["items"]
        .as_array()
        .map_or(&[][..], Vec::as_slice)
        .iter()
        .filter_map(|entry| path_entry(classes, entry))
        .collect();
    out.insert("items".to_owned(), Value::Array(items));
    let partial = doc["incomplete"]
        .as_array()
        .is_some_and(|list| !list.is_empty());
    out.insert("partial".to_owned(), Value::Bool(partial));
    Value::Object(out)
}

/// `tasks.path` for a phone, or `None` (the hub answers `not_found`) when the path is not of a released area.
pub(crate) fn path(classes: &AreaPolicy, doc: &Value) -> Option<Value> {
    let entry = path_entry(classes, &doc["path"])?;
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
            "progress",
            "xp",
        ],
    );
    out.insert("path".to_owned(), entry);
    let nodes: Vec<Value> = doc["nodes"]
        .as_array()
        .map_or(&[][..], Vec::as_slice)
        .iter()
        .map(|node| {
            let mut cut = copy(node, NODE_FIELDS);
            if let Some(link) = node["link"]
                .as_str()
                .filter(|l| l.starts_with("https://") || l.starts_with("http://"))
            {
                cut.insert("link".to_owned(), json_str(link));
            }
            if let Some(task) = node["promoted"]
                .as_str()
                .filter(|id| released_id(classes, id))
            {
                cut.insert("promoted".to_owned(), json_str(task));
            }
            Value::Object(cut)
        })
        .collect();
    out.insert("nodes".to_owned(), Value::Array(nodes));
    let levels: Vec<Value> = doc["levels"]
        .as_array()
        .map_or(&[][..], Vec::as_slice)
        .iter()
        .map(|level| Value::Object(copy(level, LEVEL_FIELDS)))
        .collect();
    out.insert("levels".to_owned(), Value::Array(levels));
    Some(Value::Object(out))
}

fn json_str(text: &str) -> Value {
    Value::String(text.to_owned())
}

/// The fields of a meeting entry a phone is given: its time, its place and its counts. The address to join and the
/// recording are given apart (`meeting_links`); left out: its file and folder (`file`, `folder`, `assets`, `cover`,
/// `image`), whom notices go to (`notify_to`) and the faults of its file as text (`problems`).
const MEETING_FIELDS: &[&str] = &[
    "id",
    "area",
    "slug",
    "title",
    "status",
    "date",
    "time",
    "end",
    "duration_min",
    "all_day",
    "starts_at",
    "ends_at",
    "tz",
    "location",
    "tags",
    "summary",
    "agenda",
    "followups",
    "has_result",
    "has_decisions",
    "has_protocol",
    "created",
    "updated",
    "etag",
    "valid",
    "repeat",
    "repeat_until",
    "except",
    "series",
    "occurrence",
    "virtual",
];

/// What the settings release of an `internal` meeting for a phone, beyond what every released meeting gives: its
/// addresses (`meetings.internal_links`) and its people (`meetings.internal_people`). A `public` one gives both, a
/// private or unclassified one nothing.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Release {
    /// The addresses to join, of the recording and of the documents (`meetings.internal_links`).
    pub links: bool,
    /// The participants by name, and ticking them present (`meetings.internal_people`).
    pub people: bool,
}

impl Release {
    pub(crate) const fn new(links: bool, people: bool) -> Self {
        Self { links, people }
    }
}

/// Whether the addresses of a meeting of `area` (to join, of the recording, of its documents) may reach a phone: those
/// of a `public` area, those of an `internal` one only with the settings' `meetings.internal_links` (as for the mails).
fn meeting_links(classes: &AreaPolicy, area: &str, release: Release) -> bool {
    match classes.shown(area) {
        Shown::Public => true,
        Shown::Internal => release.links,
        Shown::Private | Shown::Unclassified => false,
    }
}

/// Whether the people of a meeting of `area` (their names, their count, whether they were there) may reach a phone, and
/// the phone may tick them present (`meeting_attend`): those of a `public` area, those of an `internal` one only with
/// the settings' `meetings.internal_people`. Fail closed: a private or unclassified area never.
pub(crate) fn meeting_people(classes: &AreaPolicy, area: &str, release: Release) -> bool {
    match classes.shown(area) {
        Shown::Public => true,
        Shown::Internal => release.people,
        Shown::Private | Shown::Unclassified => false,
    }
}

/// A web address, or nothing: a path of the vault or of this machine never leaves for a phone.
fn web_address(value: &Value) -> Option<Value> {
    value
        .as_str()
        .filter(|l| l.starts_with("https://") || l.starts_with("http://"))
        .map(json_str)
}

/// A meeting entry for a phone, or `None` when the meeting is not of a released area.
pub(crate) fn meeting_entry(
    classes: &AreaPolicy,
    entry: &Value,
    release: Release,
) -> Option<Value> {
    let id = entry["id"].as_str()?;
    let area = area_of(id)?;
    if !released(classes, area) || entry["area"].as_str() != Some(area) {
        return None;
    }
    let mut out = copy(entry, MEETING_FIELDS);
    if meeting_links(classes, area, release) {
        for field in ["online", "recording"] {
            if let Some(link) = web_address(&entry[field]) {
                out.insert(field.to_owned(), link);
            }
        }
        if let Some(service) = entry.get("online_service") {
            out.insert("online_service".to_owned(), service.clone());
        }
    }
    // Who comes is the people of the meeting: a count of them is given only where the people may leave.
    if meeting_people(classes, area, release)
        && let Some(count) = entry.get("participants")
    {
        out.insert("participants".to_owned(), count.clone());
    }
    if let Some(icon) = plain_icon(&entry["icon"]) {
        out.insert("icon".to_owned(), icon);
    }
    out.insert("tasks".to_owned(), ids(classes, &entry["tasks"]));
    Some(Value::Object(out))
}

/// `tasks.meetings` for a phone: the meetings of released areas. No count over the vault (`total`, `next_offset` tell
/// of the others too); `partial` says that the window held more than this page, or that an area could not be read.
pub(crate) fn meetings(classes: &AreaPolicy, doc: &Value, release: Release) -> Value {
    let mut out = copy(doc, &["kind", "schema", "plugin", "engine", "generated_at"]);
    let items: Vec<Value> = doc["items"]
        .as_array()
        .map_or(&[][..], Vec::as_slice)
        .iter()
        .filter_map(|entry| meeting_entry(classes, entry, release))
        .collect();
    out.insert("items".to_owned(), Value::Array(items));
    let partial = doc.get("next_offset").is_some_and(|n| !n.is_null())
        || doc["incomplete"]
            .as_array()
            .is_some_and(|list| !list.is_empty());
    out.insert("partial".to_owned(), Value::Bool(partial));
    Value::Object(out)
}

/// The body of a meeting without its section of participants (`## Teilnehmer` / `## Participants`), for a phone of an
/// area that is not public, and without its documents (`## Unterlagen` / `## Documents`) unless its addresses may leave.
fn without_participants(body: &str, links: bool) -> String {
    let mut out = Vec::new();
    let mut skipping = false;
    for line in body.lines() {
        let heading = line.trim_end();
        if heading.starts_with("## ") {
            // The documents are addresses: their section stays where the addresses of the meeting may not leave.
            skipping = heading == "## Teilnehmer"
                || heading == "## Participants"
                || (!links && (heading == "## Unterlagen" || heading == "## Documents"));
        }
        if !skipping {
            out.push(line);
        }
    }
    out.join("\n")
}

/// `tasks.meeting` for a phone, or `None` (the hub answers `not_found`) when the meeting is not of a released area.
pub(crate) fn meeting(classes: &AreaPolicy, doc: &Value, release: Release) -> Option<Value> {
    let entry = meeting_entry(classes, &doc["meeting"], release)?;
    let area = area_of(entry["id"].as_str()?)?;
    let public = matches!(classes.shown(area), Shown::Public);
    let links = meeting_links(classes, area, release);
    let people = meeting_people(classes, area, release);
    let mut out = copy(
        doc,
        &[
            "kind",
            "schema",
            "plugin",
            "engine",
            "generated_at",
            "body_truncated",
            "agenda",
        ],
    );
    out.insert("meeting".to_owned(), entry);
    let body = doc["body"].as_str().unwrap_or("");
    out.insert(
        "body".to_owned(),
        json_str(&if public {
            body.to_owned()
        } else {
            without_participants(body, links)
        }),
    );
    if public {
        if let Some(people) = doc.get("participants") {
            out.insert("participants".to_owned(), people.clone());
        }
    } else if people {
        // An internal meeting whose people the settings release: each by number, name and tick, never an address or
        // a role; the section of the body stays out (it holds the addresses).
        let names: Vec<Value> = doc["participants"]
            .as_array()
            .map_or(&[][..], Vec::as_slice)
            .iter()
            .map(|p| Value::Object(copy(p, &["n", "name", "present"])))
            .collect();
        out.insert("participants".to_owned(), Value::Array(names));
    } else {
        out.insert("participants".to_owned(), Value::Array(Vec::new()));
    }
    // A document's text is given; its address only as a web address the class lets out, never a path.
    let documents: Vec<Value> = doc["documents"]
        .as_array()
        .map_or(&[][..], Vec::as_slice)
        .iter()
        .map(|d| {
            let mut cut = copy(d, &["n", "text"]);
            let web = d["kind"] == "web";
            cut.insert(
                "kind".to_owned(),
                json_str(if web { "web" } else { "text" }),
            );
            if let Some(href) = web
                .then(|| web_address(&d["href"]))
                .flatten()
                .filter(|_| links)
            {
                cut.insert("href".to_owned(), href);
            }
            Value::Object(cut)
        })
        .collect();
    out.insert("documents".to_owned(), Value::Array(documents));
    let followups: Vec<Value> = doc["followups"]
        .as_array()
        .map_or(&[][..], Vec::as_slice)
        .iter()
        .map(|f| {
            let mut cut = copy(f, &["n", "text", "ticked"]);
            if let Some(task) = f["task"].as_str().filter(|id| released_id(classes, id)) {
                cut.insert("task".to_owned(), json_str(task));
            }
            Value::Object(cut)
        })
        .collect();
    out.insert("followups".to_owned(), Value::Array(followups));
    Some(Value::Object(out))
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

    fn path_doc(id: &str) -> Value {
        let area = id.split_once('/').map_or("", |(a, _)| a);
        json!({
            "kind": "tasks.path", "schema": 1, "rev": "r", "digest": "d", "vault": { "id": "v" },
            "body": "Lernen.", "body_truncated": false, "progress": { "total": 3 }, "xp": { "earned": 10 },
            "tree_problems": ["secret/x is broken"],
            "path": {
                "id": id, "area": area, "slug": "lua", "title": "Lua lernen", "status": "doing",
                "areas": [area, "secret"], "target": "secret/goal", "project": "secret/p",
                "file": "E:/vault/open/ROADMAP/paths/lua.md", "folder": true, "assets": ["assets/a.png"],
                "cover": "assets/c.png", "problems": ["see secret/x"], "etag": "e1",
                "icon": { "kind": "asset", "value": "assets/i.svg" },
                "level": { "level": 1, "name": "Funke", "badge": "assets/badges/f.svg", "percent": 10 },
            },
            "nodes": [
                { "index": 1, "key": "a", "line": 12, "state": "open", "label": "Docs", "note": "lies das",
                  "link": "https://example.org/docs", "image": "assets/x.png", "promoted": "open/t1" },
                { "index": 2, "key": "b", "parent": 1, "state": "learned", "link": "file:///E:/secret.pdf",
                  "promoted": "secret/t2" },
                { "index": 3, "key": "c", "parent": 1, "state": "seen", "reason": "kenne ich", "link": "assets/y.pdf" },
            ],
            "levels": [{ "number": 1, "name": "Funke", "badge": "assets/badges/f.svg", "threshold": 50, "line": 3 }],
        })
    }

    #[test]
    fn a_path_reaches_a_phone_cut_to_what_is_its_own_and_only_of_a_released_area() {
        let c = classes();
        assert!(path(&c, &path_doc("secret/lua")).is_none());
        let cut = path(&c, &path_doc("open/lua")).expect("an internal area is released");
        let text = cut.to_string();
        for word in [
            "secret",
            "E:/",
            "assets/",
            "line",
            "tree_problems",
            "\"rev\"",
            "digest",
            "file:",
        ] {
            assert!(!text.contains(word), "{word} in {text}");
        }
        assert_eq!(cut["path"]["title"], "Lua lernen");
        assert_eq!(cut["path"]["etag"], "e1");
        assert_eq!(
            cut["path"]["level"],
            json!({ "level": 1, "name": "Funke", "percent": 10 })
        );
        assert!(cut["path"].get("icon").is_none(), "{cut}");
        assert_eq!(cut["body"], "Lernen.");
        assert_eq!(cut["nodes"][0]["link"], "https://example.org/docs");
        assert_eq!(cut["nodes"][0]["promoted"], "open/t1");
        assert_eq!(cut["nodes"][0]["note"], "lies das");
        assert!(cut["nodes"][1].get("link").is_none());
        assert!(cut["nodes"][1].get("promoted").is_none());
        assert!(cut["nodes"][2].get("link").is_none());
        assert_eq!(cut["nodes"][2]["reason"], "kenne ich");
        assert_eq!(
            cut["levels"],
            json!([{ "number": 1, "name": "Funke", "threshold": 50 }])
        );
    }

    #[test]
    fn the_list_of_paths_holds_those_of_released_areas_and_says_only_that_it_is_partial() {
        let c = classes();
        let mut emoji = path_doc("pub/rust")["path"].clone();
        emoji["icon"] = json!({ "kind": "emoji", "value": "🦀" });
        let doc = json!({
            "kind": "tasks.paths", "rev": "r",
            "items": [path_doc("open/lua")["path"], path_doc("secret/lua")["path"], emoji,
                      { "id": "nameless/x", "area": "nameless" }, { "id": "open/y", "area": "pub" }],
            "incomplete": ["secret: cannot read"],
        });
        let cut = paths(&c, &doc);
        let ids: Vec<&str> = cut["items"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|i| i["id"].as_str())
            .collect();
        assert_eq!(ids, ["open/lua", "pub/rust"]);
        assert_eq!(
            cut["items"][1]["icon"],
            json!({ "kind": "emoji", "value": "🦀" })
        );
        assert_eq!(cut["partial"], true);
        assert!(!cut.to_string().contains("secret"), "{cut}");
        assert!(cut.get("rev").is_none());
    }

    fn meeting_doc(id: &str) -> Value {
        let area = id.split_once('/').map_or("", |(a, _)| a);
        json!({
            "kind": "tasks.meeting", "rev": "r", "digest": "d", "body_truncated": false,
            "body": "Kurz.\n\n## Teilnehmer\n\n- [ ] Rick <rick@example.org>\n\n## Unterlagen\n\n- https://example.org/slides\n\n## Protokoll\n\n- 10:00 Start\n",
            "meeting": {
                "id": id, "area": area, "slug": "m", "title": "Sync", "status": "planned", "date": "2026-11-24",
                "time": "10:00", "starts_at": "2026-11-24T10:00", "location": "Raum 3",
                "online": "https://teams.microsoft.com/l/x", "online_service": "teams",
                "recording": "https://example.org/rec", "notify_to": ["rick@example.org"],
                "participants": { "total": 1, "present": 0 }, "tasks": [format!("{area}/t1"), "secret/t2"],
                "file": "E:/v/m.md", "folder": true, "assets": ["assets/a.png"], "cover": "assets/c.png",
                "icon": { "kind": "emoji", "value": "📅" }, "problems": ["secret"], "etag": "e1",
            },
            "agenda": [{ "n": 1, "text": "Stand", "ticked": false }],
            "participants": [{ "n": 1, "name": "Rick", "email": "rick@example.org", "present": false }],
            "documents": [
                { "n": 1, "text": "Folien", "kind": "web", "href": "https://example.org/slides" },
                { "n": 2, "text": "Notiz", "kind": "path", "href": "E:/notes/n.md" },
                { "n": 3, "text": "Bild", "kind": "asset", "href": "assets/a.png" },
            ],
            "followups": [
                { "n": 1, "text": "Mail", "ticked": false, "task": format!("{area}/t3") },
                { "n": 2, "text": "Geheim", "ticked": false, "task": "secret/t4" },
            ],
        })
    }

    #[test]
    fn a_meeting_of_an_internal_area_reaches_a_phone_without_its_people_and_without_its_links() {
        let c = classes();
        assert!(meeting(&c, &meeting_doc("secret/m"), Release::new(true, true)).is_none());
        let cut =
            meeting(&c, &meeting_doc("open/m"), Release::default()).expect("internal is released");
        let text = cut.to_string();
        for word in [
            "rick",
            "Rick",
            "teams",
            "example.org",
            "E:/",
            "assets/",
            "secret",
            "\"rev\"",
            "Teilnehmer",
        ] {
            assert!(!text.contains(word), "{word} in {text}");
        }
        assert_eq!(cut["meeting"]["location"], "Raum 3");
        assert_eq!(cut["meeting"]["tasks"], json!(["open/t1"]));
        assert_eq!(
            cut["meeting"]["icon"],
            json!({ "kind": "emoji", "value": "📅" })
        );
        assert_eq!(cut["participants"], json!([]));
        assert!(cut["body"].as_str().unwrap().contains("## Protokoll"));
        assert_eq!(cut["agenda"][0]["text"], "Stand");
        assert_eq!(
            cut["documents"],
            json!([{ "n": 1, "text": "Folien", "kind": "web" }, { "n": 2, "text": "Notiz", "kind": "text" },
                   { "n": 3, "text": "Bild", "kind": "text" }])
        );
        assert_eq!(cut["followups"][0]["task"], "open/t3");
        assert!(cut["followups"][1].get("task").is_none());
        // With `meetings.internal_links` the addresses of an internal meeting may leave, its people still not.
        let linked = meeting(&c, &meeting_doc("open/m"), Release::new(true, false)).unwrap();
        assert_eq!(
            linked["meeting"]["online"],
            "https://teams.microsoft.com/l/x"
        );
        assert_eq!(linked["documents"][0]["href"], "https://example.org/slides");
        assert!(!linked.to_string().contains("rick"), "{linked}");
        assert!(linked["meeting"].get("participants").is_none(), "{linked}");
    }

    #[test]
    fn with_internal_people_an_internal_meeting_gives_its_people_by_name_only() {
        let c = classes();
        let cut = meeting(&c, &meeting_doc("open/m"), Release::new(false, true)).unwrap();
        assert_eq!(
            cut["participants"],
            json!([{ "n": 1, "name": "Rick", "present": false }])
        );
        assert_eq!(cut["meeting"]["participants"]["total"], 1);
        let text = cut.to_string();
        // No address of a person, and the section of the body (it holds the addresses) stays out; no link either.
        for word in ["rick@", "example.org", "Teilnehmer", "teams"] {
            assert!(!text.contains(word), "{word} in {text}");
        }
        // The people of a private area never, whatever the settings say.
        assert!(meeting(&c, &meeting_doc("secret/m"), Release::new(true, true)).is_none());
        // Off (the default): as before, no people.
        let off = meeting(&c, &meeting_doc("open/m"), Release::default()).unwrap();
        assert_eq!(off["participants"], json!([]));
        assert!(off["meeting"].get("participants").is_none(), "{off}");
    }

    #[test]
    fn the_people_of_a_meeting_are_released_by_class_and_setting() {
        let c = classes();
        for (area, off, on) in [
            ("pub", true, true),
            ("open", false, true),
            ("secret", false, false),
            ("nope", false, false),
        ] {
            assert_eq!(meeting_people(&c, area, Release::default()), off, "{area}");
            assert_eq!(
                meeting_people(&c, area, Release::new(true, true)),
                on,
                "{area}"
            );
        }
    }

    #[test]
    fn a_meeting_of_a_public_area_reaches_a_phone_with_its_people_and_links_but_no_file() {
        let c = classes();
        let cut = meeting(&c, &meeting_doc("pub/m"), Release::default()).unwrap();
        assert_eq!(cut["meeting"]["online"], "https://teams.microsoft.com/l/x");
        assert_eq!(cut["meeting"]["recording"], "https://example.org/rec");
        assert_eq!(cut["meeting"]["participants"]["total"], 1);
        assert_eq!(cut["participants"][0]["name"], "Rick");
        assert!(cut["body"].as_str().unwrap().contains("## Teilnehmer"));
        let text = cut.to_string();
        for word in ["notify_to", "E:/", "assets/", "problems", "secret"] {
            assert!(!text.contains(word), "{word} in {text}");
        }
    }

    #[test]
    fn the_list_of_meetings_holds_those_of_released_areas_and_no_count_of_the_vault() {
        let c = classes();
        let doc = json!({
            "kind": "tasks.meetings", "total": 3, "next_offset": 100,
            "items": [meeting_doc("open/m")["meeting"], meeting_doc("secret/m")["meeting"], meeting_doc("pub/m")["meeting"]],
        });
        let cut = meetings(&c, &doc, Release::default());
        let ids: Vec<&str> = cut["items"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|m| m["id"].as_str())
            .collect();
        assert_eq!(ids, ["open/m", "pub/m"]);
        assert!(
            cut.get("total").is_none() && cut.get("next_offset").is_none(),
            "{cut}"
        );
        assert_eq!(cut["partial"], true);
        assert!(cut["items"][0].get("online").is_none());
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
