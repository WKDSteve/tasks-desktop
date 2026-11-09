//! The repo tiles of this device: repositories as tiles in groups under titles of one's own, a page of favourites.
//!
//! The file is `<config>/repos.json`, beside `config.json` and `areas.json`, of this device only (a path is of one
//! machine). The hub is its one writer: it holds the file, writes it whole and atomically (a temporary file and a
//! rename), and answers the page with a document that never carries a path (`label` is the last part of it, as the
//! vaults are named). A repo is there once, with its path; a group names repos by id, so one tile can stand in several
//! groups and a new name holds everywhere. The schema is cut so that the groups could move to the vault one day
//! without a rebuild: the groups know ids and titles, the paths stand apart.
//!
//! A file that cannot be read (broken JSON, an unknown key, a limit passed) does not stop the hub: it is
//! [`Loaded::Invalid`], the page shows an empty page with a word why, and the first write keeps the old file beside
//! the new one (`repos.json.invalid`).

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::classes::AreaPolicy;

/// The name of the file in the config folder.
pub const FILE: &str = "repos.json";
/// The name the old file is kept under when an invalid one is written over.
pub const INVALID: &str = "repos.json.invalid";
/// The version of the file's form.
pub const SCHEMA: u32 = 1;
/// The largest file that is read.
pub const MAX_FILE_BYTES: u64 = 256 * 1024;
/// The most repos of a file.
pub const MAX_REPOS: usize = 200;
/// The most groups of a file.
pub const MAX_GROUPS: usize = 50;
/// The longest name of a repo and title of a group, in characters.
pub const MAX_TEXT: usize = 80;
/// The length of an id (lowercase letters and digits).
pub const ID_LEN: usize = 8;

/// One repository: where it is, and the name it is shown by.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Repo {
    pub path: PathBuf,
    pub name: String,
}

/// One group: a title and the repos it holds, by id, in their order.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Group {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub tiles: Vec<String>,
}

/// The file.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReposFile {
    pub schema: u32,
    #[serde(default)]
    pub repos: BTreeMap<String, Repo>,
    #[serde(default)]
    pub groups: Vec<Group>,
}

impl Default for ReposFile {
    fn default() -> Self {
        Self {
            schema: SCHEMA,
            repos: BTreeMap::new(),
            groups: Vec::new(),
        }
    }
}

/// What is read from the config folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Loaded {
    /// No file: no tiles yet.
    Missing,
    /// The file, checked.
    Ok(ReposFile, String),
    /// A file that is no usable `repos.json`: the reason, without its text.
    Invalid(String),
}

/// Whether `id` is one this module would make: [`ID_LEN`] lowercase letters or digits.
#[must_use]
pub fn valid_id(id: &str) -> bool {
    id.len() == ID_LEN
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

/// A name or a title: 1 to [`MAX_TEXT`] characters, no control character, not only blanks.
fn text_error(what: &str, text: &str) -> Option<String> {
    let n = text.chars().count();
    if text.trim().is_empty() || n > MAX_TEXT {
        return Some(format!("{what} must be 1 to {MAX_TEXT} characters"));
    }
    if text.chars().any(char::is_control) {
        return Some(format!("{what} holds a control character"));
    }
    None
}

impl ReposFile {
    /// Every rule of the form: the schema, the limits, the ids, the texts, and that a group names only repos that are
    /// there, each once.
    ///
    /// # Errors
    ///
    /// The first thing that is wrong, in words, without a path.
    pub fn validate(&self) -> Result<(), String> {
        if self.schema != SCHEMA {
            return Err(format!("schema {} is not {SCHEMA}", self.schema));
        }
        if self.repos.len() > MAX_REPOS {
            return Err(format!("more than {MAX_REPOS} repos"));
        }
        if self.groups.len() > MAX_GROUPS {
            return Err(format!("more than {MAX_GROUPS} groups"));
        }
        for (id, repo) in &self.repos {
            if !valid_id(id) {
                return Err("a repo has an id that is not 8 lowercase letters or digits".to_owned());
            }
            if let Some(why) = text_error("the name of a repo", &repo.name) {
                return Err(why);
            }
            if !repo.path.is_absolute() {
                return Err("the folder of a repo is not an absolute path".to_owned());
            }
        }
        let mut groups = std::collections::BTreeSet::new();
        for group in &self.groups {
            if !valid_id(&group.id) || !groups.insert(group.id.as_str()) {
                return Err(
                    "a group has an id that is not 8 lowercase letters or digits, or one twice"
                        .to_owned(),
                );
            }
            if let Some(why) = text_error("the title of a group", &group.title) {
                return Err(why);
            }
            let mut seen = std::collections::BTreeSet::new();
            for tile in &group.tiles {
                if !self.repos.contains_key(tile) {
                    return Err("a group names a repo that is not there".to_owned());
                }
                if !seen.insert(tile.as_str()) {
                    return Err("a group names a repo twice".to_owned());
                }
            }
        }
        Ok(())
    }
}

/// A digest of the text of the file: what the page sends back to say which state it changed (`rev`). It tells one
/// state from another, nothing more (FNV-1a, 64 bits).
#[must_use]
pub fn rev_of(text: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in text.bytes() {
        hash ^= u64::from(b);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    let mut out = String::from("fnv1a:");
    let _ = write!(out, "{hash:016x}");
    out
}

/// The text a file is written as (and its `rev` is made of).
///
/// # Errors
///
/// The file does not pass [`ReposFile::validate`].
pub fn text_of(file: &ReposFile) -> Result<String, String> {
    file.validate()?;
    let text = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    Ok(format!("{text}\n"))
}

/// Read `repos.json` from the config folder. Nothing in it stops the hub.
#[must_use]
pub fn load(dir: &Path) -> Loaded {
    let path = dir.join(FILE);
    let meta = match std::fs::symlink_metadata(&path) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Loaded::Missing,
        Err(_) => return Loaded::Invalid("repos.json cannot be read".to_owned()),
    };
    if !meta.is_file() {
        return Loaded::Invalid("repos.json is not a file".to_owned());
    }
    if meta.len() > MAX_FILE_BYTES {
        return Loaded::Invalid(format!(
            "repos.json is larger than {} KiB",
            MAX_FILE_BYTES / 1024
        ));
    }
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Loaded::Invalid("repos.json cannot be read as text".to_owned());
    };
    let file: ReposFile = match serde_json::from_str(&text) {
        Ok(file) => file,
        Err(e) => {
            return Loaded::Invalid(format!(
                "repos.json is not a file of repo tiles: {}",
                short(&e.to_string())
            ))
        }
    };
    if let Err(why) = file.validate() {
        return Loaded::Invalid(format!("repos.json: {why}"));
    }
    Loaded::Ok(file, rev_of(&text))
}

/// The first line of a message, at most 200 characters (a serde message names the place, not the text).
fn short(message: &str) -> String {
    message
        .lines()
        .next()
        .unwrap_or_default()
        .chars()
        .take(200)
        .collect()
}

/// Write the file whole: a temporary file beside it, then a rename (a crash leaves the old file or the new one). An
/// invalid file that is there is kept as [`INVALID`] first. Returns the `rev` of what was written.
///
/// # Errors
///
/// The file does not pass [`ReposFile::validate`], or the folder cannot be written; the reason, without a path.
pub fn save(dir: &Path, file: &ReposFile) -> Result<String, String> {
    let text = text_of(file)?;
    std::fs::create_dir_all(dir)
        .map_err(|e| format!("cannot make the config folder: {}", e.kind()))?;
    let path = dir.join(FILE);
    if matches!(load(dir), Loaded::Invalid(_)) && path.is_file() {
        std::fs::rename(&path, dir.join(INVALID))
            .map_err(|e| format!("cannot keep the invalid repos.json: {}", e.kind()))?;
    }
    let tmp = dir.join(format!("{FILE}.{}.tmp", std::process::id()));
    std::fs::write(&tmp, &text)
        .map_err(|e| format!("cannot write the repo tiles: {}", e.kind()))?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("cannot replace repos.json: {}", e.kind())
    })?;
    Ok(rev_of(&text))
}

/// The last part of a path: what the page is told a folder is called (never the path itself).
#[must_use]
pub fn label_of(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// The area of the vault a repo stands for: the area of the same name as its folder, else the area whose `repo` in
/// `areas.json` is that folder; none when there is neither.
#[must_use]
pub fn area_of<'a>(label: &str, areas: &'a [String], policy: &AreaPolicy) -> Option<&'a str> {
    areas
        .iter()
        .find(|a| a.as_str() == label)
        .or_else(|| areas.iter().find(|a| policy.repo_of(a) == Some(label)))
        .map(String::as_str)
}

/// The document `hub.repos` the page draws: the groups with their titles and tiles, each repo with its name, the
/// label of its folder, whether an image was found and its area. No path. `problem` says why the file is not used.
#[must_use]
pub fn document(
    loaded: &Loaded,
    areas: &[String],
    policy: &AreaPolicy,
    has_image: &dyn Fn(&Path) -> bool,
) -> Value {
    let (file, rev, problem) = match loaded {
        Loaded::Missing => (ReposFile::default(), rev_of(""), None),
        Loaded::Ok(file, rev) => (file.clone(), rev.clone(), None),
        Loaded::Invalid(why) => (ReposFile::default(), rev_of(""), Some(why.clone())),
    };
    let repos: serde_json::Map<String, Value> = file
        .repos
        .iter()
        .map(|(id, repo)| {
            let label = label_of(&repo.path);
            let area = area_of(&label, areas, policy);
            (
                id.clone(),
                json!({ "name": repo.name, "label": label, "image": has_image(&repo.path), "area": area }),
            )
        })
        .collect();
    let groups: Vec<Value> = file
        .groups
        .iter()
        .map(|g| json!({ "id": g.id, "title": g.title, "tiles": g.tiles }))
        .collect();
    let mut doc = json!({ "kind": "hub.repos", "schema": SCHEMA, "rev": rev, "repos": repos, "groups": groups });
    if let Some(problem) = problem {
        doc["problem"] = json!("invalid");
        doc["message"] = json!(problem);
    }
    doc
}

/// A new id: [`ID_LEN`] lowercase hex digits from the random source of the system, not one of `taken`.
///
/// # Errors
///
/// The system has no random source.
pub fn new_id(taken: &dyn Fn(&str) -> bool) -> Result<String, String> {
    for _ in 0..16 {
        let id = appkit_core::authn::Secret::generate(ID_LEN / 2)
            .map_err(|_| "the system has no random source".to_owned())?
            .to_hex();
        if !taken(&id) {
            return Ok(id);
        }
    }
    Err("no free id".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use hub_testkit::scratch::Scratch;

    fn abs(name: &str) -> PathBuf {
        std::env::temp_dir().join("repos-test").join(name)
    }

    fn sample() -> ReposFile {
        let mut file = ReposFile::default();
        file.repos.insert(
            "aaaa0001".into(),
            Repo {
                path: abs("tasks.nvim"),
                name: "Tasks".into(),
            },
        );
        file.repos.insert(
            "aaaa0002".into(),
            Repo {
                path: abs("wkdbook-lib.nvim"),
                name: "lib".into(),
            },
        );
        file.groups.push(Group {
            id: "gggg0001".into(),
            title: "Files & Navigation".into(),
            tiles: vec!["aaaa0001".into(), "aaaa0002".into()],
        });
        // The same tile in a second group (allowed: the model keeps a repo apart from its places).
        file.groups.push(Group {
            id: "gggg0002".into(),
            title: "UI".into(),
            tiles: vec!["aaaa0001".into()],
        });
        file
    }

    #[test]
    fn a_file_goes_round_and_its_rev_is_that_of_its_text() {
        let dir = Scratch::new("repos-round");
        assert_eq!(load(dir.path()), Loaded::Missing);
        let rev = save(dir.path(), &sample()).unwrap();
        let Loaded::Ok(file, read) = load(dir.path()) else {
            panic!("not read")
        };
        assert_eq!(file, sample());
        assert_eq!(read, rev);
        assert_ne!(rev, rev_of(""));
    }

    #[test]
    fn a_broken_or_unknown_file_is_invalid_and_never_a_panic_and_is_kept_beside_the_next_one() {
        let dir = Scratch::new("repos-broken");
        for (text, word) in [
            ("{", "not a file of repo tiles"),
            (
                r#"{"schema":1,"repos":{},"groups":[],"extra":1}"#,
                "not a file of repo tiles",
            ),
            (r#"{"schema":2}"#, "schema 2"),
        ] {
            std::fs::write(dir.path().join(FILE), text).unwrap();
            match load(dir.path()) {
                Loaded::Invalid(why) => assert!(why.contains(word), "{why}"),
                other => panic!("{text}: {other:?}"),
            }
        }
        std::fs::write(
            dir.path().join(FILE),
            vec![b' '; usize::try_from(MAX_FILE_BYTES).unwrap() + 1],
        )
        .unwrap();
        assert!(matches!(load(dir.path()), Loaded::Invalid(why) if why.contains("larger")));
        // The first write keeps the invalid file beside the new one.
        save(dir.path(), &sample()).unwrap();
        assert!(dir.path().join(INVALID).is_file());
        assert!(matches!(load(dir.path()), Loaded::Ok(..)));
    }

    #[test]
    fn every_limit_of_the_form_holds() {
        let ok = sample();
        assert!(ok.validate().is_ok());
        let check = |edit: &dyn Fn(&mut ReposFile), word: &str| {
            let mut f = sample();
            edit(&mut f);
            let why = f.validate().unwrap_err();
            assert!(why.contains(word), "{word}: {why}");
        };
        check(&|f| f.schema = 2, "schema");
        check(
            &|f| f.repos.get_mut("aaaa0001").unwrap().name = "x".repeat(MAX_TEXT + 1),
            "1 to 80",
        );
        check(
            &|f| f.repos.get_mut("aaaa0001").unwrap().name = "  ".into(),
            "1 to 80",
        );
        check(
            &|f| f.repos.get_mut("aaaa0001").unwrap().name = "a\u{7}b".into(),
            "control",
        );
        check(
            &|f| f.repos.get_mut("aaaa0001").unwrap().path = PathBuf::from("relative"),
            "absolute",
        );
        check(
            &|f| {
                let r = f.repos.remove("aaaa0001").unwrap();
                f.repos.insert("BAD".into(), r);
            },
            "8 lowercase",
        );
        check(&|f| f.groups[0].title = String::new(), "1 to 80");
        check(&|f| f.groups[1].id = "gggg0001".into(), "twice");
        check(&|f| f.groups[0].tiles.push("zzzz9999".into()), "not there");
        check(&|f| f.groups[0].tiles.push("aaaa0002".into()), "twice");
        check(
            &|f| {
                for i in 0..=MAX_REPOS {
                    f.repos.insert(
                        format!("r{i:07}"),
                        Repo {
                            path: abs("x"),
                            name: "x".into(),
                        },
                    );
                }
            },
            "more than 200 repos",
        );
        check(
            &|f| {
                for i in 0..MAX_GROUPS {
                    f.groups.push(Group {
                        id: format!("h{i:07}"),
                        title: "t".into(),
                        tiles: vec![],
                    });
                }
            },
            "more than 50 groups",
        );
        // And nothing that fails the form is written.
        let dir = Scratch::new("repos-limit");
        let mut bad = sample();
        bad.schema = 9;
        assert!(save(dir.path(), &bad).is_err());
        assert_eq!(load(dir.path()), Loaded::Missing);
    }

    #[test]
    fn the_document_names_each_repo_by_its_folder_and_its_area_and_never_its_path() {
        let policy = AreaPolicy::default();
        let areas = vec!["tasks.nvim".to_owned(), "other".to_owned()];
        let loaded = Loaded::Ok(sample(), "fnv1a:1".into());
        let doc = document(&loaded, &areas, &policy, &|p| p.ends_with("tasks.nvim"));
        assert_eq!(doc["kind"], "hub.repos");
        assert_eq!(doc["rev"], "fnv1a:1");
        assert_eq!(
            doc["repos"]["aaaa0001"],
            json!({ "name": "Tasks", "label": "tasks.nvim", "image": true, "area": "tasks.nvim" })
        );
        assert_eq!(doc["repos"]["aaaa0002"]["area"], Value::Null);
        assert_eq!(
            doc["groups"][1],
            json!({ "id": "gggg0002", "title": "UI", "tiles": ["aaaa0001"] })
        );
        let text = doc.to_string();
        assert!(
            !text.contains(&abs("").to_string_lossy().replace('\\', "\\\\").to_string()),
            "a path in {text}"
        );
        assert!(!text.contains("repos-test"), "a path in {text}");
        // An invalid file: an empty page that says why.
        let invalid = document(
            &Loaded::Invalid("repos.json: schema 2 is not 1".into()),
            &areas,
            &policy,
            &|_| false,
        );
        assert_eq!(invalid["problem"], "invalid");
        assert_eq!(invalid["groups"], json!([]));
    }

    #[test]
    fn an_area_is_found_by_its_name_or_by_the_repo_folder_of_areas_json() {
        let mut entries = BTreeMap::new();
        entries.insert(
            "lib.nvim".to_owned(),
            crate::classes::Entry {
                class: crate::classes::Class::Public,
                repo: Some("wkdbook-lib.nvim".to_owned()),
            },
        );
        let policy = AreaPolicy::new(entries).unwrap();
        let areas = vec!["lib.nvim".to_owned(), "tasks.nvim".to_owned()];
        assert_eq!(area_of("tasks.nvim", &areas, &policy), Some("tasks.nvim"));
        assert_eq!(
            area_of("wkdbook-lib.nvim", &areas, &policy),
            Some("lib.nvim")
        );
        assert_eq!(area_of("elsewhere", &areas, &policy), None);
    }

    #[test]
    fn a_new_id_is_eight_lowercase_hex_digits_and_not_one_that_is_taken() {
        let id = new_id(&|_| false).unwrap();
        assert!(valid_id(&id), "{id}");
        let first = id.clone();
        let other = new_id(&|candidate| candidate == first).unwrap();
        assert_ne!(other, first);
        assert!(new_id(&|_| true).is_err());
    }
}
