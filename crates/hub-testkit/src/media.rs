//! The start of a file of a format, for an upload test: the hub judges the first bytes of a picture, a video or a
//! recording against its ending, so a test that attaches `a.png` sends a body that begins like a PNG.

/// A few bytes that begin like a file of the ending of `name` (anything for an ending the hub does not judge).
#[must_use]
pub fn body_for(name: &str) -> Vec<u8> {
    let ext = name
        .rsplit_once('.')
        .map_or(String::new(), |(_, e)| e.to_ascii_lowercase());
    let mut body: Vec<u8> = match ext.as_str() {
        "png" => vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a],
        "jpg" | "jpeg" => vec![0xff, 0xd8, 0xff, 0xe0],
        "gif" => b"GIF89a".to_vec(),
        "mp4" | "m4a" | "m4v" | "3gp" | "mov" => b"\0\0\0\x18ftypmp42".to_vec(),
        "webm" | "mkv" | "weba" => vec![0x1a, 0x45, 0xdf, 0xa3],
        "ogg" | "oga" | "opus" | "ogv" => b"OggS".to_vec(),
        _ => Vec::new(),
    };
    body.extend_from_slice(b" test body");
    body
}
