// The layout of the hour grid and of the meetings in the month: where a block stands, who overlaps whom, what a drag
// makes of a meeting, what the filters keep. Whether a time is valid is the engine's word, not tested here.
import { describe, expect, it } from 'vitest';
import type { MeetingEntry } from './contract';
import {
  allDayByDay,
  allDayDays,
  blocksByDay,
  conflictCount,
  conflictsWith,
  createRange,
  dragged,
  durationMinutes,
  durationText,
  filterMeetings,
  hhmm,
  layoutColumns,
  meetingsByDay,
  movePatch,
  NO_FILTER,
  nowOnGrid,
  placeSign,
  snap,
  spanOn,
  type Block,
} from './timeGrid';

function meeting(id: string, starts: string, ends: string | undefined, more: Partial<MeetingEntry> = {}): MeetingEntry {
  return {
    id,
    area: 'pub',
    title: `T ${id}`,
    status: 'planned',
    date: starts.slice(0, 10),
    time: starts.length > 10 ? starts.slice(11, 16) : undefined,
    all_day: false,
    starts_at: starts,
    ends_at: ends,
    tasks: [],
    participants: { total: 0 },
    ...more,
  } as unknown as MeetingEntry;
}

describe('spanOn', () => {
  it('gives the minutes of the day, and the default length for a meeting without an end', () => {
    expect(spanOn(meeting('a', '2026-11-24T14:00', '2026-11-24T15:30'), '2026-11-24')).toEqual({ start: 840, end: 930, clipped: false });
    expect(spanOn(meeting('b', '2026-11-24T14:00', undefined), '2026-11-24')).toEqual({ start: 840, end: 870, clipped: false });
  });
  it('is nothing on another day and for an all-day meeting', () => {
    expect(spanOn(meeting('a', '2026-11-24T14:00', '2026-11-24T15:00'), '2026-11-25')).toBeNull();
    expect(spanOn(meeting('b', '2026-11-24', undefined, { all_day: true }), '2026-11-24')).toBeNull();
  });
  it('cuts a meeting over midnight at both days', () => {
    const m = meeting('a', '2026-11-24T23:00', '2026-11-25T01:00');
    expect(spanOn(m, '2026-11-24')).toEqual({ start: 1380, end: 1440, clipped: true });
    expect(spanOn(m, '2026-11-25')).toEqual({ start: 0, end: 60, clipped: true });
  });
  it('does not call a meeting that ends at midnight cut', () => {
    expect(spanOn(meeting('a', '2026-11-24T23:00', '2026-11-25T00:00'), '2026-11-24')).toEqual({ start: 1380, end: 1440, clipped: false });
  });
});

describe('layoutColumns', () => {
  const at = (items: [string, string, string][]): Block[] =>
    layoutColumns(
      items.map(([id, a, b]) => {
        const span = spanOn(meeting(id, `2026-11-24T${a}`, `2026-11-24T${b}`), '2026-11-24')!;
        return { meeting: meeting(id, `2026-11-24T${a}`, `2026-11-24T${b}`), day: '2026-11-24', ...span, col: 0, cols: 1, conflict: false };
      }),
    );
  const place = (blocks: Block[]) => Object.fromEntries(blocks.map((b) => [b.meeting.id, `${b.col}/${b.cols}${b.conflict ? '!' : ''}`]));

  it('puts overlapping meetings side by side and marks them as a conflict', () => {
    expect(place(at([['a', '10:00', '11:00'], ['b', '10:30', '11:30']]))).toEqual({ a: '0/2!', b: '1/2!' });
  });
  it('lets a meeting that follows another take its column back, and leaves the lone ones alone', () => {
    const p = place(at([['a', '09:00', '10:00'], ['b', '09:30', '10:30'], ['c', '10:00', '11:00'], ['d', '13:00', '14:00']]));
    expect(p).toEqual({ a: '0/2!', b: '1/2!', c: '0/2!', d: '0/1' });
  });
  it('does not call meetings that only touch a conflict', () => {
    expect(place(at([['a', '10:00', '11:00'], ['b', '11:00', '12:00']]))).toEqual({ a: '0/1', b: '0/1' });
  });
  it('does not count a cancelled meeting as a conflict, but still sets it beside the other', () => {
    const blocks = layoutColumns([
      { meeting: meeting('a', '2026-11-24T10:00', '2026-11-24T11:00'), day: 'd', start: 600, end: 660, clipped: false, col: 0, cols: 1, conflict: false },
      { meeting: meeting('b', '2026-11-24T10:00', '2026-11-24T11:00', { status: 'cancelled' }), day: 'd', start: 600, end: 660, clipped: false, col: 0, cols: 1, conflict: false },
    ]);
    expect(conflictCount(blocks)).toBe(0);
    expect(blocks.map((b) => b.cols)).toEqual([2, 2]);
  });
  it('does not count a meeting that says overlap: ok, on either side', () => {
    const blocks = layoutColumns([
      { meeting: meeting('a', '2026-11-24T10:00', '2026-11-24T11:00'), day: 'd', start: 600, end: 660, clipped: false, col: 0, cols: 1, conflict: false },
      { meeting: meeting('b', '2026-11-24T10:30', '2026-11-24T11:30', { overlap: 'ok' }), day: 'd', start: 630, end: 690, clipped: false, col: 0, cols: 1, conflict: false },
    ]);
    expect(conflictCount(blocks)).toBe(0);
    expect(blocks.map((b) => b.cols)).toEqual([2, 2]);
  });
});

describe('the conflicts of a new meeting', () => {
  const day = [
    meeting('a', '2026-11-24T10:00', '2026-11-24T11:00'),
    meeting('ok', '2026-11-24T10:00', '2026-11-24T11:00', { overlap: 'ok' }),
    meeting('gone', '2026-11-24T10:00', '2026-11-24T11:00', { status: 'cancelled' }),
    meeting('held', '2026-11-24T10:00', '2026-11-24T11:00', { status: 'done' }),
    meeting('series', '2026-11-24T10:00', '2026-11-24T11:00', { repeat: '1w' }),
    meeting('short', '2026-11-24T12:00', undefined),
    meeting('allday', '2026-11-24', '2026-11-24', { all_day: true }),
  ];
  it('names the meetings that share its time', () => {
    expect(conflictsWith(day, '2026-11-24T10:30', '2026-11-24T11:30').map((m) => m.id)).toEqual(['a']);
    // a meeting without an end lasts half an hour
    expect(conflictsWith(day, '2026-11-24T12:15', '2026-11-24T13:00').map((m) => m.id)).toEqual(['short']);
  });
  it('is no conflict when they only touch, or for an empty span', () => {
    expect(conflictsWith(day, '2026-11-24T11:00', '2026-11-24T12:00')).toEqual([]);
    expect(conflictsWith(day, '2026-11-24T11:00', '2026-11-24T11:00')).toEqual([]);
    expect(conflictsWith(day, 'x', 'y')).toEqual([]);
  });
  it('reads a duration', () => {
    expect(durationMinutes('45m')).toBe(45);
    expect(durationMinutes('2h')).toBe(120);
    expect(durationMinutes('1h30m')).toBe(90);
    expect(durationMinutes('soon')).toBeNaN();
    expect(durationMinutes('')).toBeNaN();
    for (const n of [15, 60, 90, 150]) expect(durationMinutes(durationText(n))).toBe(n);
  });
});

describe('the meetings of the days', () => {
  const days = ['2026-11-23', '2026-11-24', '2026-11-25'];
  const list = [
    meeting('t', '2026-11-24T14:00', '2026-11-24T15:00'),
    meeting('e', '2026-11-24T09:00', '2026-11-24T10:00'),
    meeting('w', '2026-11-23', '2026-11-25', { all_day: true }),
  ];
  it('lays out the timed ones by day', () => {
    const by = blocksByDay(list, days);
    expect(by.get('2026-11-24')!.map((b) => b.meeting.id)).toEqual(['e', 't']);
    expect(by.get('2026-11-23')).toEqual([]);
  });
  it('marks both blocks of a meeting over midnight as cut, so the grid does not move them', () => {
    const by = blocksByDay([meeting('n', '2026-11-24T23:00', '2026-11-25T01:00'), ...list], days);
    expect(by.get('2026-11-24')!.map((b) => [b.meeting.id, b.start, b.end, b.clipped])).toEqual([
      ['e', 540, 600, false],
      ['t', 840, 900, false],
      ['n', 1380, 1440, true],
    ]);
    expect(by.get('2026-11-25')!.map((b) => [b.meeting.id, b.start, b.end, b.clipped])).toEqual([['n', 0, 60, true]]);
  });
  it('spreads an all-day meeting over its days', () => {
    expect(allDayDays(list[2]!)).toEqual(days);
    const by = allDayByDay(list, days);
    expect([...by.values()].map((l) => l.map((m) => m.id))).toEqual([['w'], ['w'], ['w']]);
  });
  it('lists the chips of a day: all day first, then by beginning', () => {
    expect(meetingsByDay(list, days).get('2026-11-24')!.map((m) => m.id)).toEqual(['w', 'e', 't']);
  });
});

describe('a drag', () => {
  it('moves a block by a quarter hour steps and keeps its length inside the day', () => {
    expect(dragged({ start: 600, end: 660 }, 'move', 37)).toEqual({ start: 630, end: 690 });
    expect(dragged({ start: 600, end: 660 }, 'move', -5000)).toEqual({ start: 0, end: 60 });
    expect(dragged({ start: 1380, end: 1440 }, 'move', 500)).toEqual({ start: 1380, end: 1440 });
  });
  it('changes the end only, at least a quarter hour long', () => {
    expect(dragged({ start: 600, end: 660 }, 'resize', 30)).toEqual({ start: 600, end: 690 });
    expect(dragged({ start: 600, end: 660 }, 'resize', -500)).toEqual({ start: 600, end: 615 });
  });
  it('writes the date, the beginning and the length, and drops the end (the engine takes one of them)', () => {
    expect(movePatch('2026-11-25', 570, 90)).toEqual({ date: '2026-11-25', time: '09:30', duration: '1h30m', end: null });
    // a meeting of New York dragged to 15:00 here (Vienna, winter) is written as 09:00 in New York
    expect(movePatch('2026-11-25', 900, 60, 'America/New_York', 'Europe/Vienna')).toEqual({ date: '2026-11-25', time: '09:00', duration: '1h', end: null });
    // between the changes of summer time the distance is five hours
    expect(movePatch('2026-03-16', 900, 60, 'America/New_York', 'Europe/Vienna')).toMatchObject({ date: '2026-03-16', time: '10:00' });
    // past midnight there: the day of the zone
    expect(movePatch('2026-11-25', 60, 60, 'America/New_York', 'Europe/Vienna')).toMatchObject({ date: '2026-11-24', time: '19:00' });
  });
  it('snaps and names the length as the engine reads it', () => {
    expect(snap(7)).toBe(0);
    expect(snap(8)).toBe(15);
    expect([durationText(45), durationText(120), durationText(90), durationText(0)]).toEqual(['45m', '2h', '1h30m', '1m']);
    expect(hhmm(65)).toBe('01:05');
  });
  it('makes a range over empty time, backwards too, at least a half hour', () => {
    expect(createRange(612, 700)).toEqual({ start: 600, length: 105 });
    expect(createRange(700, 612)).toEqual({ start: 600, length: 105 });
    expect(createRange(600, 602)).toEqual({ start: 600, length: 30 });
  });
});

describe('the filter and the signs', () => {
  const a = meeting('a', '2026-11-24T10:00', '2026-11-24T11:00', { online: 'https://x.test/j', online_service: 'teams', participants: { total: 3 } } as never);
  const b = meeting('b', '2026-11-24T10:00', '2026-11-24T11:00', { location: 'Room 4' });
  const c = meeting('c', '2026-11-24T10:00', '2026-11-24T11:00');
  const ids = (list: MeetingEntry[]) => list.map((m) => m.id);
  it('keeps everything without a filter', () => {
    expect(ids(filterMeetings([a, b, c], NO_FILTER))).toEqual(['a', 'b', 'c']);
  });
  it('filters by place and service', () => {
    expect(ids(filterMeetings([a, b, c], { ...NO_FILTER, place: 'online' }))).toEqual(['a']);
    expect(ids(filterMeetings([a, b, c], { ...NO_FILTER, place: 'in_person' }))).toEqual(['b']);
    expect(ids(filterMeetings([a, b, c], { ...NO_FILTER, place: 'teams' }))).toEqual(['a']);
    expect(ids(filterMeetings([a, b, c], { ...NO_FILTER, place: 'zoom' }))).toEqual([]);
  });
  it('filters by participants', () => {
    expect(ids(filterMeetings([a, b, c], { ...NO_FILTER, people: 'with' }))).toEqual(['a']);
    expect(ids(filterMeetings([a, b, c], { ...NO_FILTER, people: 'without' }))).toEqual(['b', 'c']);
  });
  it('shows the service or the place as a sign', () => {
    expect([placeSign(a), placeSign(b), placeSign(c)]).toEqual(['⧉', '⌖', '']);
  });
  it('reads the minute of the day from a wall time', () => {
    expect(nowOnGrid('2026-11-24T09:05')).toEqual({ day: '2026-11-24', minutes: 545 });
  });
});
