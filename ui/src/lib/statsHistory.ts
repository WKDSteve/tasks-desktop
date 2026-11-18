// The figures of the overview over time: which figure a tile stands for, the window that is asked for, and the line
// that is drawn. The numbers are the engine's (`tasks.history`: it writes the figures down per day and area); nothing
// is counted here but the sum of several areas, when the filter names more than one (the engine takes one).

import type { History, HistoryPoint } from './contract';
import type { CountKey } from './counts';
import { addDays, isDay } from './finished';

/** The figures a history is drawn of, in the order they are offered. */
export const HISTORY_METRICS = [
  'open',
  'ready',
  'doing',
  'blocked',
  'waiting',
  'parked',
  'withValue',
  'withEffort',
  'value',
  'effortDays',
  'done',
  'created',
] as const;
export type HistoryMetric = (typeof HISTORY_METRICS)[number];

/** `done` and `created` are counted per day (what happened on it); the others are levels (what was there). */
export const isFlow = (metric: HistoryMetric): boolean => metric === 'done' || metric === 'created';

/** The figure of one point; null where the series does not know it (a day before its first row). */
export function metricValue(point: HistoryPoint, metric: HistoryMetric): number | null {
  if (metric === 'done') return point.done;
  if (metric === 'created') return point.created;
  if (point.open === undefined) return null;
  switch (metric) {
    case 'open':
      return point.open;
    case 'ready':
      return point.by_state?.ready ?? null;
    case 'waiting':
      return point.by_state?.waiting ?? null;
    case 'parked':
      return point.by_state?.parked ?? null;
    case 'doing':
      return point.by_status?.['doing'] ?? 0;
    case 'blocked':
      return point.by_status?.['blocked'] ?? 0;
    case 'withValue':
      return point.with_value ?? null;
    case 'withEffort':
      return point.with_effort ?? null;
    case 'value':
      return point.value ?? null;
    case 'effortDays':
      return point.effort_days ?? null;
  }
}

/**
 * The figure whose history a number of the overview opens: one table for every tile, so a tile gets the behaviour by
 * being listed here. A tile without an entry has no history and offers none.
 */
export const TILE_METRIC: Partial<Record<CountKey, HistoryMetric>> = {
  ready: 'ready',
  doing: 'doing',
  blocked: 'blocked',
  estimated: 'withValue',
};

/** The figure of a tile, or null when it has no history. */
export const metricOfTile = (key: string): HistoryMetric | null =>
  (TILE_METRIC as Record<string, HistoryMetric | undefined>)[key] ?? null;

export const HISTORY_PERIODS = ['7d', '30d', '90d', 'year', 'custom'] as const;
export type HistoryPeriod = (typeof HISTORY_PERIODS)[number];

const PERIOD_DAYS: Record<Exclude<HistoryPeriod, 'custom'>, number> = { '7d': 7, '30d': 30, '90d': 90, year: 365 };

/** The most days a window is drawn day by day; a longer one is asked for and drawn by week. */
export const DAILY_MAX = 120;

export interface HistoryWindow {
  since: string;
  until: string;
  resolution: 'day' | 'week';
}

const daysBetween = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * The window a period means, up to today. `custom` takes the two days as they are when both are days and in order,
 * else the last 30 days (a half-typed date never asks the engine for nonsense).
 */
export function windowOf(period: HistoryPeriod, today: string, custom: { since: string; until: string }): HistoryWindow {
  let since = addDays(today, -29);
  let until = today;
  if (period !== 'custom') {
    since = addDays(today, -(PERIOD_DAYS[period] - 1));
  } else if (isDay(custom.since) && isDay(custom.until) && custom.since <= custom.until) {
    since = custom.since;
    until = custom.until;
  }
  return { since, until, resolution: daysBetween(since, until) + 1 > DAILY_MAX ? 'week' : 'day' };
}

/** What the person chose for the history: the figure, the period and the two days of a period of their own. */
export interface HistoryPrefs {
  metric: HistoryMetric;
  period: HistoryPeriod;
  since: string;
  until: string;
}

export const defaultHistoryPrefs = (): HistoryPrefs => ({ metric: 'ready', period: '30d', since: '', until: '' });

export const isDefaultHistory = (prefs: HistoryPrefs): boolean => {
  const first = defaultHistoryPrefs();
  return prefs.metric === first.metric && prefs.period === first.period && prefs.since === '' && prefs.until === '';
};

/** The remembered choice; anything that is not one (an older version, a damaged entry) is the first choice. */
export function parseHistoryPrefs(raw: string | null): HistoryPrefs {
  const out = defaultHistoryPrefs();
  if (raw === null) return out;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return out;
    const v = value as Record<string, unknown>;
    if ((HISTORY_METRICS as readonly unknown[]).includes(v['metric'])) out.metric = v['metric'] as HistoryMetric;
    if ((HISTORY_PERIODS as readonly unknown[]).includes(v['period'])) out.period = v['period'] as HistoryPeriod;
    if (typeof v['since'] === 'string' && isDay(v['since'])) out.since = v['since'];
    if (typeof v['until'] === 'string' && isDay(v['until'])) out.until = v['until'];
  } catch {
    return defaultHistoryPrefs();
  }
  return out;
}

/** The most areas whose histories are asked for one by one and added; a filter of more shows the whole vault. */
export const AREAS_MAX = 8;

/**
 * What to ask the engine for the areas of the filter: nothing chosen is the whole vault (one question without an
 * area), up to `AREAS_MAX` areas are one question each, more than that is the whole vault again (`whole`: the page
 * says so, because the line then covers more than the filter).
 */
export function askFor(areas: readonly string[]): { areas: (string | undefined)[]; whole: boolean } {
  if (areas.length === 0) return { areas: [undefined], whole: false };
  if (areas.length > AREAS_MAX) return { areas: [undefined], whole: true };
  return { areas: [...areas].sort(), whole: false };
}

const addMaps = (a: Record<string, number> | undefined, b: Record<string, number> | undefined): Record<string, number> => {
  const out: Record<string, number> = { ...(a ?? {}) };
  for (const [key, n] of Object.entries(b ?? {})) out[key] = (out[key] ?? 0) + n;
  return out;
};

/**
 * The histories of several areas as one: the points of the same day added up. A level is only there for a day when
 * at least one area has one (an area without a row yet adds nothing: it had no figure to add). `first` is the
 * earliest first day, `last` the latest last, `incomplete` what any of them skipped.
 */
export function sumHistories(docs: readonly History[]): History | null {
  const [head, ...rest] = docs;
  if (head === undefined) return null;
  if (rest.length === 0) return head;
  const points = head.points.map((p) => ({ ...p }));
  const byDay = new Map(points.map((p) => [p.day, p]));
  let first = head.first;
  let last = head.last;
  const incomplete = [...head.incomplete];
  for (const doc of rest) {
    if (doc.first !== undefined && (first === undefined || doc.first < first)) first = doc.first;
    if (doc.last !== undefined && (last === undefined || doc.last > last)) last = doc.last;
    for (const line of doc.incomplete) if (!incomplete.includes(line)) incomplete.push(line);
    for (const p of doc.points) {
      const into = byDay.get(p.day);
      if (into === undefined) continue;
      into.done += p.done;
      into.created += p.created;
      into.recorded = into.recorded || p.recorded;
      if (p.open === undefined) continue;
      into.open = (into.open ?? 0) + p.open;
      into.by_status = addMaps(into.by_status, p.by_status);
      into.by_state = addMaps(into.by_state, p.by_state) as NonNullable<HistoryPoint['by_state']>;
      into.with_effort = (into.with_effort ?? 0) + (p.with_effort ?? 0);
      into.with_value = (into.with_value ?? 0) + (p.with_value ?? 0);
      into.effort_days = Math.round(((into.effort_days ?? 0) + (p.effort_days ?? 0)) * 100) / 100;
      into.value = (into.value ?? 0) + (p.value ?? 0);
    }
  }
  const out: History = { ...head, points, incomplete };
  delete out.area;
  if (first !== undefined) out.first = first;
  if (last !== undefined) out.last = last;
  return out;
}

export interface SeriesPoint {
  day: string;
  /** null: the series does not know the figure of that day. */
  value: number | null;
  /** A row was written on that day (a level without it is the one carried over). */
  recorded: boolean;
}

/** The figure of every point of a history. */
export const seriesOf = (doc: History, metric: HistoryMetric): SeriesPoint[] =>
  doc.points.map((p) => ({ day: p.day, value: metricValue(p, metric), recorded: p.recorded }));

export interface ChartDot extends SeriesPoint {
  x: number;
  y: number;
  value: number;
}

export interface Chart {
  /** The line through the known points, one `M...L...` run per stretch without a gap. */
  line: string;
  /** The same stretches closed down to the base line, to be filled. */
  area: string;
  dots: ChartDot[];
  /** The values the horizontal lines stand for, from the base line up, with where they are. */
  ticks: { value: number; y: number }[];
  /** The lowest and highest value the frame shows. */
  min: number;
  max: number;
}

/** A round step so that about four lines cross the frame. */
function stepOf(span: number): number {
  if (span <= 0) return 1;
  const raw = span / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / pow;
  const nice = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10;
  return Math.max(nice * pow, span < 4 ? 1 : 0);
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * The geometry of a series inside a frame of `width` x `height` (the caller adds its margins): a point per day, the
 * days spread evenly, the value axis from a round number at or below the lowest value (0 when the values are near
 * it, so a small change is not blown up) to a round number at or above the highest. A day without a value breaks
 * the line. No point at all: an empty chart with the frame 0..1.
 */
export function chartOf(series: readonly SeriesPoint[], width: number, height: number): Chart {
  const known = series.filter((p): p is SeriesPoint & { value: number } => p.value !== null);
  if (known.length === 0) return { line: '', area: '', dots: [], ticks: [], min: 0, max: 1 };
  const lowest = Math.min(...known.map((p) => p.value));
  const highest = Math.max(...known.map((p) => p.value));
  // from zero unless the values sit far above it: a line that fills the lower half says nothing
  const from = lowest > 0 && (highest - lowest) * 3 < highest ? lowest : 0;
  const step = stepOf(Math.max(highest - from, 1));
  const min = Math.floor(from / step) * step;
  const max = Math.max(Math.ceil(highest / step) * step, min + step);
  const xOf = (i: number): number => (series.length === 1 ? width / 2 : round1((i / (series.length - 1)) * width));
  const yOf = (v: number): number => round1(height - ((v - min) / (max - min)) * height);
  const dots: ChartDot[] = [];
  const runs: ChartDot[][] = [];
  let run: ChartDot[] = [];
  series.forEach((p, i) => {
    if (p.value === null) {
      if (run.length > 0) runs.push(run);
      run = [];
      return;
    }
    const dot = { ...p, value: p.value, x: xOf(i), y: yOf(p.value) };
    dots.push(dot);
    run.push(dot);
  });
  if (run.length > 0) runs.push(run);
  const line = runs.map((r) => r.map((d, i) => `${i === 0 ? 'M' : 'L'}${d.x} ${d.y}`).join('')).join('');
  const area = runs
    .map((r) => {
      const a = r[0];
      const b = r[r.length - 1];
      if (a === undefined || b === undefined) return '';
      return `${r.map((d, i) => `${i === 0 ? 'M' : 'L'}${d.x} ${d.y}`).join('')}L${b.x} ${height}L${a.x} ${height}Z`;
    })
    .join('');
  const ticks: { value: number; y: number }[] = [];
  for (let v = min; v <= max + step / 1000; v += step) ticks.push({ value: Math.round(v * 100) / 100, y: yOf(v) });
  return { line, area, dots, ticks, min, max };
}

/** The first and last known value of a series and what lies between them; null without two known points. */
export function changeOf(series: readonly SeriesPoint[]): { from: number; to: number; delta: number } | null {
  const known = series.filter((p) => p.value !== null);
  const a = known[0];
  const b = known[known.length - 1];
  if (a === undefined || b === undefined || a === b || a.value === null || b.value === null) return null;
  return { from: a.value, to: b.value, delta: Math.round((b.value - a.value) * 100) / 100 };
}

/** Why a history shows no line, or null when it shows one. */
export function emptyReason(doc: History, metric: HistoryMetric): 'no-series' | 'before-series' | null {
  if (isFlow(metric)) return null;
  if (doc.first === undefined) return 'no-series';
  return doc.points.some((p) => p.open !== undefined) ? null : 'before-series';
}
