// The summary of a period on the start page (the tile Today): the period (a day, a week, a month, or days the person
// names), the evaluations that can be counted in it, and what the person chose to see. The counting is plain
// functions; the finished tasks and their figures are the engine's (`tasks.finished`), the made and the changed ones
// are counted from the snapshot (`created`, `updated`).

import type { Finished, FinishedItem, TaskEntry } from './contract';
import { DATE_KEYS, FIELD_KEYS, matches, type DateKey, type FieldKey, type Filter } from './filter';
import { addDays, isDay } from './finished';

// ── the period ────────────────────────────────────────────────────────────────────────────────────────────────────

export type PeriodMode = 'day' | 'week' | 'month' | 'custom';
export const PERIOD_MODES: readonly PeriodMode[] = ['day', 'week', 'month', 'custom'];

export interface Period {
  mode: PeriodMode;
  /** A day inside the period (a day, a week and a month are the ones this day lies in). */
  anchor: string;
  /** The days of a period the person names; both included. */
  from?: string;
  to?: string;
}

/** The days of a period, both included. */
export interface Days {
  since: string;
  until: string;
}

function parts(day: string): [number, number, number] {
  return [Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10))];
}

function monthStart(day: string, delta = 0): string {
  const [y, m] = parts(day);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 10);
}

/** The days of a period. A custom one with a day that is no day, or backwards, is the anchor day alone. */
export function periodDays(period: Period): Days {
  const { anchor } = period;
  switch (period.mode) {
    case 'day':
      return { since: anchor, until: anchor };
    case 'week': {
      // The week starts on Monday.
      const weekday = (new Date(`${anchor}T00:00:00Z`).getUTCDay() + 6) % 7;
      const since = addDays(anchor, -weekday);
      return { since, until: addDays(since, 6) };
    }
    case 'month': {
      const since = monthStart(anchor);
      return { since, until: addDays(monthStart(anchor, 1), -1) };
    }
    case 'custom': {
      const { from, to } = period;
      if (from !== undefined && to !== undefined && isDay(from) && isDay(to) && from <= to) return { since: from, until: to };
      return { since: anchor, until: anchor };
    }
  }
}

/** The period before (-1) or after (1): a day, a week, a month, or as many days as a named period is long. */
export function shiftPeriod(period: Period, direction: -1 | 1): Period {
  switch (period.mode) {
    case 'day':
      return { ...period, anchor: addDays(period.anchor, direction) };
    case 'week':
      return { ...period, anchor: addDays(period.anchor, 7 * direction) };
    case 'month':
      return { ...period, anchor: monthStart(period.anchor, direction) };
    case 'custom': {
      const { since, until } = periodDays(period);
      const length = Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 86_400_000) + 1;
      const from = addDays(since, length * direction);
      return { ...period, anchor: from, from, to: addDays(until, length * direction) };
    }
  }
}

/** Whether the period can be turned to: there is no later one than the one that holds `today`. */
export function canPage(period: Period, direction: -1 | 1, today: string): boolean {
  return direction < 0 || periodDays(period).until < today;
}

/** The period of today in a mode; a custom one starts as the named days, or today alone. */
export function currentPeriod(mode: PeriodMode, today: string, custom?: { from?: string; to?: string }): Period {
  return { mode, anchor: today, ...(custom?.from ? { from: custom.from } : {}), ...(custom?.to ? { to: custom.to } : {}) };
}

// ── the evaluations ───────────────────────────────────────────────────────────────────────────────────────────────

/** What can be counted. The first three are the ones shown until the person chooses. */
export const METRICS = ['finished', 'created', 'changed', 'quick', 'effort', 'commits', 'bugs', 'prio1'] as const;
export type Metric = (typeof METRICS)[number];
export const DEFAULT_METRICS: readonly Metric[] = ['finished', 'created', 'changed'];

/** A task of 0.5 days or less counts as a quick win. */
export const QUICK_DAYS = 0.5;

export interface MetricValue {
  /** `null`: not known (the engine has not told the finished tasks). */
  value: number | null;
  /** The finished tasks were more than were read: the number is at least this. */
  partial: boolean;
}

/** The engine answers at most this many finished tasks at a time. */
export const FINISHED_PAGE = 100;
/** The finished tasks read for a period, over several pages, at most. */
export const FINISHED_READ = 500;

/** The open tasks of the period: made in it, and changed in it without being made in it (each task in one of the two). */
export function periodTasks<T extends Pick<TaskEntry, 'created' | 'updated'>>(tasks: readonly T[], days: Days): { created: T[]; changed: T[] } {
  const created: T[] = [];
  const changed: T[] = [];
  const within = (day: string | undefined) => day !== undefined && day >= days.since && day <= days.until;
  for (const task of tasks) {
    if (within(task.created as unknown as string | undefined)) created.push(task);
    else if (within(task.updated as unknown as string | undefined)) changed.push(task);
  }
  return { created, changed };
}

/** The evaluations that are counted from the finished tasks. */
export type FinishedMetric = Exclude<Metric, 'created' | 'changed'>;

/** The commit a finished task names as done in, or none. */
const commitOf = (item: FinishedItem): string | undefined =>
  typeof item.done_in === 'string' && item.done_in !== '' ? item.done_in : undefined;

/**
 * The finished tasks behind an evaluation, of those that were read: all of them, the quick wins, those with an effort,
 * those that name a commit, the bugs, those of priority 1. The tile counts with the same choice.
 */
export function finishedOf(metric: FinishedMetric, finished: Finished): FinishedItem[] {
  const items = finished.items;
  switch (metric) {
    case 'finished':
      return [...items];
    case 'quick':
      return items.filter((i) => i.effort_days !== undefined && i.effort_days <= QUICK_DAYS);
    case 'effort':
      return items.filter((i) => i.effort_days !== undefined);
    case 'commits':
      return items.filter((i) => commitOf(i) !== undefined);
    case 'bugs':
      return items.filter((i) => i.kind === 'bug');
    case 'prio1':
      return items.filter((i) => i.prio === 1);
  }
}

/**
 * Whether the list behind a figure of the finished ones is a part of them: the figure says at least, or the engine
 * counted more than were read (its own figures are exact then, the list is not).
 */
export function listIsPart(read: Finished, partial: boolean): boolean {
  return partial || read.items.length < read.total;
}

/**
 * Every evaluation for the days. `created` and `changed` come from the open tasks (a task made and finished within the
 * period is counted as finished); the others from the finished tasks of the Backlogs, `null` while they are not known.
 */
export function metricValues(
  tasks: readonly Pick<TaskEntry, 'created' | 'updated'>[],
  finished: Finished | null,
  days: Days,
  /** The finished tasks are a filtered part of those that were read, and more were there: every figure is at least. */
  cut = false,
): Record<Metric, MetricValue> {
  const open = periodTasks(tasks, days);
  const created = open.created.length;
  const changed = open.changed.length;
  const none: MetricValue = { value: null, partial: false };
  const known = (value: number, partial = false): MetricValue => ({ value, partial });
  if (finished === null) {
    return { finished: none, created: known(created), changed: known(changed), quick: none, effort: none, commits: none, bugs: none, prio1: none };
  }
  const read = cut || finished.items.length < finished.total;
  const quick = finishedOf('quick', finished).length;
  const commits = new Set(finishedOf('commits', finished).map(commitOf)).size;
  const kind = (name: string) => finished.stats.by_kind.find((k) => k.kind === name)?.count ?? 0;
  const prio = (n: number) => finished.stats.by_prio.find((p) => p.prio === n)?.count ?? 0;
  return {
    finished: known(finished.total, cut),
    created: known(created),
    changed: known(changed),
    quick: known(quick, read),
    effort: known(Math.round(finished.stats.effort_days * 10) / 10, cut),
    commits: known(commits, read),
    bugs: known(kind('bug'), cut),
    prio1: known(prio(1), cut),
  };
}

// ── the filter of the list ────────────────────────────────────────────────────────────────────────────────────────

/** The fields of the filter a finished task carries (an entry of `tasks.finished`); the others it has no word for. */
const FINISHED_FIELDS: ReadonlySet<FieldKey> = new Set<FieldKey>(['kind', 'prio', 'effort', 'value', 'tag', 'plan', 'phase']);

/** A part of the filter that the finished tasks cannot be judged by: what the tile names as not taken for them. */
export type IgnoredPart =
  | { kind: 'status' | 'actor' | 'updated' | 'reminder' | 'cross' | 'quickWin' | 'overdue' }
  | { kind: 'field'; key: FieldKey }
  | { kind: 'date'; key: DateKey };

/**
 * The filter of the list as it holds for the finished tasks: the areas, the text and the fields a finished entry
 * carries (kind, priority, effort, value, tags, plan, phase, and the ranges of the three ordered ones) as they are;
 * what it has no word for (its status is done, who did it, its dates, its project, the readiness, a reminder, whether
 * it connects areas, a quick win of the open ones) is left out and named in `ignored`.
 */
export function finishedFilter(filter: Filter): { filter: Filter; ignored: IgnoredPart[] } {
  const ignored: IgnoredPart[] = [];
  if (filter.statuses.length > 0) ignored.push({ kind: 'status' });
  if (filter.actors.length > 0) ignored.push({ kind: 'actor' });
  const fields: Filter['fields'] = {};
  for (const key of FIELD_KEYS) {
    const chosen = filter.fields[key];
    if (!chosen || chosen.length === 0) continue;
    if (FINISHED_FIELDS.has(key)) fields[key] = chosen;
    else ignored.push({ kind: 'field', key });
  }
  for (const key of DATE_KEYS) {
    const span = filter.dates[key];
    if (span && (span.from || span.to)) ignored.push({ kind: 'date', key });
  }
  if (filter.updated !== '') ignored.push({ kind: 'updated' });
  if (filter.reminder !== '') ignored.push({ kind: 'reminder' });
  if (filter.cross) ignored.push({ kind: 'cross' });
  if (filter.quickWin) ignored.push({ kind: 'quickWin' });
  if (filter.overdue) ignored.push({ kind: 'overdue' });
  return {
    filter: {
      ...filter,
      statuses: [],
      actors: [],
      fields,
      matchAll: filter.matchAll.filter((k) => k === 'tag'),
      dates: {},
      updated: '',
      reminder: '',
      cross: false,
      quickWin: false,
      overdue: false,
    },
    ignored,
  };
}

/** A finished entry as the filter of the list reads a task: the fields it carries, nothing else. */
function asTask(item: FinishedItem): TaskEntry {
  return {
    id: item.id,
    area: item.area,
    slug: item.slug,
    title: item.title,
    status: 'done',
    kind: item.kind,
    prio: item.prio,
    effort: item.effort,
    effort_days: item.effort_days,
    value: item.value,
    tags: item.tags,
    category: [],
    plan: item.plan,
    phase: item.phase,
  } as unknown as TaskEntry;
}

/**
 * The finished tasks that were read, narrowed by `filter` (made with `finishedFilter`) the way the list narrows the open
 * ones: their number, their effort and the counts by kind and by priority are those of the ones kept (the rows by
 * area, month and week are left empty: the tile does not show them). `cut` says that more were finished than were
 * read, so every figure is at least.
 */
export function narrowFinished(doc: Finished, filter: Filter): { doc: Finished; cut: boolean } {
  const items = doc.items.filter((item) => matches(asTask(item), filter));
  const count = <K extends string | number>(key: (i: FinishedItem) => K | undefined) => {
    const rows = new Map<K | undefined, { count: number; effort_days: number }>();
    for (const item of items) {
      const row = rows.get(key(item)) ?? { count: 0, effort_days: 0 };
      row.count += 1;
      row.effort_days += item.effort_days ?? 0;
      rows.set(key(item), row);
    }
    return [...rows.entries()].sort((a, b) => b[1].count - a[1].count);
  };
  const effort = items.reduce((sum, i) => sum + (i.effort_days ?? 0), 0);
  return {
    doc: {
      ...doc,
      total: items.length,
      items,
      stats: {
        effort_days: effort,
        without_effort: items.filter((i) => i.effort_days === undefined).length,
        by_area: [],
        by_kind: count((i) => i.kind).map(([kind, row]) => ({ ...(kind !== undefined ? { kind } : {}), ...row })),
        by_prio: count((i) => i.prio).map(([prio, row]) => ({ ...(prio !== undefined ? { prio } : {}), ...row })),
        by_month: [],
        by_week: [],
      },
    },
    cut: doc.items.length < doc.total,
  };
}

// ── what the person chose ─────────────────────────────────────────────────────────────────────────────────────────

export interface DailyPrefs {
  mode: PeriodMode;
  from?: string;
  to?: string;
  metrics: Metric[];
}

export const DEFAULT_PREFS: DailyPrefs = { mode: 'day', metrics: [...DEFAULT_METRICS] };

/** The stored text read back; anything that is not a choice the page makes gives the default for that part. */
export function parseDailyPrefs(text: string | null): DailyPrefs {
  const fallback = (): DailyPrefs => ({ mode: 'day', metrics: [...DEFAULT_METRICS] });
  if (!text) return fallback();
  try {
    const raw = JSON.parse(text) as Record<string, unknown> | null;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return fallback();
    const mode = PERIOD_MODES.find((m) => m === raw['mode']) ?? 'day';
    const chosen = raw['metrics'];
    const metrics = Array.isArray(chosen) ? METRICS.filter((m) => chosen.includes(m)) : [...DEFAULT_METRICS];
    const from = typeof raw['from'] === 'string' && isDay(raw['from']) ? raw['from'] : undefined;
    const to = typeof raw['to'] === 'string' && isDay(raw['to']) ? raw['to'] : undefined;
    return { mode, metrics, ...(from ? { from } : {}), ...(to ? { to } : {}) };
  } catch {
    return fallback();
  }
}
