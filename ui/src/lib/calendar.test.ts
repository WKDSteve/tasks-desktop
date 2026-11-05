import { describe, expect, it } from 'vitest';
import { addDays, addMonths, daysOf, marksByDay, parseDate, sameMonth, startOfWeek, step, undated } from './calendar';
import { task } from './fixtures';

describe('calendar dates', () => {
  it('knows a date from text that only looks like one', () => {
    expect(parseDate('2026-11-05')).not.toBeNull();
    expect(parseDate('2026-02-31')).toBeNull();
    expect(parseDate('2026-13-01')).toBeNull();
    expect(parseDate('soon')).toBeNull();
    expect(parseDate(undefined)).toBeNull();
  });

  it('moves over month and year ends, and finds the Monday of a week', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(startOfWeek('2026-11-05')).toBe('2026-11-02'); // a Thursday
    expect(startOfWeek('2026-11-08')).toBe('2026-11-02'); // the Sunday belongs to the week before
    expect(startOfWeek('2026-11-02')).toBe('2026-11-02');
    expect(addMonths('2026-11-17', 1)).toBe('2026-12-01');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-01');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-01');
  });

  it('shows the whole weeks that hold a month, Monday first', () => {
    const days = daysOf('month', '2026-11-17');
    expect(days[0]).toBe('2026-10-26');
    expect(days[days.length - 1]).toBe('2026-12-06');
    expect(days.length % 7).toBe(0);
    // February 2027 starts on a Monday and has 28 days: exactly four weeks.
    expect(daysOf('month', '2027-02-10')).toHaveLength(28);
    expect(daysOf('week', '2026-11-05')).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
    ]);
  });

  it('steps by the unit of the mode', () => {
    expect(step('month', '2026-11-17', 1)).toBe('2026-12-01');
    expect(step('month', '2026-01-17', -1)).toBe('2025-12-01');
    expect(step('week', '2026-11-05', 1)).toBe('2026-11-12');
    expect(step('week', '2026-11-05', -1)).toBe('2026-10-29');
  });

  it('dims the days of the neighbouring months', () => {
    expect(sameMonth('2026-11-30', '2026-11-05')).toBe(true);
    expect(sameMonth('2026-12-01', '2026-11-05')).toBe(false);
  });
});

describe('where a task stands in the grid', () => {
  const days = daysOf('week', '2026-11-05'); // 2 to 8 November

  it('puts a task on its due day', () => {
    const marks = marksByDay([task('a/one', { due: '2026-11-04' })], days);
    expect(marks.get('2026-11-04')?.map((m) => [m.task.id, m.kind])).toEqual([['a/one', 'due']]);
    expect(marks.get('2026-11-03')).toEqual([]);
  });

  it('draws the bar from start to due: start, the days between, due', () => {
    const marks = marksByDay([task('a/bar', { start: '2026-11-03', due: '2026-11-06' })], days);
    const kinds = days.map((d) => marks.get(d)?.[0]?.kind ?? null);
    expect(kinds).toEqual([null, 'start', 'span', 'span', 'due', null, null]);
  });

  it('cuts a bar at the edges of the grid, and shows the due day only when it is in the grid', () => {
    const through = marksByDay([task('a/long', { start: '2026-10-01', due: '2026-12-01' })], days);
    expect(days.map((d) => through.get(d)?.[0]?.kind)).toEqual(Array(7).fill('span'));
    const out = marksByDay([task('a/out', { due: '2026-12-01' })], days);
    expect([...out.values()].flat()).toEqual([]);
  });

  it('stands a task with only a start on it, and ignores a start that is after the due date', () => {
    expect(marksByDay([task('a/s', { start: '2026-11-05' })], days).get('2026-11-05')?.[0]?.kind).toBe('start');
    // start after due: the engine refuses it; if a hand-made file has it the task stands on its due day only
    const odd = marksByDay([task('a/odd', { start: '2026-11-07', due: '2026-11-03' })], days);
    expect([...odd.values()].flat().map((m) => m.kind)).toEqual(['due']);
  });

  it('orders a day: due before start before span, then the more urgent, then the title', () => {
    const a = task('a/a', { due: '2026-11-04', prio: 2, title: 'B' });
    const b = task('a/b', { due: '2026-11-04', prio: 1, title: 'Z' });
    const c = task('a/c', { due: '2026-11-04', prio: 1, title: 'A' });
    const bar = task('a/bar', { start: '2026-11-04', due: '2026-11-06' });
    const marks = marksByDay([a, b, bar, c], days).get('2026-11-04')!;
    expect(marks.map((m) => m.task.id)).toEqual(['a/c', 'a/b', 'a/a', 'a/bar']);
  });

  it('knows nothing of a date that is none', () => {
    const marks = marksByDay([task('a/bad', { due: '2026-02-31' })], days);
    expect([...marks.values()].flat()).toEqual([]);
  });

  it('lists the tasks without a day, and leaves out those that stand on one', () => {
    const list = undated([task('a/none'), task('a/due', { due: '2026-11-04' }), task('a/start', { start: '2026-11-04' }), task('a/bad', { due: 'soon' })]);
    expect(list.map((t) => t.id)).toEqual(['a/none', 'a/bad']);
  });
});
