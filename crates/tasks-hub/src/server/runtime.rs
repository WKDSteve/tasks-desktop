//! What the hub keeps for the vault it reads: the engine, the snapshot, the search and the caches.

use super::*;

/// What the hub keeps for the vault it reads: the engine and the answers
/// that depend on it. Dropping it stops the watching and the indexing.
pub(super) struct VaultRuntime {
    /// The folder of the vault, when the engine is there.
    pub(super) vault: Option<PathBuf>,
    pub(super) status: HubStatus,
    /// The data classes of the areas.
    pub(super) classes: Arc<AreaPolicy>,
    /// Shows a task file in an editor; none in a hub that cannot.
    pub(super) opener: Option<Arc<dyn FileOpener>>,
    pub(super) login: Option<Arc<dyn crate::loginentry::LoginEntry>>,
    pub(super) keep_running: Option<Arc<dyn crate::keeprunning::KeepRunning>>,
    pub(super) family: Option<Arc<dyn crate::family::FamilyApps>>,
    pub(super) agent: Option<Arc<dyn crate::agent::JobIntake>>,
    pub(super) first_start: Option<Arc<dyn crate::firststart::FirstStart>>,
    pub(super) all_vaults: Option<Arc<crate::allvaults::AllVaultsCheck>>,
    pub(super) sheet_run: Option<Arc<crate::sheetrun::SheetRunJob>>,
    pub(super) testing: Option<Arc<crate::testing_link::TestingLink>>,
    /// How often the interface is used (counts per day), if kept.
    pub(super) usage: Option<Arc<UsageLog>>,
    /// The event streams that are open, by session token.
    pub(super) streams: Arc<StreamCounter>,
    /// The folders `attach` may take the newest screenshot from (the hub's settings, never the page).
    pub(super) attach_dirs: Arc<Vec<String>>,
    /// The folder a file from the page lies in until the engine has taken it; none: this hub takes no files.
    pub(super) upload_dir: Option<Arc<PathBuf>>,
    pub(super) upload_max_bytes: u64,
    pub(super) upload_engine: Option<UploadEngine>,
    /// The folder of the plugin checkouts the snapshots of the test sheets are read from.
    pub(super) snapshot_root: Option<Arc<PathBuf>>,
    pub(super) repos: Option<Arc<crate::repos::Store>>,
    pub(super) repo_status: Option<Arc<crate::repos::status::Status>>,
    /// Where a mail with reminders leaves the hub; none: this hub has no mail account.
    pub(super) mail: Option<Arc<dyn crate::mail::Transport>>,
    /// The previews and the sequences of the invitations of meetings; none: nothing is kept.
    pub(super) meetings: Option<Arc<crate::meetings::MeetingFiles>>,
    pub(super) engine: Option<Arc<dyn Engine>>,
    pub(super) store: Arc<SnapshotStore>,
    pub(super) search: Option<Arc<SearchIndex>>,
    pub(super) details: StdMutex<Details>,
    /// The check of the vault, run as a job: at most one at a time, and gone with the vault.
    pub(super) check: StdMutex<CheckJob>,
    /// When the last check was started, by a person or by the hub itself.
    pub(super) check_started: StdMutex<Option<tokio::time::Instant>>,
    /// Whether the hub runs the check again after the vault was changed (see `follow_changes`): on once a person
    /// started a check without `refs`, off when one with `refs` was started (running it again would take those out).
    pub(super) auto_check: std::sync::atomic::AtomicBool,
    /// The parameters of the last check a person started (the area), which the hub's own runs repeat.
    pub(super) check_params: StdMutex<serde_json::Map<String, serde_json::Value>>,
    /// The follower of the changes is started once for a runtime.
    pub(super) auto_check_started: std::sync::atomic::AtomicBool,
    /// Set when the runtime is retired (another vault was chosen): nothing is started in it any more.
    pub(super) retired: std::sync::atomic::AtomicBool,
    pub(super) jobs: StdMutex<Vec<JoinHandle<()>>>,
    // Kept alive: the refresher ends when every sender of hints is gone, and
    // the timer must keep running even if the file watcher could not start.
    pub(super) _hints: Option<mpsc::UnboundedSender<Hint>>,
    pub(super) _watcher: Option<fswatch::Watcher>,
    /// A change of the finished tasks (the Backlogs), which the snapshot does not hold: the count of them, for the event
    /// streams (`event: finished`).
    pub(super) finished: broadcast::Sender<u64>,
}

impl Runtime for VaultRuntime {
    type Target = VaultTarget;

    fn status(&self) -> &HubStatus {
        &self.status
    }

    fn stop(&self) {
        VaultRuntime::stop(self);
    }

    fn setup_required(&self) -> Option<&'static str> {
        appkit_hub::discovery::setup_reason(self.status.problem)
    }
}

/// What does not change when another vault is chosen but belongs to the state of one vault.
#[derive(Clone)]
pub(super) struct AppParts {
    /// `HH:MM`: the hour of the reminders, which is also the hour the figures of the day are written down from.
    pub(super) send_at: String,
    pub(super) classes: Arc<AreaPolicy>,
    pub(super) opener: Option<Arc<dyn FileOpener>>,
    pub(super) login: Option<Arc<dyn crate::loginentry::LoginEntry>>,
    pub(super) keep_running: Option<Arc<dyn crate::keeprunning::KeepRunning>>,
    pub(super) family: Option<Arc<dyn crate::family::FamilyApps>>,
    pub(super) agent: Option<Arc<dyn crate::agent::JobIntake>>,
    pub(super) first_start: Option<Arc<dyn crate::firststart::FirstStart>>,
    pub(super) all_vaults: Option<Arc<crate::allvaults::AllVaultsCheck>>,
    pub(super) sheet_run: Option<Arc<crate::sheetrun::SheetRunJob>>,
    pub(super) testing: Option<Arc<crate::testing_link::TestingLink>>,
    pub(super) usage: Option<Arc<UsageLog>>,
    pub(super) streams: Arc<StreamCounter>,
    pub(super) attach_dirs: Arc<Vec<String>>,
    pub(super) upload_dir: Option<Arc<PathBuf>>,
    pub(super) upload_max_bytes: u64,
    pub(super) upload_engine: Option<UploadEngine>,
    pub(super) snapshot_root: Option<Arc<PathBuf>>,
    pub(super) repos: Option<Arc<crate::repos::Store>>,
    pub(super) repo_status: Option<Arc<crate::repos::status::Status>>,
    pub(super) mail: Option<Arc<dyn crate::mail::Transport>>,
    pub(super) meetings: Option<Arc<crate::meetings::MeetingFiles>>,
    /// Web Push to the paired phones; none: this hub sends none.
    pub(super) push: Option<HubPush>,
}

impl VaultRuntime {
    /// Stop the refresher and the indexer.
    pub(super) fn stop(&self) {
        if let Ok(mut jobs) = self.jobs.lock() {
            // Under the lock the jobs are kept in: a start that took the lock first has its handle drained below, one
            // that takes it after sees the flag.
            self.retired
                .store(true, std::sync::atomic::Ordering::Release);
            for job in jobs.drain(..) {
                job.abort();
            }
        }
    }
}

impl Drop for VaultRuntime {
    fn drop(&mut self) {
        self.stop();
    }
}

/// The state for one vault, with the watcher and the jobs that keep it fresh.
pub(super) fn build_runtime(
    engine: Option<Arc<dyn Engine>>,
    status: HubStatus,
    vault: Option<PathBuf>,
    max_age: Option<Duration>,
    refresh: RefreshOptions,
    app: &AppParts,
) -> VaultRuntime {
    let store = SnapshotStore::new(
        engine.clone(),
        crate::store::SHAPE,
        StoreOptions {
            max_age,
            ..StoreOptions::default()
        },
    );
    // The text of the tasks, for the search: kept by the hub, read by the engine.
    let search = engine
        .clone()
        .map(|engine| SearchIndex::new(engine, crate::engine::Calls::Bodies));
    let folder = vault.clone();
    let mut jobs = Vec::new();
    if let Some(index) = &search {
        jobs.push(search::spawn_indexer(Arc::clone(index), &store));
    }
    let (finished, _) = broadcast::channel(16);
    // The watcher only says "look again"; the refresher does the looking.
    let (mut hints, mut watcher) = (None, None);
    if let Some(vault) = vault {
        let (tx, rx) = mpsc::unbounded_channel();
        let (backlog_tx, backlog_rx) = mpsc::unbounded_channel();
        jobs.push(fswatch::spawn_finished(
            backlog_rx,
            finished.clone(),
            refresh.debounce,
            refresh.max_wait,
        ));
        match fswatch::start(&vault, tx.clone(), Some(backlog_tx)) {
            Ok(started) => watcher = Some(started),
            // Not fatal: the timer and the rescan request still work.
            Err(e) => {
                eprintln!("note: the vault cannot be watched ({e}); scanning on a timer only");
            }
        }
        jobs.push(store::spawn_refresher(Arc::clone(&store), rx, refresh));
        hints = Some(tx);
    }
    // The notices of this vault, for the phones: only with an engine to read it.
    if let (Some(push), Some(folder), Some(engine)) = (&app.push, &folder, &engine) {
        jobs.push(self::push::spawn_notices(
            push.clone(),
            Arc::clone(engine),
            Arc::clone(&store),
            Arc::clone(&app.classes),
            folder.display().to_string(),
        ));
    }
    // The notices at a time of this vault (meetings, reminders at a time of day): only with an engine to read it.
    if let (Some(push), Some(folder), Some(engine)) = (&app.push, &folder, &engine)
        && let Some(scheduler) = &push.scheduler
    {
        jobs.push(self::schedule::spawn_schedule(
            self::schedule::ScheduleJob {
                scheduler: Arc::clone(scheduler),
                push: Some(Arc::clone(&push.push)),
                mail: app.mail.clone(),
                classes: Arc::clone(&app.classes),
                meetings: status.capabilities.iter().any(|c| c == "meetings"),
            },
            Arc::clone(engine),
            Arc::clone(&store),
            folder.display().to_string(),
        ));
    }
    // The series of the figures (`_Telemetry/history`), where the vault keeps one, and the engine can write it.
    if let (Some(folder), Some(engine)) = (&folder, &engine)
        && status.capabilities.iter().any(|c| c == "history")
    {
        jobs.push(self::history::spawn_history(
            Arc::clone(engine),
            store.subscribe_quiet(),
            folder.clone(),
            app.send_at.clone(),
            self::history::HistoryTiming::default(),
        ));
    }
    VaultRuntime {
        vault: folder,
        status,
        classes: Arc::clone(&app.classes),
        opener: app.opener.clone(),
        login: app.login.clone(),
        keep_running: app.keep_running.clone(),
        family: app.family.clone(),
        agent: app.agent.clone(),
        first_start: app.first_start.clone(),
        all_vaults: app.all_vaults.clone(),
        sheet_run: app.sheet_run.clone(),
        testing: app.testing.clone(),
        usage: app.usage.clone(),
        streams: Arc::clone(&app.streams),
        attach_dirs: Arc::clone(&app.attach_dirs),
        upload_dir: app.upload_dir.clone(),
        upload_max_bytes: app.upload_max_bytes,
        upload_engine: app.upload_engine.clone(),
        snapshot_root: app.snapshot_root.clone(),
        repos: app.repos.clone(),
        repo_status: app.repo_status.clone(),
        mail: app.mail.clone(),
        meetings: app.meetings.clone(),
        engine,
        store,
        search,
        details: StdMutex::new(Details::default()),
        check: StdMutex::new(CheckJob::default()),
        check_started: StdMutex::new(None),
        auto_check: std::sync::atomic::AtomicBool::new(false),
        check_params: StdMutex::new(serde_json::Map::new()),
        auto_check_started: std::sync::atomic::AtomicBool::new(false),
        retired: std::sync::atomic::AtomicBool::new(false),
        jobs: StdMutex::new(jobs),
        _hints: hints,
        _watcher: watcher,
        finished,
    }
}

/// The most task documents kept.
pub(super) const DETAILS_KEPT: usize = 64;
/// How long one is believed even when no change was seen: the watcher is the
/// way a change is noticed, and this bounds the harm of a notice that was lost.
pub(super) const DETAILS_TTL: Duration = Duration::from_secs(30);
/// How long an answer of `next` is believed: it depends on more than the state of the vault (a claim that runs out,
/// and the day), so it is held only against the questions of a moment (a page and its windows, a phone asking at the
/// same time), not for the life of a state.
pub(super) const NEXT_TTL: Duration = Duration::from_secs(5);

/// The documents of `task` the hub has answered for one state of the vault.
/// A document holds the blockers in both directions, so it is true for the
/// `rev` it was made for and for no other: a change of the vault empties
/// the whole table.
#[derive(Default)]
pub(super) struct Details {
    pub(super) rev: Option<String>,
    pub(super) docs: HashMap<String, (std::time::Instant, Bytes)>,
    pub(super) order: std::collections::VecDeque<String>,
}

impl Details {
    /// The entry `id` held for `rev`, while it is younger than `ttl` (`DETAILS_TTL`, or less for an answer that depends
    /// on more than the state).
    pub(super) fn get_within(&mut self, rev: &str, id: &str, ttl: Duration) -> Option<Bytes> {
        if self.rev.as_deref() != Some(rev) {
            return None;
        }
        self.docs
            .get(id)
            .filter(|(at, _)| at.elapsed() < ttl)
            .map(|(_, doc)| doc.clone())
    }

    /// Drop the answer `id`: it was found out of date although the state of the vault did not change.
    pub(super) fn drop_one(&mut self, id: &str) {
        if self.docs.remove(id).is_some() {
            self.order.retain(|held| held != id);
        }
    }

    /// Drop every document held: a write changed something the state of the vault may not show.
    pub(super) fn forget(&mut self) {
        self.docs.clear();
        self.order.clear();
    }

    pub(super) fn put(&mut self, rev: &str, id: &str, doc: Bytes) {
        if self.rev.as_deref() != Some(rev) {
            self.rev = Some(rev.to_owned());
            self.docs.clear();
            self.order.clear();
        }
        let entry = (std::time::Instant::now(), doc);
        if self.docs.insert(id.to_owned(), entry).is_none() {
            self.order.push_back(id.to_owned());
            while self.order.len() > DETAILS_KEPT {
                if let Some(old) = self.order.pop_front() {
                    self.docs.remove(&old);
                }
            }
        }
    }
}
