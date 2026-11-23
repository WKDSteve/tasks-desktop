//! "Open in DocMap" for a task: the places in code a task names, read and checked by the hub.
//!
//! A task names code in one of two ways: a fenced block of the language `code-ref` in its body (the schema `code-ref/1`
//! of appkit: repo, file, lines) or, older, a ref `<file>:<first>[-<last>]` that tasks.nvim writes. Both are untrusted
//! input: this module reads them with the rules of the schema (one spelling of a path, nothing that leaves the
//! repository), the hub finds the repo among the tiles of this device, and docmap-desktop is started with the folder
//! and `<file>:<lines>` as separate arguments (`docmap-desktop --open-at <project> <file>:<first>[-<last>]`). The page
//! sees the repo's name and the label of the place, never a path of this machine.

use std::path::{Path, PathBuf};

use serde_json::Value;

/// The largest block that is read (the text between the fences), as the schema says.
const MAX_BLOCK_BYTES: usize = 64 * 1024;
/// The most places of one task that are looked at.
pub const MAX_REFS: usize = 8;
/// The longest path of a place.
const MAX_FILE: usize = 300;
/// The longest node name the page of a repo is opened at (the limit of `appkit_hub::browser::open_index_html`; a longer
/// name opens the page without a fragment).
const MAX_NODE: usize = 128;
/// The file that tells DocMap where its page is written, and the folder when it says nothing.
const DOCMAP_CONFIG: &str = ".docmap.json";
const DEFAULT_OUT_DIR: &str = "docs/map";
/// The largest `.docmap.json` that is read.
const MAX_CONFIG_BYTES: u64 = 256 * 1024;
/// The largest line number of the schema.
const MAX_LINE: u64 = 10_000_000;

/// A place in code, as the task names it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodeRef {
    /// The name of the repository; none for a ref of tasks.nvim, which names the file only.
    pub repo: Option<String>,
    /// Repository-relative, forward slashes.
    pub file: String,
    pub first: u32,
    pub last: u32,
    /// The DocMap node the block names (`docmap.node`), if it is one the page can be opened at; never from a ref.
    pub node: Option<String>,
}

impl CodeRef {
    /// `<file>:<first>[-<last>]`, the argument of `docmap-desktop --open-at` and the label the page shows.
    #[must_use]
    pub fn at(&self) -> String {
        if self.first == self.last {
            format!("{}:{}", self.file, self.first)
        } else {
            format!("{}:{}-{}", self.file, self.first, self.last)
        }
    }
}

/// Why `file` is not a repository-relative path in the one spelling of `code-ref/1`; none when it is one.
#[must_use]
pub fn path_error(file: &str) -> Option<&'static str> {
    if file.is_empty() || file.len() > MAX_FILE {
        return Some("the path is empty or too long");
    }
    if file
        .chars()
        .any(|c| c == '\\' || c == ':' || c.is_control())
    {
        return Some("the path holds a backslash, a colon or a control character");
    }
    if file.starts_with('/') || file.starts_with('~') || file.contains('$') || file.contains('%') {
        return Some("the path is not relative to the repository");
    }
    if file
        .split('/')
        .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Some("the path has an empty, a . or a .. part");
    }
    None
}

fn valid_repo(repo: &str) -> bool {
    let mut chars = repo.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphanumeric())
        && repo.len() <= 100
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

fn hex_sha(sha: &str) -> bool {
    matches!(sha.len(), 40 | 64)
        && sha
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn has_control(value: &Value) -> bool {
    let bad = |s: &str| {
        s.chars()
            .any(|c| c.is_control() && !matches!(c, '\t' | '\n' | '\r'))
    };
    match value {
        Value::String(s) => bad(s),
        Value::Array(items) => items.iter().any(has_control),
        Value::Object(map) => map.iter().any(|(k, v)| bad(k) || has_control(v)),
        _ => false,
    }
}

fn line_of(value: &Value) -> Option<u32> {
    value
        .as_u64()
        .filter(|n| (1..=MAX_LINE).contains(n))
        .and_then(|n| u32::try_from(n).ok())
}

/// One `code-ref/1` block, or why it is refused (a block that fails is used for nothing).
///
/// # Errors
///
/// The first problem, in words.
pub fn from_block(text: &str) -> Result<CodeRef, String> {
    if text.len() > MAX_BLOCK_BYTES {
        return Err("the block is larger than 64 KiB".to_owned());
    }
    let doc: Value = serde_json::from_str(text).map_err(|_| "the block is no JSON".to_owned())?;
    let Some(map) = doc.as_object() else {
        return Err("the block is no object".to_owned());
    };
    if map.get("schema").and_then(Value::as_str) != Some("code-ref/1") {
        return Err("the schema is not code-ref/1".to_owned());
    }
    if has_control(&doc) {
        return Err("a text holds a control character".to_owned());
    }
    let repo = map
        .get("repo")
        .and_then(Value::as_str)
        .filter(|r| valid_repo(r))
        .ok_or("repo is missing or no plain name")?;
    let file = map
        .get("file")
        .and_then(Value::as_str)
        .ok_or("file is missing")?;
    if let Some(why) = path_error(file) {
        return Err(why.to_owned());
    }
    let lines = map
        .get("lines")
        .and_then(Value::as_array)
        .filter(|l| l.len() == 2)
        .ok_or("lines is not two numbers")?;
    let (Some(first), Some(last)) = (line_of(&lines[0]), line_of(&lines[1])) else {
        return Err("lines are not two line numbers".to_owned());
    };
    if first > last {
        return Err("lines are not in order".to_owned());
    }
    match map.get("sha") {
        None | Some(Value::Null) => {}
        Some(Value::String(sha)) if hex_sha(sha) => {}
        Some(_) => return Err("sha is not a commit".to_owned()),
    }
    let node = map
        .get("docmap")
        .and_then(|d| d.get("node"))
        .and_then(Value::as_str)
        .filter(|n| !n.is_empty() && n.len() <= MAX_NODE)
        .map(str::to_owned);
    Ok(CodeRef {
        repo: Some(repo.to_owned()),
        file: file.to_owned(),
        first,
        last,
        node,
    })
}

/// The ref `<file>:<first>[-<last>]` of tasks.nvim; none when `text` is not one (a task id, a url, a path with a
/// drive).
#[must_use]
pub fn from_ref(text: &str) -> Option<CodeRef> {
    let (file, lines) = text.rsplit_once(':')?;
    if path_error(file).is_some() {
        return None;
    }
    let (first, last) = match lines.split_once('-') {
        Some((a, b)) => (a, b),
        None => (lines, lines),
    };
    let number = |s: &str| {
        (!s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
            .then(|| s.parse::<Value>().ok())
            .flatten()
            .and_then(|v| line_of(&v))
    };
    let (first, last) = (number(first)?, number(last)?);
    (first <= last).then(|| CodeRef {
        repo: None,
        file: file.to_owned(),
        first,
        last,
        node: None,
    })
}

/// The text of every fenced block of the language `code-ref` in `body`, in order. A fence is three or more backticks
/// (up to three spaces before them) and closes with at least as many; a block of another language is skipped whole, so
/// a `code-ref` inside it is text; an unclosed block is dropped.
#[must_use]
pub fn blocks(body: &str) -> Vec<String> {
    let mut found = Vec::new();
    // The open fence: its length, whether it is ours, the lines so far.
    let mut open: Option<(usize, bool, Vec<&str>)> = None;
    for line in body.lines() {
        let stripped = line.trim_start_matches(' ');
        let indent = line.len() - stripped.len();
        let ticks = stripped.bytes().take_while(|&b| b == b'`').count();
        let rest = &stripped[ticks..];
        match &mut open {
            Some((len, ours, lines)) => {
                if indent <= 3 && ticks >= *len && rest.trim().is_empty() {
                    if *ours {
                        found.push(lines.join("\n"));
                    }
                    open = None;
                } else if *ours {
                    lines.push(line);
                }
            }
            None => {
                if indent <= 3 && ticks >= 3 && !rest.contains('`') {
                    open = Some((ticks, rest.trim() == "code-ref", Vec::new()));
                }
            }
        }
    }
    found
}

/// The body of a task without its front matter, should the engine hand it over with one.
fn without_front_matter(body: &str) -> &str {
    let Some(rest) = body.strip_prefix("---") else {
        return body;
    };
    match rest.find("\n---") {
        Some(end) if rest.starts_with(['\n', '\r']) => {
            let tail = &rest[end + 4..];
            tail.split_once('\n').map_or("", |(_, t)| t)
        }
        _ => body,
    }
}

/// The places a task names: its `code-ref` blocks first (a block that fails is left out), then its refs of the form
/// `<file>:<lines>` that no block already names; at most [`MAX_REFS`].
#[must_use]
pub fn collect(body: &str, refs: &[String]) -> Vec<CodeRef> {
    let mut found: Vec<CodeRef> = blocks(without_front_matter(body))
        .iter()
        .filter_map(|text| from_block(text).ok())
        .collect();
    for text in refs {
        if let Some(place) = from_ref(text)
            && !found
                .iter()
                .any(|p| p.file == place.file && p.first == place.first && p.last == place.last)
        {
            found.push(place);
        }
    }
    found.truncate(MAX_REFS);
    found
}

/// The path of the generated page of the repo in `folder`, relative to it: `<out_dir>/index.html`, where `out_dir` is the
/// one of the `.docmap.json` of the repo (default `docs/map`, as docmap-desktop reads it). The file is read as untrusted
/// input: a missing, too large or unreadable file or an `out_dir` that is no plain relative path gives the default or
/// nothing, never a path outside the repo (the opener checks the path once more).
#[must_use]
pub fn page_relative(folder: &Path) -> Option<String> {
    let out_dir = match std::fs::symlink_metadata(folder.join(DOCMAP_CONFIG)) {
        Ok(meta) if meta.is_file() && meta.len() <= MAX_CONFIG_BYTES => {
            let text = std::fs::read_to_string(folder.join(DOCMAP_CONFIG)).ok()?;
            let doc: Value = serde_json::from_str(&text).ok()?;
            match doc.get("out_dir") {
                None | Some(Value::Null) => DEFAULT_OUT_DIR.to_owned(),
                Some(Value::String(dir)) => dir.trim_end_matches('/').to_owned(),
                Some(_) => return None,
            }
        }
        Ok(_) => return None,
        Err(_) => DEFAULT_OUT_DIR.to_owned(),
    };
    let out_dir = out_dir.strip_prefix("./").unwrap_or(&out_dir);
    if out_dir.is_empty() || path_error(out_dir).is_some() {
        return None;
    }
    Some(format!("{out_dir}/index.html"))
}

/// Where a place is on this machine, or why it cannot be opened.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Resolved {
    /// The folder of the repo (a tile of this device) in which the file is a plain file.
    Found { repo: String, folder: PathBuf },
    /// A short reason, no path.
    Refused(&'static str),
}

fn name_of(folder: &Path) -> Option<String> {
    folder.file_name().map(|n| n.to_string_lossy().into_owned())
}

/// Find the repo of `place` among the folders of the tiles. A place with a repo name needs the one folder of that name
/// (two of one name: refused, as DocMap refuses an ambiguous project); a place without one needs exactly one folder in
/// which its file is. The file must be a plain file inside the folder (a link out of it is refused).
#[must_use]
pub fn resolve(place: &CodeRef, folders: &[PathBuf]) -> Resolved {
    if let Some(why) = path_error(&place.file) {
        return Resolved::Refused(why);
    }
    let holds = |folder: &PathBuf| crate::editor::file_in_vault(folder, &place.file).is_ok();
    let candidates: Vec<&PathBuf> = match &place.repo {
        Some(repo) => folders
            .iter()
            .filter(|f| name_of(f).as_deref() == Some(repo.as_str()))
            .collect(),
        None => folders.iter().filter(|f| holds(f)).collect(),
    };
    match candidates.as_slice() {
        [] => Resolved::Refused(if place.repo.is_some() {
            "the repo is not one of your tiles"
        } else {
            "no repo of your tiles holds this file"
        }),
        [one] if holds(one) => Resolved::Found {
            repo: name_of(one).unwrap_or_default(),
            folder: (*one).clone(),
        },
        [_] => Resolved::Refused("the file is not in the repo"),
        _ => Resolved::Refused("more than one repo of your tiles fits"),
    }
}

#[cfg(test)]
mod tests {
    use hub_testkit::scratch::Scratch;

    use super::*;

    const GOOD: &str = r#"{ "schema": "code-ref/1", "repo": "docmap.nvim", "file": "lua/a.lua", "lines": [22, 41] }"#;

    #[test]
    fn a_block_is_read_with_the_rules_of_the_schema() {
        let place = from_block(GOOD).unwrap();
        assert_eq!(place.at(), "lua/a.lua:22-41");
        assert_eq!(place.repo.as_deref(), Some("docmap.nvim"));
        for bad in [
            r#"{ "schema": "code-ref/2", "repo": "x", "file": "a", "lines": [1, 1] }"#,
            r#"{ "schema": "code-ref/1", "repo": "x", "file": "/etc/passwd", "lines": [1, 1] }"#,
            r#"{ "schema": "code-ref/1", "repo": "x", "file": "../a", "lines": [1, 1] }"#,
            r#"{ "schema": "code-ref/1", "repo": "x", "file": "C:/a", "lines": [1, 1] }"#,
            r#"{ "schema": "code-ref/1", "repo": "x", "file": "a\\b", "lines": [1, 1] }"#,
            r#"{ "schema": "code-ref/1", "repo": "x", "file": "~/a", "lines": [1, 1] }"#,
            r#"{ "schema": "code-ref/1", "repo": "x", "file": "a", "lines": [3, 2] }"#,
            r#"{ "schema": "code-ref/1", "repo": "x", "file": "a", "lines": [true, 2] }"#,
            r#"{ "schema": "code-ref/1", "repo": "../x", "file": "a", "lines": [1, 1] }"#,
            r#"{ "schema": "code-ref/1", "repo": "x", "file": "a", "lines": [1, 1], "sha": "abc" }"#,
            r#"{ "schema": "code-ref/1", "repo": "x", "file": "a\u0000", "lines": [1, 1] }"#,
            "[1]",
            "nope",
        ] {
            assert!(from_block(bad).is_err(), "{bad} was accepted");
        }
        let huge = format!(
            r#"{{ "schema": "code-ref/1", "repo": "x", "file": "a", "lines": [1, 1], "excerpt": "{}" }}"#,
            "x".repeat(MAX_BLOCK_BYTES)
        );
        assert!(from_block(&huge).is_err());
    }

    #[test]
    fn a_block_may_name_the_docmap_node_a_ref_never() {
        let with = GOOD.replace(r#""lines""#, r#""docmap": { "node": "a.b" }, "lines""#);
        assert_eq!(from_block(&with).unwrap().node.as_deref(), Some("a.b"));
        assert_eq!(from_block(GOOD).unwrap().node, None);
        // A node the kit would refuse (too long) opens the page without a fragment.
        let long = GOOD.replace(
            r#""lines""#,
            &format!(r#""docmap": {{ "node": "{}" }}, "lines""#, "n".repeat(129)),
        );
        assert_eq!(from_block(&long).unwrap().node, None);
        assert_eq!(from_ref("lua/a.lua:3").unwrap().node, None);
    }

    #[test]
    fn the_page_is_where_the_docmap_json_says() {
        let root = Scratch::new("docmap-page-relative");
        let repo = |name: &str, config: Option<&str>| {
            let dir = root.join(name);
            std::fs::create_dir_all(&dir).unwrap();
            if let Some(text) = config {
                std::fs::write(dir.join(".docmap.json"), text).unwrap();
            }
            dir
        };
        assert_eq!(
            page_relative(&repo("none", None)).as_deref(),
            Some("docs/map/index.html")
        );
        assert_eq!(
            page_relative(&repo("empty", Some("{}"))).as_deref(),
            Some("docs/map/index.html")
        );
        assert_eq!(
            page_relative(&repo("own", Some(r#"{ "out_dir": "./site/map/" }"#))).as_deref(),
            Some("site/map/index.html")
        );
        for bad in [
            r#"{ "out_dir": "../x" }"#,
            r#"{ "out_dir": "/abs" }"#,
            r#"{ "out_dir": "C:/x" }"#,
            r#"{ "out_dir": "" }"#,
            r#"{ "out_dir": 3 }"#,
            "not json",
        ] {
            let dir = repo(&format!("bad{}", bad.len()), Some(bad));
            assert_eq!(page_relative(&dir), None, "{bad}");
        }
    }

    #[test]
    fn only_fenced_blocks_of_the_language_are_read() {
        let body = format!(
            "## Kontext\n\n```code-ref\n{GOOD}\n```\n\n```json\n{GOOD}\n```\n\n````md\n```code-ref\n{GOOD}\n```\n````\n\n```code-ref\n{GOOD}\n"
        );
        // One block: the json block and the one inside the longer fence are text, the unclosed one is dropped.
        assert_eq!(blocks(&body).len(), 1);
        assert_eq!(collect(&body, &[]).len(), 1);
    }

    #[test]
    fn a_ref_of_tasks_nvim_is_a_place_without_a_repo() {
        let place = from_ref("lua/a.lua:22-41").unwrap();
        assert_eq!((place.repo, place.first, place.last), (None, 22, 41));
        assert_eq!(from_ref("lua/a.lua:7").unwrap().at(), "lua/a.lua:7");
        for bad in [
            "lua/a.lua",
            "lua/a.lua:x",
            "lua/a.lua:5-3",
            "C:/a.lua:3",
            "/a.lua:3",
            "../a.lua:3",
            "a:b:3",
            "lib.nvim/some-task",
            "https://example.com:80",
        ] {
            assert!(from_ref(bad).is_none(), "{bad} was accepted");
        }
    }

    #[test]
    fn a_ref_a_block_already_names_is_not_listed_twice() {
        let body = format!("```code-ref\n{GOOD}\n```");
        let refs = ["lua/a.lua:22-41".to_owned(), "lua/b.lua:1".to_owned()];
        let places = collect(&body, &refs);
        assert_eq!(
            places.iter().map(CodeRef::at).collect::<Vec<_>>(),
            ["lua/a.lua:22-41", "lua/b.lua:1"]
        );
    }

    #[test]
    fn the_front_matter_is_not_body() {
        let body = format!("---\ntitle: x\n---\n```code-ref\n{GOOD}\n```\n");
        assert_eq!(collect(&body, &[]).len(), 1);
        let hidden = format!("---\nnote: |\n  ```code-ref\n  {GOOD}\n  ```\n---\ntext\n");
        assert!(collect(&hidden, &[]).is_empty());
    }

    #[test]
    fn a_repo_is_found_by_its_folder_name_and_the_file_must_be_in_it() {
        let root = Scratch::new("docmap-resolve");
        let one = root.join("one");
        let two = root.join("two");
        std::fs::create_dir_all(one.join("lua")).unwrap();
        std::fs::create_dir_all(&two).unwrap();
        std::fs::write(one.join("lua").join("a.lua"), "x").unwrap();
        let folders = vec![one.clone(), two.clone()];
        let place = |repo: Option<&str>, file: &str| CodeRef {
            repo: repo.map(str::to_owned),
            file: file.to_owned(),
            first: 1,
            last: 1,
            node: None,
        };
        assert_eq!(
            resolve(&place(Some("one"), "lua/a.lua"), &folders),
            Resolved::Found {
                repo: "one".to_owned(),
                folder: one.clone()
            }
        );
        assert_eq!(
            resolve(&place(None, "lua/a.lua"), &folders),
            Resolved::Found {
                repo: "one".to_owned(),
                folder: one
            }
        );
        for (p, why) in [
            (
                place(Some("three"), "lua/a.lua"),
                "the repo is not one of your tiles",
            ),
            (
                place(Some("two"), "lua/a.lua"),
                "the file is not in the repo",
            ),
            (
                place(None, "lua/zz.lua"),
                "no repo of your tiles holds this file",
            ),
            (
                place(Some("one"), "../x"),
                "the path has an empty, a . or a .. part",
            ),
        ] {
            assert_eq!(resolve(&p, &folders), Resolved::Refused(why));
        }
        // The same file in two repos: a place without a repo does not guess.
        std::fs::create_dir_all(two.join("lua")).unwrap();
        std::fs::write(two.join("lua").join("a.lua"), "x").unwrap();
        assert_eq!(
            resolve(&place(None, "lua/a.lua"), &folders),
            Resolved::Refused("more than one repo of your tiles fits")
        );
    }
}
