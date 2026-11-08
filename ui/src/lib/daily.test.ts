import { describe, expect, it } from 'vitest';
import type { Finished, FinishedItem } from './contract';
import { finishedFilter, finishedOf, listIsPart, metricValues, narrowFinished, periodTasks, type FinishedMetric } from './daily';
import { freshFilter, type Filter } from './filter';

const figures = (tasks: never[], day: string) => {
  const v = metricValues(tasks, null, { since: day, until: day });
  return { created: v.created.value, changed: v.changed.value };
};
const task = (created?: string, updated?: string) => ({ created, updated }) as never;

describe('the figures of the day', () => {
  it('counts the tasks made today, and the older ones changed today, each once', () => {
    const got = figures(
      [
        task('2026-10-20', '2026-10-20'), // made and touched today: new, not changed too
        task('2026-10-20'),
        task('2026-10-01', '2026-10-20'),
        task('2026-10-01', '2026-10-19'),
        task(undefined, '2026-10-20'), // no created date: changed
        task(),
      ],
      '2026-10-20',
    );
    expect(got).toEqual({ created: 2, changed: 2 });
  });

  it('is zero for an empty vault and a day nothing happened on', () => {
    expect(figures([], '2026-10-20')).toEqual({ created: 0, changed: 0 });
    expect(figures([task('2026-01-01', '2026-01-02')], '2026-10-20')).toEqual({ created: 0, changed: 0 });
  });
});

describe('the filter of the list on the tile', () => {
  const item = (id: string, extra: Partial<FinishedItem> = {}): FinishedItem => {
    const [area = '', slug = ''] = id.split('/');
    return { id, area, slug, title: `Title ${slug}`, tags: [], file: `${slug}.md`, ...extra };
  };
  const doc = (items: FinishedItem[], total = items.length): Finished =>
    ({
      kind: 'tasks.finished',
      total,
      offset: 0,
      limit: 100,
      items,
      undated: 0,
      incomplete: [],
      stats: { effort_days: 99, without_effort: 0, by_area: [], by_kind: [{ kind: 'bug', count: 9, effort_days: 0 }], by_prio: [], by_month: [], by_week: [] },
    }) as unknown as Finished;
  const day = { since: '2026-11-08', until: '2026-11-08' };
  const items = [
    item('testing.nvim/a', { effort: 'XS', effort_days: 0.25, kind: 'bug', prio: 1 }),
    item('testing.nvim/b', { effort: 'M', effort_days: 3 }),
    item('lib.nvim/c', { effort: 'XS', effort_days: 0.25, kind: 'bug' }),
  ];

  it('counts the finished ones of the area and the effort the filter keeps, their figures from those kept', () => {
    const filter: Filter = { ...freshFilter(), areas: ['testing.nvim'], fields: { effort: ['XS'] } };
    const { filter: forFinished, ignored } = finishedFilter(filter);
    expect(ignored).toEqual([]);
    const { doc: narrowed, cut } = narrowFinished(doc(items), forFinished);
    expect(cut).toBe(false);
    expect(narrowed.items.map((i) => i.id)).toEqual(['testing.nvim/a']);
    const v = metricValues([], narrowed, day, cut);
    expect([v.finished, v.effort, v.bugs, v.prio1, v.quick]).toEqual([
      { value: 1, partial: false },
      { value: 0.3, partial: false },
      { value: 1, partial: false },
      { value: 1, partial: false },
      { value: 1, partial: false },
    ]);
  });

  it('leaves out and names the parts a finished task does not carry, and keeps the text and the ranges', () => {
    const filter: Filter = {
      ...freshFilter(),
      statuses: ['open'],
      actors: ['me'],
      query: 'title b',
      fields: { project: ['ALL/x'], tag: ['ui'], state: ['ready'] },
      dates: { due: { from: '2026-01-01' } },
      ranges: { effort: { min: { label: 'M', n: 2 } } },
      quickWin: true,
    };
    const { filter: forFinished, ignored } = finishedFilter(filter);
    expect(ignored).toEqual([
      { kind: 'status' },
      { kind: 'actor' },
      { kind: 'field', key: 'state' },
      { kind: 'field', key: 'project' },
      { kind: 'date', key: 'due' },
      { kind: 'quickWin' },
    ]);
    expect(forFinished.fields).toEqual({ tag: ['ui'] });
    const tagged = items.map((i) => (i.id === 'testing.nvim/b' ? { ...i, tags: ['ui'] } : i));
    expect(narrowFinished(doc(tagged), forFinished).doc.items.map((i) => i.id)).toEqual(['testing.nvim/b']);
  });

  it('says at least when more were finished than were read', () => {
    const { doc: narrowed, cut } = narrowFinished(doc(items, 700), finishedFilter({ ...freshFilter(), areas: ['lib.nvim'] }).filter);
    expect(cut).toBe(true);
    expect(metricValues([], narrowed, day, cut).finished).toEqual({ value: 1, partial: true });
    // Without a filter the engine's figures stand as they are.
    expect(metricValues([], doc(items, 700), day).finished).toEqual({ value: 700, partial: false });
    expect(metricValues([], doc(items, 700), day).effort.value).toBe(99);
  });
});

describe('the tasks behind each figure', () => {
  const day = { since: '2026-11-02', until: '2026-11-08' };
  const item = (id: string, extra: Partial<FinishedItem> = {}): FinishedItem =>
    ({ id, area: 'a', slug: id, title: id, tags: [], file: `${id}.md`, ...extra }) as FinishedItem;
  // The figures of a document are those `narrowFinished` sums up (an empty filter keeps all): the same as the engine's.
  const read = narrowFinished(
    {
      kind: 'tasks.finished',
      total: 5,
      offset: 0,
      limit: 100,
      items: [
        item('q', { effort_days: 0.25, kind: 'bug', prio: 1, done_in: 'abc' }),
        item('m', { effort_days: 3, prio: 2, done_in: 'abc' }),
        item('b', { kind: 'bug', prio: 1, done_in: 'def' }),
        item('h', { effort_days: 0.5 }),
        item('n', { done_in: '' }),
      ],
      undated: 0,
      incomplete: [],
      stats: { effort_days: 0, without_effort: 0, by_area: [], by_kind: [], by_prio: [], by_month: [], by_week: [] },
    } as unknown as Finished,
    freshFilter(),
  ).doc;

  it('lists as many open tasks as are counted: the made ones, and the changed ones without the made', () => {
    const tasks = [
      { id: 'made', created: '2026-11-03', updated: '2026-11-07' },
      { id: 'changed', created: '2026-10-01', updated: '2026-11-08' },
      { id: 'old', created: '2026-10-01', updated: '2026-10-30' },
      { id: 'later', created: '2026-11-09' },
    ] as never[];
    const open = periodTasks(tasks as { id: string; created?: string; updated?: string }[], day);
    expect(open.created.map((t) => t.id)).toEqual(['made']);
    expect(open.changed.map((t) => t.id)).toEqual(['changed']);
    const v = metricValues(tasks, null, day);
    expect([v.created.value, v.changed.value]).toEqual([open.created.length, open.changed.length]);
  });

  it('lists the finished tasks each figure counts, the same number', () => {
    const v = metricValues([], read, day);
    for (const metric of ['finished', 'quick', 'bugs', 'prio1'] as FinishedMetric[]) {
      expect(finishedOf(metric, read).length, metric).toBe(v[metric].value);
    }
    expect(finishedOf('quick', read).map((i) => i.id)).toEqual(['q', 'h']);
    // The effort is a sum of days: the list is the tasks with an effort, adding up to the figure.
    const withEffort = finishedOf('effort', read);
    expect(withEffort.map((i) => i.id)).toEqual(['q', 'm', 'h']);
    expect(Math.round(withEffort.reduce((sum, i) => sum + (i.effort_days ?? 0), 0) * 10) / 10).toBe(v.effort.value);
    // The commits are the different ones: the list is the tasks that name one.
    const named = finishedOf('commits', read);
    expect(named.map((i) => i.id)).toEqual(['q', 'm', 'b']);
    expect(new Set(named.map((i) => i.done_in)).size).toBe(v.commits.value);
  });

  it('says the list is a part when more were finished than were read, also where the figure itself is exact', () => {
    const more = { ...read, total: 600 } as Finished;
    const v = metricValues([], more, day);
    expect(v.finished).toEqual({ value: 600, partial: false });
    expect(listIsPart(more, v.finished.partial)).toBe(true);
    expect(listIsPart(read, false)).toBe(false);
    expect(listIsPart(read, true)).toBe(true);
  });
});
