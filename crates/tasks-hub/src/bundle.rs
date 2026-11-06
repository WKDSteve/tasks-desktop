//! The engine the program may carry: Neovim, cut down, with tasks.nvim and lib.nvim (`tools/pack-engine.py`). A build with
//! `TASKS_HUB_ENGINE_BUNDLE` embeds it, a build without has none and looks for them on the machine as ever.
//!
//! It is unpacked once per content into the configuration folder, where the programs of the release can run from, and
//! what was set by hand (the settings, `TASKS_NVIM`, `TASKS_ENGINE_DIR`, `LIB_NVIM_DIR`) still goes first. Neovim finds
//! its runtime by where it stands; the engine process gets no `VIMRUNTIME` of the person's.

use std::fs;
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

use flate2::read::GzDecoder;

use crate::config::Env;

const MAGIC: &[u8] = b"tasks-engine-bundle-1\n";
const COMPLETE: &str = ".complete";
/// More than this in one path is no path of a bundle.
const MAX_PATH: u32 = 1024;

#[cfg(engine_bundle)]
static EMBEDDED: Option<&[u8]> = Some(include_bytes!(env!("TASKS_HUB_ENGINE_BUNDLE_FILE")));
#[cfg(not(engine_bundle))]
static EMBEDDED: Option<&[u8]> = None;

/// Where the unpacked engine stands.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Bundled {
    pub root: PathBuf,
    pub nvim: PathBuf,
    pub engine_dir: PathBuf,
    pub lib_dir: PathBuf,
}

impl Bundled {
    fn at(root: PathBuf) -> Self {
        Self {
            nvim: root.join("nvim").join("bin").join(if cfg!(windows) {
                "nvim.exe"
            } else {
                "nvim"
            }),
            engine_dir: root.join("tasks.nvim"),
            lib_dir: root.join("lib.nvim"),
            root,
        }
    }
}

/// The engine of this program, unpacked on the first question. None without one, or when it cannot be unpacked: that is
/// told once, and the hub looks on the machine as it does without one.
pub fn current(env: &Env) -> Option<&'static Bundled> {
    static UNPACKED: OnceLock<Option<Bundled>> = OnceLock::new();
    UNPACKED
        .get_or_init(|| {
            let bytes = EMBEDDED?;
            let folder = appkit_hub::instance::config_folder(env, &crate::IDENTITY).ok()?;
            match unpack(bytes, &folder.join("engine")) {
                Ok(bundled) => Some(bundled),
                Err(e) => {
                    eprintln!("note: the engine of this program could not be unpacked: {e}");
                    None
                }
            }
        })
        .as_ref()
}

/// A short name for the content: a new program with the same engine does not unpack it again.
fn name_of(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8423_2225;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}")
}

fn read_exact_vec(reader: &mut impl Read, size: usize) -> io::Result<Vec<u8>> {
    let mut out = vec![0; size];
    reader.read_exact(&mut out)?;
    Ok(out)
}

fn bad(why: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, why.to_owned())
}

/// A path of the bundle as a path below `into`: plain parts only.
fn inside(into: &Path, path: &str) -> io::Result<PathBuf> {
    let relative = Path::new(path);
    if !relative
        .components()
        .all(|c| matches!(c, Component::Normal(_)))
        || path.contains('\\')
    {
        return Err(bad("a path of the bundle leads out of it"));
    }
    Ok(into.join(relative))
}

fn extract(bytes: &[u8], into: &Path) -> io::Result<()> {
    let mut gz = GzDecoder::new(bytes);
    if read_exact_vec(&mut gz, MAGIC.len())? != MAGIC {
        return Err(bad("this is not a bundle of the engine"));
    }
    loop {
        let mut size = [0u8; 4];
        match gz.read_exact(&mut size) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(()),
            Err(e) => return Err(e),
        }
        let size = u32::from_le_bytes(size);
        if size == 0 || size > MAX_PATH {
            return Err(bad("a path of the bundle is too long"));
        }
        let path = read_exact_vec(&mut gz, size as usize)?;
        let path = String::from_utf8(path).map_err(|_| bad("a path of the bundle is no text"))?;
        let target = inside(into, &path)?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut length = [0u8; 8];
        gz.read_exact(&mut length)?;
        let length = u64::from_le_bytes(length);
        let mut file = fs::File::create(&target)?;
        let copied = io::copy(&mut (&mut gz).take(length), &mut file)?;
        if copied != length {
            return Err(bad("the bundle ends too early"));
        }
    }
}

/// Unpack `bytes` below `folder`, under a name of its content: all of it or nothing, and earlier ones go.
fn unpack(bytes: &[u8], folder: &Path) -> io::Result<Bundled> {
    let name = name_of(bytes);
    let target = folder.join(&name);
    if target.join(COMPLETE).is_file() {
        return Ok(Bundled::at(target));
    }
    fs::create_dir_all(folder)?;
    let making = folder.join(format!("{name}.{}.tmp", std::process::id()));
    let _ = fs::remove_dir_all(&making);
    let result = extract(bytes, &making)
        .and_then(|()| fs::write(making.join(COMPLETE), b""))
        .and_then(|()| fs::rename(&making, &target));
    if let Err(e) = result {
        let _ = fs::remove_dir_all(&making);
        // Another hub that started at the same moment was first.
        if target.join(COMPLETE).is_file() {
            return Ok(Bundled::at(target));
        }
        return Err(e);
    }
    // The ones of earlier programs; one that is running keeps its files open and simply stays until next time.
    if let Ok(entries) = fs::read_dir(folder) {
        for entry in entries.flatten() {
            if entry.file_name() != name.as_str() {
                let _ = fs::remove_dir_all(entry.path());
            }
        }
    }
    Ok(Bundled::at(target))
}

/// A full Neovim for the person to read a file in: the one of the bundle has no runtime to edit with. Only when `nvim`
/// is that one is another looked for on `PATH`.
#[must_use]
pub fn editor_nvim(nvim: PathBuf, env: &Env) -> Option<PathBuf> {
    match current(env) {
        Some(bundled) if nvim.starts_with(&bundled.root) => on_path(env),
        _ => Some(nvim),
    }
}

fn on_path(env: &Env) -> Option<PathBuf> {
    let path = env.get("PATH")?;
    let name = if cfg!(windows) { "nvim.exe" } else { "nvim" };
    std::env::split_paths(path)
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;

    fn entry(out: &mut Vec<u8>, path: &str, data: &[u8]) {
        out.extend_from_slice(&u32::try_from(path.len()).unwrap().to_le_bytes());
        out.extend_from_slice(path.as_bytes());
        out.extend_from_slice(&(data.len() as u64).to_le_bytes());
        out.extend_from_slice(data);
    }

    fn packed(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut body = MAGIC.to_vec();
        for (path, data) in entries {
            entry(&mut body, path, data);
        }
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        gz.write_all(&body).unwrap();
        gz.finish().unwrap()
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tasks-bundle-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn a_bundle_is_unpacked_once_and_an_earlier_one_goes() {
        let folder = scratch("once");
        let first = packed(&[("tasks.nvim/scripts/tasks.lua", b"one")]);
        let done = unpack(&first, &folder).unwrap();
        let script = done.engine_dir.join("scripts").join("tasks.lua");
        assert_eq!(fs::read(&script).unwrap(), b"one");
        // Not again: what is there stays as it is.
        fs::write(&script, b"touched").unwrap();
        assert_eq!(unpack(&first, &folder).unwrap(), done);
        assert_eq!(fs::read(&script).unwrap(), b"touched");

        let second = packed(&[("tasks.nvim/scripts/tasks.lua", b"two")]);
        let next = unpack(&second, &folder).unwrap();
        assert_ne!(next.root, done.root);
        assert!(!done.root.exists(), "the earlier one goes");
        assert_eq!(fs::read_dir(&folder).unwrap().count(), 1);
        let _ = fs::remove_dir_all(&folder);
    }

    #[test]
    fn a_bundle_that_is_broken_leaves_nothing_behind() {
        let folder = scratch("broken");
        for bytes in [
            packed(&[("../out.txt", b"x")]),
            packed(&[("a\\b.txt", b"x")]),
            packed(&[("C:/x.txt", b"x")]),
            b"not a bundle at all".to_vec(),
        ] {
            assert!(unpack(&bytes, &folder).is_err());
        }
        let good = packed(&[("a.txt", b"12345")]);
        let mut gz = GzDecoder::new(good.as_slice());
        let mut plain = Vec::new();
        gz.read_to_end(&mut plain).unwrap();
        plain.truncate(plain.len() - 2);
        let mut cut = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        cut.write_all(&plain).unwrap();
        assert!(unpack(&cut.finish().unwrap(), &folder).is_err());
        let left = fs::read_dir(&folder).map_or(0, Iterator::count);
        assert_eq!(left, 0, "nothing half-done stays");
        assert!(!scratch("broken").with_file_name("out.txt").exists());
        let _ = fs::remove_dir_all(&folder);
    }
}
