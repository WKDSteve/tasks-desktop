import { describe, expect, it } from 'vitest';
import type { TaskEntry } from './contract';
import { task } from './fixtures';
import { applyFilter, freshFilter, NO_ACTOR, NONE } from './filter';
import { bucketOf, chosenBuckets, cutOf, DAYS, OTHER, STAT_MULTI, TOP, effortSource, ESTIMATE_MAX, figureFilter, figuresOf, filterFor, finishedPerArea, parseStatsPrefs, STAT_DIMS, statsOf, toggledBucket, withoutDim } from './stats';

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

  it('sort by the name shown, so a prefix that is left out does not move an area', () => {
    const some = [task('wkdbook-zeta/1'), task('beta/1'), task('wkdbook-alpha/1')];
    const label = (area: string) => area.replace(/^wkdbook-/, '');
    expect(statsOf(some, 'status', 'name', label).rows.map((r) => r.area)).toEqual([
      'wkdbook-alpha',
      'beta',
      'wkdbook-zeta',
    ]);
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
      const filter = figureFilter(freshFilter(), figure, figures);
      expect(filter).not.toBeNull();
      const shown = applyFilter(tasks, filter!, '2026-11-01', undefined, wins);
      expect(shown.length).toBe(figures[figure]);
    }
  });

  it('open nothing for a number of none, so a field the filter keeps out is not set', () => {
    // Only open tasks are kept: doing and blocked count none, and "doing" must not open the doing tasks.
    const base = { ...freshFilter(), statuses: ['open'] };
    const kept = applyFilter(tasks, base, '2026-11-01');
    const figures = figuresOf(kept, new Set(['a/one']));
    expect(figures.doing).toBe(0);
    expect(figureFilter(base, 'doing', figures)).toBeNull();
    expect(figureFilter(base, 'blocked', figures)).toBeNull();
    expect(figureFilter(base, 'quickWins', figures)).toBeNull();
    // A number above none opens the tasks it counts, inside the filter that is on.
    for (const figure of ['open', 'ready', 'noEffort'] as const) {
      const filter = figureFilter(base, figure, figures);
      expect(applyFilter(tasks, filter!, '2026-11-01').length, figure).toBe(figures[figure]);
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

describe('a click on the legend', () => {
  const base = freshFilter();
  it('adds a value, adds a second one, and a second click takes it away', () => {
    const one = toggledBucket(base, 'prio', '2', tasks);
    expect(one.fields.prio).toEqual(['2']);
    const two = toggledBucket(one, 'prio', '4', tasks);
    expect([...chosenBuckets(two, 'prio')]).toEqual(['2', '4']);
    expect(applyFilter(tasks, two).map((t) => t.id)).toEqual(['b/three', 'b/four', 'c/six']);
    const back = toggledBucket(toggledBucket(two, 'prio', '2', tasks), 'prio', '4', tasks);
    expect(back.fields.prio).toBeUndefined();
    expect(chosenBuckets(back, 'prio').size).toBe(0);
  });
  it('chooses a status, and the stack without a status is the empty status', () => {
    const f = toggledBucket(toggledBucket(base, 'status', 'open', tasks), 'status', NONE, tasks);
    expect(f.statuses).toEqual(['open', '']);
    expect([...chosenBuckets(f, 'status')]).toEqual(['open', NONE]);
  });
  it('takes all day values for the stack in days, and takes them away together', () => {
    const f = toggledBucket(toggledBucket(base, 'effort', 'S', tasks), 'effort', DAYS, tasks);
    expect([...(f.fields.effort ?? [])].sort()).toEqual(['0.5d', '3d', 'S']);
    expect([...chosenBuckets(f, 'effort')].sort()).toEqual(['S', DAYS].sort());
    expect(toggledBucket(f, 'effort', DAYS, tasks).fields.effort).toEqual(['S']);
  });
  it('counts as if the field had no choice: the other values stay in the legend', () => {
    const f = toggledBucket(base, 'prio', '2', tasks);
    expect(statsOf(applyFilter(tasks, withoutDim(f, 'prio')), 'prio').buckets).toEqual(['1', '2', '4', NONE]);
    expect(withoutDim(toggledBucket(base, 'status', 'open', tasks), 'status').statuses).toEqual([]);
  });
});

// Tasks with the fields beyond the first five: who, value, severity, and the list fields (category, scope, tag).
const rich: TaskEntry[] = [
  task('a/r1', { actor: 'me', value: 5, severity: 'high', category: ['bug', 'security'], scope: ['ui'], tags: ['x', 'y'], plan: 'a/p1', phase: 'one' }),
  task('a/r2', { actor: 'cdx', value: 3, category: ['docs'], scope: ['ui', 'docs'], tags: ['x'], plan: 'a/p1', phase: 'two', project: 'a/proj' }),
  task('b/r3', { actor: 'cdx', category: ['bug'], tags: ['z'], plan: 'b/p2' }),
  task('b/r4', { actor: 'pair', value: 3, severity: 'low' }),
  task('b/r5', {}),
];

describe('the further fields', () => {
  it('count who does a task, with the tasks nobody was named for', () => {
    const stats = statsOf(rich, 'actor');
    expect(stats.buckets).toEqual(['me', 'pair', 'cdx', NONE]);
    expect(stats.totals).toEqual({ me: 1, pair: 1, cdx: 2, [NONE]: 1 });
    expect(bucketOf('actor', rich[4]!)).toBe(NONE);
  });

  it('count the value from the highest down and the severity from the worst down', () => {
    expect(statsOf(rich, 'value').buckets).toEqual(['5', '3', NONE]);
    expect(statsOf(rich, 'value').totals).toEqual({ '5': 1, '3': 2, [NONE]: 2 });
    expect(statsOf(rich, 'severity').buckets).toEqual(['high', 'low', NONE]);
  });

  it('count a task of a list field in every value it has: the stacks add up to more than the tasks, the rows do not', () => {
    for (const dim of STAT_MULTI) {
      const stats = statsOf(rich, cutOf(rich, dim));
      expect(stats.total, dim).toBe(rich.length);
      expect(stats.rows.reduce((n, r) => n + r.total, 0), dim).toBe(rich.length);
      expect(Object.values(stats.totals).reduce((n, v) => n + v, 0), dim).toBeGreaterThan(rich.length);
    }
    const byCategory = statsOf(rich, cutOf(rich, 'category'));
    expect(byCategory.totals).toEqual({ bug: 2, security: 1, docs: 1, [NONE]: 2 });
    expect(byCategory.rows.find((r) => r.area === 'a')).toEqual({ area: 'a', total: 2, counts: { bug: 1, security: 1, docs: 1 } });
    expect(statsOf(rich, cutOf(rich, 'scope')).totals).toEqual({ ui: 2, docs: 1, [NONE]: 3 });
    expect(statsOf(rich, cutOf(rich, 'tag')).totals).toEqual({ x: 2, y: 1, z: 1, [NONE]: 2 });
  });

  it('a task that names a value twice counts once in it', () => {
    const twice = [task('a/t', { tags: ['x', 'x'] })];
    expect(statsOf(twice, cutOf(twice, 'tag')).totals).toEqual({ x: 1 });
  });

  it('name the most frequent values of a field the tasks name freely, the most frequent first and a tie by name, none last', () => {
    expect(cutOf(rich, 'tag').named).toEqual(['x', 'y', 'z']);
    expect(statsOf(rich, cutOf(rich, 'tag')).buckets).toEqual(['x', 'y', 'z', NONE]);
    expect(cutOf(rich, 'plan').named).toEqual(['a/p1', 'b/p2']);
    expect(cutOf(rich, 'status').named).toBeNull();
  });

  it('put the values beyond the named ones into one stack, and a task with two of them once', () => {
    const cut = cutOf(rich, 'tag', undefined, 1);
    expect(cut.named).toEqual(['x']);
    const stats = statsOf(rich, cut);
    expect(stats.buckets).toEqual(['x', OTHER, NONE]);
    // r1 has x and y (one in "further"), r3 has z; a task with y and z would still be one.
    expect(stats.totals).toEqual({ x: 2, [OTHER]: 2, [NONE]: 2 });
    const both = [...rich, task('c/r6', { tags: ['y', 'z'] })];
    expect(statsOf(both, cut).totals[OTHER]).toBe(3);
  });

  it('take the project of a task from where the page finds it (its plan), when told how', () => {
    const projectOf = (t: TaskEntry) => (t.plan === 'a/p1' ? 'a/proj' : t.project);
    expect(statsOf(rich, cutOf(rich, 'project')).totals).toEqual({ 'a/proj': 1, [NONE]: 4 });
    expect(statsOf(rich, cutOf(rich, 'project', projectOf)).totals).toEqual({ 'a/proj': 2, [NONE]: 3 });
  });

  it('a click on a stack opens in the list the tasks the stack counts, for every field, stack and area, also with "further"', () => {
    for (const dim of STAT_DIMS) {
      for (const top of [TOP, 1]) {
        const cut = cutOf(rich, dim, undefined, top);
        const stats = statsOf(rich, cut);
        for (const row of stats.rows) {
          for (const [bucket, n] of Object.entries(row.counts)) {
            const filter = filterFor(freshFilter(), cut, bucket, row.area, rich);
            expect(applyFilter(rich, filter, '2026-11-01').length, `${dim} ${top} ${row.area} ${bucket}`).toBe(n);
          }
        }
        for (const bucket of stats.buckets) {
          const filter = filterFor(freshFilter(), cut, bucket, null, rich);
          expect(applyFilter(rich, filter, '2026-11-01').length, `${dim} ${top} ${bucket}`).toBe(stats.totals[bucket]);
        }
      }
    }
  });

  it('who is chosen in the filter of the list by its own field, "nobody" by its word', () => {
    expect(filterFor(freshFilter(), 'actor', 'cdx', null, rich).actors).toEqual(['cdx']);
    expect(filterFor(freshFilter(), 'actor', NONE, null, rich).actors).toEqual([NO_ACTOR]);
    expect(chosenBuckets({ ...freshFilter(), actors: [NO_ACTOR, 'me'] }, 'actor')).toEqual(new Set([NONE, 'me']));
    expect(withoutDim({ ...freshFilter(), actors: ['me'] }, 'actor').actors).toEqual([]);
    expect(toggledBucket({ ...freshFilter(), actors: ['me'] }, 'actor', 'me', rich).actors).toEqual([]);
  });

  it('the legend takes the values of "further" together and gives them back together, the named ones stay', () => {
    const cut = cutOf(rich, 'tag', undefined, 1);
    const on = toggledBucket({ ...freshFilter(), fields: { tag: ['x'] } }, cut, OTHER, rich);
    expect([...(on.fields.tag ?? [])].sort()).toEqual(['x', 'y', 'z']);
    expect(chosenBuckets(on, cut)).toEqual(new Set(['x', OTHER]));
    expect(toggledBucket(on, cut, OTHER, rich).fields.tag).toEqual(['x']);
    // The last value taken away leaves no empty choice behind.
    expect(toggledBucket({ ...freshFilter(), fields: { tag: ['x'] } }, cut, 'x', rich).fields).toEqual({});
  });

  it('a click on a stack of a list field keeps a choice that is on: the list shows the tasks the stack counted', () => {
    // One value chosen (any of one is all of one): the stack's value joins it, and all are asked for.
    const base = { ...freshFilter(), fields: { tag: ['x'] } };
    const kept = applyFilter(rich, base, '2026-11-01');
    const cut = cutOf(rich, 'tag');
    const stats = statsOf(kept, cut);
    expect(stats.totals).toEqual({ x: 2, y: 1 });
    for (const bucket of stats.buckets) {
      const filter = filterFor(base, cut, bucket, null, kept);
      expect(applyFilter(rich, filter, '2026-11-01').length, bucket).toBe(stats.totals[bucket]);
    }
    expect(filterFor(base, cut, 'y', null, kept)).toMatchObject({ fields: { tag: ['x', 'y'] }, matchAll: ['tag'] });
    expect(base.matchAll).toEqual([]);
    // "All of them" on: the same, with every chosen value kept.
    const all = { ...freshFilter(), fields: { category: ['bug'] }, matchAll: ['category' as const] };
    const both = filterFor(all, cutOf(rich, 'category'), 'security', null, rich);
    expect(applyFilter(rich, both, '2026-11-01').map((t) => t.id)).toEqual(['a/r1']);
    // The stack of the value that is chosen already: nothing changes, and "any of them" stays "any of them" (a second
    // tag added in the list must add its tasks, not narrow).
    expect(filterFor(base, cut, 'x', null, kept)).toEqual(base);
    expect(filterFor(all, cutOf(rich, 'category'), 'bug', 'a', rich)).toEqual({ ...all, areas: ['a'] });
    // The stack of the tasks without a value cannot join a value: it is chosen alone.
    expect(filterFor(base, cut, NONE, null, rich)).toMatchObject({ fields: { tag: [NONE] }, matchAll: [] });
  });

  it('"all of them" left on from an earlier choice does not empty the list when "further" is clicked or added in the legend', () => {
    // The person once asked for all of the chosen tags and took the tags away: the switch stays in the filter.
    const stale = { ...freshFilter(), matchAll: ['tag' as const] };
    const cut = cutOf(rich, 'tag', undefined, 1);
    const stats = statsOf(rich, cut);
    const clicked = filterFor(stale, cut, OTHER, null, rich);
    expect(clicked.matchAll).toEqual([]);
    expect(applyFilter(rich, clicked, '2026-11-01').length).toBe(stats.totals[OTHER]);
    const legend = toggledBucket(stale, cut, OTHER, rich);
    expect(legend.matchAll).toEqual([]);
    expect(applyFilter(rich, legend, '2026-11-01').length).toBe(stats.totals[OTHER]);
    // The first value added in the legend starts a choice of "any of them" too; a second one then adds its tasks.
    const one = toggledBucket(stale, cut, 'x', rich);
    expect(one.matchAll).toEqual([]);
    // A choice of "all of them" that has values is the person's and stays.
    const meant = { ...freshFilter(), fields: { tag: ['x'] }, matchAll: ['tag' as const] };
    expect(toggledBucket(meant, cutOf(rich, 'tag'), 'y', rich).matchAll).toEqual(['tag']);
  });

  it('a value that is chosen is in the filter of the list under its own field, also the scope', () => {
    const scoped = applyFilter(rich, { ...freshFilter(), fields: { scope: ['docs'] } }, '2026-11-01');
    expect(scoped.map((t) => t.id)).toEqual(['a/r2']);
    const without = applyFilter(rich, { ...freshFilter(), fields: { scope: [NONE] } }, '2026-11-01');
    expect(without.map((t) => t.id)).toEqual(['b/r3', 'b/r4', 'b/r5']);
  });
});

describe('the finished tasks per area', () => {
  const byArea = [
    { area: 'a', count: 3 },
    { area: 'b', count: 2 },
  ];
  it('takes what the engine counted, all areas when none is chosen', () => {
    expect(finishedPerArea(byArea, [])).toEqual({ total: 5, counts: { a: 3, b: 2 } });
  });
  it('keeps only the areas the filter means', () => {
    expect(finishedPerArea(byArea, ['b', 'c'])).toEqual({ total: 2, counts: { b: 2 } });
  });
  it('keeps an area called __proto__ as a key of its own (folder names are foreign keys)', () => {
    const got = finishedPerArea([{ area: '__proto__', count: 4 }, { area: 'a', count: 1 }], []);
    expect(got.total).toBe(5);
    expect(Object.keys(got.counts).toSorted()).toEqual(['__proto__', 'a']);
    expect(Object.getOwnPropertyDescriptor(got.counts, '__proto__')?.value).toBe(4);
    expect(Object.getPrototypeOf(got.counts)).toBeNull();
  });
});

describe('where the effort comes from', () => {
  it('is the engine for what one question takes, the snapshot for every task beyond it, else nothing', () => {
    expect(effortSource(tasks, tasks)?.from).toBe('engine');
    expect(effortSource(tasks.slice(0, 2), tasks)).toEqual({ from: 'engine', ids: ['a/one', 'a/two'] });
    expect(effortSource([], tasks)).toBeNull();
    const many = Array.from({ length: ESTIMATE_MAX + 2 }, (_, i) => task(`a/t${i}`));
    expect(effortSource(many, many)).toEqual({ from: 'snapshot' });
    expect(effortSource(many.slice(1), many)).toBeNull();
    expect(effortSource(many.slice(0, ESTIMATE_MAX), many)?.from).toBe('engine');
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
