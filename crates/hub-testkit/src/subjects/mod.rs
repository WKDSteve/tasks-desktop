//! The tasks hub as a subject of the security matrix of `appkit-testkit`.

mod tasks;

pub use self::tasks::{Tasks, TasksWithPhonePage, PHONE_PREFIX, PHONE_WORKER_POLICY};
