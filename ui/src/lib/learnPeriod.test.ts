// The periods of the tab Learning plans: what a period means on a day, the sums of the series over it, the bars, the
// hours per week and path, the calendar of learning days and the rows per path.
import { describe, expect, it } from 'vitest';
import type { FinishedItem, LearnHistory } from './contract';
import {
  barsOf,
  byDate,
  calendarLevel,
  calendarWeeks,
  changeOf,
  coverage,
  cumulative,
  isoWeek,
  knownDays,
  parseLearnPeriod,
  parseStatsPeriod,
  parseStatsSpan,
  pathRows,
  periodFrame,
  statsFrame,
  sumSpan,
  weekHours,
  withFinished,
} from './learnPeriod';

type Day = LearnHistory['points'][number];
const day = (date: string, paths: { id: string; learned?: number; seen?: number; xp?: number; done_h?: number }[]): Day => {
  const full = paths.map((p) => ({ id: p.id, learned: p.learned ?? 0, seen: p.seen ?? 0, dropped: 0, xp: p.xp ?? 0, done_h: p.done_h ?? 0 }));
  const sum = (k: 'learned' | 'seen' | 'xp' | 'done_h') => full.reduce((a, p) => a + p[k], 0);
  return { date, learned: sum('learned'), seen: sum('seen'), dropped: 0, xp: sum('xp'), done_h: sum('done_h'), days: sum('learned') + sum('seen') > 0 ? 1 : 0, paths: full };
};
const history = (points: Day[], first?: string, paths: LearnHistory['paths'] = []): LearnHistory =>
  ({ kind: 'tasks.learn_history', since: '', until: '', step: 'day', ...(first ? { first } : {}), points, paths, incomplete: [] }) as unknown as LearnHistory;

describe('periodFrame', () => {
  it('today: the day, yesterday, the week up to it in the chart', () => {
    expect(periodFrame('day', '2026-11-22')).toEqual({
      current: { since: '2026-11-22', until: '2026-11-22' },
      previous: { since: '2026-11-21', until: '2026-11-21' },
      chart: { since: '2026-11-16', until: '2026-11-22' },
      bucket: 'day',
      ask: { since: '2026-11-16', until: '2026-11-22' },
    });
  });
  it('the week from Monday, the week before; asked up to today only', () => {
    const f = periodFrame('week', '2026-11-22'); // a Sunday
    expect(f.current).toEqual({ since: '2026-11-16', until: '2026-11-22' });
    expect(f.previous).toEqual({ since: '2026-11-09', until: '2026-11-15' });
    expect(f.ask).toEqual({ since: '2026-11-09', until: '2026-11-22' });
    expect(periodFrame('week', '2026-11-16').current).toEqual({ since: '2026-11-16', until: '2026-11-22' });
  });
  it('the month, the quarter by weeks, the year by months', () => {
    expect(periodFrame('month', '2026-03-31')).toMatchObject({ current: { since: '2026-03-01', until: '2026-03-31' }, previous: { since: '2026-02-01', until: '2026-02-28' } });
    const q = periodFrame('quarter', '2026-11-22');
    expect(q).toMatchObject({ current: { since: '2026-10-01', until: '2026-12-31' }, previous: { since: '2026-07-01', until: '2026-08-22' }, bucket: 'week' });
    expect(periodFrame('quarter', '2026-01-05').previous).toEqual({ since: '2025-10-01', until: '2025-10-05' });
    const y = periodFrame('year', '2026-11-22');
    expect(y).toMatchObject({ current: { since: '2026-01-01', until: '2026-12-31' }, bucket: 'month', ask: { since: '2025-01-01', until: '2026-11-22' } });
  });
});

describe('periodFrame, the period before over as many days (decision B)', () => {
  it('a week: Monday to the same weekday of the week before; on a Monday the Monday before', () => {
    expect(periodFrame('week', '2026-11-18').previous).toEqual({ since: '2026-11-09', until: '2026-11-11' });
    expect(periodFrame('week', '2026-11-16').previous).toEqual({ since: '2026-11-09', until: '2026-11-09' });
  });
  it('a month from its 1st to the same day of the month before, to its end when it is shorter', () => {
    expect(periodFrame('month', '2026-11-01').previous).toEqual({ since: '2026-10-01', until: '2026-10-01' });
    expect(periodFrame('month', '2026-11-22').previous).toEqual({ since: '2026-10-01', until: '2026-10-22' });
    expect(periodFrame('month', '2026-03-31').previous).toEqual({ since: '2026-02-01', until: '2026-02-28' });
    expect(periodFrame('month', '2028-03-30').previous).toEqual({ since: '2028-02-01', until: '2028-02-29' });
  });
  it('a quarter to the same month and day of the quarter before; a year to the same date', () => {
    expect(periodFrame('quarter', '2026-05-31').previous).toEqual({ since: '2026-01-01', until: '2026-02-28' });
    expect(periodFrame('year', '2026-11-22').previous).toEqual({ since: '2025-01-01', until: '2025-11-22' });
    expect(periodFrame('year', '2028-02-29').previous).toEqual({ since: '2027-01-01', until: '2027-02-28' });
  });
  it('over the turn of the year', () => {
    expect(periodFrame('day', '2027-01-01').previous).toEqual({ since: '2026-12-31', until: '2026-12-31' });
    expect(periodFrame('week', '2027-01-01').previous).toEqual({ since: '2026-12-21', until: '2026-12-25' });
    expect(periodFrame('month', '2027-01-15').previous).toEqual({ since: '2026-12-01', until: '2026-12-15' });
    expect(periodFrame('year', '2027-01-01').previous).toEqual({ since: '2026-01-01', until: '2026-01-01' });
  });
});

describe('statsFrame', () => {
  it('a period without the one before; a window of its own when both days are good', () => {
    expect(statsFrame('month', '2026-11-22', { since: '', until: '' })).toMatchObject({ previous: null, ask: { since: '2026-11-01', until: '2026-11-22' } });
    expect(statsFrame('custom', '2026-11-22', { since: '2026-01-01', until: '2026-02-15' })).toMatchObject({ bucket: 'day', chart: { since: '2026-01-01', until: '2026-02-15' } });
    expect(statsFrame('custom', '2026-11-22', { since: '2026-01-01', until: '2026-11-30' })).toMatchObject({ bucket: 'week', ask: { until: '2026-11-22' } });
    expect(statsFrame('custom', '2026-11-22', { since: '2024-01-01', until: '2026-11-22' }).bucket).toBe('month');
    // half typed or the wrong way round: the month
    expect(statsFrame('custom', '2026-11-22', { since: '2026-02-30', until: '2026-03-01' }).current.since).toBe('2026-11-01');
    expect(statsFrame('custom', '2026-11-22', { since: '2026-05-01', until: '2026-04-01' }).current.since).toBe('2026-11-01');
  });
  it('cuts a window of its own to the last 800 days the engine answers by day', () => {
    const long = statsFrame('custom', '2026-11-22', { since: '2023-01-01', until: '2026-11-22' });
    expect(long).toMatchObject({ clamped: true, current: { since: '2024-09-14', until: '2026-11-22' }, ask: { since: '2024-09-14', until: '2026-11-22' } });
    expect(statsFrame('custom', '2026-11-22', { since: '2024-09-14', until: '2026-11-22' }).clamped).toBeUndefined();
  });
  it('a window not begun yet asks for a since after its until (the view asks nothing then)', () => {
    expect(statsFrame('custom', '2026-11-22', { since: '2026-12-01', until: '2026-12-31' }).ask).toEqual({ since: '2026-12-01', until: '2026-11-22' });
  });
});

describe('sums', () => {
  const h = history(
    [
      day('2026-11-10', [{ id: 'a/x', learned: 2, xp: 20, done_h: 0.1 }]),
      day('2026-11-11', []),
      day('2026-11-16', [{ id: 'a/x', learned: 1, xp: 10, done_h: 0.2 }, { id: 'b/y', seen: 1, xp: 5 }]),
      day('2026-11-17', [{ id: 'b/y', learned: 3, xp: 30, done_h: 1.5 }]),
    ],
    '2026-11-10',
  );
  const days = byDate(h);

  it('adds up the days of a span up to today, and says null where the series knows none of them', () => {
    expect(sumSpan(days, { since: '2026-11-16', until: '2026-11-22' }, '2026-11-22', h.first, null)).toEqual({ learned: 4, seen: 1, xp: 45, done_h: 1.7, days: 2 });
    expect(sumSpan(days, { since: '2026-11-16', until: '2026-11-22' }, '2026-11-16', h.first, null)).toMatchObject({ learned: 1, days: 1 });
    expect(sumSpan(days, { since: '2026-11-01', until: '2026-11-09' }, '2026-11-22', h.first, null)).toBeNull();
    expect(sumSpan(days, { since: '2026-11-23', until: '2026-11-29' }, '2026-11-22', h.first, null)).toBeNull();
    expect(sumSpan(days, { since: '2026-11-01', until: '2026-11-22' }, '2026-11-22', undefined, null)).toBeNull();
  });

  it('of the paths a filter keeps: a day counts when one of them moved', () => {
    const keep = (id: string) => id === 'b/y';
    expect(sumSpan(days, { since: '2026-11-09', until: '2026-11-22' }, '2026-11-22', h.first, keep)).toEqual({ learned: 3, seen: 1, xp: 35, done_h: 1.5, days: 2 });
  });

  it('knows how far the series reaches into a span and how many of its days have begun', () => {
    expect(coverage({ since: '2026-11-09', until: '2026-11-15' }, '2026-11-10')).toBe('partial');
    expect(coverage({ since: '2026-11-16', until: '2026-11-22' }, '2026-11-10')).toBe('full');
    expect(coverage({ since: '2026-11-01', until: '2026-11-08' }, '2026-11-10')).toBe('none');
    expect(coverage({ since: '2026-11-01', until: '2026-11-08' }, undefined)).toBe('none');
    expect(knownDays({ since: '2026-11-16', until: '2026-11-22' }, '2026-11-18', '2026-11-10')).toBe(3);
    expect(knownDays({ since: '2026-11-09', until: '2026-11-15' }, '2026-11-22', '2026-11-10')).toBe(6);
    expect(knownDays({ since: '2026-11-09', until: '2026-11-15' }, '2026-11-22', undefined)).toBe(0);
  });

  it('a change up, down or none, its size without a tail', () => {
    expect(changeOf(14, 9)).toEqual({ direction: 'up', by: 5 });
    expect(changeOf(5.5, 6.5)).toEqual({ direction: 'down', by: 1 });
    expect(changeOf(0.3, 0.1 + 0.2)).toEqual({ direction: 'same', by: 0 });
  });

  it('draws a bar per bucket, none for days not begun or before the series', () => {
    const bars = barsOf(days, periodFrame('week', '2026-11-18'), '2026-11-18', h.first, null);
    expect(bars).toHaveLength(7);
    expect(bars[0]!.figures).toMatchObject({ learned: 1, seen: 1 });
    expect(bars[1]!.figures).toMatchObject({ learned: 3 });
    expect(bars[2]!.figures).toMatchObject({ learned: 0 });
    expect(bars[3]!.figures).toBeNull();
    const quarter = barsOf(days, periodFrame('quarter', '2026-11-18'), '2026-11-18', h.first, null);
    // the first week of the quarter starts on its first day, not the Monday before it
    expect(quarter[0]).toMatchObject({ since: '2026-10-01', until: '2026-10-04', figures: null });
    expect(quarter.find((b) => b.since === '2026-11-09')!.figures).toMatchObject({ learned: 2 });
    expect(barsOf(days, periodFrame('year', '2026-11-18'), '2026-11-18', h.first, null)).toHaveLength(12);
  });

  it('a running sum that keeps its value over a bar without figures', () => {
    const bars = barsOf(days, periodFrame('week', '2026-11-18'), '2026-11-18', h.first, null);
    expect(cumulative(bars, (f) => f.xp)).toEqual([15, 45, 45, null, null, null, null]);
  });
});

describe('before the series: the finished tasks of the points', () => {
  const task = (point: string | undefined, done: string, outcome?: 'learned' | 'seen' | 'not-applicable', xp?: number) =>
    ({ id: 'a/t', area: 'a', slug: 't', title: 't', tags: [], file: 'f', done, ...(point ? { point } : {}), ...(outcome ? { outcome } : {}), ...(xp ? { xp } : {}) }) as unknown as FinishedItem;

  it('fills the bars before the first day, marked partial, and only with tasks of points that were learned or seen', () => {
    const bars = barsOf(new Map(), { chart: { since: '2026-11-01', until: '2026-11-04' }, bucket: 'day' }, '2026-11-04', '2026-11-03', null);
    const finished = [
      task('a/x#k1', '2026-11-01', 'learned', 10),
      task('a/x#k2', '2026-11-01', 'seen'),
      task('a/x#k3', '2026-11-02', 'not-applicable'),
      task(undefined, '2026-11-02', 'learned'),
      task('b/y#k1', '2026-11-02', undefined, 5),
      task('a/x#k4', '2026-11-03', 'learned'),
    ];
    const out = withFinished(bars, '2026-11-03', finished, null);
    expect(out[0]).toMatchObject({ figures: { learned: 1, seen: 1, xp: 10, days: 1 }, partial: true });
    expect(out[1]).toMatchObject({ figures: { learned: 1, xp: 5 }, partial: true });
    // from the first day on the series counts (no day of it here)
    expect(out[2]!.partial).toBeUndefined();
    expect(withFinished(bars, '2026-11-03', finished, (id) => id === 'a/x')[1]!.figures).toBeNull();
  });

  it('counts no XP of a task only seen: the engine counts part of it by its rule', () => {
    const bars = barsOf(new Map(), { chart: { since: '2026-11-01', until: '2026-11-01' }, bucket: 'day' }, '2026-11-04', '2026-11-03', null);
    const out = withFinished(bars, '2026-11-03', [task('a/x#k1', '2026-11-01', 'seen', 10)], null);
    expect(out[0]!.figures).toMatchObject({ learned: 0, seen: 1, xp: 0 });
  });
});

describe('hours per week, the calendar, the rows per path', () => {
  const h = history(
    [
      day('2026-11-09', [{ id: 'a/1', learned: 1, done_h: 1 }, { id: 'a/2', done_h: 0.5 }]),
      day('2026-11-16', [
        { id: 'a/1', done_h: 2 },
        { id: 'a/2', done_h: 1 },
        { id: 'a/3', done_h: 0.25 },
        { id: 'a/4', learned: 2, seen: 1, done_h: 0.25 },
      ]),
      day('2026-11-17', [{ id: 'a/1', learned: 5, seen: 3, xp: 40 }]),
    ],
    '2026-11-09',
    [
      { id: 'a/1', area: 'a', title: 'Eins', first: '2026-11-09', levels: [{ ref: 'l1', reached_on: '2026-11-09' }, { ref: 'l2', reached_on: '2026-11-17' }], rewards: [] },
      { id: 'a/2', area: 'a', first: '2026-11-09', levels: [], rewards: [] },
      { id: 'a/9', area: 'a', title: 'Ruhig', first: '2026-11-01', levels: [], rewards: [] },
    ],
  );
  const days = byDate(h);
  const span = { since: '2026-11-09', until: '2026-11-22' };

  it('stacks the hours of each week by the paths with the most, the rest together', () => {
    const w = weekHours(days, span, '2026-11-22', h.first, null, 2);
    expect(w.paths).toEqual(['a/1', 'a/2']);
    expect(w.weeks).toEqual([
      { since: '2026-11-09', until: '2026-11-15', values: [1, 0.5], rest: 0, total: 1.5, known: true },
      { since: '2026-11-16', until: '2026-11-22', values: [2, 1], rest: 0.5, total: 3.5, known: true },
    ]);
    expect(weekHours(days, span, '2026-11-22', h.first, (id) => id === 'a/3').paths).toEqual(['a/3']);
  });

  it('a calendar of weeks from Monday, its stages by the points of a day', () => {
    expect([0, 1, 2, 3, 4, 6, 7, 30].map(calendarLevel)).toEqual([0, 1, 2, 2, 3, 3, 4, 4]);
    const weeks = calendarWeeks(days, { since: '2026-11-08', until: '2026-11-18' }, '2026-11-17', h.first, null);
    expect(weeks).toHaveLength(3);
    // the Sunday before the series begins: no figure; the days before the span are no cell
    expect(weeks[0]!.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(weeks[0]![6]).toEqual({ day: '2026-11-08', count: null, level: 0 });
    expect(weeks[1]![0]).toEqual({ day: '2026-11-09', count: 1, level: 1 });
    expect(weeks[1]![1]).toEqual({ day: '2026-11-10', count: 0, level: 0 });
    expect(weeks[2]![0]).toEqual({ day: '2026-11-16', count: 3, level: 2 });
    expect(weeks[2]![1]).toEqual({ day: '2026-11-17', count: 8, level: 4 });
    // not begun yet
    expect(weeks[2]![2]).toEqual({ day: '2026-11-18', count: null, level: 0 });
  });

  it('a calendar of every week of a span, also the 54 weeks a year can touch', () => {
    const year = calendarWeeks(new Map(), { since: '2040-01-01', until: '2040-12-31' }, '2041-01-01', '2039-01-01', null);
    expect(year).toHaveLength(54);
    expect(year[0]![6]).toMatchObject({ day: '2040-01-01' });
    expect(calendarWeeks(new Map(), { since: '2024-01-01', until: '2026-11-22' }, '2026-11-22', '2024-01-01', null).length).toBeGreaterThan(53);
  });

  it('a row per path that moved or reached a level, its last level of the window', () => {
    const rows = pathRows(h, { since: '2026-11-10', until: '2026-11-30' }, '2026-11-22', null);
    expect(rows.map((r) => r.id)).toEqual(['a/1', 'a/2']);
    expect(rows[0]).toMatchObject({ title: 'Eins', figures: { learned: 5, seen: 3, xp: 40, done_h: 2, days: 1 }, reached: { ref: 'l2', on: '2026-11-17' } });
    // a path without a title is named by its id
    expect(rows[1]).toMatchObject({ title: 'a/2', figures: { done_h: 1 } });
    expect(pathRows(h, span, '2026-11-22', (id) => id === 'a/2').map((r) => r.id)).toEqual(['a/2']);
    expect(pathRows(null, span, '2026-11-22', null)).toEqual([]);
  });
});

describe('small things', () => {
  it('the week of the year after ISO 8601', () => {
    expect(isoWeek('2026-11-16')).toBe(47);
    expect(isoWeek('2026-01-01')).toBe(1);
    expect(isoWeek('2027-01-01')).toBe(53);
    expect(isoWeek('2024-12-30')).toBe(1);
  });
  it('the remembered period, the week for anything else', () => {
    expect(parseLearnPeriod('quarter')).toBe('quarter');
    expect(parseLearnPeriod(null)).toBe('week');
    expect(parseLearnPeriod('custom')).toBe('week');
  });
  it('the remembered period and days of the statistics', () => {
    expect(parseStatsPeriod('custom')).toBe('custom');
    expect(parseStatsPeriod('day')).toBe('month');
    expect(parseStatsSpan('2026-01-01..2026-02-30')).toEqual({ since: '2026-01-01', until: '' });
    expect(parseStatsSpan(null)).toEqual({ since: '', until: '' });
  });
});
