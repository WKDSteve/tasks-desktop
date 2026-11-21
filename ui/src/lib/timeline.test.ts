import { describe, expect, it } from 'vitest';
import { task } from './fixtures';
import {
  arrowPath,
  barOf,
  barsOf,
  clip,
  daysBetween,
  edgesOf,
  lastDay,
  movedBar,
  partsOf,
  patchOf,
  rangeOf,
  rowsOf,
  ticksOf,
  DAYS_AFTER,
  DAYS_BEFORE,
  type Names,
  type BaseRow,
} from './timeline';

const names: Names = {
  plan: (id) => `Plan ${id}`,
  project: (id) => `Project ${id}`,
  projectOf: () => undefined,
};

describe('the bar of a task', () => {
  it('goes from start to due, and is a mark for a task with one date', () => {
    expect(barOf(task('a/x', { start: '2026-11-02', due: '2026-11-06' }))).toMatchObject({ from: '2026-11-02', to: '2026-11-06', kind: 'bar' });
    expect(barOf(task('a/x', { start: '2026-11-06', due: '2026-11-06' }))).toMatchObject({ kind: 'bar' });
    expect(barOf(task('a/x', { due: '2026-11-06' }))).toMatchObject({ from: '2026-11-06', to: '2026-11-06', kind: 'due' });
    expect(barOf(task('a/x', { start: '2026-11-02' }))).toMatchObject({ from: '2026-11-02', to: '2026-11-02', kind: 'start' });
  });

  it('is none without a valid date, and the mark of the due day when the start is after it', () => {
    expect(barOf(task('a/x'))).toBeNull();
    expect(barOf(task('a/x', { due: '2026-02-31' }))).toBeNull();
    expect(barOf(task('a/x', { start: '2026-11-09', due: '2026-11-06' }))).toMatchObject({ from: '2026-11-06', kind: 'due' });
  });

  it('are in the order of their first day', () => {
    const bars = barsOf([
      task('a/late', { due: '2026-12-01' }),
      task('a/none'),
      task('a/early', { start: '2026-11-01', due: '2026-11-20' }),
      task('a/short', { start: '2026-11-01', due: '2026-11-05' }),
    ]);
    expect(bars.map((b) => b.task.id)).toEqual(['a/short', 'a/early', 'a/late']);
  });
});

describe('the days of the timeline', () => {
  it('counts days over a month end', () => {
    expect(daysBetween('2026-11-30', '2026-12-02')).toBe(2);
    expect(daysBetween('2026-12-02', '2026-11-30')).toBe(-2);
    expect(daysBetween('soon', '2026-11-30')).toBe(0);
  });

  it('hold every bar and today in whole weeks, with the fewest days of the zoom', () => {
    const bars = barsOf([task('a/x', { start: '2026-11-10', due: '2026-12-20' })]);
    const range = rangeOf(bars, '2026-11-18', 'month');
    expect(range.from).toBe('2026-11-02'); // the Monday of the week of 2026-11-03
    expect(range.days % 7).toBe(0);
    expect(lastDay(range) >= '2026-12-27').toBe(true);
    // Nothing but today: still some weeks to look at.
    const empty = rangeOf([], '2026-11-18', 'quarter');
    expect(empty.days).toBe(182);
    expect(empty.from <= '2026-11-18' && lastDay(empty) >= '2026-11-18').toBe(true);
  });

  it('never reach further than a year back and two years on: a bar beyond is cut', () => {
    const bars = barsOf([task('a/x', { start: '2020-01-01', due: '2035-01-01' })]);
    const range = rangeOf(bars, '2026-11-18', 'quarter');
    expect(range.days).toBeLessThanOrEqual(DAYS_BEFORE + DAYS_AFTER + 60);
    expect(clip(bars[0]!, range)).toMatchObject({ from: range.from, to: lastDay(range), cutLeft: true, cutRight: true });
    expect(clip({ from: '2019-01-01', to: '2019-02-01' }, range)).toBeNull();
    expect(clip({ from: '2026-11-18', to: '2026-11-20' }, range)).toEqual({ from: '2026-11-18', to: '2026-11-20', cutLeft: false, cutRight: false });
  });

  it('have a head of months and grid lines for the zoom', () => {
    const range = { from: '2026-11-23', days: 21 };
    const week = ticksOf(range, 'week');
    expect(week.months).toEqual([
      { date: '2026-11-23', offset: 0, days: 8 },
      { date: '2026-12-01', offset: 8, days: 13 },
    ]);
    expect(week.ticks).toHaveLength(21);
    expect(week.ticks.filter((t) => t.major).map((t) => t.date)).toEqual(['2026-11-23', '2026-11-30', '2026-12-07']);
    expect(ticksOf(range, 'month').ticks.map((t) => t.date)).toEqual(['2026-11-23', '2026-11-30', '2026-12-07']);
    expect(ticksOf(range, 'quarter').ticks).toEqual([{ date: '2026-12-01', offset: 8, major: true }]);
  });
});

describe('moving a bar', () => {
  const bar = barOf(task('a/x', { start: '2026-11-02', due: '2026-11-06' }))!;
  const due = barOf(task('a/x', { due: '2026-11-06' }))!;
  const start = barOf(task('a/x', { start: '2026-11-02' }))!;

  it('has ends to pull only when it is a bar', () => {
    expect(partsOf(bar)).toEqual(['start', 'body', 'end']);
    expect(partsOf(due)).toEqual(['body']);
  });

  it('moves both dates with the body and one with an end', () => {
    expect(patchOf(bar, 'body', 3)).toEqual({ start: '2026-11-05', due: '2026-11-09' });
    expect(patchOf(bar, 'start', -2)).toEqual({ start: '2026-10-31' });
    expect(patchOf(bar, 'end', 2)).toEqual({ due: '2026-11-08' });
    expect(patchOf(bar, 'body', 0)).toBeNull();
  });

  it('stops an end at the other end', () => {
    expect(movedBar(bar, 'start', 10)).toEqual({ from: '2026-11-06', to: '2026-11-06' });
    expect(movedBar(bar, 'end', -10)).toEqual({ from: '2026-11-02', to: '2026-11-02' });
    expect(patchOf(bar, 'end', -10)).toEqual({ due: '2026-11-02' });
  });

  it('writes only the date a mark has', () => {
    expect(patchOf(due, 'body', 1)).toEqual({ due: '2026-11-07' });
    expect(patchOf(start, 'body', -1)).toEqual({ start: '2026-11-01' });
    // A mark has no ends: a part that is none moves the whole.
    expect(patchOf(due, 'end', 1)).toEqual({ due: '2026-11-07' });
  });
});

describe('the rows', () => {
  const tasks = [
    task('lib/a', { title: 'A', plan: 'lib/p1', start: '2026-11-10', due: '2026-11-12' }),
    task('lib/b', { title: 'B', plan: 'lib/p1', due: '2026-11-05' }),
    task('app/c', { title: 'C', plan: 'app/p2', due: '2026-11-01' }),
    task('app/d', { title: 'D', due: '2026-10-01' }),
  ];
  const text = (rows: BaseRow[]) =>
    rows.map((r) => (r.type === 'group' ? `${'  '.repeat(r.level)}[${r.key}] ${r.span.from}..${r.span.to} (${r.count})` : `${'  '.repeat(r.level)}${r.bar.task.id}`));

  it('are by plan, the earlier plan first and the tasks of no plan last', () => {
    expect(text(rowsOf(barsOf(tasks), 'plan', names, new Set()))).toEqual([
      '[plan:app/p2] 2026-11-01..2026-11-01 (1)',
      '  app/c',
      '[plan:lib/p1] 2026-11-05..2026-11-12 (2)',
      '  lib/b',
      '  lib/a',
      '[none] 2026-10-01..2026-10-01 (1)',
      '  app/d',
    ]);
  });

  it('are by area, and a folded group shows its head only', () => {
    expect(text(rowsOf(barsOf(tasks), 'area', names, new Set(['area:app'])))).toEqual([
      '[area:app] 2026-10-01..2026-11-01 (2)',
      '[area:lib] 2026-11-05..2026-11-12 (2)',
      '  lib/b',
      '  lib/a',
    ]);
  });

  it('put a project above its plans and its own tasks, spanning them all', () => {
    const withProjects: Names = {
      ...names,
      projectOf: (t) => (t.plan === 'lib/p1' ? 'lib/big' : t.id === 'app/d' ? 'lib/big' : undefined),
    };
    const rows = rowsOf(barsOf(tasks), 'plan', withProjects, new Set());
    expect(text(rows)).toEqual([
      '[project:lib/big] 2026-10-01..2026-11-12 (3)',
      '  [project:lib/big/plan:lib/p1] 2026-11-05..2026-11-12 (2)',
      '    lib/b',
      '    lib/a',
      '  app/d',
      '[plan:app/p2] 2026-11-01..2026-11-01 (1)',
      '  app/c',
    ]);
    expect(rows[0]).toMatchObject({ kind: 'project', label: 'Project lib/big' });
    // Folded, the project hides its plans too.
    expect(text(rowsOf(barsOf(tasks), 'plan', withProjects, new Set(['project:lib/big'])))).toEqual([
      '[project:lib/big] 2026-10-01..2026-11-12 (3)',
      '[plan:app/p2] 2026-11-01..2026-11-01 (1)',
      '  app/c',
    ]);
  });
});

describe('the keys of the rows', () => {
  it('are all different, also when the tasks of one plan stand under two projects and under none', () => {
    const split = [
      task('lib/a', { title: 'A', plan: 'lib/p1', due: '2026-11-10' }),
      task('lib/b', { title: 'B', plan: 'lib/p1', due: '2026-11-11' }),
      task('lib/c', { title: 'C', plan: 'lib/p1', due: '2026-11-12' }),
    ];
    const rows = rowsOf(
      barsOf(split),
      'plan',
      { ...names, projectOf: (t) => (t.id === 'lib/a' ? 'lib/one' : t.id === 'lib/b' ? 'lib/two' : undefined) },
      new Set(),
    );
    const keys = rows.map((r) => (r.type === 'group' ? r.key : r.bar.task.id));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((k) => k.endsWith('plan:lib/p1'))).toEqual(['project:lib/one/plan:lib/p1', 'project:lib/two/plan:lib/p1', 'plan:lib/p1']);
  });
});

describe('the arrows', () => {
  it('join a task to what it waits for when both are on the timeline, hard before soft', () => {
    const bars = barsOf([
      task('a/first', { start: '2026-11-02', due: '2026-11-06' }),
      task('a/second', { start: '2026-11-09', due: '2026-11-12', blocked_by: ['a/first', 'a/gone'], after: ['a/first'] }),
      task('a/soft', { due: '2026-11-20', after: ['a/second'] }),
    ]);
    expect(edgesOf(bars)).toEqual([
      { from: 'a/first', to: 'a/second', kind: 'blocked_by', backwards: false },
      { from: 'a/second', to: 'a/soft', kind: 'after', backwards: false },
    ]);
  });

  it('point back when the blocker ends after the day its follower begins (the same day is in time)', () => {
    const edge = (blockerDue: string) =>
      edgesOf(
        barsOf([
          task('a/first', { start: '2026-11-02', due: blockerDue }),
          task('a/second', { start: '2026-11-09', due: '2026-11-12', blocked_by: ['a/first'] }),
        ]),
      )[0]?.backwards;
    expect(edge('2026-11-10')).toBe(true);
    expect(edge('2026-11-09')).toBe(false);
  });

  it("take the engine's late blockers when it names them, not the bars", () => {
    const bars = barsOf([
      // the bars say in time (the blocker ends before the follower begins) ...
      task('a/first', { start: '2026-11-02', due: '2026-11-06' }),
      task('a/second', {
        start: '2026-11-09',
        due: '2026-11-12',
        blocked_by: ['a/first'],
        after: ['a/first'],
        // ... the engine says the hard one is late: its word counts, for that kind only
        late_blockers: [{ id: 'a/first', kind: 'blocked_by', due: '2026-11-10', against: 'start' }],
      }),
    ]);
    expect(edgesOf(bars, true)).toEqual([{ from: 'a/first', to: 'a/second', kind: 'blocked_by', backwards: true }]);
    expect(edgesOf(bars, false)[0]?.backwards, 'an older engine: the bars').toBe(false);
    // a late blocker the engine does not name is in time, whatever the bars say
    const late = barsOf([
      task('b/first', { start: '2026-11-02', due: '2026-11-10' }),
      task('b/second', { start: '2026-11-09', blocked_by: ['b/first'] }),
    ]);
    expect(edgesOf(late, true)[0]?.backwards).toBe(false);
    expect(edgesOf(late, false)[0]?.backwards).toBe(true);
  });

  it('go out to the right and in from the left, and around when the target is not to the right', () => {
    expect(arrowPath(100, 15, 200, 45, 30)).toBe('M 100 15 H 108 V 45 H 200');
    expect(arrowPath(200, 15, 100, 45, 30)).toBe('M 200 15 H 208 V 30 H 92 V 45 H 100');
    expect(arrowPath(200, 45, 100, 15, 30)).toBe('M 200 45 H 208 V 30 H 92 V 15 H 100');
  });
});
