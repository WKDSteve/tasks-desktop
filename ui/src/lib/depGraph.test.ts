import { describe, expect, it } from 'vitest';
import { task } from './fixtures';
import {
  applyOrder,
  connectOp,
  criticalEdges,
  crossings,
  depGraphOf,
  edgeOp,
  focusStages,
  movedInRow,
  neighbourOf,
  orderRows,
  parseGraphOrder,
  phaseOp,
  phaseRows,
  type DepRow,
} from './depGraph';

describe('the plan as a graph', () => {
  it('takes the stages as rows and the tasks own blocked_by and after as arrows, between drawn tasks only', () => {
    const g = depGraphOf([
      { stage: 0, tasks: [task('a/1'), task('a/2')] },
      { stage: 1, tasks: [task('a/3', { blocked_by: ['a/1', 'a/gone'], after: ['a/2', 'a/elsewhere'] })] },
      { stage: null, tasks: [task('a/4', { blocked_by: ['a/5'] }), task('a/5', { blocked_by: ['a/4'] })] },
    ]);
    expect(g.rows).toEqual([
      { stage: 0, ids: ['a/1', 'a/2'] },
      { stage: 1, ids: ['a/3'] },
      { stage: null, ids: ['a/4', 'a/5'] },
    ]);
    expect(g.edges).toEqual([
      { from: 'a/1', to: 'a/3', kind: 'blocked_by' },
      { from: 'a/2', to: 'a/3', kind: 'after' },
      { from: 'a/5', to: 'a/4', kind: 'blocked_by' },
      { from: 'a/4', to: 'a/5', kind: 'blocked_by' },
    ]);
    // A hard blocker that is not drawn is counted; a soft one is not (it holds nothing up).
    expect(g.hidden.get('a/3')).toBe(1);
    expect(g.hidden.has('a/4')).toBe(false);
  });

  it('orders a row so that fewer arrows cross, and keeps the plan order where it changes nothing', () => {
    // a/1 -> a/4, a/2 -> a/3: in the plan order the two arrows cross.
    const rows: DepRow[] = [
      { stage: 0, ids: ['a/1', 'a/2'] },
      { stage: 1, ids: ['a/3', 'a/4'] },
    ];
    const edges = [
      { from: 'a/1', to: 'a/4', kind: 'blocked_by' as const },
      { from: 'a/2', to: 'a/3', kind: 'blocked_by' as const },
    ];
    expect(crossings(rows, edges)).toBe(1);
    const ordered = orderRows(rows, edges);
    expect(crossings(ordered, edges)).toBe(0);
    expect(ordered.map((r) => r.stage)).toEqual([0, 1]);
    // Nothing to gain: the order stays as the engine gave it.
    const calm = [
      { stage: 0, ids: ['a/1', 'a/2', 'a/9'] },
      { stage: 1, ids: ['a/3'] },
    ];
    expect(orderRows(calm, [{ from: 'a/1', to: 'a/3', kind: 'blocked_by' }])).toEqual(calm);
  });

  it('is the same picture for the same data, and never crosses more than the plan order', () => {
    const rows: DepRow[] = [
      { stage: 0, ids: ['a', 'b', 'c', 'd'] },
      { stage: 1, ids: ['e', 'f', 'g', 'h'] },
      { stage: 2, ids: ['i', 'j'] },
    ];
    const edges = (
      [
        ['a', 'h'],
        ['b', 'g'],
        ['c', 'f'],
        ['d', 'e'],
        ['e', 'j'],
        ['h', 'i'],
        ['a', 'e'],
      ] as const
    ).map(([from, to]) => ({ from, to, kind: 'blocked_by' as const }));
    const once = orderRows(rows, edges);
    expect(orderRows(rows, edges)).toEqual(once);
    expect(crossings(once, edges)).toBeLessThan(crossings(rows, edges));
    // Every task is still in its own row.
    expect(once.map((r) => [...r.ids].sort())).toEqual(rows.map((r) => [...r.ids].sort()));
  });

  it('counts only arrows between neighbouring rows as crossings', () => {
    const rows: DepRow[] = [
      { stage: 0, ids: ['a', 'b'] },
      { stage: 1, ids: ['c'] },
      { stage: 2, ids: ['d', 'e'] },
    ];
    expect(
      crossings(rows, [
        { from: 'a', to: 'e', kind: 'blocked_by' },
        { from: 'b', to: 'd', kind: 'blocked_by' },
      ]),
    ).toBe(0);
  });

  it('marks the arrows of the critical path, from one task of the path to the next', () => {
    expect([...criticalEdges(['a', 'b', 'c'])]).toEqual(['a>b', 'b>c']);
    expect(criticalEdges([]).size).toBe(0);
  });

  it('moves the keys in a row and to the nearest place in the next row that has tasks', () => {
    const rows: DepRow[] = [
      { stage: 0, ids: ['a', 'b', 'c'] },
      { stage: 1, ids: [] },
      { stage: 2, ids: ['d', 'e'] },
    ];
    expect(neighbourOf(rows, 'b', 'left')).toBe('a');
    expect(neighbourOf(rows, 'b', 'right')).toBe('c');
    expect(neighbourOf(rows, 'c', 'right')).toBeNull();
    expect(neighbourOf(rows, 'c', 'down')).toBe('e');
    expect(neighbourOf(rows, 'a', 'down')).toBe('d');
    expect(neighbourOf(rows, 'e', 'up')).toBe('c');
    expect(neighbourOf(rows, 'a', 'up')).toBeNull();
    expect(neighbourOf(rows, 'zz', 'up')).toBeNull();
  });

  it('cuts the stages to the tasks of a focus, drops a stage left empty, and draws only the arrows between them', () => {
    const stages = [
      { stage: 0, tasks: [task('a/1'), task('a/2')] },
      { stage: 1, tasks: [task('a/3', { blocked_by: ['a/1', 'a/2'] })] },
      { stage: 2, tasks: [task('a/4', { blocked_by: ['a/2'] })] },
    ];
    expect(focusStages(stages, null)).toBe(stages);
    const cut = focusStages(stages, new Set(['a/1', 'a/3', 'a/elsewhere']));
    expect(cut.map((s) => [s.stage, s.tasks.map((t) => t.id)])).toEqual([
      [0, ['a/1']],
      [1, ['a/3']],
    ]);
    const g = depGraphOf(cut);
    expect(g.edges).toEqual([{ from: 'a/1', to: 'a/3', kind: 'blocked_by' }]);
    // The blocker the focus leaves out is counted as not shown, as a filter's.
    expect(g.hidden.get('a/3')).toBe(1);
  });

  it('writes one set at the waiting task to take an arrow away or to turn it hard or soft, on the version shown', () => {
    const b = task('a/b', { blocked_by: ['a/1', 'a/2'], after: ['a/3'], etag: 'e1' });
    const hard = { from: 'a/1', to: 'a/b', kind: 'blocked_by' } as const;
    expect(edgeOp(b, hard, 'remove')).toEqual({ op: 'set', id: 'a/b', patch: { blocked_by: ['a/2'] }, if_match: 'e1' });
    expect(edgeOp(b, hard, 'toggle')).toEqual({ op: 'set', id: 'a/b', patch: { blocked_by: ['a/2'], after: ['a/3', 'a/1'] }, if_match: 'e1' });
    // The last one of a list takes the key away; soft to hard.
    const soft = { from: 'a/3', to: 'a/b', kind: 'after' } as const;
    expect(edgeOp(b, soft, 'remove')).toEqual({ op: 'set', id: 'a/b', patch: { after: null }, if_match: 'e1' });
    expect(edgeOp(b, soft, 'toggle')).toEqual({ op: 'set', id: 'a/b', patch: { after: null, blocked_by: ['a/1', 'a/2', 'a/3'] }, if_match: 'e1' });
    // An arrow the task does not have (any more), or of another task: nothing to write.
    expect(edgeOp(b, { from: 'a/9', to: 'a/b', kind: 'blocked_by' }, 'remove')).toBeNull();
    expect(edgeOp(b, { from: 'a/1', to: 'a/c', kind: 'blocked_by' }, 'remove')).toBeNull();
  });

  it('joins a task to another with one set, hard or soft, and not to itself nor twice', () => {
    const c = task('a/c', { blocked_by: ['a/1'], after: ['a/2'], etag: 'e2' });
    expect(connectOp(c, 'a/3', 'blocked_by')).toEqual({ op: 'set', id: 'a/c', patch: { blocked_by: ['a/1', 'a/3'] }, if_match: 'e2' });
    expect(connectOp(c, 'a/3', 'after')).toEqual({ op: 'set', id: 'a/c', patch: { after: ['a/2', 'a/3'] }, if_match: 'e2' });
    expect(connectOp(task('a/d'), 'a/3', 'blocked_by')).toEqual({ op: 'set', id: 'a/d', patch: { blocked_by: ['a/3'] } });
    // Itself, or joined already (either way): nothing to write.
    expect(connectOp(c, 'a/c', 'blocked_by')).toBeNull();
    expect(connectOp(c, 'a/1', 'after')).toBeNull();
    expect(connectOp(c, 'a/2', 'blocked_by')).toBeNull();
  });

  it('lays the rows by phase: each phase of the plan in its order, an empty one too, then the tasks without one', () => {
    const stages = [
      { stage: 0, tasks: [task('a/1', { phase: 'test' }), task('a/2')] },
      { stage: 1, tasks: [task('a/3', { phase: 'build', blocked_by: ['a/1'] }), task('a/4', { phase: 'gone' })] },
    ];
    const rows = phaseRows(stages, ['build', 'test', 'ship']);
    expect(rows).toEqual([
      { stage: null, phase: 'build', ids: ['a/3'] },
      { stage: null, phase: 'test', ids: ['a/1'] },
      { stage: null, phase: 'ship', ids: [] },
      { stage: null, phase: '', ids: ['a/2', 'a/4'] },
    ]);
    // The order of a row keeps the phase of the row.
    expect(orderRows(rows, depGraphOf(stages).edges).map((r) => r.phase)).toEqual(['build', 'test', 'ship', '']);
  });

  it('puts a task into a phase with one set, or takes its phase away, and writes nothing where it is already', () => {
    const t = task('a/1', { phase: 'build', etag: 'e3' });
    expect(phaseOp(t, 'test')).toEqual({ op: 'set', id: 'a/1', patch: { phase: 'test' }, if_match: 'e3' });
    expect(phaseOp(t, '')).toEqual({ op: 'set', id: 'a/1', patch: { phase: null }, if_match: 'e3' });
    expect(phaseOp(t, 'build')).toBeNull();
    expect(phaseOp(task('a/2'), '')).toBeNull();
  });

  it('puts a kept order first in a row, drops the tasks that left it and keeps the new ones after it', () => {
    const rows: DepRow[] = [
      { stage: 0, ids: ['a', 'b', 'c'] },
      { stage: 1, ids: ['d', 'e'] },
    ];
    const key = (r: DepRow) => String(r.stage);
    expect(applyOrder(rows, undefined, key)).toEqual(rows);
    expect(applyOrder(rows, { '0': ['c', 'gone', 'a'] }, key)).toEqual([
      { stage: 0, ids: ['c', 'a', 'b'] },
      { stage: 1, ids: ['d', 'e'] },
    ]);
  });

  it('moves a task one place in its row or before another, and says nothing when it would not move', () => {
    expect(movedInRow(['a', 'b', 'c'], 'b', { step: -1 })).toEqual(['b', 'a', 'c']);
    expect(movedInRow(['a', 'b', 'c'], 'b', { step: 1 })).toEqual(['a', 'c', 'b']);
    expect(movedInRow(['a', 'b', 'c'], 'a', { step: -1 })).toBeNull();
    expect(movedInRow(['a', 'b', 'c'], 'c', { step: 1 })).toBeNull();
    expect(movedInRow(['a', 'b', 'c'], 'c', { before: 'a' })).toEqual(['c', 'a', 'b']);
    expect(movedInRow(['a', 'b', 'c'], 'a', { before: 'c' })).toEqual(['b', 'a', 'c']);
    expect(movedInRow(['a', 'b', 'c'], 'a', { before: 'b' })).toBeNull();
    expect(movedInRow(['a', 'b', 'c'], 'x', { step: 1 })).toBeNull();
    expect(movedInRow(['a', 'b', 'c'], 'a', { before: 'x' })).toBeNull();
  });

  it('reads the kept orders and drops what is not one', () => {
    expect(parseGraphOrder(null)).toEqual({});
    expect(parseGraphOrder('not json')).toEqual({});
    expect(parseGraphOrder('[1]')).toEqual({});
    expect(parseGraphOrder('{"p":{"0":["a","b"],"1":[2]},"q":"x","r":{}}')).toEqual({ p: { '0': ['a', 'b'] } });
  });
});
