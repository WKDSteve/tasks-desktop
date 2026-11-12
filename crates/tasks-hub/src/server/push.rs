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

/// One look: the snapshot (a fresh one only while a phone waits for a notice: nobody else makes the engine scan),
/// the notices it gives, and the ones that go out.
pub(super) async fn look(
    parts: &HubPush,
    engine: &dyn Engine,
    store: &SnapshotStore,
    classes: &AreaPolicy,
    vault: &str,
) {
    let wanted = parts.push.has_subscribers(DECISION) || parts.push.has_subscribers(REMIND);
    let cached = if wanted {
        store.current().await.ok()
    } else {
        store.latest()
    };
    let Some(cached) = cached else {
        return;
    };
    let Ok(doc) = serde_json::from_slice::<serde_json::Value>(&cached.text) else {
        return;
    };
    // What is seen is kept as told also when nobody listens: a phone that subscribes later is not told the past. The day
    // is the engine's (`hello.today`, the person's day, asked each time: the snapshot is held across midnight); an engine
    // that does not say it reminds of nothing.
    let today = if parts.push.has_subscribers(REMIND) {
        engine_today(engine).await
    } else {
        None
    };
    for notice in parts.notices.observe(vault, &doc, today.as_deref()) {
        if !parts.push.has_subscribers(notice.kind) {
            continue;
        }
        let class = data_class(classes.shown(&notice.area));
        if !class.released_for_device() {
            continue;
        }
        parts
            .push
            .notify(notice.kind, Some((&notice.id, class)), false)
            .await;
    }
}

/// The day of the engine (`today` of `tasks.hello`, YYYY-MM-DD), if it says one.
pub(super) async fn engine_today(engine: &dyn Engine) -> Option<String> {
    let reply = engine.call(crate::engine::Calls::Hello, None).await.ok()?;
    let doc: serde_json::Value = serde_json::from_str(&reply.text).ok()?;
    let day = doc["today"].as_str()?;
    let plain = day.len() == 10
        && day.bytes().enumerate().all(|(i, b)| {
            if i == 4 || i == 7 {
                b == b'-'
            } else {
                b.is_ascii_digit()
            }
        });
    plain.then(|| day.to_owned())
}
