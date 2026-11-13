//! Web Push to the paired phones (tasks-mobile `docs/HUB.md` section 5): a job of the runtime of a vault looks at each
//! new snapshot, asks `Notices` what it gives once, and sends a notice only to a phone that subscribed to its kind, and
//! only for a task whose area is `public` or `internal` (nothing at all for a private or unclassified one, not even
//! without its id). The notice carries the kind and the id; the phone reads the rest over its paired way (PWA-06).

use super::*;

use appkit_hub::push::Push;
use appkit_hub::DataClass;

use crate::notices::{Notices, DECISION, REMIND};

/// What a hub needs to tell phones: the push (its key, the subscriptions, the way out) and what it told.
#[derive(Clone)]
pub struct HubPush {
    pub push: Arc<Push>,
    pub notices: Arc<Notices>,
}

/// How often the job looks without a change of the vault: a reminder's day comes without one.
pub(super) const LOOK_EVERY: Duration = Duration::from_secs(5 * 60);

/// The class a notice goes out with.
pub(super) fn data_class(shown: Shown) -> DataClass {
    match shown {
        Shown::Public => DataClass::Public,
        Shown::Internal => DataClass::Internal,
        Shown::Private => DataClass::Private,
        Shown::Unclassified => DataClass::Unclassified,
    }
}

/// Follow the snapshots of one vault and tell the phones. Ends with the runtime (the job is aborted with it).
pub(super) fn spawn_notices(
    parts: HubPush,
    engine: Arc<dyn Engine>,
    store: Arc<SnapshotStore>,
    classes: Arc<AreaPolicy>,
    vault: String,
) -> JoinHandle<()> {
    let mut changes = store.subscribe_quiet();
    tokio::spawn(async move {
        // What was told is kept per vault, by its one name: the same folder by another spelling is the same vault.
        let vault = {
            let path = vault.clone();
            tokio::task::spawn_blocking(move || std::fs::canonicalize(&path).ok())
                .await
                .ok()
                .flatten()
                .map_or(vault, |p| p.display().to_string())
        };
        let mut tick = tokio::time::interval(LOOK_EVERY);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                change = changes.recv() => {
                    if matches!(change, Err(tokio::sync::broadcast::error::RecvError::Closed)) {
                        return;
                    }
                }
                _ = tick.tick() => {}
            }
            look(&parts, engine.as_ref(), &store, &classes, &vault).await;
        }
    })
}

/// How long the notices of one look may take to go out, together: each push service gets `SEND_TIMEOUT`, the phones of
/// one notice are told one after the other (appkit `Push::notify`), the notices of one look side by side.
pub(super) const SEND_DEADLINE: Duration = Duration::from_secs(45);

/// One look. While no phone waits for a notice the snapshot is not even read (nobody else makes the engine scan, and
/// a parse of a large vault is not free): the decisions are forgotten, so a phone that subscribes later is not told
/// the past. Otherwise a fresh snapshot, the notices it gives (parsed and kept off the async workers), and the ones
/// that go out, side by side within one deadline. A notice that reached no phone is taken back, to be told again.
pub(super) async fn look(
    parts: &HubPush,
    engine: &dyn Engine,
    store: &SnapshotStore,
    classes: &Arc<AreaPolicy>,
    vault: &str,
) {
    let wanted = parts.push.has_subscribers(DECISION) || parts.push.has_subscribers(REMIND);
    if !wanted {
        let notices = Arc::clone(&parts.notices);
        let vault = vault.to_owned();
        let _ = tokio::task::spawn_blocking(move || notices.forget_decisions(&vault)).await;
        return;
    }
    let Ok(cached) = store.current().await else {
        return;
    };
    // The day and the time of day are the engine's (`hello.today`, `hello.time`: the person's, asked each time, the
    // snapshot is held across midnight); an engine that does not say them reminds of nothing.
    let now = if parts.push.has_subscribers(REMIND) {
        engine_now(engine).await
    } else {
        None
    };
    let notices = Arc::clone(&parts.notices);
    let owned = vault.to_owned();
    let policy = Arc::clone(classes);
    let found = tokio::task::spawn_blocking(move || {
        let doc = serde_json::from_slice::<serde_json::Value>(&cached.text).ok()?;
        let released = |area: &str| data_class(policy.shown(area)).released_for_device();
        let now = now
            .as_ref()
            .map(|(day, time)| (day.as_str(), time.as_str()));
        Some(notices.observe(&owned, &doc, now, &released))
    })
    .await
    .ok()
    .flatten()
    .unwrap_or_default();

    let mut sending = tokio::task::JoinSet::new();
    let mut pending = Vec::new();
    for notice in found {
        if !parts.push.has_subscribers(notice.kind) {
            continue;
        }
        // A decision names its task, and only of a released area; the reminder of a day names none (its areas were
        // weighed when it was found).
        let item = match &notice.id {
            Some(id) => {
                let class = data_class(classes.shown(&notice.area));
                if !class.released_for_device() {
                    continue;
                }
                Some((id.clone(), class))
            }
            None => None,
        };
        let push = Arc::clone(&parts.push);
        let n = notice.clone();
        sending.spawn(async move {
            let item = item.as_ref().map(|(id, class)| (id.as_str(), *class));
            let sent = push.notify(n.kind, item, false).await;
            (n, sent)
        });
        pending.push(notice);
    }
    let deadline = tokio::time::sleep(SEND_DEADLINE);
    tokio::pin!(deadline);
    let mut unsent = Vec::new();
    loop {
        tokio::select! {
            joined = sending.join_next() => match joined {
                None => break,
                Some(Ok((notice, sent))) => {
                    pending.retain(|p| *p != notice);
                    // Refused or unanswered by every push service, taken by none: not told.
                    if sent.delivered == 0 && sent.failed > 0 {
                        unsent.push(notice);
                    }
                }
                // A send that ended without an answer stays pending: not told.
                Some(Err(_)) => {}
            },
            () = &mut deadline => {
                sending.abort_all();
                break;
            }
        }
    }
    // What did not end in time is not known to have arrived: told again on the next look (a phone may then see it
    // twice, rather than never).
    unsent.extend(pending);
    if !unsent.is_empty() {
        let notices = Arc::clone(&parts.notices);
        let vault = vault.to_owned();
        let _ = tokio::task::spawn_blocking(move || notices.unsent(&vault, &unsent)).await;
    }
}

/// The day and the time of day of the engine (`today`, YYYY-MM-DD, and `time`, HH:MM, of `tasks.hello`), if it says
/// both.
pub(super) async fn engine_now(engine: &dyn Engine) -> Option<(String, String)> {
    let reply = engine.call(crate::engine::Calls::Hello, None).await.ok()?;
    let doc: serde_json::Value = serde_json::from_str(&reply.text).ok()?;
    let day = doc["today"].as_str()?;
    let time = doc["time"].as_str()?;
    let plain = day.len() == 10
        && day.bytes().enumerate().all(|(i, b)| {
            if i == 4 || i == 7 {
                b == b'-'
            } else {
                b.is_ascii_digit()
            }
        });
    (plain && crate::notices::valid_time(time)).then(|| (day.to_owned(), time.to_owned()))
}
