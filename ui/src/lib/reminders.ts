// The view of all reminders: every task with a `remind:` day, open or finished, by day, and the mail the hub writes
// for a choice of them. The page only lists and chooses: which reminders may go into a mail is decided by the hub
// (the classes of the areas), and the mail the page shows is the hub's answer, word for word.

import type { TaskEntry } from './contract';
import { parseDate } from './calendar';
import { isDue, type DoneReminder } from './remind';

/** One reminder of the list. */
export interface ReminderRow {
  id: string;
  title: string;
  area: string;
  /** The day of the reminder, `YYYY-MM-DD`. */
  day: string;
  /** Its time of day (`HH:MM`), when it has one. */
  at?: string;
  /** The addresses the reminder is sent to on its day (`remind_to`). */
  to: readonly string[];
  /** A finished task: it is not in the list of the open tasks and cannot be opened from here. */
  finished: boolean;
  /** The day has come (today or earlier). */
  due: boolean;
}

/**
 * Every reminder: the open tasks that carry one and the finished ones the snapshot lists, the earliest day first (in
 * a day: without a time of day first, then by time, then by title). A `remind` that is no day of the calendar
 * (`soon`, `2026-13-45`) is left out: the view formats the day, and a day that is none cannot be formatted.
 */
export function reminderRows(tasks: readonly TaskEntry[], finished: readonly DoneReminder[] | undefined, today: string): ReminderRow[] {
  const rows: ReminderRow[] = [];
  const add = (entry: Pick<TaskEntry, 'id' | 'area' | 'title'> & { remind?: unknown; remind_at?: string; remind_to?: readonly string[] }, done: boolean): void => {
    const day = typeof entry.remind === 'string' ? entry.remind : '';
    if (!parseDate(day)) return;
    rows.push({
      id: entry.id,
      title: entry.title,
      area: entry.area,
      day,
      ...(entry.remind_at ? { at: entry.remind_at } : {}),
      to: entry.remind_to ?? [],
      finished: done,
      due: isDue(day, today),
    });
  };
  for (const task of tasks) add(task, false);
  for (const entry of finished ?? []) add(entry as unknown as Parameters<typeof add>[0], true);
  return rows.sort((a, b) => a.day.localeCompare(b.day) || (a.at ?? '').localeCompare(b.at ?? '') || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

/**
 * Whether a text looks like one e-mail address, as the hub takes it (`local@domain.tld`, ASCII, no space). The hub
 * judges the address again; this only keeps the button off while the field cannot be right.
 */
export function looksLikeAddress(text: string): boolean {
  return text.length <= 254 && /^[A-Za-z0-9_%+-](?:[A-Za-z0-9._%+-]{0,62}[A-Za-z0-9_%+-])?@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(text) && !text.split('@')[0]!.includes('..');
}

/** Why the hub left a chosen reminder out of the mail. */
export type LeftOutReason = 'private' | 'unclassified' | 'unknown';

/** The hub's answer for a choice of reminders (`hub.reminders_mail`): the mail as it is sent. */
export interface RemindersMail {
  /** Whether this hub has a mail account at all (without one it shows the mail and sends nothing). */
  account: boolean;
  sent: boolean;
  to: string;
  subject: string;
  text: string;
  included: string[];
  leftOut: { id: string; reason: LeftOutReason }[];
  /** What stands for exactly this mail: handed back with a send, so the hub sends the mail that was shown. */
  digest: string;
}

const REASONS: readonly string[] = ['private', 'unclassified', 'unknown'];

/** The answer of the hub, read strictly: anything else is not shown as a mail. */
export function parseRemindersMail(doc: unknown): RemindersMail {
  const d = (doc ?? {}) as Record<string, unknown>;
  const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
  if (
    d['kind'] !== 'hub.reminders_mail' ||
    typeof d['subject'] !== 'string' ||
    typeof d['text'] !== 'string' ||
    typeof d['to'] !== 'string' ||
    typeof d['digest'] !== 'string'
  ) {
    throw new Error('not a mail of the hub');
  }
  const leftOut = (Array.isArray(d['left_out']) ? d['left_out'] : []).flatMap((entry) => {
    const e = (entry ?? {}) as Record<string, unknown>;
    return typeof e['id'] === 'string' && typeof e['reason'] === 'string' && REASONS.includes(e['reason'])
      ? [{ id: e['id'], reason: e['reason'] as LeftOutReason }]
      : [];
  });
  return {
    account: d['account'] === true,
    sent: d['sent'] === true,
    to: d['to'],
    subject: d['subject'],
    text: d['text'],
    included: strings(d['included']),
    leftOut,
    digest: d['digest'],
  };
}
