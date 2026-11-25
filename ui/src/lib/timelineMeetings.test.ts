// The meetings on the timeline: the diamond of a meeting on the rows of its tasks, the row "Meetings" of a group, and the
// fill that says where a meeting stands.
import { describe, expect, it } from 'vitest';
import type { MeetingEntry } from './contract';
import { task } from './fixtures';
import { barsOf, rowsOf, type Names } from './timeline';
import { dayOfMeeting, diamondsByTask, fillOf, withMeetingRows } from './timelineMeetings';

function meeting(id: string, day: string, more: Partial<MeetingEntry> = {}): MeetingEntry {
  return {
    id,
    area: 'pub',
    title: id,
    status: 'planned',
    date: day,
    time: '10:00',
    all_day: false,
    starts_at: `${day}T10:00`,
    ends_at: `${day}T11:00`,
    tasks: [],
    ...more,
  } as unknown as MeetingEntry;
}

const names: Names = { plan: (id) => id, project: (id) => id, projectOf: () => undefined };
const tasks = [task('pub/a', { due: '2026-11-10' }), task('pub/b', { due: '2026-11-12' }), task('lib/c', { due: '2026-11-14' })];
const bars = barsOf(tasks);

describe('the diamonds of the tasks', () => {
  it('puts a meeting on every task it has, the earlier first, and skips tasks without a bar and meetings without a day', () => {
    const m1 = meeting('m1', '2026-11-12', { tasks: ['pub/a', 'pub/b', 'gone/x'] });
    const m2 = meeting('m2', '2026-11-09', { tasks: ['pub/a'] });
    const bad = meeting('bad', 'nope', { tasks: ['pub/a'], starts_at: undefined });
    const by = diamondsByTask([m1, m2, bad], bars);
    expect(by.get('pub/a')!.map((m) => m.id)).toEqual(['m2', 'm1']);
    expect(by.get('pub/b')!.map((m) => m.id)).toEqual(['m1']);
    expect(by.has('gone/x')).toBe(false);
    expect(dayOfMeeting(bad)).toBeNull();
  });
  it('stands on the day of this machine: the evening in New York is the next morning in Vienna', () => {
    const late = meeting('late', '2026-11-12', { time: '20:00', starts_at: '2026-11-12T20:00', ends_at: '2026-11-12T21:00', tz: 'America/New_York' });
    expect(dayOfMeeting(late, 'Europe/Vienna')).toBe('2026-11-13');
    expect(dayOfMeeting(late, 'America/New_York')).toBe('2026-11-12');
  });
});

describe('the row "Meetings"', () => {
  it('goes under the group of the area of a meeting without a task, and nowhere else', () => {
    const own = meeting('own', '2026-11-11', { area: 'lib' });
    const tied = meeting('tied', '2026-11-11', { tasks: ['pub/a'] });
    const rows = withMeetingRows(rowsOf(bars, 'area', names, new Set()), [own, tied], bars, 'area');
    const kinds = rows.map((r) => (r.type === 'group' ? `g:${r.key}` : r.type === 'task' ? `t:${r.bar.task.id}` : `m:${r.key}:${r.meetings.map((m) => m.id)}`));
    expect(kinds).toEqual(['g:area:pub', 't:pub/a', 't:pub/b', 'g:area:lib', 'm:meetings:area:lib:own', 't:lib/c']);
  });
  it('is not there under a folded group', () => {
    const own = meeting('own', '2026-11-11', { area: 'lib' });
    const rows = withMeetingRows(rowsOf(bars, 'area', names, new Set(['area:lib'])), [own], bars, 'area');
    expect(rows.some((r) => r.type === 'meetings' && r.key !== 'meetings:rest')).toBe(false);
  });
  it('takes a meeting of an area with no group into a row at the end', () => {
    const rows = withMeetingRows(rowsOf(bars, 'area', names, new Set()), [meeting('lost', '2026-11-11', { area: 'zzz' })], bars, 'area');
    const last = rows[rows.length - 1]!;
    expect(last).toMatchObject({ type: 'meetings', key: 'meetings:rest', level: 0 });
  });
  it('by plan: a meeting without a task goes to the tasks of no plan', () => {
    const rows = withMeetingRows(rowsOf(bars, 'plan', names, new Set()), [meeting('own', '2026-11-11')], bars, 'plan');
    expect(rows.map((r) => (r.type === 'group' ? r.key : r.type))).toEqual(['none', 'meetings', 'task', 'task', 'task']);
  });
});

describe('the fill of a diamond', () => {
  const now = new Date('2026-11-20T12:00:00').getTime();
  it('is hollow when planned, half when over and still open, full when done, struck through when cancelled', () => {
    expect(fillOf(meeting('a', '2026-11-25'), now)).toBe('hollow');
    expect(fillOf(meeting('a', '2026-11-19'), now)).toBe('half');
    expect(fillOf(meeting('a', '2026-11-19', { status: 'done' }), now)).toBe('full');
    expect(fillOf(meeting('a', '2026-11-25', { status: 'cancelled' }), now)).toBe('cancelled');
  });
});
