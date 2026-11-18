import { describe, expect, it } from 'vitest';
import type { DoneReminder } from './remind';
import { task } from './fixtures';
import { looksLikeAddress, parseRemindersMail, reminderRows } from './reminders';

describe('the list of all reminders', () => {
  const finished = [
    { id: 'pub/old', area: 'pub', title: 'Done one', remind: '2026-11-01', remind_at: '07:15' },
  ] as unknown as DoneReminder[];

  it('holds the open and the finished tasks with a reminder, the earliest day first', () => {
    const rows = reminderRows(
      [
        task('pub/b', { title: 'B', remind: '2026-11-20' }),
        task('pub/none', { title: 'None' }),
        task('pub/a', { title: 'A', remind: '2026-11-18', remind_to: ['me@example.org'] }),
        task('pub/word', { title: 'Word', remind: 'soon' }),
        // The shape of a date, but no day of the calendar: formatting it would throw.
        task('pub/never', { title: 'Never', remind: '2026-13-45' }),
        task('pub/feb', { title: 'Feb', remind: '2026-02-30' }),
      ],
      finished,
      '2026-11-18',
    );
    expect(rows.map((r) => `${r.day} ${r.id} ${r.finished ? 'finished' : 'open'} ${r.due ? 'due' : 'later'}`)).toEqual([
      '2026-11-01 pub/old finished due',
      '2026-11-18 pub/a open due',
      '2026-11-20 pub/b open later',
    ]);
    expect(rows[0]).toMatchObject({ at: '07:15', to: [] });
    expect(rows[1]).toMatchObject({ to: ['me@example.org'] });
    expect(rows[1]).not.toHaveProperty('at');
  });

  it('puts a reminder without a time of day before those with one, in a day', () => {
    const rows = reminderRows(
      [
        task('pub/late', { title: 'Late', remind: '2026-11-18', remind_at: '15:00' }),
        task('pub/early', { title: 'Early', remind: '2026-11-18', remind_at: '08:00' }),
        task('pub/day', { title: 'Day', remind: '2026-11-18' }),
      ],
      undefined,
      '2026-11-17',
    );
    expect(rows.map((r) => r.id)).toEqual(['pub/day', 'pub/early', 'pub/late']);
    expect(rows.every((r) => !r.due)).toBe(true);
  });
});

describe('an address', () => {
  it('is one plain mailbox', () => {
    for (const good of ['a@b.de', 'first.last+tag@mail.example.org', 'x_1%y-z@a-b.io']) expect(looksLikeAddress(good), good).toBe(true);
    for (const bad of ['', 'a', 'a@b', '@b.de', 'a b@c.de', 'a@b.de, c@d.de', 'a@b.de\nBcc: x@y.de', '<a@b.de>', 'a@@b.de', '.a@b.de', 'a.@b.de', 'a..b@c.de', 'a@-b.de', 'ä@b.de']) {
      expect(looksLikeAddress(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('the mail of the hub', () => {
  const answer = {
    kind: 'hub.reminders_mail',
    account: false,
    sent: false,
    to: 'me@example.org',
    subject: 'Reminders: 2 tasks',
    text: 'Reminders from tasks-desktop:\n',
    digest: 'sha256:abc',
    included: ['pub/a', 'pub/b', 7],
    left_out: [{ id: 'sec/x', reason: 'private' }, { id: 'new/y', reason: 'made-up' }, 'x'],
  };

  it('is read as it is, without what is no id or no reason', () => {
    expect(parseRemindersMail(answer)).toEqual({
      account: false,
      sent: false,
      to: 'me@example.org',
      subject: 'Reminders: 2 tasks',
      text: 'Reminders from tasks-desktop:\n',
      included: ['pub/a', 'pub/b'],
      leftOut: [{ id: 'sec/x', reason: 'private' }],
      digest: 'sha256:abc',
    });
  });

  it('is refused when it is not one', () => {
    expect(() => parseRemindersMail({ ...answer, kind: 'tasks.result' })).toThrow();
    expect(() => parseRemindersMail({ ...answer, text: undefined })).toThrow();
    // Without its digest a mail could not be sent as the one that was shown.
    expect(() => parseRemindersMail({ ...answer, digest: undefined })).toThrow();
    expect(() => parseRemindersMail(null)).toThrow();
  });
});
