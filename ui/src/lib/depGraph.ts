// The plan as a graph: the stages of the engine are the rows, the tasks' own `blocked_by` and `after` are the arrows.
// Nothing here reckons a rule: the rows and their first order are the engine's (the stage, the plan order inside it);
// what this adds is the order inside a row that crosses fewer arrows, and the crossings it is measured by. The same
// data give the same picture.

import type { Op } from './api';
import type { TaskEntry } from './contract';
import type { Stage } from './plan';

export type EdgeKind = 'blocked_by' | 'after';

/** One arrow: `from` is finished first, `to` waits for it. */
export interface DepEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}

/**
 * One row of the picture: a stage of the engine (`null`: the tasks in a cycle, which have none), or, in the rows by
 * phase, a phase of the plan (`phase`; '' for the tasks without one, and `stage` is then null and says nothing).
 */
export interface DepRow {
  stage: number | null;
  phase?: string;
  ids: string[];
}

export interface DepGraph {
  rows: DepRow[];
  /** The arrows between tasks that are both drawn. */
  edges: DepEdge[];
  /** For a task, how many of the tasks it waits for are not in the picture (a filter hides them, or they are done). */
  hidden: Map<string, number>;
}

/** The graph of the shown tasks in their stages: the rows as the engine orders them, the arrows of the tasks. */
export function depGraphOf(stages: readonly Stage[]): DepGraph {
  const rows = stages.map((s) => ({ stage: s.stage, ids: s.tasks.map((t) => t.id) }));
  const tasks: TaskEntry[] = stages.flatMap((s) => s.tasks);
  const drawn = new Set(tasks.map((t) => t.id));
  const edges: DepEdge[] = [];
  const hidden = new Map<string, number>();
  for (const task of tasks) {
    for (const kind of ['blocked_by', 'after'] as const) {
      for (const from of task[kind] ?? []) {
        if (drawn.has(from)) edges.push({ from, to: task.id, kind });
        else if (kind === 'blocked_by') hidden.set(task.id, (hidden.get(task.id) ?? 0) + 1);
      }
    }
  }
  return { rows, edges, hidden };
}

/**
 * The stages cut to the tasks of a focus (what one task needs, or what waits for it, as the engine's `planfor` names
 * them); a stage left without a task goes. No focus: the stages as they are.
 */
export function focusStages(stages: readonly Stage[], ids: ReadonlySet<string> | null): readonly Stage[] {
  if (ids === null) return stages;
  return stages
    .map((s) => ({ stage: s.stage, tasks: s.tasks.filter((t) => ids.has(t.id)) }))
    .filter((s) => s.tasks.length > 0);
}

export type EdgeAction = 'remove' | 'toggle';

/**
 * The write that takes one arrow away (`remove`), or makes a hard one soft and a soft one hard (`toggle`): one `set`
 * at the task that waits, on the version shown. A list left empty is taken away (`null`). No arrow of the task as it
 * is shown: nothing to write (`null`); whether the change is allowed is the engine's to say.
 */
export function edgeOp(task: TaskEntry, edge: DepEdge, action: EdgeAction): Op | null {
  const list = task[edge.kind] ?? [];
  if (task.id !== edge.to || !list.includes(edge.from)) return null;
  const rest = list.filter((id) => id !== edge.from);
  const patch: Record<string, string[] | null> = { [edge.kind]: rest.length > 0 ? rest : null };
  if (action === 'toggle') {
    const other = edge.kind === 'blocked_by' ? 'after' : 'blocked_by';
    const was = task[other] ?? [];
    patch[other] = was.includes(edge.from) ? was : [...was, edge.from];
  }
  return { op: 'set', id: task.id, patch, ...(task.etag ? { if_match: task.etag } : {}) };
}

/**
 * The write that makes `task` wait for `from`: `from` into its `blocked_by` (`kind`), or into its `after` (soft). A task
 * is not joined to itself, and not twice to the same task (hard or soft): nothing to write (`null`). A cycle is the
 * engine's to find (`blocked-by-cycle`): the page reckons no graph.
 */
export function connectOp(task: TaskEntry, from: string, kind: EdgeKind): Op | null {
  if (from === task.id || (task.blocked_by ?? []).includes(from) || (task.after ?? []).includes(from)) return null;
  return { op: 'set', id: task.id, patch: { [kind]: [...(task[kind] ?? []), from] }, ...(task.etag ? { if_match: task.etag } : {}) };
}

/**
 * The rows by phase: one per phase of the plan in its order (also one no task stands in yet: a place to drop on),
 * then the tasks without a phase, or with one the plan does not name. Inside a row the plan order of the stages.
 */
export function phaseRows(stages: readonly Stage[], order: readonly string[]): DepRow[] {
  const rows: DepRow[] = [...order, ''].map((phase) => ({ stage: null, phase, ids: [] }));
  const at = new Map(rows.map((r, i) => [r.phase!, i] as const));
  for (const task of stages.flatMap((s) => s.tasks)) rows[at.get(task.phase ?? '') ?? order.length]!.ids.push(task.id);
  return rows;
}

/** The write that puts `task` into `phase` ('' takes its phase away); `null` when it is there already. */
export function phaseOp(task: TaskEntry, phase: string): Op | null {
  if ((task.phase ?? '') === phase) return null;
  return { op: 'set', id: task.id, patch: { phase: phase === '' ? null : phase }, ...(task.etag ? { if_match: task.etag } : {}) };
}

/** Where each task stands: its row and its place in the row. */
function places(rows: readonly DepRow[]): Map<string, { row: number; col: number }> {
  const out = new Map<string, { row: number; col: number }>();
  rows.forEach((r, row) => r.ids.forEach((id, col) => out.set(id, { row, col })));
  return out;
}

/**
 * The rows in an order that crosses fewer arrows: each row, from the second down, is sorted by the mean place of the
 * tasks its tasks wait for in the rows above (the barycentre), then each row from the last but one up by the mean
 * place of the tasks that wait for them below; a few such sweeps. A task with no neighbour keeps its place, a tie keeps
 * the order it had (the plan order at first), so the result never depends on anything but the data.
 */
export function orderRows(rows: readonly DepRow[], edges: readonly DepEdge[], sweeps = 4): DepRow[] {
  let out = rows.map((r) => ({ ...r, ids: [...r.ids] }));
  const sortRow = (index: number, neighbours: (id: string) => string[]): void => {
    const at = places(out);
    const row = out[index]!;
    const keyed = row.ids.map((id, col) => {
      const cols = neighbours(id)
        .map((n) => at.get(n))
        .filter((p): p is { row: number; col: number } => p !== undefined && p.row !== index)
        .map((p) => p.col / Math.max(1, out[p.row]!.ids.length - 1));
      const own = col / Math.max(1, row.ids.length - 1);
      return { id, col, key: cols.length === 0 ? own : cols.reduce((a, b) => a + b, 0) / cols.length };
    });
    keyed.sort((a, b) => a.key - b.key || a.col - b.col);
    out[index] = { ...row, ids: keyed.map((k) => k.id) };
  };
  const before = new Map<string, string[]>();
  const after = new Map<string, string[]>();
  for (const e of edges) {
    before.set(e.to, [...(before.get(e.to) ?? []), e.from]);
    after.set(e.from, [...(after.get(e.from) ?? []), e.to]);
  }
  for (let s = 0; s < sweeps; s += 1) {
    for (let i = 1; i < out.length; i += 1) sortRow(i, (id) => before.get(id) ?? []);
    for (let i = out.length - 2; i >= 0; i -= 1) sortRow(i, (id) => after.get(id) ?? []);
  }
  // The first row is sorted by what waits below, and that may have moved it from the plan order for nothing: a sweep
  // never makes the crossings more, but the result is kept only when it crosses fewer than the plan order.
  out = crossings(out, edges) <= crossings(rows, edges) ? out : rows.map((r) => ({ ...r, ids: [...r.ids] }));
  return out;
}

/** How many pairs of arrows between two neighbouring rows cross (the measure the order is made by). */
export function crossings(rows: readonly DepRow[], edges: readonly DepEdge[]): number {
  const at = places(rows);
  const spans = edges
    .map((e) => ({ a: at.get(e.from), b: at.get(e.to) }))
    .filter((s): s is { a: { row: number; col: number }; b: { row: number; col: number } } => !!s.a && !!s.b && s.b.row === s.a.row + 1);
  let n = 0;
  for (let i = 0; i < spans.length; i += 1) {
    for (let j = i + 1; j < spans.length; j += 1) {
      const x = spans[i]!;
      const y = spans[j]!;
      if (x.a.row !== y.a.row) continue;
      if ((x.a.col - y.a.col) * (x.b.col - y.b.col) < 0) n += 1;
    }
  }
  return n;
}

/** The arrows on the critical path: from one task of the path to the next. */
export function criticalEdges(path: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 1; i < path.length; i += 1) out.add(`${path[i - 1]}>${path[i]}`);
  return out;
}

/** The task a key moves to from `id`: left and right in its row, up and down to the nearest place in the next row. */
export function neighbourOf(rows: readonly DepRow[], id: string, key: 'left' | 'right' | 'up' | 'down'): string | null {
  const at = places(rows).get(id);
  if (!at) return null;
  const row = rows[at.row]!;
  if (key === 'left') return row.ids[at.col - 1] ?? null;
  if (key === 'right') return row.ids[at.col + 1] ?? null;
  // The next row that has tasks (an empty one is skipped), at the place nearest to the same share of its width.
  const step = key === 'up' ? -1 : 1;
  for (let r = at.row + step; r >= 0 && r < rows.length; r += step) {
    const next = rows[r]!.ids;
    if (next.length === 0) continue;
    const share = row.ids.length <= 1 ? 0 : at.col / (row.ids.length - 1);
    return next[Math.round(share * (next.length - 1))] ?? null;
  }
  return null;
}
