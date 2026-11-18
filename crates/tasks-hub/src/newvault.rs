//! Making a new, empty vault: a folder with one area that has the folders the engine looks for.
//!
//! The page asks for a folder it has shown to the person, with a confirmation (the route checks that). This is the
//! part that touches the disk, so it is strict: an absolute path without `..`, a parent that exists, and a target that
//! does not exist yet or is an empty folder. Nothing that is already there is written over or merged into.

use std::path::{Component, Path};

use crate::config::valid_area_name;

/// Why a vault was not made: a short code for the page and a text without a path.
#[derive(Debug, PartialEq, Eq)]
pub struct Refused {
    pub code: &'static str,
    pub why: &'static str,
}

const fn refused(code: &'static str, why: &'static str) -> Refused {
    Refused { code, why }
}

/// Make `path` a vault with one `area` (`<path>/<area>/ROADMAP/tasks`).
///
/// # Errors
///
/// [`Refused`] when the path or the area is not acceptable, the folder is not empty, or the disk says no.
pub fn create(path: &Path, area: &str) -> Result<(), Refused> {
    if valid_area_name(area).is_err() {
        return Err(refused("bad_area", "the area is not a plain name"));
    }
    let plain = path.components().all(|c| {
        matches!(
            c,
            Component::Prefix(_) | Component::RootDir | Component::Normal(_)
        )
    });
    if !path.is_absolute() || !plain {
        return Err(refused(
            "bad_path",
            "the folder must be an absolute path without . or ..",
        ));
    }
    if !path.parent().is_some_and(Path::is_dir) {
        return Err(refused("no_parent", "the folder above it does not exist"));
    }
    match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => {
            let empty = std::fs::read_dir(path)
                .map_err(|_| refused("not_readable", "the folder cannot be read"))?
                .next()
                .is_none();
            // What an earlier try left (the page makes the folder, then remembers it; a refusal of the second step
            // must not lock the person out of the same folder): the same bare structure is taken as it is.
            if !empty && is_bare_vault(path, area) {
                return Ok(());
            }
            if !empty {
                return Err(refused("not_empty", "the folder is not empty"));
            }
        }
        Ok(_) => return Err(refused("exists", "something is there already")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(refused("not_readable", "the folder cannot be read")),
    }
    std::fs::create_dir_all(path.join(area).join("ROADMAP").join("tasks"))
        .map_err(|_| refused("not_writable", "the folders could not be made"))
}

/// The most files an example vault holds, and the most one of them weighs: the one of tasks.nvim has 15 small files.
pub const EXAMPLE_MAX_FILES: usize = 200;
pub const EXAMPLE_MAX_FILE_BYTES: u64 = 1024 * 1024;
/// The most folders of an example vault: a tree of empty folders is no example either.
pub const EXAMPLE_MAX_DIRS: usize = 200;
/// The marker file of a vault (`tasks-vault.json`, docs/ENGINE.md of tasks.nvim): an example has one.
const MARKER: &str = "tasks-vault.json";

/// What an example vault holds, for the page to say before anything is copied: its areas and how many files.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Example {
    pub areas: Vec<String>,
    pub files: usize,
}

/// The files of the example at `from`, relative, in a fixed order: plain files in plain folders only (a link is not
/// followed and not copied), within the limits above. `None` when it is no example vault (no marker file), holds a
/// link, or is larger than an example is.
fn example_files(from: &Path) -> Option<Vec<std::path::PathBuf>> {
    if !from.join(MARKER).is_file() {
        return None;
    }
    let mut files = Vec::new();
    let mut dirs = vec![std::path::PathBuf::new()];
    let mut seen_dirs = 0usize;
    while let Some(rel) = dirs.pop() {
        seen_dirs += 1;
        if seen_dirs > EXAMPLE_MAX_DIRS {
            return None;
        }
        let mut entries: Vec<_> = std::fs::read_dir(from.join(&rel))
            .ok()?
            .filter_map(Result::ok)
            .collect();
        entries.sort_by_key(std::fs::DirEntry::file_name);
        for entry in entries {
            let kind = entry.file_type().ok()?;
            let name = rel.join(entry.file_name());
            if kind.is_symlink() {
                return None;
            } else if kind.is_dir() {
                dirs.push(name);
            } else if kind.is_file() {
                if entry.metadata().ok()?.len() > EXAMPLE_MAX_FILE_BYTES {
                    return None;
                }
                files.push(name);
                if files.len() > EXAMPLE_MAX_FILES {
                    return None;
                }
            }
        }
    }
    files.sort();
    Some(files)
}

/// What the example at `from` holds; `None` when there is none to offer.
#[must_use]
pub fn example(from: &Path) -> Option<Example> {
    let files = example_files(from)?;
    let mut areas: Vec<String> = files
        .iter()
        .filter(|f| f.components().count() > 1)
        .filter_map(|f| f.components().next())
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .filter(|name| valid_area_name(name).is_ok())
        .collect();
    areas.dedup();
    (!areas.is_empty()).then_some(Example {
        areas,
        files: files.len(),
    })
}

/// Copy the example vault at `from` into `to`, which becomes a vault of its own: the example is never opened where it
/// lies (the folder of the plugin is not a place to write tasks into). `to` is held to the rules of [`create`]: an
/// absolute path without `..`, a parent that exists, and nothing there yet or an empty folder. Nothing that is there
/// is written over.
///
/// # Errors
///
/// [`Refused`] when the target is not acceptable, there is no example, or the disk says no.
pub fn copy_example(from: &Path, to: &Path) -> Result<usize, Refused> {
    let plain = to.components().all(|c| {
        matches!(
            c,
            Component::Prefix(_) | Component::RootDir | Component::Normal(_)
        )
    });
    if !to.is_absolute() || !plain {
        return Err(refused(
            "bad_path",
            "the folder must be an absolute path without . or ..",
        ));
    }
    if !to.parent().is_some_and(Path::is_dir) {
        return Err(refused("no_parent", "the folder above it does not exist"));
    }
    match std::fs::symlink_metadata(to) {
        Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => {
            let empty = std::fs::read_dir(to)
                .map_err(|_| refused("not_readable", "the folder cannot be read"))?
                .next()
                .is_none();
            if !empty {
                return Err(refused("not_empty", "the folder is not empty"));
            }
        }
        Ok(_) => return Err(refused("exists", "something is there already")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(refused("not_readable", "the folder cannot be read")),
    }
    let files =
        example_files(from).ok_or(refused("no_example", "there is no example vault to copy"))?;
    let existed = to.exists();
    let copied = copy_files(from, to, &files);
    if copied.is_err() {
        // What this call wrote goes again: a second try into the same folder must not be refused as "not empty" by the
        // half of the first.
        remove_copy(to, existed);
    }
    copied.map(|()| files.len())
}

/// Take back a copy of the example in `to` that is not kept (the copy broke off, or the hub did not take the folder as
/// its vault): the folder was empty (`existed`) or not there before [`copy_example`], so what is in it now is the copy.
/// An empty folder stays empty, one that was not there goes. Nothing reports: what cannot go stays.
pub fn remove_copy(to: &Path, existed: bool) {
    if existed {
        if let Ok(entries) = std::fs::read_dir(to) {
            for entry in entries.filter_map(Result::ok) {
                let path = entry.path();
                let _ = if entry.file_type().is_ok_and(|t| t.is_dir()) {
                    std::fs::remove_dir_all(&path)
                } else {
                    std::fs::remove_file(&path)
                };
            }
        }
    } else {
        let _ = std::fs::remove_dir_all(to);
    }
}

/// Write `files` of `from` below `to`, each made new and no longer than a file of an example may be.
fn copy_files(from: &Path, to: &Path, files: &[std::path::PathBuf]) -> Result<(), Refused> {
    use std::io::Read as _;
    let failed = || refused("not_writable", "the example could not be copied");
    for rel in files {
        let target = to.join(rel);
        if let Some(dir) = target.parent() {
            std::fs::create_dir_all(dir).map_err(|_| failed())?;
        }
        // `create_new`: nothing that appeared meanwhile is written over.
        let mut out = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(|_| failed())?;
        let source = std::fs::File::open(from.join(rel)).map_err(|_| failed())?;
        // The size was looked at when the files were listed; a file that grew since is not copied beyond it.
        let mut limited = source.take(EXAMPLE_MAX_FILE_BYTES + 1);
        let n = std::io::copy(&mut limited, &mut out).map_err(|_| failed())?;
        if n > EXAMPLE_MAX_FILE_BYTES {
            return Err(failed());
        }
    }
    Ok(())
}

/// Is `dir` a plain folder that holds exactly one plain folder called `name`, and nothing else? Gives that folder.
fn only_folder(dir: &Path, name: &str) -> Option<std::path::PathBuf> {
    let mut entries = std::fs::read_dir(dir).ok()?;
    let entry = entries.next()?.ok()?;
    if entries.next().is_some() || entry.file_name() != name {
        return None;
    }
    let kind = entry.file_type().ok()?;
    (kind.is_dir() && !kind.is_symlink()).then(|| entry.path())
}

/// Does `path` hold exactly `<area>/ROADMAP/tasks`, with nothing in the last one?
fn is_bare_vault(path: &Path, area: &str) -> bool {
    let tasks = only_folder(path, area)
        .and_then(|a| only_folder(&a, "ROADMAP"))
        .and_then(|r| only_folder(&r, "tasks"));
    tasks.is_some_and(|t| std::fs::read_dir(t).is_ok_and(|mut d| d.next().is_none()))
}

#[cfg(test)]
mod tests {
    use hub_testkit::scratch::Scratch;

    use super::*;

    /// A folder of its own, removed when the value drops.
    fn scratch(name: &str) -> Scratch {
        Scratch::new(&format!("newvault-{name}"))
    }

    /// An example vault as the engine brings one: a marker, two areas, a task and a finished one.
    fn an_example(base: &Path) -> std::path::PathBuf {
        let from = base.join("engine").join("examples").join("vault");
        for (file, text) in [
            ("tasks-vault.json", "{}"),
            ("README.md", "An example."),
            (
                "demo.nvim/ROADMAP/tasks/first.md",
                "---\ntitle: First\n---\n",
            ),
            ("demo.nvim/ROADMAP/TASKS.md", "# Tasks"),
            (
                "docs/Backlog/TASKS/2026-01-05_done.md",
                "---\ntitle: Done\n---\n",
            ),
        ] {
            let at = from.join(file);
            std::fs::create_dir_all(at.parent().unwrap()).unwrap();
            std::fs::write(at, text).unwrap();
        }
        from
    }

    #[test]
    fn the_example_says_its_areas_and_is_copied_whole_into_an_empty_folder_only() {
        let base = scratch("example");
        let from = an_example(&base);
        assert_eq!(
            example(&from),
            Some(Example {
                areas: vec!["demo.nvim".to_owned(), "docs".to_owned()],
                files: 5
            })
        );
        // Into a folder that is not there yet, and into an empty one.
        let fresh = base.join("fresh");
        assert_eq!(copy_example(&from, &fresh), Ok(5));
        assert_eq!(
            std::fs::read_to_string(fresh.join("demo.nvim/ROADMAP/tasks/first.md")).unwrap(),
            "---\ntitle: First\n---\n"
        );
        assert!(fresh.join("tasks-vault.json").is_file());
        assert!(fresh
            .join("docs/Backlog/TASKS/2026-01-05_done.md")
            .is_file());
        let empty = base.join("empty");
        std::fs::create_dir(&empty).unwrap();
        assert_eq!(copy_example(&from, &empty), Ok(5));
        // The example itself is as it was: it is read, never written.
        assert_eq!(example(&from).unwrap().files, 5);

        // Nothing is written over or merged into: a folder with anything in it, a file, the copy made just now.
        let used = base.join("used");
        std::fs::create_dir(&used).unwrap();
        std::fs::write(used.join("mine.txt"), "mine").unwrap();
        for target in [&used, &fresh, &used.join("mine.txt")] {
            let before = std::fs::read_dir(&used).unwrap().count();
            let code = copy_example(&from, target).unwrap_err().code;
            assert!(matches!(code, "not_empty" | "exists"), "{code}");
            assert_eq!(std::fs::read_dir(&used).unwrap().count(), before);
        }
        assert_eq!(
            std::fs::read_to_string(used.join("mine.txt")).unwrap(),
            "mine"
        );
        // The target is held to the rules of a new vault.
        assert_eq!(
            copy_example(&from, Path::new("relative/x"))
                .unwrap_err()
                .code,
            "bad_path"
        );
        assert_eq!(
            copy_example(&from, &base.join("a").join("..").join("b"))
                .unwrap_err()
                .code,
            "bad_path"
        );
        assert_eq!(
            copy_example(&from, &base.join("no").join("parent"))
                .unwrap_err()
                .code,
            "no_parent"
        );
    }

    #[test]
    fn a_tree_of_many_folders_is_no_example_and_a_failed_copy_leaves_nothing_behind() {
        let base = scratch("example-limits");
        let deep = an_example(&base.join("deep"));
        for n in 0..=EXAMPLE_MAX_DIRS {
            std::fs::create_dir_all(deep.join("docs").join(format!("d{n}"))).unwrap();
        }
        assert_eq!(example(&deep), None, "folders are counted, not only files");

        // A copy that cannot be finished (a name of the example is taken by a folder of that name, made between the
        // look and the copy) fails, and what it wrote is gone: the same folder takes the next try.
        let from = an_example(&base.join("ok"));
        let empty = base.join("target");
        std::fs::create_dir(&empty).unwrap();
        let files = example_files(&from).unwrap();
        let blocked = empty.join(files.last().unwrap());
        std::fs::create_dir_all(&blocked).unwrap();
        assert_eq!(
            copy_files(&from, &empty, &files).unwrap_err().code,
            "not_writable"
        );
        std::fs::remove_dir_all(&empty).unwrap();
        std::fs::create_dir(&empty).unwrap();
        assert_eq!(copy_example(&from, &empty), Ok(5));
        // And a folder that is not there yet is made for the copy.
        let gone = base.join("gone");
        let no_source = base.join("ok2");
        std::fs::create_dir_all(&no_source).unwrap();
        std::fs::write(no_source.join("tasks-vault.json"), "{}").unwrap();
        std::fs::create_dir_all(no_source.join("a")).unwrap();
        std::fs::write(no_source.join("a").join("t.md"), "x").unwrap();
        assert_eq!(copy_example(&no_source, &gone), Ok(2));
        assert!(gone.join("a").join("t.md").is_file());
    }

    #[test]
    fn what_is_no_example_is_not_offered_and_not_copied() {
        let base = scratch("no-example");
        let from = an_example(&base);
        // Without the marker file it is some folder, not a vault to hand out.
        std::fs::remove_file(from.join("tasks-vault.json")).unwrap();
        assert_eq!(example(&from), None);
        let target = base.join("target");
        assert_eq!(copy_example(&from, &target).unwrap_err().code, "no_example");
        assert!(!target.exists(), "nothing was made");
        assert_eq!(example(&base.join("nowhere")), None);
        // A marker and no area: nothing to show.
        let bare = base.join("bare");
        std::fs::create_dir_all(&bare).unwrap();
        std::fs::write(bare.join("tasks-vault.json"), "{}").unwrap();
        assert_eq!(example(&bare), None);
        // Larger than an example is: not offered (the hub copies no tree it does not know the size of).
        let big = an_example(&base.join("big"));
        for n in 0..=EXAMPLE_MAX_FILES {
            std::fs::write(big.join("docs").join(format!("f{n}.md")), "x").unwrap();
        }
        assert_eq!(example(&big), None);
        assert_eq!(
            copy_example(&big, &base.join("big-target"))
                .unwrap_err()
                .code,
            "no_example"
        );
    }

    #[test]
    fn a_new_folder_gets_the_structure_the_engine_looks_for() {
        let base = scratch("new");
        let vault = base.join("v");
        create(&vault, "alpha.nvim").unwrap();
        assert!(vault.join("alpha.nvim/ROADMAP/tasks").is_dir());
    }

    #[test]
    fn an_empty_folder_is_taken_a_full_one_is_not() {
        let base = scratch("full");
        let empty = base.join("empty");
        std::fs::create_dir(&empty).unwrap();
        create(&empty, "a").unwrap();
        let full = base.join("full");
        std::fs::create_dir(&full).unwrap();
        std::fs::write(full.join("x.md"), "x").unwrap();
        assert_eq!(create(&full, "a").unwrap_err().code, "not_empty");
        assert!(!full.join("a").exists());
        let file = base.join("file");
        std::fs::write(&file, "x").unwrap();
        assert_eq!(create(&file, "a").unwrap_err().code, "exists");
    }

    #[test]
    fn the_folder_an_earlier_try_made_is_taken_again_but_nothing_else_that_is_there() {
        let base = scratch("again");
        let vault = base.join("v");
        create(&vault, "a").unwrap();
        // The same area again: the second step of the page may have been refused, and the person tries once more.
        create(&vault, "a").unwrap();
        // Another area, or a task in it, is something that is there.
        assert_eq!(create(&vault, "b").unwrap_err().code, "not_empty");
        std::fs::write(vault.join("a/ROADMAP/tasks/t.md"), "x").unwrap();
        assert_eq!(create(&vault, "a").unwrap_err().code, "not_empty");
    }

    #[test]
    fn paths_and_areas_that_are_not_plain_are_refused() {
        let base = scratch("bad");
        assert_eq!(
            create(Path::new("relative/v"), "a").unwrap_err().code,
            "bad_path"
        );
        assert_eq!(
            create(&base.join("..").join("v"), "a").unwrap_err().code,
            "bad_path"
        );
        assert_eq!(
            create(&base.join("no").join("v"), "a").unwrap_err().code,
            "no_parent"
        );
        for area in ["", "..", "a/b", "a\\b", ".hidden"] {
            assert_eq!(
                create(&base.join("v"), area).unwrap_err().code,
                "bad_area",
                "{area:?}"
            );
        }
        assert!(!base.join("v").exists());
    }
}
