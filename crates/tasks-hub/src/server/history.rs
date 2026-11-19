//! The series of the figures of a vault (`_Telemetry/history`, `tasks.history`) kept by the hub itself.
//!
//! The engine writes a row of figures with the operation `history_record` (one row per day and area, and only when the
//! figures changed: asking again is free of effect). The page used to send it, but only while somebody looked at the
//! statistics, so on a day nobody opened them the series got no row. A job of the runtime of a vault sends it:
//!
//! - once a day, from the hour of the reminders on (`reminders.send_at`, compared with the engine's own day and time,
//!   `hello.today` / `hello.time`: the person's);
//! - after the vault changed, at most once in ten minutes.
//!
//! Only where the vault keeps a series at all (the folder `_Telemetry/history` is there): a series is started by the
//! person, in the page. A failure changes nothing for reading and writing; it is one line on the log, without a path.

use super::push::engine_now;
use super::*;

/// The folder of the series, below the vault.
const SERIES: &str = "_Telemetry/history";

/// How the job keeps time.
#[derive(Clone, Copy)]
pub(super) struct HistoryTiming {
    /// At least this long between two requests to the engine.
    pub(super) gap: Duration,
    /// How often the day is looked at without a change of the vault.
    pub(super) poll: Duration,
}

impl Default for HistoryTiming {
    fn default() -> Self {
        Self {
            gap: Duration::from_secs(10 * 60),
            poll: Duration::from_secs(5 * 60),
        }
    }
}

/// Whether the vault keeps a series. One `stat` of a local folder: not worth a thread of its own.
fn has_series(vault: &std::path::Path) -> bool {
    std::fs::metadata(vault.join(SERIES)).is_ok_and(|m| m.is_dir())
}

/// Ask the engine to write the figures of today down; whether it did (a row or none: both are fine).
async fn record(engine: &dyn Engine) -> bool {
    static COUNT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = COUNT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let request = json!({
        "client_op_id": format!("hub-history-{at}-{n}"),
        "ops": [{ "op": "history_record" }],
    });
    let Ok(reply) = engine.call(Calls::Ops, Some(&request)).await else {
        return false;
    };
    serde_json::from_str::<serde_json::Value>(&reply.text)
        .is_ok_and(|doc| doc["ok"].as_bool() == Some(true))
}

/// Follow one vault and keep its series. Ends with the runtime (the job is aborted with it) or when the store closes.
pub(super) fn spawn_history(
    engine: Arc<dyn Engine>,
    mut changes: broadcast::Receiver<Arc<store::Change>>,
    vault: PathBuf,
    send_at: String,
    timing: HistoryTiming,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(timing.poll);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        // The vault changed since the last request.
        let mut dirty = false;
        let mut last: Option<tokio::time::Instant> = None;
        // The day a request was answered for, from the hour: not asked again that day.
        let mut last_day: Option<String> = None;
        loop {
            tokio::select! {
                change = changes.recv() => {
                    if matches!(change, Err(broadcast::error::RecvError::Closed)) {
                        return;
                    }
                    dirty = true;
                }
                _ = tick.tick() => {}
            }
            if !has_series(&vault) {
                // Started later by the person: what changed until then is in the first row they ask for.
                dirty = false;
                continue;
            }
            if last.is_some_and(|at| at.elapsed() < timing.gap) {
                continue;
            }
            let day = engine_now(engine.as_ref())
                .await
                .filter(|(day, time)| {
                    last_day.as_deref() != Some(day.as_str()) && time.as_str() >= send_at.as_str()
                })
                .map(|(day, _)| day);
            if !dirty && day.is_none() {
                continue;
            }
            let written = record(engine.as_ref()).await;
            last = Some(tokio::time::Instant::now());
            if written {
                dirty = false;
                if day.is_some() {
                    last_day = day;
                }
                // The request's own row is a change of the vault: not a reason to ask again.
                while changes.try_recv().is_ok() {}
            } else {
                eprintln!("note: the figures of the vault were not written down");
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// An engine with a clock the test sets, that counts the requests to write down and answers as it is told.
    struct Clock {
        now: Mutex<(String, String)>,
        asked: std::sync::atomic::AtomicUsize,
        ok: std::sync::atomic::AtomicBool,
    }

    impl Clock {
        fn new(day: &str, time: &str) -> Arc<Self> {
            Arc::new(Self {
                now: Mutex::new((day.to_owned(), time.to_owned())),
                asked: std::sync::atomic::AtomicUsize::new(0),
                ok: std::sync::atomic::AtomicBool::new(true),
            })
        }
        fn set(&self, day: &str, time: &str) {
            *self.now.lock().unwrap() = (day.to_owned(), time.to_owned());
        }
        fn asked(&self) -> usize {
            self.asked.load(std::sync::atomic::Ordering::SeqCst)
        }
    }

    impl Engine for Clock {
        fn call<'a>(
            &'a self,
            method: Method,
            params: Option<&'a serde_json::Value>,
        ) -> crate::engine::CallFuture<'a> {
            Box::pin(async move {
                let text = if method == Calls::Hello {
                    let (day, time) = self.now.lock().unwrap().clone();
                    json!({ "kind": "tasks.hello", "today": day, "time": time }).to_string()
                } else {
                    // Only the request that writes the figures down comes here.
                    assert_eq!(params.unwrap()["ops"][0]["op"], "history_record");
                    self.asked.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    let ok = self.ok.load(std::sync::atomic::Ordering::SeqCst);
                    json!({ "kind": "tasks.result", "ok": ok, "results": [] }).to_string()
                };
                Ok(crate::engine::Reply {
                    kind: "x".to_owned(),
                    text,
                })
            })
        }
    }

    const TIMING: HistoryTiming = HistoryTiming {
        gap: Duration::from_secs(600),
        poll: Duration::from_secs(300),
    };

    /// A vault folder with the series (or without), a store with a channel the test sends the changes on, the job.
    struct Rig {
        engine: Arc<Clock>,
        vault: PathBuf,
        changes: broadcast::Sender<Arc<store::Change>>,
        _job: JoinHandle<()>,
    }

    async fn rig(day: &str, time: &str, series: bool) -> Rig {
        let vault = std::env::temp_dir().join(format!(
            "tasks-hub-history-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&vault).unwrap();
        if series {
            std::fs::create_dir_all(vault.join(SERIES)).unwrap();
        }
        let engine = Clock::new(day, time);
        let (changes, rx) = broadcast::channel(16);
        let job = spawn_history(
            engine.clone(),
            rx,
            vault.clone(),
            "08:00".to_owned(),
            TIMING,
        );
        Rig {
            engine,
            vault,
            changes,
            _job: job,
        }
    }

    static COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

    impl Drop for Rig {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.vault);
        }
    }

    async fn pass(seconds: u64) {
        tokio::time::sleep(Duration::from_secs(seconds)).await;
    }

    fn write(rig: &Rig) {
        let change = store::Change {
            seq: 1,
            rev: None,
            cause: "fs",
            changed: Vec::new(),
            added: Vec::new(),
            removed: Vec::new(),
            truncated: false,
        };
        rig.changes.send(Arc::new(change)).unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn the_figures_are_written_down_once_a_day_from_the_hour_of_the_reminders_on() {
        let rig = rig("2026-11-19", "07:00", true).await;
        pass(1).await;
        assert_eq!(
            rig.engine.asked(),
            0,
            "before the hour of the day nothing is written"
        );
        rig.engine.set("2026-11-19", "08:00");
        pass(300).await;
        assert_eq!(rig.engine.asked(), 1, "from the hour on, once");
        pass(3600).await;
        assert_eq!(rig.engine.asked(), 1, "not again on the same day");
        // The day changes at midnight; the new day's figures wait for the hour again.
        rig.engine.set("2026-11-20", "00:30");
        pass(300).await;
        assert_eq!(rig.engine.asked(), 1);
        rig.engine.set("2026-11-20", "08:05");
        pass(300).await;
        assert_eq!(rig.engine.asked(), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn a_change_of_the_vault_is_written_down_at_most_once_in_ten_minutes() {
        let rig = rig("2026-11-19", "09:00", true).await;
        pass(1).await;
        assert_eq!(rig.engine.asked(), 1, "the day of the start");
        // Changes right after: held back until the gap is over, then one request for all of them.
        for _ in 0..5 {
            write(&rig);
            pass(30).await;
        }
        assert_eq!(rig.engine.asked(), 1, "inside the gap nothing is asked");
        pass(600).await;
        assert_eq!(rig.engine.asked(), 2, "one request for the five changes");
        pass(3000).await;
        assert_eq!(
            rig.engine.asked(),
            2,
            "nothing changed since: nothing is asked"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_vault_without_a_series_is_never_asked() {
        let rig = rig("2026-11-19", "09:00", false).await;
        write(&rig);
        pass(7200).await;
        write(&rig);
        pass(7200).await;
        assert_eq!(rig.engine.asked(), 0);
        // The person starts a series in the page: the next look keeps it.
        std::fs::create_dir_all(rig.vault.join(SERIES)).unwrap();
        pass(300).await;
        assert_eq!(rig.engine.asked(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn a_request_that_failed_is_tried_again_after_the_gap_and_changes_nothing_else() {
        let rig = rig("2026-11-19", "09:00", true).await;
        rig.engine
            .ok
            .store(false, std::sync::atomic::Ordering::SeqCst);
        pass(1).await;
        assert_eq!(rig.engine.asked(), 1);
        pass(300).await;
        assert_eq!(rig.engine.asked(), 1, "inside the gap");
        rig.engine
            .ok
            .store(true, std::sync::atomic::Ordering::SeqCst);
        pass(600).await;
        assert_eq!(rig.engine.asked(), 2, "the day is still owed");
        pass(7200).await;
        assert_eq!(rig.engine.asked(), 2, "and paid");
    }
}
