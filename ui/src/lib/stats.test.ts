import { describe, expect, it } from 'vitest';
import type { TaskEntry } from './contract';
import { task } from './fixtures';
import { applyFilter, freshFilter, NONE } from './filter';
import { bucketOf, DAYS, figureFilter, figuresOf, filterFor, parseStatsPrefs, STAT_DIMS, statsOf } from './stats';

const state = (s: string) => ({ state: s, rank: 1, leverage: 0, open_blockers: [] }) as unknown as TaskEntry['readiness'];

const tasks: TaskEntry[] = [
  task('a/one', { status: 'doing', effort: 'S', kind: 'bug', prio: 1, readiness: state('ready') }),
  task('a/two', { status: 'open', effort: '3d', kind: 'feature', readiness: state('ready') }),
  task('b/three', { status: 'blocked', effort: 'XS', prio: 2, readiness: state('waiting') }),
  task('b/four', { status: 'open', effort: '0.5d', kind: 'bug', prio: 2 }),
  task('b/five', { status: 'open', kind: 'idea' }),
  task('c/six', { status: 'parked', effort: 'XL', prio: 4, readiness: state('parked') }),
];

describe('the stack of a task', () => {
  it('is the written value, none for a missing one, and days for an effort in days', () => {
    expect(bucketOf('effort', tasks[0]!)).toBe('S');
    expect(bucketOf('effort', tasks[1]!)).toBe(DAYS);
    expect(bucketOf('effort', tasks[4]!)).toBe(NONE);
    expect(bucketOf('prio', tasks[1]!)).toBe(NONE);
    expect(bucketOf('state', tasks[3]!)).toBe(NONE);
    expect(bucketOf('kind', tasks[0]!)).toBe('bug');
  });
});

describe('the statistics', () => {
  it('count every task once: the rows and the stacks add up to the tasks', () => {
    for (const dim of STAT_DIMS) {
      const stats = statsOf(tasks, dim);
      expect(stats.total).toBe(tasks.length);
      expect(stats.rows.reduce((n, r) => n + r.total, 0)).toBe(tasks.length);
      expect(Object.values(stats.totals).reduce((n, v) => n + v, 0)).toBe(tasks.length);
      for (const row of stats.rows) expect(Object.values(row.counts).reduce((n, v) => n + v, 0)).toBe(row.total);
    }
  });

  it('put the area with the most tasks first, a tie by name, or sort by name', () => {
    expect(statsOf(tasks, 'status').rows.map((r) => r.area)).toEqual(['b', 'a', 'c']);
    expect(statsOf(tasks, 'status', 'name').rows.map((r) => r.area)).toEqual(['a', 'b', 'c']);
    const tie = [task('z/1'), task('m/1')];
    expect(statsOf(tie, 'status').rows.map((r) => r.area)).toEqual(['m', 'z']);
  });

  it('list only the stacks that have a task, in their order, and an unknown value after them', () => {
    expect(statsOf(tasks, 'effort').buckets).toEqual(['XS', 'S', 'XL', DAYS, NONE]);
    const odd = statsOf([task('a/x', { kind: 'chore' as TaskEntry['kind'] }), task('a/y', { kind: 'bug' })], 'kind');
    expect(odd.buckets).toEqual(['bug', 'chore']);
  });

  it('count per area and stack', () => {
    const b = statsOf(tasks, 'status').rows.find((r) => r.area === 'b');
    expect(b).toEqual({ area: 'b', total: 3, counts: { blocked: 1, open: 2 } });
  });
});

describe('the headline numbers', () => {
  it('count open, ready, doing, blocked, the quick wins and the tasks without an effort', () => {
    expect(figuresOf(tasks, new Set(['a/one', 'x/gone']))).toEqual({
      open: 6,
      ready: 2,
      doing: 1,
      blocked: 1,
      quickWins: 1,
      noEffort: 1,
    });
    expect(figuresOf(tasks).quickWins).toBeUndefined();
  });

  it('open the same tasks in the list as they count', () => {
    const wins = new Set(['a/one']);
    const figures = figuresOf(tasks, wins);
    for (const figure of ['open', 'ready', 'doing', 'blocked', 'quickWins', 'noEffort'] as const) {
      const shown = applyFilter(tasks, figureFilter(freshFilter(), figure), '2026-11-01', undefined, wins);
      expect(shown.length).toBe(figures[figure]);
    }
  });
});

describe('a click on a stack', () => {
  it('opens in the list the tasks the stack counts, for every field and stack', () => {
    for (const dim of STAT_DIMS) {
      const stats = statsOf(tasks, dim);
      for (const row of stats.rows) {
        for (const [bucket, n] of Object.entries(row.counts)) {
          const filter = filterFor(freshFilter(), dim, bucket, row.area, tasks);
          expect(applyFilter(tasks, filter, '2026-11-01').length, `${dim} ${row.area} ${bucket}`).toBe(n);
        }
      }
      for (const bucket of stats.buckets) {
        const filter = filterFor(freshFilter(), dim, bucket, null, tasks);
        expect(applyFilter(tasks, filter, '2026-11-01').length, `${dim} ${bucket}`).toBe(stats.totals[bucket]);
      }
    }
  });

  it('keeps the filter that is on and does not change it in place', () => {
    const base = { ...freshFilter(), query: 'one', fields: { tag: ['x'] } };
    const out = filterFor(base, 'kind', 'bug', 'a', tasks);
    expect(out).toMatchObject({ query: 'one', areas: ['a'], fields: { tag: ['x'], kind: ['bug'] } });
    expect(base.fields).toEqual({ tag: ['x'] });
    expect(base.areas).toEqual([]);
  });

  it('on an area alone sets only the area', () => {
    expect(filterFor(freshFilter(), 'status', null, 'b', tasks)).toEqual({ ...freshFilter(), areas: ['b'] });
  });
});

describe('the stored choice', () => {
  it('reads back a field and an order that exist, else the defaults', () => {
    expect(parseStatsPrefs('{"dim":"kind","sort":"name"}')).toEqual({ dim: 'kind', sort: 'name' });
    expect(parseStatsPrefs('{"dim":"colour","sort":2}')).toEqual({ dim: 'status', sort: 'count' });
    expect(parseStatsPrefs('not json')).toEqual({ dim: 'status', sort: 'count' });
    expect(parseStatsPrefs(null)).toEqual({ dim: 'status', sort: 'count' });
    expect(parseStatsPrefs('[1]')).toEqual({ dim: 'status', sort: 'count' });
  });
});
