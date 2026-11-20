import { describe, expect, it } from 'vitest';
import {
  coverChoices,
  emptyMeetingForm,
  formOfProposal,
  meetingFields,
  meetingNewOp,
  participantLine,
  participantsText,
  phaseOf,
  sectionText,
  splitMeetings,
  startTab,
  toReview,
  wallTime,
  whenText,
  withDocument,
} from './meetings';

/** The instant of a wall time of this machine (the tests run in its zone). */
const at = (wall: string): number => new Date(`${wall}:00`).getTime();

describe('the form of a meeting', () => {
  it('starts at the next full hour, an hour long, for the tasks it was opened for', () => {
    const form = emptyMeetingForm('lib.nvim', '2026-11-19T09:40', ['lib.nvim/alpha']);
    expect(form).toMatchObject({ area: 'lib.nvim', date: '2026-11-19', time: '10:00', duration: '60m', tasks: ['lib.nvim/alpha'] });
    // late in the day: midnight of the next day, not an hour that has begun (nor hour 24), also at the end of a year
    expect(emptyMeetingForm('a', '2026-11-19T23:30')).toMatchObject({ date: '2026-11-20', time: '00:00' });
    expect(emptyMeetingForm('a', '2026-12-31T23:05')).toMatchObject({ date: '2027-01-01', time: '00:00' });
    expect(emptyMeetingForm('a', '2026-11-19T22:59')).toMatchObject({ date: '2026-11-19', time: '23:00' });
  });

  it('sends only what is filled in, and no time for an all-day meeting', () => {
    const form = { ...emptyMeetingForm('lib.nvim', '2026-11-19T09:40'), title: ' Sync ', location: ' Raum 3 ', tags: 'a, b, a,' };
    expect(meetingNewOp(form, 'de')).toEqual({
      op: 'meeting_new',
      area: 'lib.nvim',
      title: 'Sync',
      fields: { date: '2026-11-19', time: '10:00', duration: '60m', location: 'Raum 3', tags: ['a', 'b'] },
      lang: 'de',
    });
    expect(meetingFields({ ...form, allDay: true })).toEqual({ date: '2026-11-19', location: 'Raum 3', tags: ['a', 'b'] });
    // the end as a time instead of a length: only the end
    expect(meetingFields({ ...form, endMode: 'end', end: '11:30' })).toMatchObject({ time: '10:00', end: '11:30' });
    expect(meetingFields({ ...form, endMode: 'end', end: '11:30' })).not.toHaveProperty('duration');
    // never more than five notifications
    const many = meetingFields({ ...form, notify: ['-1m', '-2m', '-3m', '-4m', '-5m', '-6m'] });
    expect(many.notify).toHaveLength(5);
  });

  it('takes the proposal of the quick capture, keeps the area and adds its tasks', () => {
    const base = emptyMeetingForm('lib.nvim', '2026-11-19T09:40', ['lib.nvim/alpha']);
    const form = formOfProposal(base, {
      title: 'Sync mit Rick',
      all_day: false,
      fields: { date: '2026-11-23', time: '14:00', end: '15:00', online: 'https://teams.microsoft.com/l/x', tasks: ['lib.nvim/beta'], notify: ['-15m'] },
    });
    expect(form).toMatchObject({
      area: 'lib.nvim',
      title: 'Sync mit Rick',
      date: '2026-11-23',
      time: '14:00',
      endMode: 'end',
      end: '15:00',
      duration: '',
      online: 'https://teams.microsoft.com/l/x',
      tasks: ['lib.nvim/alpha', 'lib.nvim/beta'],
      notify: ['-15m'],
    });
    const allDay = formOfProposal(base, { title: '', all_day: true, fields: { date: '2026-11-20' } });
    expect(allDay).toMatchObject({ allDay: true, time: '', duration: '', title: '' });
  });
});

describe('the participants', () => {
  it('are lines of the section, without characters that would end a name', () => {
    expect(participantLine({ name: 'Rick', email: 'rick@example.org', role: 'Organisator' })).toBe('- [ ] Rick <rick@example.org> (Organisator)');
    expect(participantLine({ name: ' Aleks ', email: '', role: '' })).toBe('- [ ] Aleks');
    expect(participantLine({ name: 'A<b>\n(c)', email: '', role: '' })).toBe('- [ ] Ab c');
    expect(participantLine({ name: '  ', email: 'x@y', role: '' })).toBeNull();
    expect(participantsText([{ name: 'A', email: '', role: '' }, { name: '', email: '', role: '' }, { name: 'B', email: '', role: 'optional' }])).toBe(
      '- [ ] A\n- [ ] B (optional)',
    );
  });
});

describe('the sections of a body', () => {
  const body = 'Kurz.\n\n## Agenda\n\n- [ ] Eins\n\n## Unterlagen\n\n<!-- Links -->\n\n## Ergebnis\n\n```\n## no heading\n```\nFertig.\n';
  it('reads the text of a section, without the placeholders of the template', () => {
    expect(sectionText(body, 'Agenda')).toBe('- [ ] Eins');
    expect(sectionText(body, 'Unterlagen')).toBe('');
    expect(sectionText(body, 'Ergebnis')).toBe('```\n## no heading\n```\nFertig.');
    expect(sectionText(body, 'Nope')).toBe('');
  });
  it('adds a document as one line', () => {
    expect(withDocument(body, 'Unterlagen', 'https://example.org/x')).toBe('- https://example.org/x');
    expect(withDocument('## Unterlagen\n\n- a\n', 'Unterlagen', 'b\nc')).toBe('- a\n- b c');
  });
});

describe('where a meeting stands by the clock', () => {
  const m = { starts_at: '2026-11-24T14:00', ends_at: '2026-11-24T15:00', all_day: false };
  it('opens on the preparation before, in the meeting from 15 minutes before to its end, on the result after', () => {
    expect(phaseOf(m, at('2026-11-24T13:44'))).toBe('prep');
    expect(phaseOf(m, at('2026-11-24T13:45'))).toBe('during');
    expect(phaseOf(m, at('2026-11-24T14:59'))).toBe('during');
    expect(phaseOf(m, at('2026-11-24T15:00'))).toBe('result');
  });
  it('counts the days of an all-day meeting, and a meeting without a time as before', () => {
    const day = { starts_at: '2026-11-24', ends_at: '2026-11-25', all_day: true };
    expect(phaseOf(day, at('2026-11-23T23:59'))).toBe('prep');
    expect(phaseOf(day, at('2026-11-25T23:59'))).toBe('during');
    expect(phaseOf(day, at('2026-11-26T00:00'))).toBe('result');
    expect(phaseOf({}, at('2030-01-01T00:00'))).toBe('prep');
  });
  it('reads the time of a zone in that zone', () => {
    // 14:00 in New York is 19:00 UTC in November
    const ny = { ...m, tz: 'America/New_York' };
    const utc = Date.UTC(2026, 10, 24, 19, 5);
    expect(wallTime(utc, 'America/New_York')).toBe('2026-11-24T14:05');
    expect(phaseOf(ny, utc)).toBe('during');
    // a zone the browser does not know: this machine's time
    expect(wallTime(at('2026-11-24T10:00'), 'Nowhere/Nothing')).toBe('2026-11-24T10:00');
  });
  it('opens a finished or cancelled meeting on its result', () => {
    expect(startTab({ ...m, status: 'done' }, at('2026-11-20T10:00'))).toBe('result');
    expect(startTab({ ...m, status: 'cancelled' }, at('2026-11-20T10:00'))).toBe('result');
    expect(startTab({ ...m, status: 'planned' }, at('2026-11-20T10:00'))).toBe('prep');
  });
});

describe('the meetings of a task', () => {
  it('are split into the coming ones (next first) and the past ones (last first)', () => {
    const items = [
      { id: 'a/old', starts_at: '2026-11-01T10:00', ends_at: '2026-11-01T11:00' },
      { id: 'a/next', starts_at: '2026-11-21T10:00', ends_at: '2026-11-21T11:00' },
      { id: 'a/later', starts_at: '2026-12-01T10:00', ends_at: '2026-12-01T11:00' },
      { id: 'a/older', starts_at: '2026-10-01T10:00', ends_at: '2026-10-01T11:00' },
      { id: 'a/now', starts_at: '2026-11-20T09:30', ends_at: '2026-11-20T10:30' },
    ];
    const { coming, past } = splitMeetings(items, at('2026-11-20T10:00'));
    expect(coming.map((x) => x.id)).toEqual(['a/now', 'a/next', 'a/later']);
    expect(past.map((x) => x.id)).toEqual(['a/old', 'a/older']);
  });
});

describe('the words of a meeting', () => {
  it('say its time', () => {
    expect(whenText({ date: '2026-11-24', time: '14:00', ends_at: '2026-11-24T15:00' }, 'all day')).toBe('2026-11-24 14:00–15:00');
    expect(whenText({ date: '2026-11-24', time: '23:00', ends_at: '2026-11-25T01:00', tz: 'Europe/Vienna' }, 'all day')).toBe(
      '2026-11-24 23:00–2026-11-25 01:00 (Europe/Vienna)',
    );
    expect(whenText({ date: '2026-11-24', all_day: true, ends_at: '2026-11-24' }, 'all day')).toBe('2026-11-24 all day');
    expect(whenText({}, 'all day')).toBe('');
  });
  it('offer its images as the cover', () => {
    // the files of the folder as the engine lists them, relative to it
    expect(
      coverChoices({ assets: ['assets/images/a.png', 'assets/images/b.txt', 'assets/screenshots/s.JPG', 'assets/videos/v.mp4', 'meeting.png'] }),
    ).toEqual(['assets/images/a.png', 'assets/screenshots/s.JPG']);
    expect(coverChoices({})).toEqual([]);
  });
});

describe('the meetings to follow up', () => {
  const m = (id: string, ends: string, status: 'planned' | 'done' | 'cancelled', hasResult = false) => ({
    id,
    starts_at: `${ends.slice(0, 10)}T08:00`,
    ends_at: ends,
    all_day: false,
    status,
    has_result: hasResult,
  });

  it('names those over and still planned or done without a result, the last first, and not the ones put away', () => {
    const items = [
      m('a/over-planned', '2026-11-18T09:00', 'planned'),
      m('a/done-empty', '2026-11-19T09:00', 'done'),
      m('a/done-result', '2026-11-19T09:00', 'done', true),
      m('a/cancelled', '2026-11-19T09:00', 'cancelled'),
      m('a/coming', '2026-11-21T09:00', 'planned'),
      m('a/put-away', '2026-11-17T09:00', 'planned'),
    ];
    expect(toReview(items, at('2026-11-20T10:00'), new Set(['a/put-away'])).map((x) => x.id)).toEqual(['a/done-empty', 'a/over-planned']);
  });
});
