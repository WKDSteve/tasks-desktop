import { describe, expect, it } from 'vitest';
import type { MeetingEntry } from './contract';
import { choicesOf, dayOf, filterList, NO_LIST_FILTER, partsOf, wantsFollowUp, weekEnd } from './meetingList';

// 2026-11-24 is a Tuesday: the week ends on Sunday the 29th.
const TODAY = '2026-11-24';
const m = (id: string, day: string, more: Partial<MeetingEntry> = {}): MeetingEntry =>
  ({ id, area: 'a', title: `T ${id}`, summary: '', tags: [], status: 'planned', starts_at: `${day}T10:00`, participants: { total: 0 }, has_protocol: false, has_result: false, ...more }) as unknown as MeetingEntry;

describe('meetingList', () => {
  it('ends the week on Sunday, and on a Sunday today', () => {
    expect(weekEnd(TODAY)).toBe('2026-11-29');
    expect(weekEnd('2026-11-29')).toBe('2026-11-29');
  });

  it('lays the meetings into today, this week, later and past, the past latest first', () => {
    const p = partsOf([m('late', '2026-12-10'), m('now', TODAY), m('sun', '2026-11-29'), m('old', '2026-11-01'), m('older', '2026-10-01')], TODAY);
    expect(p.today.map((x) => x.id)).toEqual(['now']);
    expect(p.week.map((x) => x.id)).toEqual(['sun']);
    expect(p.later.map((x) => x.id)).toEqual(['late']);
    expect(p.past.map((x) => x.id)).toEqual(['old', 'older']);
  });

  it('keeps a cancelled meeting out of the coming ones but in the past, and skips an undated one', () => {
    const p = partsOf([m('x', '2026-12-01', { status: 'cancelled' }), m('y', '2026-11-01', { status: 'cancelled' }), m('z', '', { starts_at: undefined })], TODAY);
    expect(p.later).toEqual([]);
    expect(p.past.map((x) => x.id)).toEqual(['y']);
    expect(dayOf(m('z', '', { starts_at: undefined }))).toBe('');
  });

  it('groups the coming occurrences of a series, the next one first', () => {
    const p = partsOf([m('s2', '2026-12-08', { series: 'a/s', title: 'Weekly' }), m('s1', '2026-12-01', { series: 'a/s', title: 'Weekly' }), m('one', '2026-12-02')], TODAY);
    expect(p.series).toHaveLength(1);
    expect(p.series[0]).toMatchObject({ series: 'a/s', count: 2 });
    expect(p.series[0]?.next.id).toBe('s1');
  });

  it('marks a past meeting with no minutes and no result, not a cancelled or a finished one', () => {
    expect(wantsFollowUp(m('a', '2026-11-01'))).toBe(true);
    expect(wantsFollowUp(m('a', '2026-11-01', { has_protocol: true }))).toBe(false);
    expect(wantsFollowUp(m('a', '2026-11-01', { has_result: true }))).toBe(false);
    expect(wantsFollowUp(m('a', '2026-11-01', { status: 'cancelled' }))).toBe(false);
  });

  it('filters by words, area, tag, online and participants', () => {
    const list = [
      m('1', TODAY, { title: 'Budget review', area: 'x', tags: ['money'], online: 'https://meet.example/1', participants: { total: 2 } }),
      m('2', TODAY, { title: 'Lunch', area: 'y', summary: 'budget talk' }),
    ] as MeetingEntry[];
    const ids = (f: Partial<typeof NO_LIST_FILTER>) => filterList(list, { ...NO_LIST_FILTER, ...f }).map((x) => x.id);
    expect(ids({})).toEqual(['1', '2']);
    expect(ids({ text: 'budget' })).toEqual(['1', '2']);
    expect(ids({ text: 'budget review' })).toEqual(['1']);
    expect(ids({ area: 'y' })).toEqual(['2']);
    expect(ids({ tag: 'money' })).toEqual(['1']);
    expect(ids({ place: 'online' })).toEqual(['1']);
    expect(ids({ people: 'without' })).toEqual(['2']);
    expect(choicesOf(list)).toEqual({ areas: ['x', 'y'], tags: ['money'] });
  });
});
