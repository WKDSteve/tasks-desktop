//! The image of a repo tile: a logo, an icon or the first picture of the README, read the safe way.
//!
//! The hub reads only what [`CANDIDATES`] names, in that order, and never lists a folder: `logo.*` and `icon.*` in the
//! root, then in `assets/`, `docs/` and `.github/`, then `favicon.*`, last the first image the README names (a path
//! relative to the repo, without `..`, without a scheme; only the first 64 KiB of the README are read). A candidate is
//! taken only when it is a regular file (no link), no larger than [`MAX_IMAGE_BYTES`] (looked at before and while
//! reading), whose real path lies under the real path of the repo, and whose first bytes are what its extension says
//! (PNG, JPEG, WebP; an SVG is text with `<svg` and no `<script`). The page shows it only as `<img>`.

use std::io::Read as _;
use std::path::{Component, Path, PathBuf};

/// The largest image that is read.
pub const MAX_IMAGE_BYTES: u64 = 512 * 1024;
/// How much of the README is read for its first image.
pub const MAX_README_BYTES: u64 = 64 * 1024;
/// The extensions an image may have, in the order they are tried for a name.
pub const EXTENSIONS: [&str; 5] = ["svg", "png", "webp", "jpg", "jpeg"];

/// The places looked at, in order, before the README: a folder ("" is the root) and a file name without extension.
pub const CANDIDATES: [(&str, &str); 9] = [
    ("", "logo"),
    ("", "icon"),
    ("assets", "logo"),
    ("assets", "icon"),
    ("docs", "logo"),
    ("docs", "icon"),
    (".github", "logo"),
    (".github", "icon"),
    ("", "favicon"),
];

/// An image read: its bytes and the type it is sent with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Image {
    pub bytes: Vec<u8>,
    pub content_type: &'static str,
}

/// The type of an image by its extension, when the hub takes that extension.
fn content_type_of(ext: &str) -> Option<&'static str> {
    match ext.to_ascii_lowercase().as_str() {
        "svg" => Some("image/svg+xml"),
        "png" => Some("image/png"),
        "webp" => Some("image/webp"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        _ => None,
    }
}

/// Whether the first bytes are what the type says. An SVG is text that holds `<svg` and no `<script` (an SVG is code: a
/// script in it is refused even though the page shows it only as an image).
fn looks_like(content_type: &str, bytes: &[u8]) -> bool {
    match content_type {
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "image/webp" => bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        "image/svg+xml" => {
            let Ok(text) = std::str::from_utf8(bytes) else {
                return false;
            };
            let lower = text.to_ascii_lowercase();
            lower.contains("<svg") && !lower.contains("<script")
        }
        _ => false,
    }
}

/// Read the file at `rel` under `root` if it passes every check, else `None`.
#[must_use]
pub fn read(root: &Path, rel: &Path) -> Option<Image> {
    // Only plain names below the root: no `..`, no root, no drive.
    if rel.components().any(|c| !matches!(c, Component::Normal(_))) {
        return None;
    }
    let ext = rel.extension()?.to_str()?;
    let content_type = content_type_of(ext)?;
    let path = root.join(rel);
    let meta = std::fs::symlink_metadata(&path).ok()?;
    if !meta.is_file() || meta.len() > MAX_IMAGE_BYTES {
        return None;
    }
    // The real path lies under the real path of the repo (a folder on the way that is a link leads nowhere else).
    let real_root = std::fs::canonicalize(root).ok()?;
    let real = std::fs::canonicalize(&path).ok()?;
    if !real.starts_with(&real_root) {
        return None;
    }
    let mut bytes = Vec::new();
    std::fs::File::open(&real)
        .ok()?
        .take(MAX_IMAGE_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if u64::try_from(bytes.len()).ok()? > MAX_IMAGE_BYTES {
        return None;
    }
    looks_like(content_type, &bytes[..bytes.len().min(4096)]).then_some(Image {
        bytes,
        content_type,
    })
}

/// The first image the README names, as a path relative to the repo: `![...](path)` or `<img src="path">`, only a
/// plain relative path (no scheme, no `/` at the start, no `..`, no query), only from the first [`MAX_README_BYTES`].
#[must_use]
pub fn readme_image(root: &Path) -> Option<PathBuf> {
    let path = root.join("README.md");
    let meta = std::fs::symlink_metadata(&path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let mut bytes = Vec::new();
    std::fs::File::open(&path)
        .ok()?
        .take(MAX_README_BYTES)
        .read_to_end(&mut bytes)
        .ok()?;
    let text = String::from_utf8_lossy(&bytes);
    let target = first_image_target(&text)?;
    let plain = !target.contains(':')
        && !target.starts_with('/')
        && !target.starts_with('\\')
        && !target.contains('?')
        && !target.contains('#')
        && !target.split(['/', '\\']).any(|part| part == "..");
    plain.then(|| PathBuf::from(target.trim_start_matches("./")))
}

/// The target of the first image of a Markdown text: `![alt](target "title")` or `<img ... src="target">`, whichever
/// comes first.
fn first_image_target(text: &str) -> Option<String> {
    let md = text.find("![").and_then(|at| {
        let rest = &text[at..];
        let open = rest.find("](")?;
        let close = rest[open + 2..].find(')')?;
        let inner = rest[open + 2..open + 2 + close].trim();
        Some((
            at,
            inner
                .split_whitespace()
                .next()
                .unwrap_or_default()
                .to_owned(),
        ))
    });
    let lower = text.to_ascii_lowercase();
    let html = lower.find("<img").and_then(|at| {
        let tag_end = lower[at..].find('>')? + at;
        let tag = &text[at..tag_end];
        let src = tag.to_ascii_lowercase().find("src=")?;
        let value = &tag[src + 4..];
        let quote = value.chars().next()?;
        let value = if quote == '"' || quote == '\'' {
            &value[1..]
        } else {
            value
        };
        let end = value
            .find(|c: char| c == quote || c.is_whitespace() || c == '>')
            .unwrap_or(value.len());
        Some((at, value[..end].to_owned()))
    });
    match (md, html) {
        (Some(a), Some(b)) => Some(if a.0 <= b.0 { a.1 } else { b.1 }),
        (Some(a), None) => Some(a.1),
        (None, Some(b)) => Some(b.1),
        (None, None) => None,
    }
    .filter(|t| !t.is_empty())
}

/// The image of a repo: the first candidate of [`CANDIDATES`] (each name with each of [`EXTENSIONS`]) that passes
/// [`read`], else the first image of the README that passes it.
#[must_use]
pub fn image(root: &Path) -> Option<Image> {
    for (dir, name) in CANDIDATES {
        for ext in EXTENSIONS {
            let rel = if dir.is_empty() {
                PathBuf::from(format!("{name}.{ext}"))
            } else {
                Path::new(dir).join(format!("{name}.{ext}"))
            };
            if let Some(found) = read(root, &rel) {
                return Some(found);
            }
        }
    }
    readme_image(root).and_then(|rel| read(root, &rel))
}

#[cfg(test)]
mod tests {
    use super::*;
    use hub_testkit::scratch::Scratch;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";
    const SVG: &str = r#"<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>"#;

    fn put(root: &Path, rel: &str, bytes: &[u8]) {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }

    #[test]
    fn the_candidates_are_tried_in_their_order_and_a_file_is_taken_by_what_it_is() {
        let repo = Scratch::new("img-order");
        assert_eq!(image(&repo), None);
        put(&repo, "docs/icon.png", PNG);
        assert_eq!(image(&repo).unwrap().content_type, "image/png");
        put(&repo, "assets/logo.svg", SVG.as_bytes());
        assert_eq!(image(&repo).unwrap().content_type, "image/svg+xml");
        put(&repo, "logo.webp", b"RIFF\0\0\0\0WEBPVP8 ");
        assert_eq!(image(&repo).unwrap().content_type, "image/webp");
    }

    #[test]
    fn a_file_whose_extension_lies_or_an_svg_with_a_script_is_no_image() {
        let repo = Scratch::new("img-lies");
        put(&repo, "logo.png", b"not a png at all");
        assert_eq!(image(&repo), None);
        put(
            &repo,
            "icon.svg",
            br#"<svg><script>alert(1)</script></svg>"#,
        );
        assert_eq!(image(&repo), None);
        put(&repo, "favicon.jpg", &[0xff, 0xd8, 0xff, 0xe0]);
        assert_eq!(image(&repo).unwrap().content_type, "image/jpeg");
    }

    #[test]
    fn a_file_over_the_limit_is_not_read() {
        let repo = Scratch::new("img-large");
        let mut big = PNG.to_vec();
        big.resize(usize::try_from(MAX_IMAGE_BYTES).unwrap() + 1, 0);
        put(&repo, "logo.png", &big);
        assert_eq!(image(&repo), None);
        big.truncate(usize::try_from(MAX_IMAGE_BYTES).unwrap());
        put(&repo, "logo.png", &big);
        assert!(image(&repo).is_some());
    }

    #[test]
    fn the_readme_gives_its_first_image_only_as_a_plain_relative_path_in_the_repo() {
        let repo = Scratch::new("img-readme");
        put(&repo, "art/brand.png", PNG);
        put(
            &repo,
            "README.md",
            b"# Name\n\n![brand](./art/brand.png \"The brand\")\n\n![second](other.png)\n",
        );
        assert_eq!(readme_image(&repo), Some(PathBuf::from("art/brand.png")));
        assert_eq!(image(&repo).unwrap().content_type, "image/png");
        put(
            &repo,
            "README.md",
            br#"<p><img alt="x" src='art/brand.png' width=40></p>"#,
        );
        assert_eq!(readme_image(&repo), Some(PathBuf::from("art/brand.png")));
        for refused in [
            "![x](https://example.com/logo.png)",
            "![x](../outside.png)",
            "![x](art/../../outside.png)",
            "![x](/etc/logo.png)",
            "![x](C:/logo.png)",
            "![x](art/brand.png?raw=1)",
        ] {
            put(&repo, "README.md", refused.as_bytes());
            assert_eq!(readme_image(&repo), None, "{refused}");
        }
        // Only the first 64 KiB are read.
        let mut long = vec![b'x'; usize::try_from(MAX_README_BYTES).unwrap()];
        long.extend_from_slice(b"\n![late](art/brand.png)\n");
        put(&repo, "README.md", &long);
        assert_eq!(readme_image(&repo), None);
    }

    #[test]
    fn a_path_that_leaves_the_repo_is_not_read() {
        let repo = Scratch::new("img-escape");
        let outside = Scratch::new("img-outside");
        put(&outside, "logo.png", PNG);
        assert_eq!(read(&repo, Path::new("../img-outside/logo.png")), None);
        // A link (where the system lets a test make one) is neither followed nor read.
        #[cfg(unix)]
        let linked =
            std::os::unix::fs::symlink(outside.join("logo.png"), repo.join("logo.png")).is_ok();
        #[cfg(windows)]
        let linked =
            std::os::windows::fs::symlink_file(outside.join("logo.png"), repo.join("logo.png"))
                .is_ok();
        if linked {
            assert_eq!(image(&repo), None);
        }
    }
}
