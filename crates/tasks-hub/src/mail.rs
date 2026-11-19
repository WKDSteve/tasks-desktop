//! Reminders by e-mail: what a mail with the chosen reminders says, and the seam it is sent through.
//!
//! The page chooses reminders (open tasks with a `remind:` day, finished ones of `reminders`) and one address; the hub
//! writes the mail from the snapshot it holds, so the preview the page shows is the mail that goes out. **Only a task
//! of a `public` or `internal` area is ever in a mail** (decision 2026-11-13): one of a private or unclassified area is
//! left out and named with the reason, fail closed. A mail says the day, the time of day when the reminder has one,
//! the title and the id of each task, nothing of its text and no path of this machine.
//!
//! The mail leaves through a [`Transport`]. The hub has none of its own yet (the SMTP account of the settings, with
//! its password in the key store of the system, is a task of its own): without one the route says so
//! (`mail_not_set_up`) and nothing is sent. The tests give a transport that keeps what it was handed.

use appkit_hub::BoxFuture;
use serde_json::Value;

use crate::classes::Shown;

/// The most reminders one mail holds.
pub const MAX_ITEMS: usize = 100;
/// The longest address that is taken (RFC 5321: 254 characters).
pub const MAX_ADDRESS: usize = 254;
/// The longest title a line of the mail shows, in characters.
const MAX_TITLE: usize = 200;

/// One mail: plain text to one address.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Message {
    pub to: String,
    pub subject: String,
    pub text: String,
}

impl Message {
    /// What stands for exactly this mail: a hash over the address, the subject and the text. The page gets it with
    /// the preview and hands it back when it sends, so the hub sends the mail that was shown and no other (the list
    /// may have changed in between, or the page may ask for another choice than the one it showed).
    #[must_use]
    pub fn digest(&self) -> String {
        use sha2::{Digest, Sha256};
        let mut hash = Sha256::new();
        for part in [&self.to, &self.subject, &self.text] {
            // The length first: no two mails share a hash by moving a character from one part to the next.
            hash.update((part.len() as u64).to_le_bytes());
            hash.update(part.as_bytes());
        }
        let hex: String = hash.finalize().iter().map(|b| format!("{b:02x}")).collect();
        format!("sha256:{hex}")
    }
}

/// Where a mail leaves the hub.
pub trait Transport: Send + Sync {
    /// Send `message`. The error is a short reason for the person, without an address of a server, a user name or
    /// anything else of the account.
    fn send<'a>(&'a self, message: &'a Message) -> BoxFuture<'a, Result<(), String>>;
}

/// Why a chosen reminder is not in the mail.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LeftOut {
    /// Its area is private: it never leaves the hub.
    Private,
    /// Its area has no class yet: nothing is released until somebody said so.
    Unclassified,
    /// No task of that id has a reminder (it was finished, moved or its reminder was taken away meanwhile).
    Unknown,
}

impl LeftOut {
    /// The word the page knows the reason by.
    #[must_use]
    pub fn code(self) -> &'static str {
        match self {
            Self::Private => "private",
            Self::Unclassified => "unclassified",
            Self::Unknown => "unknown",
        }
    }
}

/// The language a mail is written in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    En,
    De,
}

/// A mail with the reminders that may go, and the chosen ones that may not.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Composed {
    pub message: Message,
    /// The ids in the mail, in its order (by day, then time of day, then id).
    pub included: Vec<String>,
    /// The chosen ids that are not in it, with the reason, in the order they were chosen.
    pub left_out: Vec<(String, LeftOut)>,
}

/// Is this one e-mail address the hub sends to: `local@domain`, ASCII, no space, no control character, nothing that
/// could start another header or name a second address. Stricter than the RFC on purpose.
#[must_use]
pub fn valid_address(text: &str) -> bool {
    if text.is_empty() || text.len() > MAX_ADDRESS {
        return false;
    }
    let Some((local, domain)) = text.split_once('@') else {
        return false;
    };
    let local_ok = !local.is_empty()
        && local.len() <= 64
        && !local.starts_with('.')
        && !local.ends_with('.')
        && !local.contains("..")
        && local
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._%+-".contains(&b));
    let labels: Vec<&str> = domain.split('.').collect();
    let domain_ok = labels.len() >= 2
        && labels.iter().all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        });
    local_ok && domain_ok
}

/// One reminder of the snapshot.
struct Item {
    id: String,
    area: String,
    title: String,
    day: String,
    at: Option<String>,
    finished: bool,
}

/// A title as one line of a mail: no control character (a line break would start a line of its own), not endless.
pub(crate) fn one_line(title: &str) -> String {
    let clean: String = title
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let clean = clean.split_whitespace().collect::<Vec<_>>().join(" ");
    if clean.chars().count() > MAX_TITLE {
        let mut cut: String = clean.chars().take(MAX_TITLE - 1).collect();
        cut.push('…');
        cut
    } else {
        clean
    }
}

fn is_day(text: &str) -> bool {
    let b = text.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && [0, 1, 2, 3, 5, 6, 8, 9]
            .iter()
            .all(|&i| b[i].is_ascii_digit())
}

fn item_of(entry: &Value, finished: bool) -> Option<Item> {
    let day = entry["remind"].as_str().filter(|d| is_day(d))?;
    Some(Item {
        id: entry["id"].as_str()?.to_owned(),
        area: entry["area"].as_str()?.to_owned(),
        title: one_line(entry["title"].as_str().unwrap_or_default()),
        day: day.to_owned(),
        at: entry["remind_at"]
            .as_str()
            .filter(|t| crate::notices::valid_time(t))
            .map(str::to_owned),
        finished,
    })
}

/// Every reminder of a `tasks.snapshot`: the open tasks that carry `remind`, and the finished ones of `reminders`.
fn reminders(doc: &Value) -> Vec<Item> {
    let list = |key: &str| doc[key].as_array().map_or(&[][..], Vec::as_slice);
    list("tasks")
        .iter()
        .filter_map(|t| item_of(t, false))
        .chain(list("reminders").iter().filter_map(|t| item_of(t, true)))
        .collect()
}

/// The mail for the reminders `ids` of `doc` (a `tasks.snapshot`) to `to`. `shown` is the class of an area; only
/// `public` and `internal` ones are written into the mail. An id chosen twice counts once.
#[must_use]
pub fn compose(
    doc: &Value,
    ids: &[String],
    to: &str,
    lang: Lang,
    shown: &dyn Fn(&str) -> Shown,
) -> Composed {
    let all = reminders(doc);
    let mut taken: Vec<&Item> = Vec::new();
    let mut left_out = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for id in ids {
        if !seen.insert(id.as_str()) {
            continue;
        }
        let Some(item) = all.iter().find(|i| &i.id == id) else {
            left_out.push((id.clone(), LeftOut::Unknown));
            continue;
        };
        match shown(&item.area) {
            Shown::Public | Shown::Internal => taken.push(item),
            Shown::Private => left_out.push((id.clone(), LeftOut::Private)),
            Shown::Unclassified => left_out.push((id.clone(), LeftOut::Unclassified)),
        }
    }
    taken.sort_by(|a, b| (&a.day, &a.at, &a.id).cmp(&(&b.day, &b.at, &b.id)));

    let n = taken.len();
    let (subject, head, done) = match lang {
        Lang::En => (
            if n == 1 {
                "Reminder: 1 task".to_owned()
            } else {
                format!("Reminders: {n} tasks")
            },
            "Reminders from tasks-desktop:",
            "finished",
        ),
        Lang::De => (
            if n == 1 {
                "Erinnerung: 1 Task".to_owned()
            } else {
                format!("Erinnerungen: {n} Tasks")
            },
            "Erinnerungen aus tasks-desktop:",
            "erledigt",
        ),
    };
    let mut text = String::from(head);
    text.push('\n');
    for item in &taken {
        text.push('\n');
        text.push_str(&item.day);
        if let Some(at) = &item.at {
            text.push(' ');
            text.push_str(at);
        }
        text.push_str("  ");
        text.push_str(&item.title);
        text.push_str("  (");
        text.push_str(&item.id);
        if item.finished {
            text.push_str(", ");
            text.push_str(done);
        }
        text.push(')');
    }
    text.push('\n');
    Composed {
        message: Message {
            to: to.to_owned(),
            subject,
            text,
        },
        included: taken.iter().map(|i| i.id.clone()).collect(),
        left_out,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn class(area: &str) -> Shown {
        match area {
            "pub" => Shown::Public,
            "own" => Shown::Internal,
            "secret" => Shown::Private,
            _ => Shown::Unclassified,
        }
    }

    fn doc() -> Value {
        json!({
            "tasks": [
                { "id": "own/b", "area": "own", "title": "Second", "remind": "2026-11-20", "remind_at": "09:30" },
                { "id": "pub/a", "area": "pub", "title": "First\r\nBcc: x@evil.example", "remind": "2026-11-19" },
                { "id": "secret/s", "area": "secret", "title": "Hidden", "remind": "2026-11-19" },
                { "id": "new/n", "area": "new", "title": "Unsorted", "remind": "2026-11-19" },
                { "id": "own/none", "area": "own", "title": "No reminder" },
            ],
            "reminders": [
                { "id": "own/old", "area": "own", "title": "Done one", "remind": "2026-11-01" },
            ],
        })
    }

    fn ids(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn an_address_is_one_plain_mailbox() {
        for good in [
            "a@b.de",
            "first.last+tag@mail.example.org",
            "x_1%y-z@a-b.io",
        ] {
            assert!(valid_address(good), "{good}");
        }
        for bad in [
            "",
            "a",
            "a@b",
            "@b.de",
            "a@.de",
            "a@b..de",
            "a b@c.de",
            "a@b.de, c@d.de",
            "a@b.de\r\nBcc: c@d.de",
            "a@b.de\n",
            "<a@b.de>",
            "a@@b.de",
            ".a@b.de",
            "a.@b.de",
            "a..b@c.de",
            "a@-b.de",
            "a@b-.de",
            "ä@b.de",
            "a@b.de;c@d.de",
        ] {
            assert!(!valid_address(bad), "{bad:?}");
        }
        assert!(!valid_address(&format!("{}@b.de", "a".repeat(65))));
        assert!(!valid_address(&format!("a@{}.de", "b".repeat(250))));
    }

    #[test]
    fn a_mail_lists_the_released_reminders_by_day_and_names_what_was_left_out() {
        let chosen = ids(&[
            "own/b", "secret/s", "pub/a", "own/old", "new/n", "own/gone", "own/none", "own/b",
        ]);
        let mail = compose(&doc(), &chosen, "me@example.org", Lang::En, &class);
        assert_eq!(mail.included, ["own/old", "pub/a", "own/b"]);
        assert_eq!(
            mail.left_out,
            [
                ("secret/s".to_owned(), LeftOut::Private),
                ("new/n".to_owned(), LeftOut::Unclassified),
                ("own/gone".to_owned(), LeftOut::Unknown),
                ("own/none".to_owned(), LeftOut::Unknown),
            ]
        );
        assert_eq!(mail.message.to, "me@example.org");
        assert_eq!(mail.message.subject, "Reminders: 3 tasks");
        assert_eq!(
            mail.message.text,
            "Reminders from tasks-desktop:\n\n\
             2026-11-01  Done one  (own/old, finished)\n\
             2026-11-19  First Bcc: x@evil.example  (pub/a)\n\
             2026-11-20 09:30  Second  (own/b)\n"
        );
        // Nothing of a private or unclassified area is in the mail, not even its id.
        for word in ["Hidden", "secret/s", "Unsorted", "new/n"] {
            assert!(!mail.message.text.contains(word), "{word}");
        }
    }

    #[test]
    fn a_mail_is_written_in_the_language_asked_for() {
        let mail = compose(
            &doc(),
            &ids(&["own/old"]),
            "me@example.org",
            Lang::De,
            &class,
        );
        assert_eq!(mail.message.subject, "Erinnerung: 1 Task");
        assert!(mail
            .message
            .text
            .starts_with("Erinnerungen aus tasks-desktop:\n"));
        assert!(mail.message.text.contains("(own/old, erledigt)"));
    }

    #[test]
    fn a_mail_has_a_digest_that_changes_with_every_part_of_it() {
        let mail = |to: &str, subject: &str, text: &str| Message {
            to: to.to_owned(),
            subject: subject.to_owned(),
            text: text.to_owned(),
        };
        let one = mail("me@example.org", "Reminder: 1 task", "a\n").digest();
        assert!(one.starts_with("sha256:") && one.len() == 7 + 64, "{one}");
        assert_eq!(
            one,
            mail("me@example.org", "Reminder: 1 task", "a\n").digest()
        );
        for other in [
            mail("you@example.org", "Reminder: 1 task", "a\n"),
            mail("me@example.org", "Reminders: 2 tasks", "a\n"),
            mail("me@example.org", "Reminder: 1 task", "b\n"),
            // The same characters, cut elsewhere.
            mail("me@example.org", "Reminder: 1 taska", "\n"),
        ] {
            assert_ne!(one, other.digest(), "{other:?}");
        }
    }

    #[test]
    fn a_title_is_one_line_and_not_endless() {
        assert_eq!(one_line("a\tb\u{0}c\r\n d"), "a b c d");
        let long = one_line(&"x".repeat(500));
        assert_eq!(long.chars().count(), MAX_TITLE);
        assert!(long.ends_with('…'));
    }

    #[test]
    fn a_reminder_without_a_day_is_none() {
        let doc =
            json!({ "tasks": [{ "id": "own/a", "area": "own", "title": "T", "remind": "soon" }] });
        let mail = compose(&doc, &ids(&["own/a"]), "me@example.org", Lang::En, &class);
        assert!(mail.included.is_empty());
        assert_eq!(mail.left_out, [("own/a".to_owned(), LeftOut::Unknown)]);
    }
}
