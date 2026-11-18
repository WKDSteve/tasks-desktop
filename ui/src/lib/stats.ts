// The statistics of the vault: for every area how many open tasks it has, cut up by one field (status, effort, kind,
// priority, readiness, who, value, severity, category, scope, tag, plan, phase, project). Plain counting of the tasks
// the engine sent; no rule of a task is reckoned here (WEB-13): an effort written in days stays a day value and is not
// turned into a size, the quick wins are the engine's. A due date is not a field to cut by: "overdue" and "due soon"
// are reckoned from today, and the filter of the list can only say "overdue".

import type { TaskEntry } from './contract';
import { fieldValues, NO_ACTOR, NONE, toggled, type FieldKey, type Filter, type ProjectOf } from './filter';

export const STAT_DIMS = [
  'status',
  'effort',
  'kind',
  'prio',
  'state',
  'actor',
  'value',
  'severity',
  'category',
  'scope',
  'tag',
  'plan',
  'phase',
  'project',
] as const;
export type StatDim = (typeof STAT_DIMS)[number];

/** The fields a task can hold several values of: it counts in each of them, so the stacks can add up to more than the tasks. */
export const STAT_MULTI: readonly StatDim[] = ['category', 'scope', 'tag'];
export const isMultiDim = (dim: StatDim): boolean => STAT_MULTI.includes(dim);

/**
 * The fields whose values the tasks name freely (or that can have many): their stacks are the values the tasks have,
 * the most frequent first, and beyond `TOP` the rest is one stack (`OTHER`).
 */
export const STAT_OPEN: readonly StatDim[] = ['category', 'scope', 'tag', 'plan', 'phase', 'project'];
export const isOpenDim = (dim: StatDim): boolean => STAT_OPEN.includes(dim);
/** How many values of an open field get a stack of their own. */
export const TOP = 10;

export const STAT_SORTS = ['count', 'name'] as const;
export type StatSort = (typeof STAT_SORTS)[number];

/** The stack an effort written in days (`3d`, `0.5d`) is in: the engine knows its days, the page names no size for it. */
export const DAYS = 'days';
/**
 * The stack of the values of an open field beyond the most frequent ones. Like `NONE` it starts with a control
 * character, which no value can hold.
 */
export const OTHER = '\u0000other';

/** The stacks of a field with known values, in the order they are drawn; `NONE` is a task without the field. */
const BUCKETS: Record<StatDim, readonly string[]> = {
  status: ['doing', 'decision', 'blocked', 'open', 'parked', NONE],
  effort: ['XS', 'S', 'M', 'L', 'XL', DAYS, NONE],
  kind: ['feature', 'task', 'bug', 'idea', 'research', NONE],
  prio: ['1', '2', '3', '4', NONE],
  state: ['ready', 'decision', 'waiting', 'stuck', 'freed', 'parked', 'unknown', NONE],
  actor: ['me', 'pair', 'cdx', NONE],
  value: ['5', '4', '3', '2', '1', NONE],
  severity: ['critical', 'high', 'medium', 'low', NONE],
  category: [],
  scope: [],
  tag: [],
  plan: [],
  phase: [],
  project: [],
};

/** The stacks of `dim` that are known beforehand. A value the engine sends and this list does not know gets one of its own after these. */
export function bucketsOf(dim: StatDim): readonly string[] {
  return BUCKETS[dim];
}

/**
 * A field to cut by, with what the counting needs besides its name: for an open field the values that get a stack of
 * their own (`named`, the most frequent first), and how a task's project is found. One cut is made for a view and
 * given to every count of it, so the bars, the legend and a click agree on which values are "further".
 */
export interface StatCut {
  dim: StatDim;
  /** Null for a field with known values. */
  named: readonly string[] | null;
  projectOf?: ProjectOf;
}

const cut = (of: StatDim | StatCut): StatCut => (typeof of === 'string' ? { dim: of, named: null } : of);

/** The values a task has for `dim` as they are written (`NONE` for none); several for a list field, each once. */
export function valuesOf(of: StatDim | StatCut, task: TaskEntry): string[] {
  const { dim, projectOf } = cut(of);
  const one = (v: string | number | undefined): string[] => [v === undefined || v === '' ? NONE : String(v)];
  switch (dim) {
    case 'status':
      return one(task.status);
    case 'actor':
      return one(task.actor);
    default:
      return [...new Set(fieldValues(task, dim, projectOf))];
  }
}

/** The stack a written value is in: itself, `DAYS` for an effort in days, `OTHER` for a value of an open field that is not named. */
export function bucketOfValue(of: StatDim | StatCut, value: string): string {
  const { dim, named } = cut(of);
  if (value === NONE) return NONE;
  if (dim === 'effort') return BUCKETS.effort.includes(value) ? value : DAYS;
  if (named !== null && !named.includes(value)) return OTHER;
  return value;
}

/** The stacks of a task: one, or several for a list field (each once: two tags beyond the named ones are one "further"). */
export function bucketsOfTask(of: StatDim | StatCut, task: TaskEntry): string[] {
  const c = cut(of);
  const out: string[] = [];
  for (const value of valuesOf(c, task)) {
    const bucket = bucketOfValue(c, value);
    if (!out.includes(bucket)) out.push(bucket);
  }
  return out;
}

/** The stack of a task for a field it has one value of. */
export function bucketOf(dim: StatDim, task: TaskEntry): string {
  return bucketsOfTask(dim, task)[0] ?? NONE;
}

/**
 * The cut of a view by `dim`. For an open field the `top` most frequent values of `tasks` are named (a tie by name);
 * `tasks` are the ones the legend counts (the filter without the choice of this field), so a choice in the legend
 * does not change which values are named.
 */
export function cutOf(tasks: readonly TaskEntry[], dim: StatDim, projectOf?: ProjectOf, top: number = TOP): StatCut {
  if (!isOpenDim(dim)) return { dim, named: null, projectOf };
  const plain: StatCut = { dim, named: null, projectOf };
  const counts = new Map<string, number>();
  for (const task of tasks) {
    for (const value of valuesOf(plain, task)) if (value !== NONE) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const named = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, top)
    .map(([value]) => value);
  return { dim, named, projectOf };
}

export interface StatRow {
  area: string;
  /** The tasks of the area. */
  total: number;
  /** How many tasks of the area are in each stack; a stack with none has no entry. */
  counts: Record<string, number>;
}

export interface Stats {
  /** The stacks that have a task: the known or named ones in their order, those unknown, then "further" and "none". */
  buckets: string[];
  rows: StatRow[];
  /** Per stack, over all areas. */
  totals: Record<string, number>;
  /** The tasks counted. */
  total: number;
}

/**
 * The tasks counted per area and stack. With a field a task has one value of, every task is in one row and one stack,
 * so the rows add up to the tasks; with a list field it is in one row and in every stack it has a value of.
 * `count` puts the area with the most tasks first (a tie by name), `name` sorts by name. The name is the one shown
 * (`label`, e.g. without the prefix `wkdbook-`), so the order is the one the eye reads.
 */
export function statsOf(
  tasks: readonly TaskEntry[],
  of: StatDim | StatCut,
  sort: StatSort = 'count',
  label: (area: string) => string = (area) => area,
): Stats {
  const c = cut(of);
  const rows = new Map<string, StatRow>();
  const totals: Record<string, number> = {};
  for (const task of tasks) {
    let row = rows.get(task.area);
    if (!row) {
      row = { area: task.area, total: 0, counts: {} };
      rows.set(task.area, row);
    }
    row.total += 1;
    for (const bucket of bucketsOfTask(c, task)) {
      row.counts[bucket] = (row.counts[bucket] ?? 0) + 1;
      totals[bucket] = (totals[bucket] ?? 0) + 1;
    }
  }
  const known = [...BUCKETS[c.dim], ...(c.named ?? [])];
  const last = [OTHER, NONE].filter((b) => !known.includes(b));
  const extra = Object.keys(totals)
    .filter((b) => !known.includes(b) && !last.includes(b))
    .sort();
  const buckets = [...known, ...extra, ...last].filter((b) => totals[b] !== undefined);
  const byName = (a: StatRow, b: StatRow) => label(a.area).localeCompare(label(b.area)) || a.area.localeCompare(b.area);
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

/** Whether a stack stands for several written values (the day values, the values beyond the named ones). */
const isFolded = (bucket: string): boolean => bucket === DAYS || bucket === OTHER;

/** The written values of `tasks` (of one area, when given) that are in `bucket`. */
function writtenIn(c: StatCut, bucket: string, tasks: readonly TaskEntry[], area: string | null): string[] {
  const out = new Set<string>();
  for (const task of tasks) {
    if (area !== null && task.area !== area) continue;
    for (const value of valuesOf(c, task)) if (bucketOfValue(c, value) === bucket) out.add(value);
  }
  return [...out];
}

/** What the filter has chosen for `dim`, as stack values (`NONE` for "not written"). */
function chosenValues(base: Filter, dim: StatDim): string[] {
  if (dim === 'status') return base.statuses.map((s) => (s === '' ? NONE : s));
  if (dim === 'actor') return base.actors.map((a) => (a === NO_ACTOR ? NONE : a));
  return base.fields[dim] ?? [];
}

/** The filter with the choice of `dim` set to `values` (stack values; none takes the choice away). */
function withChosen(base: Filter, dim: StatDim, values: readonly string[]): Filter {
  if (dim === 'status') return { ...base, statuses: values.map((v) => (v === NONE ? '' : v)) };
  if (dim === 'actor') return { ...base, actors: values.map((v) => (v === NONE ? NO_ACTOR : v)) };
  const key: FieldKey = dim;
  const fields = { ...base.fields };
  if (values.length === 0) delete fields[key];
  else fields[key] = [...values];
  return { ...base, fields };
}

/**
 * The filter that shows the tasks of one stack (and of one area, when given) in the list: the filter that is on,
 * with the area and the field of the stack set to what was clicked. A stack that stands for several values (the day
 * values, the values beyond the named ones) sets the ones the tasks have (the filter chooses written values).
 */
export function filterFor(
  base: Filter,
  of: StatDim | StatCut,
  bucket: string | null,
  area: string | null,
  tasks: readonly TaskEntry[],
): Filter {
  const c = cut(of);
  const out: Filter = { ...base, fields: { ...base.fields } };
  if (area !== null) out.areas = [area];
  if (bucket === null) return out;
  return withChosen(out, c.dim, isFolded(bucket) ? writtenIn(c, bucket, tasks, area) : [bucket]);
}

/** The filter that is on without the choice of `dim`: what the legend counts, so the other values stay there to be added. */
export function withoutDim(base: Filter, dim: StatDim): Filter {
  return withChosen(base, dim, []);
}

/** The stacks of `dim` the filter that is on has chosen. */
export function chosenBuckets(base: Filter, of: StatDim | StatCut): Set<string> {
  const c = cut(of);
  return new Set(chosenValues(base, c.dim).map((v) => bucketOfValue(c, v)));
}

/**
 * A click on a stack of the legend: the filter with that stack added, or taken away when it was chosen; the other
 * values of the field stay. A stack that stands for several values stands for the ones `tasks` have.
 */
export function toggledBucket(base: Filter, of: StatDim | StatCut, bucket: string, tasks: readonly TaskEntry[]): Filter {
  const c = cut(of);
  const chosen = chosenValues(base, c.dim);
  if (!isFolded(bucket)) return withChosen(base, c.dim, toggled(chosen, bucket));
  const rest = chosen.filter((v) => bucketOfValue(c, v) !== bucket);
  return withChosen(base, c.dim, rest.length !== chosen.length ? rest : [...rest, ...writtenIn(c, bucket, tasks, null)]);
}

/**
 * The filter of a headline number: the filter that is on, narrowed to what the number counts. Null for a number of
 * none: the field it sets may be one the filter keeps out (doing while only open is chosen), and setting it would show
 * tasks the number did not count. A number above none has a task the filter keeps, so the field's choice holds it.
 */
export function figureFilter(base: Filter, figure: Figure, figures: StatFigures): Filter | null {
  if (!figures[figure]) return null;
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

/**
 * What the engine answered for the finished tasks of a period, cut to the areas the filter means (none chosen: all of
 * them). The engine counts per area; the page only adds up the areas it was asked to keep (WEB-13).
 */
export function finishedPerArea(
  byArea: readonly { area: string; count: number }[],
  areas: readonly string[],
): { total: number; counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  let total = 0;
  for (const { area, count } of byArea) {
    if (areas.length > 0 && !areas.includes(area)) continue;
    counts[area] = count;
    total += count;
  }
  return { total, counts };
}

/** The most ids the engine's estimate takes in one question (the hub's `ESTIMATE_MAX`). */
export const ESTIMATE_MAX = 1000;

/**
 * Where the figure of the effort comes from: the engine asked for the ids the filter keeps (its answer has the range
 * of the sizes too); beyond what one question takes, the snapshot's estimate when the filter keeps every open task
 * (the engine reckoned it for all of them); else null, as for no task (the page reckons no sum itself).
 */
export function effortSource(
  shown: readonly TaskEntry[],
  all: readonly TaskEntry[],
): { from: 'snapshot' } | { from: 'engine'; ids: string[] } | null {
  if (shown.length === 0) return null;
  if (shown.length <= ESTIMATE_MAX) return { from: 'engine', ids: shown.map((t) => t.id) };
  return shown.length === all.length ? { from: 'snapshot' } : null;
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
