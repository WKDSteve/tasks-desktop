//! The job of the scheduler (`crate::schedule`) for one vault: it reads the reminders at a time of day from the
//! snapshot and the meetings of the coming days from the engine (`tasks.meetings`, when the engine has the capability
//! `meetings`), again after every change of the vault and at least every [`REFRESH_EVERY`], and looks at the clock until
//! the next notice is due (at most [`LOOK_AT_MOST`] apart). A due notice goes to the phones that subscribed to its kind
//! (Web Push: its kind and its id, nothing else, PWA-06) and, when this hub can send mail, to the addresses the meeting
//! or task names. Only for an area whose class is released for devices (`public`, `internal`): for a private or
//! unclassified one nothing goes out at all. A notice that reached nobody is handed out again on the next look while it
//! is due.

use super::*;

use crate::mail::Transport;
use crate::schedule::{self as plan, Due, Inputs, Scheduler, MEETING, MEETING_END, REMIND};

/// The longest the job sleeps between two looks at the clock (a suspended PC wakes up with a clock that jumped).
pub(super) const LOOK_AT_MOST: Duration = Duration::from_secs(60);
/// How often the reminders and meetings are read again without a change of the vault (the window of days moves).
pub(super) const REFRESH_EVERY: Duration = Duration::from_secs(5 * 60);
/// The most pages of meetings that are read (100 each).
const MAX_PAGES: u64 = 10;

/// What the job needs besides the engine and the store.
pub(super) struct ScheduleJob {
    pub(super) scheduler: Arc<Scheduler>,
    pub(super) push: Option<Arc<appkit_hub::push::Push>>,
    pub(super) mail: Option<Arc<dyn Transport>>,
    pub(super) classes: Arc<AreaPolicy>,
    /// The engine reads meetings (capability `meetings`).
    pub(super) meetings: bool,
}

impl ScheduleJob {
    fn subscribed(&self, kind: &str) -> bool {
        self.push.as_ref().is_some_and(|p| p.has_subscribers(kind))
    }

    /// Anybody to tell anything: a phone that listens for a kind of the scheduler, or a mail account.
    fn wanted(&self) -> bool {
        self.mail.is_some()
            || [MEETING, MEETING_END, REMIND]
                .iter()
                .any(|k| self.subscribed(k))
    }
}

/// Follow one vault and send its notices when they are due. Ends with the runtime (the job is aborted with it).
pub(super) fn spawn_schedule(
    job: ScheduleJob,
    engine: Arc<dyn Engine>,
    store: Arc<SnapshotStore>,
    vault: String,
) -> JoinHandle<()> {
    let mut changes = store.subscribe_quiet();
    tokio::spawn(async move {
        // The same key as `notices.json`: the same folder by another spelling is the same vault.
        let vault = {
            let path = vault.clone();
            tokio::task::spawn_blocking(move || std::fs::canonicalize(&path).ok())
                .await
                .ok()
                .flatten()
                .map_or(vault, |p| p.display().to_string())
        };
        let mut inputs = Inputs::default();
        let mut read_at: Option<tokio::time::Instant> = None;
        loop {
            if job.wanted() {
                if read_at.is_none_or(|at| at.elapsed() >= REFRESH_EVERY) {
                    if let Some(fresh) = read(&job, engine.as_ref(), &store).await {
                        inputs = fresh;
                    }
                    read_at = Some(tokio::time::Instant::now());
                }
                tell(&job, &inputs, &vault).await;
            }
            let s = &job.scheduler;
            let now = s.now();
            let wait = plan::next_after(&inputs, now, &s.zone, s.rules(&vault))
                .and_then(|next| next.duration_since(now).try_into().ok())
                .map_or(LOOK_AT_MOST, |d: Duration| d.min(LOOK_AT_MOST))
                .max(Duration::from_secs(1));
            tokio::select! {
                change = changes.recv() => {
                    if matches!(change, Err(tokio::sync::broadcast::error::RecvError::Closed)) {
                        return;
                    }
                    read_at = None;
                }
                () = tokio::time::sleep(wait) => {}
            }
        }
    })
}

/// The reminders of the snapshot and the planned meetings of the window; `None` when the snapshot cannot be read (the
/// last ones are kept). Meetings the engine does not answer are none.
async fn read(job: &ScheduleJob, engine: &dyn Engine, store: &SnapshotStore) -> Option<Inputs> {
    let cached = store.current().await.ok()?;
    let reminders = tokio::task::spawn_blocking(move || {
        serde_json::from_slice::<serde_json::Value>(&cached.text)
            .ok()
            .map(|doc| plan::reminders_of(&doc))
    })
    .await
    .ok()
    .flatten()?;
    let mut meetings = Vec::new();
    if job.meetings {
        let (since, until) = plan::window(job.scheduler.now(), &job.scheduler.zone);
        let mut offset = 0u64;
        for _ in 0..MAX_PAGES {
            let params = json!({
                "since": since.to_string(), "until": until.to_string(), "status": ["planned"],
                "limit": crate::engine::LIST_PAGE, "offset": offset,
            });
            let Ok(reply) = engine.call(Calls::Meetings, Some(&params)).await else {
                break;
            };
            let Ok(doc) = serde_json::from_str::<serde_json::Value>(&reply.text) else {
                break;
            };
            if doc["kind"] != "tasks.meetings" {
                break;
            }
            let items = doc["items"].as_array().map_or(&[][..], Vec::as_slice);
            meetings.extend(items.iter().filter_map(plan::meeting_of));
            match doc["next_offset"].as_u64() {
                Some(next) if next > offset => offset = next,
                _ => break,
            }
        }
    }
    Some(Inputs {
        meetings,
        reminders,
    })
}

/// Has `due` a way out: a phone that listens for its kind, or a mail to an address of its item.
fn reachable(job: &ScheduleJob, inputs: &Inputs, due: &Due) -> bool {
    if job.subscribed(due.kind) {
        return true;
    }
    job.mail.is_some()
        && if due.kind == REMIND {
            inputs
                .reminders
                .iter()
                .any(|r| r.id == due.id && !r.to.is_empty())
        } else {
            inputs
                .meetings
                .iter()
                .any(|m| m.id == due.id && !m.notify_to.is_empty())
        }
}

/// Send what is due now and was not sent yet. What reached nobody is taken back.
async fn tell(job: &ScheduleJob, inputs: &Inputs, vault: &str) {
    let s = &job.scheduler;
    let now = s.now();
    let due: Vec<Due> = plan::plan(inputs, now, &s.zone, s.rules(vault))
        .into_iter()
        .filter(|d| super::push::data_class(job.classes.shown(&d.area)).released_for_device())
        .filter(|d| reachable(job, inputs, d))
        .collect();
    if due.is_empty() {
        return;
    }
    let fresh = {
        let s = Arc::clone(&job.scheduler);
        let owned = vault.to_owned();
        tokio::task::spawn_blocking(move || s.memory.take(&owned, due, now))
            .await
            .unwrap_or_default()
    };
    let mut sending = tokio::task::JoinSet::new();
    let mut pending = Vec::new();
    for d in fresh {
        let shown = job.classes.shown(&d.area);
        let class = super::push::data_class(shown);
        let push = job.push.clone().filter(|p| p.has_subscribers(d.kind));
        let mails = if job.mail.is_some() {
            plan::mails(inputs, &d, &s.zone, shown, s.internal_links, s.lang)
        } else {
            Vec::new()
        };
        let mail = job.mail.clone();
        let n = d.clone();
        sending.spawn(async move {
            let mut reached = false;
            if let Some(push) = push {
                // The beginning of a meeting is urgent: a phone in doze gets it now, not at its next window.
                let sent = push
                    .notify(n.kind, Some((n.id.as_str(), class)), n.kind == MEETING)
                    .await;
                reached |= sent.delivered > 0;
            }
            if let Some(mail) = mail {
                for message in &mails {
                    match mail.send(message).await {
                        Ok(()) => reached = true,
                        Err(why) => {
                            eprintln!("note: a mail of the scheduler was not sent: {why:.200}")
                        }
                    }
                }
            }
            (n, reached)
        });
        pending.push(d);
    }
    let deadline = tokio::time::sleep(super::push::SEND_DEADLINE);
    tokio::pin!(deadline);
    let mut unsent = Vec::new();
    loop {
        tokio::select! {
            joined = sending.join_next() => match joined {
                None => break,
                Some(Ok((due, reached))) => {
                    pending.retain(|p| *p != due);
                    if !reached {
                        unsent.push(due);
                    }
                }
                Some(Err(_)) => {}
            },
            () = &mut deadline => {
                sending.abort_all();
                break;
            }
        }
    }
    // What did not end in time is not known to have arrived: handed out again (a phone may then see it twice, rather
    // than never).
    unsent.extend(pending);
    if !unsent.is_empty() {
        let s = Arc::clone(&job.scheduler);
        let owned = vault.to_owned();
        let _ = tokio::task::spawn_blocking(move || s.memory.unsent(&owned, &unsent)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    use appkit_hub::push::{b64url, Push, PushRequest, PushTransport, Subscription};
    use jiff::Timestamp;

    use crate::classes::{Class, Entry};
    use crate::mail::Message;

    /// An engine of the tests: a snapshot and meetings the test sets.
    struct Vault {
        tasks: Mutex<serde_json::Value>,
        meetings: Mutex<serde_json::Value>,
    }

    impl Engine for Vault {
        fn call<'a>(
            &'a self,
            method: Method,
            params: Option<&'a serde_json::Value>,
        ) -> crate::engine::CallFuture<'a> {
            Box::pin(async move {
                let text = if method == Calls::Meetings {
                    assert_eq!(params.unwrap()["status"], json!(["planned"]));
                    json!({ "kind": "tasks.meetings", "items": self.meetings.lock().unwrap().clone() })
                } else {
                    assert_eq!(method, Calls::Snapshot);
                    json!({ "kind": "tasks.snapshot", "rev": "rev:000001", "tasks": self.tasks.lock().unwrap().clone() })
                };
                Ok(crate::engine::Reply {
                    kind: text["kind"].as_str().unwrap().to_owned(),
                    text: text.to_string(),
                })
            })
        }
    }

    /// A push service that keeps the endpoints it was given.
    #[derive(Default)]
    struct Counting(Mutex<Vec<String>>);

    impl PushTransport for Counting {
        fn send(&self, request: PushRequest) -> BoxFuture<'_, Option<u16>> {
            self.0.lock().unwrap().push(request.endpoint);
            Box::pin(async { Some(201) })
        }
    }

    /// A mail account that keeps what it sent.
    #[derive(Default)]
    struct Outbox(Mutex<Vec<Message>>);

    impl Transport for Outbox {
        fn send<'a>(&'a self, message: &'a Message) -> BoxFuture<'a, Result<(), String>> {
            self.0.lock().unwrap().push(message.clone());
            Box::pin(async { Ok(()) })
        }
    }

    /// The base point of P-256, uncompressed: a valid public key of a device.
    const DEVICE_KEY: &str = "046b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2964fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5";

    fn key() -> String {
        let bytes: Vec<u8> = (0..DEVICE_KEY.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&DEVICE_KEY[i..i + 2], 16).unwrap())
            .collect();
        b64url(&bytes)
    }

    struct Rig {
        engine: Arc<Vault>,
        clock: Arc<Mutex<Timestamp>>,
        service: Arc<Counting>,
        outbox: Arc<Outbox>,
        memory: PathBuf,
        _job: JoinHandle<()>,
        _dir: hub_testkit::scratch::Scratch,
    }

    impl Rig {
        fn set(&self, wall: &str) {
            *self.clock.lock().unwrap() = vienna(wall);
        }

        /// The endpoints told so far: each stands for one kind.
        fn told(&self) -> Vec<String> {
            self.service.0.lock().unwrap().clone()
        }

        fn mails(&self) -> Vec<Message> {
            self.outbox.0.lock().unwrap().clone()
        }
    }

    fn vienna(wall: &str) -> Timestamp {
        let tz = jiff::tz::TimeZone::get("Europe/Vienna").unwrap();
        wall.parse::<jiff::civil::DateTime>()
            .unwrap()
            .to_zoned(tz)
            .unwrap()
            .timestamp()
    }

    async fn rig(
        name: &str,
        now: &str,
        tasks: serde_json::Value,
        meetings: serde_json::Value,
    ) -> Rig {
        let dir = hub_testkit::scratch::Scratch::new(name);
        let service = Arc::new(Counting::default());
        let push = Arc::new(Push::open(&dir.join("settings"), service.clone()).unwrap());
        // One phone per kind, so the endpoint says which kind went out.
        for kind in [MEETING, MEETING_END, REMIND] {
            push.subscribe(
                &format!("phone-{kind}"),
                Subscription {
                    endpoint: format!("https://push.example.org/{kind}"),
                    p256dh: key(),
                    auth: b64url(&[7u8; 16]),
                    kinds: vec![kind.to_owned()],
                },
            )
            .unwrap();
        }
        let engine = Arc::new(Vault {
            tasks: Mutex::new(tasks),
            meetings: Mutex::new(meetings),
        });
        let store = SnapshotStore::new(
            Some(engine.clone() as Arc<dyn Engine>),
            crate::store::SHAPE,
            StoreOptions::default(),
        );
        let clock = Arc::new(Mutex::new(vienna(now)));
        let memory = dir.join("schedule.json");
        let mut scheduler = Scheduler::new(Some(memory.clone()));
        scheduler.zone = jiff::tz::TimeZone::get("Europe/Vienna").unwrap();
        let c = Arc::clone(&clock);
        scheduler.clock = Box::new(move || *c.lock().unwrap());
        let classes = AreaPolicy::new(std::collections::BTreeMap::from([
            (
                "pub".to_owned(),
                Entry {
                    class: Class::Public,
                    repo: None,
                },
            ),
            (
                "secret".to_owned(),
                Entry {
                    class: Class::Private,
                    repo: None,
                },
            ),
        ]))
        .unwrap();
        let outbox = Arc::new(Outbox::default());
        let job = spawn_schedule(
            ScheduleJob {
                scheduler: Arc::new(scheduler),
                push: Some(push),
                mail: Some(outbox.clone() as Arc<dyn Transport>),
                classes: Arc::new(classes),
                meetings: true,
            },
            engine.clone(),
            store,
            dir.display().to_string(),
        );
        Rig {
            engine,
            clock,
            service,
            outbox,
            memory,
            _job: job,
            _dir: dir,
        }
    }

    async fn pass(seconds: u64) {
        tokio::time::sleep(Duration::from_secs(seconds)).await;
    }

    fn meeting(id: &str, starts_at: &str, ends_at: &str) -> serde_json::Value {
        json!({
            "id": id, "area": id.split('/').next().unwrap(), "title": "Sync", "status": "planned", "valid": true,
            "all_day": false, "starts_at": starts_at, "ends_at": ends_at, "notify": [],
            "notify_to": ["me@example.org"], "online": "https://zoom.us/j/1", "online_service": "zoom",
        })
    }

    const E_MEETING: &str = "https://push.example.org/meeting";
    const E_END: &str = "https://push.example.org/meeting_end";
    const E_REMIND: &str = "https://push.example.org/remind";

    #[tokio::test(start_paused = true)]
    async fn a_meeting_is_told_once_at_its_time_again_when_moved_and_after_its_end() {
        let r = rig(
            "schedule-job-meeting",
            "2026-11-24T13:40",
            json!([]),
            json!([
                meeting("pub/m", "2026-11-24T14:00", "2026-11-24T15:00"),
                meeting("secret/s", "2026-11-24T14:00", "2026-11-24T15:00")
            ]),
        )
        .await;
        pass(1).await;
        assert!(r.told().is_empty(), "not before 13:45");
        r.set("2026-11-24T13:45");
        pass(61).await;
        assert_eq!(
            r.told(),
            [E_MEETING],
            "the private one tells nothing at all"
        );
        let mails = r.mails();
        assert_eq!(mails.len(), 1);
        assert_eq!(mails[0].subject, "Meeting at 14:00: Sync");
        assert!(
            mails[0].text.contains("Join: https://zoom.us/j/1\n"),
            "public: the address goes"
        );
        // It looks every minute: told once.
        pass(600).await;
        assert_eq!(r.told(), [E_MEETING]);
        let kept = std::fs::read_to_string(&r.memory).unwrap();
        assert!(kept.contains("meeting|pub/m|2026-11-24T14:00|"), "{kept}");
        assert!(!kept.contains("secret"), "{kept}");

        // Moved to 16:00 (seen at the next read of the meetings): the notice at 15:45.
        *r.engine.meetings.lock().unwrap() =
            json!([meeting("pub/m", "2026-11-24T16:00", "2026-11-24T17:00")]);
        r.set("2026-11-24T14:00");
        pass(301).await;
        assert_eq!(r.told(), [E_MEETING]);
        r.set("2026-11-24T15:45");
        pass(61).await;
        assert_eq!(r.told(), [E_MEETING, E_MEETING]);
        // After its end: the question, once; the old end (15:00) asked nothing.
        r.set("2026-11-24T17:00");
        pass(61).await;
        assert_eq!(r.told(), [E_MEETING, E_MEETING, E_END]);
        assert!(r
            .mails()
            .last()
            .unwrap()
            .text
            .ends_with("Enter the result or finish it?\n"));
        r.set("2026-11-24T17:30");
        pass(120).await;
        assert_eq!(r.told().len(), 3);
    }

    #[tokio::test(start_paused = true)]
    async fn a_cancelled_meeting_tells_nothing_and_a_reminder_at_a_time_is_told_alone() {
        let r = rig(
            "schedule-job-remind",
            "2026-11-24T09:00",
            json!([
                { "id": "pub/t", "area": "pub", "title": "Call", "status": "open", "remind": "2026-11-24", "remind_at": "09:30" },
                { "id": "secret/t", "area": "secret", "title": "Hidden", "status": "open", "remind": "2026-11-24", "remind_at": "09:30", "remind_to": ["me@example.org"] },
            ]),
            json!([meeting("pub/m", "2026-11-24T10:00", "2026-11-24T11:00")]),
        )
        .await;
        pass(1).await;
        // Cancelled before its notice: the engine answers only planned meetings.
        *r.engine.meetings.lock().unwrap() = json!([]);
        pass(301).await;
        r.set("2026-11-24T09:30");
        pass(61).await;
        assert_eq!(r.told(), [E_REMIND]);
        assert!(
            r.mails().is_empty(),
            "the public task names no address, the private one never gets a mail"
        );
        r.set("2026-11-24T09:45");
        pass(61).await;
        r.set("2026-11-24T11:00");
        pass(61).await;
        assert_eq!(r.told(), [E_REMIND], "nothing of the cancelled meeting");
    }
}
