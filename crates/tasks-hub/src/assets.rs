//! The image files of a container (task, plan, project, learning path, meeting) below the `assets/` of its folder,
//! as the page draws them in a text, as an icon, a cover or a badge (concept "Lernplan" 11.3, E12).
//!
//! Only a file the container's folder holds is read: the address is a plain relative path below `assets/` (no `..`,
//! no root, no drive, no backslash), its kind is on the allow-list, and once every link is followed the file still
//! lies below `assets/` of that folder, and the folder below the vault. A file larger than its limit is refused. An
//! SVG is handed on as it is: the page draws it only as `<img>` (which runs nothing), and the route seals it
//! (`nosniff`, a CSP with `sandbox`) for the case it is opened on its own.

use std::path::{Path, PathBuf};

/// The largest picture handed on.
pub const MAX_RASTER_BYTES: u64 = 20 * 1024 * 1024;
/// The largest drawing handed on.
pub const MAX_SVG_BYTES: u64 = 2 * 1024 * 1024;

/// What holds the assets: the kind of the file and, with it, its folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Owner {
    Task,
    Plan,
    Project,
    Path,
    Meeting,
}

impl Owner {
    /// The word of the query (`kind=`).
    #[must_use]
    pub fn from_word(word: &str) -> Option<Self> {
        Some(match word {
            "task" => Self::Task,
            "plan" => Self::Plan,
            "project" => Self::Project,
            "path" => Self::Path,
            "meeting" => Self::Meeting,
            _ => return None,
        })
    }

    /// The file of a plan or a project in its folder form, relative to the vault (the engine's layout:
    /// `<area>/ROADMAP/plans/<slug>/<slug>.md`). Tasks, paths and meetings are named by the engine.
    #[must_use]
    pub fn folder_file(self, area: &str, slug: &str) -> Option<String> {
        let dir = match self {
            Self::Plan => "plans",
            Self::Project => "projects",
            _ => return None,
        };
        Some(format!("{area}/ROADMAP/{dir}/{slug}/{slug}.md"))
    }
}

/// The media type of an image asset by its kind; `None`: not an image the page may draw.
#[must_use]
pub fn content_type(file: &str) -> Option<&'static str> {
    let ext = file.rsplit_once('.')?.1.to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        _ => return None,
    })
}

/// Why an asset is not handed on.
#[derive(Debug, PartialEq, Eq)]
pub enum Refusal {
    /// The address is no plain path below `assets/`, or no image kind.
    BadPath,
    /// The container is not in its folder form, or the file is not there (or not its own: a link out of it).
    Missing,
    /// The file is larger than its limit.
    TooLarge,
}

/// A plain path below `assets/`: plain parts only, an image kind.
#[must_use]
pub fn valid_asset_path(file: &str) -> bool {
    file.starts_with("assets/")
        && crate::meetings::plain_relative(file)
        && content_type(file).is_some()
}

/// The file `rel` of the container whose file is `container_file` (relative to the vault), checked: the path of the
/// file on disk and its media type.
///
/// # Errors
///
/// [`Refusal`] when the address is not plain, the file is not one of the container's own or it is too large.
pub fn resolve(
    vault: &Path,
    container_file: &str,
    rel: &str,
) -> Result<(PathBuf, &'static str), Refusal> {
    if !valid_asset_path(rel) {
        return Err(Refusal::BadPath);
    }
    let kind = content_type(rel).ok_or(Refusal::BadPath)?;
    if !crate::meetings::plain_relative(container_file) {
        return Err(Refusal::Missing);
    }
    let folder = vault
        .join(container_file)
        .parent()
        .ok_or(Refusal::Missing)?
        .to_path_buf();
    let assets = std::fs::canonicalize(folder.join("assets")).map_err(|_| Refusal::Missing)?;
    let path =
        crate::meetings::inside(vault, &folder, &folder.join(rel)).ok_or(Refusal::Missing)?;
    // `inside` holds the file to the folder; an asset holds it to `assets/` of that folder as well (a link named
    // `assets/x.png` to the container's own `.md` is no picture of it).
    if !path.starts_with(&assets) {
        return Err(Refusal::Missing);
    }
    let size = std::fs::metadata(&path)
        .map_err(|_| Refusal::Missing)?
        .len();
    let limit = if kind == "image/svg+xml" {
        MAX_SVG_BYTES
    } else {
        MAX_RASTER_BYTES
    };
    if size > limit {
        return Err(Refusal::TooLarge);
    }
    Ok((path, kind))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Dir(PathBuf);
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn vault(name: &str) -> Dir {
        let dir =
            std::env::temp_dir().join(format!("tasks-hub-assets-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let task = dir.join("a").join("ROADMAP").join("tasks").join("t");
        std::fs::create_dir_all(task.join("assets").join("images")).unwrap();
        std::fs::write(task.join("t.md"), "---\ntitle: t\n---\n").unwrap();
        std::fs::write(task.join("assets").join("images").join("x.svg"), "<svg/>").unwrap();
        std::fs::write(task.join("assets").join("p.PNG"), [137, 80, 78, 71]).unwrap();
        std::fs::write(task.join("assets").join("notes.txt"), "x").unwrap();
        std::fs::write(dir.join("a").join("secret.png"), "x").unwrap();
        Dir(dir)
    }

    const FILE: &str = "a/ROADMAP/tasks/t/t.md";

    #[test]
    fn a_file_below_assets_of_the_folder_is_handed_on_with_its_type() {
        let v = vault("ok");
        let (path, kind) = resolve(&v.0, FILE, "assets/images/x.svg").unwrap();
        assert!(path.ends_with("x.svg"));
        assert_eq!(kind, "image/svg+xml");
        assert_eq!(resolve(&v.0, FILE, "assets/p.PNG").unwrap().1, "image/png");
    }

    #[test]
    fn anything_but_a_plain_image_path_below_assets_is_refused() {
        let v = vault("bad");
        for rel in [
            "",
            "t.md",
            "assets/notes.txt",
            "assets/../t.md",
            "assets/../../../secret.png",
            "assets/./images/x.svg",
            "assets//images/x.svg",
            "/assets/p.PNG",
            "C:/x/assets/p.PNG",
            "assets\\p.PNG",
            "https://tracker.example/assets/x.png",
            "data:image/png;base64,AA",
            "assets/a.svgz",
            "assets/a.html",
        ] {
            assert_eq!(resolve(&v.0, FILE, rel), Err(Refusal::BadPath), "{rel}");
        }
    }

    #[test]
    fn a_file_that_is_not_there_or_a_container_outside_the_vault_is_missing() {
        let v = vault("missing");
        assert_eq!(
            resolve(&v.0, FILE, "assets/none.png"),
            Err(Refusal::Missing)
        );
        assert_eq!(
            resolve(&v.0, "../x/t.md", "assets/p.PNG"),
            Err(Refusal::Missing)
        );
        assert_eq!(
            resolve(&v.0, "a/ROADMAP/tasks/none/none.md", "assets/p.PNG"),
            Err(Refusal::Missing)
        );
    }

    #[test]
    fn a_link_out_of_assets_is_no_asset() {
        let v = vault("link");
        let assets =
            v.0.join("a")
                .join("ROADMAP")
                .join("tasks")
                .join("t")
                .join("assets");
        let link = assets.join("out.png");
        #[cfg(windows)]
        let made = std::os::windows::fs::symlink_file(v.0.join("a").join("secret.png"), &link);
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink(v.0.join("a").join("secret.png"), &link);
        if made.is_err() {
            println!("n/a  this account may not make links");
            return;
        }
        assert_eq!(resolve(&v.0, FILE, "assets/out.png"), Err(Refusal::Missing));
    }

    #[test]
    fn a_file_over_its_limit_is_refused() {
        let v = vault("large");
        let big =
            v.0.join("a")
                .join("ROADMAP")
                .join("tasks")
                .join("t")
                .join("assets")
                .join("big.svg");
        let file = std::fs::File::create(&big).unwrap();
        file.set_len(MAX_SVG_BYTES + 1).unwrap();
        assert_eq!(
            resolve(&v.0, FILE, "assets/big.svg"),
            Err(Refusal::TooLarge)
        );
    }

    #[test]
    fn the_kinds_and_the_folders_of_the_owners() {
        assert_eq!(Owner::from_word("path"), Some(Owner::Path));
        assert_eq!(Owner::from_word("board"), None);
        assert_eq!(
            Owner::Plan.folder_file("a", "p").as_deref(),
            Some("a/ROADMAP/plans/p/p.md")
        );
        assert_eq!(
            Owner::Project.folder_file("a", "p").as_deref(),
            Some("a/ROADMAP/projects/p/p.md")
        );
        assert_eq!(Owner::Task.folder_file("a", "p"), None);
        for (file, kind) in [
            ("a.png", Some("image/png")),
            ("a.JPG", Some("image/jpeg")),
            ("a.jpeg", Some("image/jpeg")),
            ("a.webp", Some("image/webp")),
            ("a.gif", Some("image/gif")),
            ("a.svg", Some("image/svg+xml")),
            ("a.mp4", None),
            ("a", None),
        ] {
            assert_eq!(content_type(file), kind, "{file}");
        }
    }
}
