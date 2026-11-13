//! The tasks hub as a paired device of the testing hub (`tasks-hub testing link`), so a phone of tasks can start the
//! test sheets of a task on the PC through the hub it already knows (decided 2026-11-13: through the tasks hub, not a
//! second pairing of the phone).
//!
//! The tasks hub never reads a secret of the testing hub (hub-desktop concept: a hub reads no secret of another app).
//! It pairs like a phone does, once, with a one-time link the person makes with `testing-hub phone pair --tunnel`, and
//! keeps two keys of its own in its settings folder (`testing-link-keys.json`, secret like `push-key.json`): one signs
//! its logins, the other confirms a trigger. It confirms a run at the testing hub only for a request a phone confirmed
//! at the tasks hub (the guard checks the phone's confirmation before the route runs), one confirmation for one run.
//! What the testing hub then allows is its own: the level of this device there (`testing-hub phone level <id>
//! trigger`).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use appkit_mobile::link::{self, AppRoutes, Limits, Link, LinkError, SignError, Signer};
use appkit_mobile::state::{Paired, StateFile};
use appkit_mobile::way::parse_pair_link;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

/// The pairing with the testing hub (where it is, the device id it gave), in the settings folder.
pub const LINK_FILE: &str = "testing-link.json";
/// The two keys of that pairing, secret.
pub const KEYS_FILE: &str = "testing-link-keys.json";
/// The name the testing hub lists this device by.
pub const DEVICE_NAME: &str = "tasks-hub";

/// The hub this one is paired with and the routes it asks there. [`Target::testing`] in the hub; a test points it at
/// another hub of the kit.
#[derive(Debug, Clone)]
pub struct Target {
    /// What the hub's `hello` calls the app, and the namespace of its routes.
    pub routes: AppRoutes,
    /// The sheets that name a task (`?task=` is added).
    pub sheets_path: String,
    /// Where the run stands.
    pub run_path: String,
    /// Start the sheets of a task (`trigger`).
    pub start_path: String,
}

impl Target {
    /// The testing hub (`testing-desktop/docs/USAGE.md`, "A run through testing.nvim").
    #[must_use]
    pub fn testing() -> Self {
        Self {
            routes: AppRoutes::new("testing-desktop", "testing"),
            sheets_path: "/api/testing/run/task-sheets".to_owned(),
            run_path: "/api/testing/run".to_owned(),
            start_path: "/api/testing/run/task".to_owned(),
        }
    }
}

/// A key of this hub, kept in the settings folder.
struct KeySigner(p256::ecdsa::SigningKey);

impl Signer for KeySigner {
    fn public_key(&self) -> link::BoxFuture<'_, Result<String, SignError>> {
        let key = appkit_mobile::hex(self.0.verifying_key().to_sec1_point(false).as_bytes());
        Box::pin(async move { Ok(key) })
    }

    fn sign<'a>(&'a self, message: &'a [u8]) -> link::BoxFuture<'a, Result<String, SignError>> {
        use p256::ecdsa::signature::Signer as _;
        let signature: p256::ecdsa::Signature = self.0.sign(message);
        Box::pin(async move { Ok(appkit_mobile::hex(&signature.to_bytes())) })
    }
}

fn new_key() -> Result<p256::ecdsa::SigningKey, String> {
    for _ in 0..16 {
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes).map_err(|e| format!("no random source: {e}"))?;
        if let Ok(key) = p256::ecdsa::SigningKey::from_slice(&bytes) {
            return Ok(key);
        }
    }
    Err("no key could be made".to_owned())
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct KeysFile {
    schema: u32,
    key: String,
    confirm: String,
}

fn hex_key(key: &p256::ecdsa::SigningKey) -> String {
    appkit_mobile::hex(&key.to_bytes())
}

fn key_of(text: &str) -> Option<p256::ecdsa::SigningKey> {
    if !appkit_mobile::is_hex(text, 32) {
        return None;
    }
    let bytes: Vec<u8> = (0..64)
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).ok())
        .collect::<Option<_>>()?;
    p256::ecdsa::SigningKey::from_slice(&bytes).ok()
}

fn read_keys(dir: &Path) -> Result<Option<(KeySigner, KeySigner)>, String> {
    let path = dir.join(KEYS_FILE);
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("{KEYS_FILE}: {e}")),
    };
    let file: KeysFile =
        serde_json::from_str(&text).map_err(|_| format!("{KEYS_FILE} cannot be read"))?;
    match (file.schema, key_of(&file.key), key_of(&file.confirm)) {
        (1, Some(key), Some(confirm)) => Ok(Some((KeySigner(key), KeySigner(confirm)))),
        _ => Err(format!("{KEYS_FILE} holds no keys")),
    }
}

/// Write `text` to `path` whole or not at all.
fn write_whole(path: &Path, text: &str) -> Result<(), String> {
    let mut temp = path.as_os_str().to_os_string();
    temp.push(".part");
    let temp = PathBuf::from(temp);
    std::fs::write(&temp, text).map_err(|e| format!("{}: {e}", temp.display()))?;
    std::fs::rename(&temp, path).map_err(|e| {
        let _ = std::fs::remove_file(&temp);
        format!("{}: {e}", path.display())
    })
}

/// The way to the testing hub as this hub keeps it: read when first asked, then kept with its session.
pub struct TestingLink {
    dir: PathBuf,
    target: Target,
    link: Mutex<Option<Arc<Link>>>,
}

impl TestingLink {
    /// The pairing with the testing hub kept in `dir`.
    #[must_use]
    pub fn new(dir: PathBuf) -> Self {
        Self::with_target(dir, Target::testing())
    }

    /// The pairing kept in `dir` with another hub of the kit (the tests).
    #[must_use]
    pub fn with_target(dir: PathBuf, target: Target) -> Self {
        Self {
            dir,
            target,
            link: Mutex::new(None),
        }
    }

    #[must_use]
    pub fn target(&self) -> &Target {
        &self.target
    }

    /// The link, or `None` when this hub is not paired with a testing hub.
    ///
    /// # Errors
    ///
    /// The files are there but cannot be read, or there is no network stack.
    pub async fn get(&self) -> Result<Option<Arc<Link>>, String> {
        let mut held = self.link.lock().await;
        if let Some(link) = held.as_ref() {
            return Ok(Some(Arc::clone(link)));
        }
        let Some(paired) = StateFile::new(self.dir.join(LINK_FILE))
            .load()
            .map_err(|e| format!("{LINK_FILE}: {e}"))?
        else {
            return Ok(None);
        };
        let Some((key, confirm)) = read_keys(&self.dir)? else {
            return Ok(None);
        };
        let link = Arc::new(open(paired, key, confirm, &self.target)?);
        *held = Some(Arc::clone(&link));
        Ok(Some(link))
    }
}

fn transport() -> Result<Arc<dyn link::Transport>, String> {
    Ok(Arc::new(appkit_mobile::net::NetTransport::new()?))
}

fn open(
    paired: Paired,
    key: KeySigner,
    confirm: KeySigner,
    target: &Target,
) -> Result<Link, String> {
    Ok(Link::new(
        transport()?,
        Arc::new(key),
        target.routes.clone(),
        paired,
        Limits::default(),
    )
    .with_confirm(Some(Arc::new(confirm))))
}

/// `tasks-hub testing link <link>`: pair this hub with the testing hub of the link (`testing-hub phone pair
/// --tunnel`), with two new keys; keep the pairing and the keys. A pairing kept before is replaced only when the testing
/// hub said yes.
///
/// # Errors
///
/// Not a pairing link of the testing hub, the testing hub refused (the code is spent or old), or the folder cannot be
/// written.
pub async fn pair(dir: &Path, text: &str) -> Result<String, String> {
    pair_with(dir, text, &Target::testing()).await
}

/// [`pair`] with another hub of the kit (the tests).
///
/// # Errors
///
/// As [`pair`].
pub async fn pair_with(dir: &Path, text: &str, target: &Target) -> Result<String, String> {
    let link = parse_pair_link(text)
        .ok_or("not a pairing link (testing-hub phone pair --tunnel prints one)")?;
    let key = new_key()?;
    let confirm = new_key()?;
    let keys = KeysFile {
        schema: 1,
        key: hex_key(&key),
        confirm: hex_key(&confirm),
    };
    let (paired, _) = link::pair(
        transport()?,
        Arc::new(KeySigner(key)),
        Some(Arc::new(KeySigner(confirm))),
        &target.routes,
        &link,
        DEVICE_NAME,
        Limits::default(),
    )
    .await
    .map_err(|e| refusal_text(&e))?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string(&keys).map_err(|e| e.to_string())?;
    write_whole(&dir.join(KEYS_FILE), &text)?;
    StateFile::new(dir.join(LINK_FILE))
        .save(&paired)
        .map_err(|e| format!("{LINK_FILE}: {e}"))?;
    Ok(format!(
        "paired with the testing hub at {} as device {} (\"{DEVICE_NAME}\").\n\
         To let phones start the test sheets of a task, raise it there: testing-hub phone level {} trigger\n\
         (a running tasks hub takes it at the next request)",
        paired.address.base(),
        paired.device,
        paired.device
    ))
}

/// `tasks-hub testing unlink`: forget the pairing and its keys here (the testing hub keeps the device until it is
/// revoked there: `testing-hub phone revoke <id>`).
///
/// # Errors
///
/// A file is there but cannot be removed.
pub fn unlink(dir: &Path) -> Result<String, String> {
    let device = StateFile::new(dir.join(LINK_FILE))
        .load()
        .ok()
        .flatten()
        .map(|p| p.device);
    StateFile::new(dir.join(LINK_FILE))
        .forget()
        .map_err(|e| format!("{LINK_FILE}: {e}"))?;
    match std::fs::remove_file(dir.join(KEYS_FILE)) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("{KEYS_FILE}: {e}")),
    }
    Ok(match device {
        Some(id) => format!(
            "forgotten here (restart a running tasks hub); revoke it at the testing hub too: testing-hub phone revoke {id}"
        ),
        None => "this hub was not paired with a testing hub".to_owned(),
    })
}

/// A refusal as one line for the console: the testing hub's code, never its words.
#[must_use]
pub fn refusal_text(error: &LinkError) -> String {
    match error {
        LinkError::Refused { status, code } => {
            format!("the testing hub refused ({status} {code})")
        }
        other => format!("the testing hub could not be reached or answered oddly ({other:?})"),
    }
}
