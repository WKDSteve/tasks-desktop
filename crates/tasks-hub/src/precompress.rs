//! The compressed versions of the phone page's files, made ahead of time by `build.rs`. The hub never compresses per
//! request; it answers with the version made here to a request that accepts it (`appkit_hub::Pages::encoded`), and
//! with the plain file otherwise.
//!
//! Only gzip: the workspace has a gzip encoder already (`flate2`), and Brotli would be a new dependency for a gain of a
//! few kB on the first start of the phone page (the service worker keeps its files after that).
//!
//! This file is also compiled into `build.rs` (`#[path]`), so it uses nothing but `std` and `flate2`.

use std::io::Write as _;

/// Whether a file of this type is worth compressing: text. Pictures and fonts are compressed in their own format.
#[must_use]
pub fn compressible(content_type: &str) -> bool {
    content_type.starts_with("text/")
        || content_type.starts_with("application/json")
        || content_type.starts_with("application/manifest+json")
        || content_type.starts_with("image/svg+xml")
}

/// The file compressed with gzip, at the best level, when that makes it smaller; `None` otherwise. The same bytes give
/// the same result (no time or name in the header), so a build with the same interface embeds the same files.
#[must_use]
pub fn gzip(bytes: &[u8]) -> Option<Vec<u8>> {
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());
    encoder.write_all(bytes).ok()?;
    let packed = encoder.finish().ok()?;
    (packed.len() < bytes.len()).then_some(packed)
}
