// The statistics of the vault: for every area how many open tasks it has, cut up by one field (status, effort, kind,
// priority, readiness). Plain counting of the tasks the engine sent; no rule of a task is reckoned here (WEB-13): an
// effort written in days stays a day value and is not turned into a size, the quick wins are the engine's.

import type { TaskEntry } from './contract';
import { NONE, type FieldKey, type Filter } from './filter';

export const STAT_DIMS = ['status', 'effort', 'kind', 'prio', 'state'] as const;
export type StatDim = (typeof STAT_DIMS)[number];

export const STAT_SORTS = ['count', 'name'] as const;
export type StatSort = (typeof STAT_SORTS)[number];

/** The stack an effort written in days (`3d`, `0.5d`) is in: the engine knows its days, the page names no size for it. */
export const DAYS = 'days';

/** The stacks of a field, in the order they are drawn; `NONE` is a task without the field. */
const BUCKETS: Record<StatDim, readonly string[]> = {
  status: ['doing', 'decision', 'blocked', 'open', 'parked', NONE],
  effort: ['XS', 'S', 'M', 'L', 'XL', DAYS, NONE],
  kind: ['feature', 'task', 'bug', 'idea', 'research', NONE],
  prio: ['1', '2', '3', '4', NONE],
  state: ['ready', 'decision', 'waiting', 'stuck', 'freed', 'parked', 'unknown', NONE],
};

/** The stacks of `dim`. A value the engine sends and this list does not know gets one of its own after these. */
export function bucketsOf(dim: StatDim): readonly string[] {
  return BUCKETS[dim];
}

/** The stack of a task for `dim`. */
export function bucketOf(dim: StatDim, task: TaskEntry): string {
  const one = (v: string | number | undefined): string => (v === undefined || v === '' ? NONE : String(v));
  switch (dim) {
    case 'status':
      return one(task.status);
    case 'effort': {
      const effort = one(task.effort);
      return effort === NONE || BUCKETS.effort.includes(effort) ? effort : DAYS;
    }
    case 'kind':
      return one(task.kind);
    case 'prio':
      return one(task.prio);
    case 'state':
      return one(task.readiness?.state);
  }
}

export interface StatRow {
  area: string;
  total: number;
  /** How many tasks of the area are in each stack; a stack with none has no entry. */
  counts: Record<string, number>;
}

export interface Stats {
  /** The stacks that have a task, in the order of `bucketsOf` and then those it does not know. */
  buckets: string[];
  rows: StatRow[];
  /** Per stack, over all areas. */
  totals: Record<string, number>;
  total: number;
}

/**
 * The tasks counted per area and stack. Every task is in one row and one stack, so the rows add up to the tasks.
 * `count` puts the area with the most tasks first (a tie by name), `name` sorts by name.
 */
export function statsOf(tasks: readonly TaskEntry[], dim: StatDim, sort: StatSort = 'count'): Stats {
  const rows = new Map<string, StatRow>();
  const totals: Record<string, number> = {};
  for (const task of tasks) {
    const bucket = bucketOf(dim, task);
    let row = rows.get(task.area);
    if (!row) {
      row = { area: task.area, total: 0, counts: {} };
      rows.set(task.area, row);
    }
    row.total += 1;
    row.counts[bucket] = (row.counts[bucket] ?? 0) + 1;
    totals[bucket] = (totals[bucket] ?? 0) + 1;
  }
  const known = BUCKETS[dim];
  const extra = Object.keys(totals)
    .filter((b) => !known.includes(b))
    .sort();
  const buckets = [...known.filter((b) => totals[b] !== undefined), ...extra];
  const byName = (a: StatRow, b: StatRow) => a.area.localeCompare(b.area);
  const list = [...rows.values()].sort(sort === 'name' ? byName : (a, b) => b.total - a.total || byName(a, b));
  return { buckets, rows: list, totals, total: tasks.length };
}

/** The headline numbers: open, ready, doing, blocked, the engine's quick wins and the tasks without an effort. */
export interface StatFigures {
  open: number;
  ready: number;
  doing: number;
  blocked: number;
  /** Undefined when the engine gave no quick wins. */
  quickWins: number | undefined;
  noEffort: number;
}

export function figuresOf(tasks: readonly TaskEntry[], quickWins?: ReadonlySet<string>): StatFigures {
  let ready = 0;
  let doing = 0;
  let blocked = 0;
  let wins = 0;
  let noEffort = 0;
  for (const task of tasks) {
    if (task.readiness?.state === 'ready') ready += 1;
    if (task.status === 'doing') doing += 1;
    if (task.status === 'blocked') blocked += 1;
    if (quickWins?.has(task.id)) wins += 1;
    if (task.effort === undefined || task.effort === '') noEffort += 1;
  }
  return { open: tasks.length, ready, doing, blocked, quickWins: quickWins ? wins : undefined, noEffort };
}

/** The headline numbers a click can open in the list. */
export const FIGURES = ['open', 'ready', 'doing', 'blocked', 'quickWins', 'noEffort'] as const;
export type Figure = (typeof FIGURES)[number];

/**
 * The filter that shows the tasks of one stack (and of one area, when given) in the list: the filter that is on,
 * with the area and the field of the stack set to what was clicked. The day values of the `DAYS` stack are the ones
 * the tasks have (the filter chooses written values).
 */
export function filterFor(
  base: Filter,
  dim: StatDim,
  bucket: string | null,
  area: string | null,
  tasks: readonly TaskEntry[],
): Filter {
  const out: Filter = { ...base, fields: { ...base.fields } };
  if (area !== null) out.areas = [area];
  if (bucket === null) return out;
  if (dim === 'status') {
    out.statuses = [bucket === NONE ? '' : bucket];
    return out;
  }
  const key: FieldKey = dim;
  if (dim === 'effort' && bucket === DAYS) {
    const days = new Set<string>();
    for (const task of tasks) {
      if ((area === null || task.area === area) && bucketOf('effort', task) === DAYS && task.effort) days.add(task.effort);
    }
    out.fields[key] = [...days];
  } else {
    out.fields[key] = [bucket];
  }
  return out;
}

/** The filter of a headline number (the filter that is on, narrowed to what the number counts). */
export function figureFilter(base: Filter, figure: Figure): Filter {
  switch (figure) {
    case 'open':
      return base;
    case 'ready':
      return { ...base, fields: { ...base.fields, state: ['ready'] } };
    case 'doing':
    case 'blocked':
      return { ...base, statuses: [figure] };
    case 'quickWins':
      return { ...base, quickWin: true };
    case 'noEffort':
      return { ...base, fields: { ...base.fields, effort: [NONE] } };
  }
}

/** The stored choice of the view read back: only a field and an order that exist. */
export function parseStatsPrefs(text: string | null): { dim: StatDim; sort: StatSort } {
  const out: { dim: StatDim; sort: StatSort } = { dim: 'status', sort: 'count' };
  if (!text) return out;
  try {
    const raw: unknown = JSON.parse(text);
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
    const { dim, sort } = raw as Record<string, unknown>;
    if (typeof dim === 'string' && (STAT_DIMS as readonly string[]).includes(dim)) out.dim = dim as StatDim;
    if (typeof sort === 'string' && (STAT_SORTS as readonly string[]).includes(sort)) out.sort = sort as StatSort;
  } catch {
    // the defaults
  }
  return out;
}
