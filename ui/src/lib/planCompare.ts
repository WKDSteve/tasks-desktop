// The comparison of plans (`tasks.plan_compare`): which rows are shown and in which order. Every figure is the
// engine's (rule WEB-13); this file only chooses and sorts the rows it gave.
import type { PlanCompareRow } from './contract';

/** What the table can be sorted by. */
export const COMPARE_KEYS = ['title', 'open', 'progress', 'effort', 'path', 'forecast', 'value', 'prio', 'last_done'] as const;
export type CompareKey = (typeof COMPARE_KEYS)[number];
export type CompareSort = { key: CompareKey; desc: boolean };

/**
 * The first click on a column: names A to Z, the best prio first (1 is best, so the smallest), the newest finish
 * first, every other figure the largest first.
 */
export function firstDirection(key: CompareKey): boolean {
  return key !== 'title' && key !== 'prio';
}

/** The next sort after a click on `key`: the same column turns round, another one starts with its first direction. */
export function nextSort(current: CompareSort, key: CompareKey): CompareSort {
  return current.key === key ? { key, desc: !current.desc } : { key, desc: firstDirection(key) };
}

/** The value a row is sorted by; null sorts last in either direction (no forecast, never finished). */
function valueOf(row: PlanCompareRow, key: CompareKey): number | string | null {
  switch (key) {
    case 'title':
      return row.title.toLocaleLowerCase();
    case 'open':
      return row.tasks.open;
    case 'progress':
      return row.progress;
    case 'effort':
      return row.effort.open_days;
    case 'path':
      return row.path.days;
    case 'forecast':
      return row.forecast_weeks ? row.forecast_weeks.high : null;
    case 'value':
      return row.value?.avg ?? null;
    case 'prio':
      return row.prio ?? null;
    case 'last_done':
      return row.last_done ?? null;
  }
}

/** The rows in the order of `sort`; equal ones keep the order of the engine (the vault's), so the table never jumps. */
export function sortRows(rows: readonly PlanCompareRow[], sort: CompareSort): PlanCompareRow[] {
  const sign = sort.desc ? -1 : 1;
  return rows
    .map((row, i) => ({ row, i, v: valueOf(row, sort.key) }))
    .sort((a, b) => {
      if (a.v === null || b.v === null) return a.v === b.v ? a.i - b.i : a.v === null ? 1 : -1;
      if (a.v < b.v) return -sign;
      if (a.v > b.v) return sign;
      return a.i - b.i;
    })
    .map((x) => x.row);
}

/** A further choice of plans: by the areas a plan names and by its status. Empty means any. */
export type CompareFilter = { areas: readonly string[]; statuses: readonly string[] };

/**
 * The rows that are compared: those of a project (`project`, `''` for all), of the chosen areas (a plan that names
 * one of them) and statuses, and, when some plans are chosen, only those (`chosen`, plan ids; one that is gone is
 * ignored).
 */
export function pickRows(
  rows: readonly PlanCompareRow[],
  project: string,
  chosen: readonly string[],
  filter: CompareFilter = { areas: [], statuses: [] },
): PlanCompareRow[] {
  const want = new Set(chosen);
  const areas = new Set(filter.areas);
  const statuses = new Set(filter.statuses);
  return rows.filter(
    (r) =>
      (project === '' || r.project === project) &&
      (areas.size === 0 || (r.areas ?? []).some((a) => areas.has(a))) &&
      (statuses.size === 0 || (r.status !== undefined && statuses.has(r.status))) &&
      (want.size === 0 || want.has(r.id)),
  );
}

/** The areas the plans name, A to Z, each once: what the area choice offers. */
export function areasOf(rows: readonly PlanCompareRow[]): string[] {
  return [...new Set(rows.flatMap((r) => r.areas ?? []))].sort((a, b) => a.localeCompare(b));
}

/** The statuses the plans have, in the order a plan goes through them; an unknown one after those. */
export function statusesOf(rows: readonly PlanCompareRow[]): string[] {
  const order = ['planning', 'doing', 'parked'];
  const seen = [...new Set(rows.flatMap((r) => (r.status === undefined ? [] : [r.status])))];
  return seen.sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib) || a.localeCompare(b);
  });
}

/** The largest open effort among the rows: the full width of its bar (0: no bars). */
export function widest(rows: readonly PlanCompareRow[]): number {
  return rows.reduce((n, r) => Math.max(n, r.effort.open_days), 0);
}

/** Parse a remembered sort; anything else is the default (the most open effort first). */
export function parseCompareSort(text: string | null): CompareSort {
  if (text) {
    const [key = '', dir] = text.split(':');
    if ((COMPARE_KEYS as readonly string[]).includes(key) && (dir === 'asc' || dir === 'desc')) {
      return { key: key as CompareKey, desc: dir === 'desc' };
    }
  }
  return { key: 'effort', desc: true };
}

export function serializeCompareSort(sort: CompareSort): string {
  return `${sort.key}:${sort.desc ? 'desc' : 'asc'}`;
}
