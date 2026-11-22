// The periods of the tab Learning plans and what the series of the learning figures says over them: the window a
// period means (today, this week, month, quarter or year, and the period before it), the sums over its days, the bars
// of a chart, the weeks of hours per path, the calendar of the learning days and a row per path. Every figure is the
// engine's: `tasks.learn_history` asked by day gives the differences of the series per day, and the page only adds
// up the days a period holds (WEB-13: no rule of the tasks here). Used by the overview (`views/LearnView.svelte`) and
// the statistics (`views/LearnStatsView.svelte`); both are chunks of their own.

import { addDays, addMonths, parseDate, startOfWeek } from './calendar';
import type { FinishedItem, LearnHistory } from './contract';

export const LEARN_PERIODS = ['day', 'week', 'month', 'quarter', 'year'] as const;
export type LearnPeriod = (typeof LEARN_PERIODS)[number];
export const STATS_PERIODS = ['week', 'month', 'quarter', 'year', 'custom'] as const;
export type StatsPeriod = (typeof STATS_PERIODS)[number];

export type Bucket = 'day' | 'week' | 'month';

/** Days from `since` to `until`, both included (`YYYY-MM-DD`). */
export interface Span {
  since: string;
  until: string;
}

/** What a period means on a day. */
export interface PeriodFrame {
  /** The period from its first to its last day (the last may lie after today). */
  current: Span;
  /** The whole period before it; none for a window of one's own. */
  previous: Span | null;
  /** The days the chart draws, and how it groups them. */
  chart: Span;
  bucket: Bucket;
  /** What the engine is asked for, by day: from the first day needed up to today (never later). */
  ask: Span;
  /** A window of one's own longer than the engine answers by day: cut to its last `MAX_DAYS` days. */
  clamped?: true;
}

/** The most days the engine answers in steps of a day (`tasks.learn_history`: at most 800 steps). */
export const MAX_DAYS = 800;

/** The figures of a day, a bar or a period: the differences of the series added up. */
export interface Figures {
  learned: number;
  seen: number;
  xp: number;
  done_h: number;
  /** Learning days: days on which a point was learned or seen. */
  days: number;
}

type Day = LearnHistory['points'][number];

/** Which paths count: all (null), or those the test keeps (a project, a path). */
export type Keep = ((path: string) => boolean) | null;

const ZERO: Figures = { learned: 0, seen: 0, xp: 0, done_h: 0, days: 0 };
/** Hours keep two decimal places, as the engine writes them; a sum of them must not grow a tail (0.1 + 0.2). */
const hours = (n: number): number => Math.round(n * 100) / 100;
const min = (a: string, b: string): string => (a <= b ? a : b);
const max = (a: string, b: string): string => (a >= b ? a : b);
const lastOfMonth = (day: string): string => addDays(addMonths(day, 1), -1);
const isDay = (text: string): boolean => parseDate(text) !== null;

/** The number of days from `a` to `b`, both included (0 when `b` is before `a`). */
export function dayCount(a: string, b: string): number {
  const x = parseDate(a);
  const y = parseDate(b);
  if (!x || !y || b < a) return 0;
  return Math.round((y.getTime() - x.getTime()) / 86_400_000) + 1;
}

/** The week of the year of a day after ISO 8601 (the week of its Thursday). */
export function isoWeek(day: string): number {
  const d = parseDate(day);
  if (!d) return 0;
  const thursday = new Date(d.getTime() + (3 - ((d.getUTCDay() + 6) % 7)) * 86_400_000);
  const jan1 = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return Math.floor((thursday.getTime() - jan1) / 86_400_000 / 7) + 1;
}

/** The window of a period of the overview on `today`, the period before it, and the chart of it. */
export function periodFrame(period: LearnPeriod, today: string): PeriodFrame {
  let current: Span;
  let previous: Span;
  let chart: Span;
  let bucket: Bucket = 'day';
  switch (period) {
    case 'day':
      current = { since: today, until: today };
      previous = { since: addDays(today, -1), until: addDays(today, -1) };
      // A day alone is one bar: the chart shows the week up to it.
      chart = { since: addDays(today, -6), until: today };
      break;
    case 'week': {
      const monday = startOfWeek(today);
      current = { since: monday, until: addDays(monday, 6) };
      previous = { since: addDays(monday, -7), until: addDays(monday, -1) };
      chart = current;
      break;
    }
    case 'month': {
      const first = addMonths(today, 0);
      current = { since: first, until: lastOfMonth(first) };
      previous = { since: addMonths(today, -1), until: addDays(first, -1) };
      chart = current;
      break;
    }
    case 'quarter': {
      const month = Number(today.slice(5, 7)) - 1;
      const first = addMonths(today, -(month % 3));
      current = { since: first, until: addDays(addMonths(first, 3), -1) };
      previous = { since: addMonths(first, -3), until: addDays(first, -1) };
      chart = current;
      bucket = 'week';
      break;
    }
    case 'year': {
      const year = Number(today.slice(0, 4));
      current = { since: `${year}-01-01`, until: `${year}-12-31` };
      previous = { since: `${year - 1}-01-01`, until: `${year - 1}-12-31` };
      chart = current;
      bucket = 'month';
      break;
    }
  }
  return { current, previous, chart, bucket, ask: { since: min(previous.since, chart.since), until: today } };
}

/** The bucket of a window of one's own: days up to two months, weeks up to a year and a week, else months. */
export function bucketOf(span: Span): Bucket {
  const n = dayCount(span.since, span.until);
  return n <= 62 ? 'day' : n <= 371 ? 'week' : 'month';
}

/**
 * The window of the statistics: a period as the overview means it (without the period before), or one's own from
 * `since` to `until` when both are days and in order (else the month). The engine is asked for no day after today.
 */
export function statsFrame(period: StatsPeriod, today: string, custom: Span): PeriodFrame {
  if (period !== 'custom' || !isDay(custom.since) || !isDay(custom.until) || custom.since > custom.until) {
    const frame = periodFrame(period === 'custom' ? 'month' : period, today);
    return { ...frame, previous: null, ask: { since: frame.current.since, until: min(frame.current.until, today) } };
  }
  // Longer than the engine answers by day: its last days. A window that has not begun asks nothing (since after until).
  const clamped = dayCount(custom.since, custom.until) > MAX_DAYS;
  const span = { since: clamped ? addDays(custom.until, -(MAX_DAYS - 1)) : custom.since, until: custom.until };
  return {
    current: span,
    previous: null,
    chart: span,
    bucket: bucketOf(span),
    ask: { since: span.since, until: min(span.until, today) },
    ...(clamped ? { clamped: true as const } : {}),
  };
}

/** Whether the series knows the days of a span: not at all, from a day inside it on, or all of them. */
export function coverage(span: Span, first: string | undefined): 'none' | 'partial' | 'full' {
  if (first === undefined || first > span.until) return 'none';
  return first > span.since ? 'partial' : 'full';
}

/** The figures of one day, of all paths or of those `keep` keeps (a day of theirs counts when one of them moved). */
export function dayFigures(day: Day, keep: Keep): Figures {
  if (keep === null) return { learned: day.learned, seen: day.seen, xp: day.xp, done_h: day.done_h, days: day.days > 0 ? 1 : 0 };
  const out = { ...ZERO };
  for (const p of day.paths) {
    if (!keep(p.id)) continue;
    out.learned += p.learned;
    out.seen += p.seen;
    out.xp += p.xp;
    out.done_h += p.done_h;
    if (p.learned > 0 || p.seen > 0) out.days = 1;
  }
  out.done_h = hours(out.done_h);
  return out;
}

/** The days of the series by their date (it is asked by day: a point is a day). */
export function byDate(history: LearnHistory | null): ReadonlyMap<string, Day> {
  return new Map((history?.points ?? []).map((p) => [p.date, p]));
}

/** The figures of the days of `span` (up to `today`) the series knows; null when it knows none of them. */
export function sumSpan(days: ReadonlyMap<string, Day>, span: Span, today: string, first: string | undefined, keep: Keep): Figures | null {
  if (coverage(span, first) === 'none' || span.since > today) return null;
  const out = { ...ZERO };
  for (let d = max(span.since, first ?? span.since), end = min(span.until, today); d <= end; d = addDays(d, 1)) {
    const day = days.get(d);
    if (!day) continue;
    const f = dayFigures(day, keep);
    out.learned += f.learned;
    out.seen += f.seen;
    out.xp += f.xp;
    out.done_h += f.done_h;
    out.days += f.days;
  }
  out.done_h = hours(out.done_h);
  return out;
}

/** The days of a span that have begun and that the series knows: what "5 of 7" learning days is out of. */
export function knownDays(span: Span, today: string, first: string | undefined): number {
  if (first === undefined) return 0;
  return dayCount(max(span.since, first), min(span.until, today));
}

/** A figure against the same figure of the period before: up, down or the same, and by how much. */
export interface Change {
  direction: 'up' | 'down' | 'same';
  by: number;
}

export function changeOf(now: number, before: number): Change {
  const by = hours(now - before);
  return { direction: by > 0 ? 'up' : by < 0 ? 'down' : 'same', by: Math.abs(by) };
}

/** One bar of a chart: the days it holds, and its figures; null for days not begun yet or before the series. */
export interface Bar {
  since: string;
  until: string;
  figures: Figures | null;
  /** Its figures come from the finished tasks of the points alone (before the series): not every point is in them. */
  partial?: true;
}

/** The first days of the buckets of a span: every day, every Monday, every first of a month (the first may start before). */
export function bucketStarts(span: Span, bucket: Bucket): Span[] {
  const out: Span[] = [];
  if (!isDay(span.since) || !isDay(span.until)) return out;
  let start = bucket === 'day' ? span.since : bucket === 'week' ? startOfWeek(span.since) : addMonths(span.since, 0);
  while (start <= span.until && out.length < 800) {
    const next = bucket === 'day' ? addDays(start, 1) : bucket === 'week' ? addDays(start, 7) : addMonths(start, 1);
    out.push({ since: max(start, span.since), until: min(addDays(next, -1), span.until) });
    start = next;
  }
  return out;
}

/** The bars of a chart of the series. */
export function barsOf(days: ReadonlyMap<string, Day>, frame: Pick<PeriodFrame, 'chart' | 'bucket'>, today: string, first: string | undefined, keep: Keep): Bar[] {
  return bucketStarts(frame.chart, frame.bucket).map((span) => ({ ...span, figures: sumSpan(days, span, today, first, keep) }));
}

/** A finished task that was a learning point of a path (`point` is `<path>#<key>`) and ended learned or seen. */
export function learnedTask(item: FinishedItem): { path: string; day: string; learned: number; seen: number; xp: number } | null {
  const hash = item.point?.indexOf('#') ?? -1;
  if (item.point === undefined || hash <= 0 || item.done === undefined) return null;
  if (item.outcome !== undefined && item.outcome !== 'learned' && item.outcome !== 'seen') return null;
  const day = String(item.done).slice(0, 10);
  if (!isDay(day)) return null;
  const seen = item.outcome === 'seen' ? 1 : 0;
  // A point only seen earns a part of its XP by the engine's rule: the page shows none rather than reckon that part.
  return { path: item.point.slice(0, hash), day, learned: 1 - seen, seen, xp: seen ? 0 : (item.xp ?? 0) };
}

/**
 * The bars before the series begins, from the finished tasks of the points (`learnedTask`): their figures say only what
 * was promoted to a task, so they are marked partial. A bar the series knows stays as it is.
 */
export function withFinished(bars: readonly Bar[], first: string | undefined, finished: readonly FinishedItem[], keep: Keep): Bar[] {
  const tasks = finished.map(learnedTask).filter((t): t is NonNullable<typeof t> => t !== null && (keep === null || keep(t.path)));
  return bars.map((bar) => {
    if (bar.figures !== null || (first !== undefined && bar.since >= first)) return bar;
    const end = first === undefined ? bar.until : min(bar.until, addDays(first, -1));
    const inside = tasks.filter((t) => t.day >= bar.since && t.day <= end);
    if (inside.length === 0) return bar;
    const figures = { ...ZERO };
    const learningDays = new Set<string>();
    for (const t of inside) {
      figures.learned += t.learned;
      figures.seen += t.seen;
      figures.xp += t.xp;
      learningDays.add(t.day);
    }
    figures.days = learningDays.size;
    return { ...bar, figures, partial: true };
  });
}

/** The running sum of a figure over the bars (a bar without figures keeps the sum and draws no point). */
export function cumulative(bars: readonly Bar[], pick: (f: Figures) => number): (number | null)[] {
  let sum = 0;
  return bars.map((bar) => {
    if (bar.figures === null) return null;
    sum += pick(bar.figures);
    return sum;
  });
}

/** The hours of the weeks of a span, stacked by path: the paths with the most hours (up to `top`), the rest together. */
export interface WeekHours {
  paths: string[];
  weeks: { since: string; until: string; values: number[]; rest: number; total: number; known: boolean }[];
}

export function weekHours(days: ReadonlyMap<string, Day>, span: Span, today: string, first: string | undefined, keep: Keep, top = 5): WeekHours {
  const weeks = bucketStarts(span, 'week');
  const perWeek = weeks.map((w) => {
    const sums = new Map<string, number>();
    const known = coverage(w, first) !== 'none' && w.since <= today;
    if (known) {
      for (let d = max(w.since, first ?? w.since), end = min(w.until, today); d <= end; d = addDays(d, 1)) {
        for (const p of days.get(d)?.paths ?? []) {
          if (p.done_h === 0 || (keep !== null && !keep(p.id))) continue;
          sums.set(p.id, (sums.get(p.id) ?? 0) + p.done_h);
        }
      }
    }
    return { ...w, sums, known };
  });
  const totals = new Map<string, number>();
  for (const w of perWeek) for (const [id, h] of w.sums) totals.set(id, (totals.get(id) ?? 0) + h);
  const paths = [...totals.entries()]
    .filter(([, h]) => h > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, top)
    .map(([id]) => id);
  return {
    paths,
    weeks: perWeek.map((w) => {
      const values = paths.map((id) => hours(w.sums.get(id) ?? 0));
      const all = hours([...w.sums.values()].reduce((a, b) => a + b, 0));
      return { since: w.since, until: w.until, values, rest: hours(all - values.reduce((a, b) => a + b, 0)), total: all, known: w.known };
    }),
  };
}

/** A day of the calendar of learning days: the points learned or seen that day, or null (not begun, before the series, outside). */
export interface CalendarDay {
  day: string;
  count: number | null;
  /** 0 nothing, 1..4 more and more. */
  level: 0 | 1 | 2 | 3 | 4;
}

/** The stage of a day of the calendar: none, 1, 2–3, 4–6, 7 and more points. */
export function calendarLevel(count: number): CalendarDay['level'] {
  return count <= 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 6 ? 3 : 4;
}

/** The weeks (Monday first) of the calendar of a span, every one of them; a day outside the span is null. */
export function calendarWeeks(days: ReadonlyMap<string, Day>, span: Span, today: string, first: string | undefined, keep: Keep): (CalendarDay | null)[][] {
  const weeks = bucketStarts(span, 'week');
  return weeks.map((w) => {
    const monday = startOfWeek(w.since);
    return Array.from({ length: 7 }, (_, i) => {
      const day = addDays(monday, i);
      if (day < w.since || day > w.until) return null;
      if (first === undefined || day < first || day > today) return { day, count: null, level: 0 as const };
      const point = days.get(day);
      const f = point ? dayFigures(point, keep) : ZERO;
      const count = Math.max(0, f.learned) + Math.max(0, f.seen);
      return { day, count, level: calendarLevel(count) };
    });
  });
}

/** A path in the window: what it learned, its XP and hours, and the last level it reached in the window. */
export interface PathRow {
  id: string;
  title: string;
  area: string;
  figures: Figures;
  reached?: { ref: string; on: string };
}

/** A row per path that moved in the window or reached a level in it, the most learned first. */
export function pathRows(history: LearnHistory | null, span: Span, today: string, keep: Keep): PathRow[] {
  if (!history) return [];
  const sums = new Map<string, Figures>();
  const end = min(span.until, today);
  for (const day of history.points) {
    if (day.date < span.since || day.date > end) continue;
    for (const p of day.paths) {
      if (keep !== null && !keep(p.id)) continue;
      const f = sums.get(p.id) ?? { ...ZERO };
      f.learned += p.learned;
      f.seen += p.seen;
      f.xp += p.xp;
      f.done_h = hours(f.done_h + p.done_h);
      if (p.learned > 0 || p.seen > 0) f.days += 1;
      sums.set(p.id, f);
    }
  }
  const rows: PathRow[] = [];
  for (const path of history.paths) {
    if (keep !== null && !keep(path.id)) continue;
    const inside = path.levels.filter((l) => l.reached_on >= span.since && l.reached_on <= end);
    const last = inside.reduce<(typeof inside)[number] | undefined>((a, l) => (a === undefined || l.reached_on >= a.reached_on ? l : a), undefined);
    const figures = sums.get(path.id);
    if (!figures && !last) continue;
    rows.push({
      id: path.id,
      title: path.title ?? path.id,
      area: path.area,
      figures: figures ?? { ...ZERO },
      ...(last ? { reached: { ref: last.ref, on: last.reached_on } } : {}),
    });
  }
  return rows.sort((a, b) => b.figures.learned - a.figures.learned || b.figures.xp - a.figures.xp || a.title.localeCompare(b.title));
}

/** The remembered period of the overview (per device); anything else is the week. */
export function parseLearnPeriod(raw: string | null): LearnPeriod {
  return (LEARN_PERIODS as readonly string[]).includes(raw ?? '') ? (raw as LearnPeriod) : 'week';
}

/** The remembered period of the statistics (per device); anything else is the month. */
export function parseStatsPeriod(raw: string | null): StatsPeriod {
  return (STATS_PERIODS as readonly string[]).includes(raw ?? '') ? (raw as StatsPeriod) : 'month';
}

/** The remembered two days of a window of one's own, `since..until`; a part that is no day is empty. */
export function parseStatsSpan(raw: string | null): Span {
  const [since = '', until = ''] = (raw ?? '').split('..');
  return { since: isDay(since) ? since : '', until: isDay(until) ? until : '' };
}
