// The timeline (Gantt-like): one bar for each task from `start` to `due`, in rows grouped by plan or by area, with
// the dependencies as arrows. Only layout: which days are shown, where a bar lies, which rows there are. Whether a
// date is allowed is the engine's to say (a drag writes `start` and `due` through the engine, which refuses
// `start > due` in its own words); an arrow that points back in time is geometry, read from the two bars it joins.

import { addDays, addMonths, parseDate, startOfWeek } from './calendar';
import type { MeetingEntry, TaskEntry } from './contract';
import type { EdgeKind } from './depGraph';

export type TimelineZoom = 'week' | 'month' | 'quarter';
export const TIMELINE_ZOOMS: readonly TimelineZoom[] = ['week', 'month', 'quarter'];
/** The width of a day in pixels: a week, a month or a quarter fills about the same width. */
export const DAY_WIDTH: Record<TimelineZoom, number> = { week: 40, month: 14, quarter: 5 };

export type TimelineGrouping = 'plan' | 'area';
export const TIMELINE_GROUPINGS: readonly TimelineGrouping[] = ['plan', 'area'];

const DAY_MS = 86_400_000;
/** How far back and forward of today the timeline reaches at most (a bar is cut there, not drawn for years). */
export const DAYS_BEFORE = 366;
export const DAYS_AFTER = 731;
/** Days shown around the bars, and the fewest days a zoom shows (a single short bar would stand alone otherwise). */
const PAD: Record<TimelineZoom, number> = { week: 3, month: 7, quarter: 14 };
const LEAST: Record<TimelineZoom, number> = { week: 21, month: 63, quarter: 182 };

/** The days from `a` to `b` (negative when `b` is before `a`); 0 for text that is no date. */
export function daysBetween(a: string, b: string): number {
  const from = parseDate(a);
  const to = parseDate(b);
  return from && to ? Math.round((to.getTime() - from.getTime()) / DAY_MS) : 0;
}

/**
 * How a task lies on the timeline: a bar from `start` to `due`, or a mark on the one date it has (`due`, or `start`).
 * `from` and `to` are the first and the last day (the same day for a mark).
 */
export interface Bar {
  task: TaskEntry;
  from: string;
  to: string;
  kind: 'bar' | 'due' | 'start';
}

/**
 * The bar of a task, or null for one without a valid date. A `start` after the `due` (a file written by hand; the
 * engine refuses it) is shown as the mark of its due day.
 */
export function barOf(task: TaskEntry): Bar | null {
  const due = parseDate(task.due) ? task.due : undefined;
  const start = parseDate(task.start) ? task.start : undefined;
  if (due !== undefined && start !== undefined && start <= due) return { task, from: start, to: due, kind: 'bar' };
  if (due !== undefined) return { task, from: due, to: due, kind: 'due' };
  if (start !== undefined) return { task, from: start, to: start, kind: 'start' };
  return null;
}

/** The bars of `tasks`, the earlier first (then the one that ends first, then by title). */
export function barsOf(tasks: readonly TaskEntry[]): Bar[] {
  return tasks
    .map(barOf)
    .filter((b): b is Bar => b !== null)
    .sort(byTime);
}

function byTime(a: Bar, b: Bar): number {
  return a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.task.title.localeCompare(b.task.title);
}

/** The days the timeline shows: `days` of them from `from` (a Monday). */
export interface Range {
  from: string;
  days: number;
}

/**
 * The days that hold every bar and today, with some air around them, in whole weeks. Never more than `DAYS_BEFORE`
 * back and `DAYS_AFTER` forward of today: a bar beyond is cut at the edge (`clip`).
 */
export function rangeOf(bars: readonly Bar[], today: string, zoom: TimelineZoom): Range {
  const least = addDays(today, -DAYS_BEFORE);
  const most = addDays(today, DAYS_AFTER);
  let lo = today;
  let hi = today;
  for (const bar of bars) {
    if (bar.from < lo) lo = bar.from;
    if (bar.to > hi) hi = bar.to;
  }
  if (lo < least) lo = least;
  if (hi > most) hi = most;
  const from = startOfWeek(addDays(lo, -PAD[zoom]));
  let to = addDays(startOfWeek(addDays(hi, PAD[zoom])), 6);
  if (daysBetween(from, to) + 1 < LEAST[zoom]) to = addDays(from, LEAST[zoom] - 1);
  return { from, days: daysBetween(from, to) + 1 };
}

/** The last day of a range. */
export function lastDay(range: Range): string {
  return addDays(range.from, range.days - 1);
}

/** The part of a bar inside the range (`cutLeft`, `cutRight`: it goes on beyond that edge), or null when none is. */
export function clip(
  bar: { from: string; to: string },
  range: Range,
): { from: string; to: string; cutLeft: boolean; cutRight: boolean } | null {
  const last = lastDay(range);
  if (bar.to < range.from || bar.from > last) return null;
  const cutLeft = bar.from < range.from;
  const cutRight = bar.to > last;
  return { from: cutLeft ? range.from : bar.from, to: cutRight ? last : bar.to, cutLeft, cutRight };
}

/** A month of the head: `offset` days from the start of the range, `days` wide, named by its first day shown. */
export interface MonthSpan {
  date: string;
  offset: number;
  days: number;
}
/** A line of the grid: a day (a week zoom), a Monday (a month zoom) or the first of a month (a quarter zoom). */
export interface Tick {
  date: string;
  offset: number;
  /** A Monday in the week zoom; every tick of the other zooms. */
  major: boolean;
}

/** The months and the grid lines of a range. */
export function ticksOf(range: Range, zoom: TimelineZoom): { months: MonthSpan[]; ticks: Tick[] } {
  const months: MonthSpan[] = [];
  const ticks: Tick[] = [];
  const last = lastDay(range);
  for (let first = range.from; first <= last; ) {
    const next = addMonths(first, 1);
    const end = next > last ? addDays(last, 1) : next;
    months.push({ date: first, offset: daysBetween(range.from, first), days: daysBetween(first, end) });
    first = end;
  }
  if (zoom === 'quarter') {
    for (const month of months) if (month.offset > 0) ticks.push({ date: month.date, offset: month.offset, major: true });
    return { months, ticks };
  }
  const stepDays = zoom === 'week' ? 1 : 7;
  for (let offset = 0; offset < range.days; offset += stepDays) {
    const date = addDays(range.from, offset);
    ticks.push({ date, offset, major: zoom === 'month' || offset % 7 === 0 });
  }
  return { months, ticks };
}

/** The part of a bar a drag or a key takes: its first day, its last day, or the whole of it. */
export type BarPart = 'start' | 'body' | 'end';

/** The parts a bar has: a mark has no ends to pull. */
export function partsOf(bar: Bar): readonly BarPart[] {
  return bar.kind === 'bar' ? ['start', 'body', 'end'] : ['body'];
}

/**
 * Where a bar lies after `part` was moved by `days`: the whole of it, or one end, which stops at the other end (a bar
 * is never turned around; the engine would refuse `start > due`).
 */
export function movedBar(bar: Bar, part: BarPart, days: number): { from: string; to: string } {
  if (part === 'body' || bar.kind !== 'bar') return { from: addDays(bar.from, days), to: addDays(bar.to, days) };
  if (part === 'start') {
    const from = addDays(bar.from, days);
    return { from: from > bar.to ? bar.to : from, to: bar.to };
  }
  const to = addDays(bar.to, days);
  return { from: bar.from, to: to < bar.from ? bar.from : to };
}

/** The fields a move changes (`start`, `due`), or null when it changes none. Only the dates the task has are written. */
export function patchOf(bar: Bar, part: BarPart, days: number): { start?: string; due?: string } | null {
  const moved = movedBar(bar, part, days);
  const patch: { start?: string; due?: string } = {};
  if (bar.kind !== 'due' && moved.from !== bar.from) patch.start = moved.from;
  if (bar.kind !== 'start' && moved.to !== bar.to) patch.due = moved.to;
  return patch.start === undefined && patch.due === undefined ? null : patch;
}

/** A row of the timeline: the head of a group (with the span of all its bars), or a task. */
export type BaseRow =
  | {
      type: 'group';
      key: string;
      kind: 'project' | 'plan' | 'area' | 'none';
      label: string;
      level: number;
      span: { from: string; to: string };
      count: number;
      folded: boolean;
    }
  | { type: 'task'; bar: Bar; level: number };

/** A row of the timeline with the meetings of `timelineMeetings.ts`. */
export type Row =
  | BaseRow
  /** The meetings of a group that belong to none of its tasks (concept 7.4): diamonds on their days (`timelineMeetings.ts`). */
  | { type: 'meetings'; key: string; level: number; meetings: MeetingEntry[] };

/** What the rows need to know of the vault: the names, and the project a task belongs to (none without `projects`). */
export interface Names {
  plan(id: string): string;
  project(id: string): string;
  projectOf(task: TaskEntry): string | undefined;
}

interface Node {
  key: string;
  kind: 'project' | 'plan' | 'area' | 'none';
  label: string;
  groups: Node[];
  bars: Bar[];
}

function all(node: Node): Bar[] {
  return [...node.bars, ...node.groups.flatMap(all)];
}

function spanOf(bars: readonly Bar[]): { from: string; to: string } {
  let from = bars[0]?.from ?? '';
  let to = bars[0]?.to ?? '';
  for (const bar of bars) {
    if (bar.from < from) from = bar.from;
    if (bar.to > to) to = bar.to;
  }
  return { from, to };
}

/**
 * The rows: by area, or by plan (the tasks of no plan last, as their own group). With projects, a project is a row
 * above its plans and its own tasks, and its bar spans them all. A group in `folded` shows its head only. Groups are
 * in the order of their first day, then by name. Every group row has a key of its own.
 */
export function rowsOf(bars: readonly Bar[], grouping: TimelineGrouping, names: Names, folded: ReadonlySet<string>): BaseRow[] {
  const top = new Map<string, Node>();
  const node = (into: Map<string, Node> | Node[], key: string, kind: Node['kind'], label: string): Node => {
    const found = Array.isArray(into) ? into.find((n) => n.key === key) : into.get(key);
    if (found) return found;
    const made: Node = { key, kind, label, groups: [], bars: [] };
    if (Array.isArray(into)) into.push(made);
    else into.set(key, made);
    return made;
  };
  for (const bar of bars) {
    const task = bar.task;
    if (grouping === 'area') {
      node(top, `area:${task.area}`, 'area', task.area).bars.push(bar);
      continue;
    }
    const project = names.projectOf(task);
    const home = project === undefined ? null : node(top, `project:${project}`, 'project', names.project(project));
    // A plan under a project is keyed with it: tasks of one plan can stand under two parents (a task that names a
    // project of its own, beside the one of its plan), and each row needs a key of its own.
    if (task.plan) {
      const key = home ? `${home.key}/plan:${task.plan}` : `plan:${task.plan}`;
      node(home ? home.groups : top, key, 'plan', names.plan(task.plan)).bars.push(bar);
    }
    else if (home) home.bars.push(bar);
    else node(top, 'none', 'none', '').bars.push(bar);
  }
  const ordered = (nodes: Iterable<Node>): Node[] =>
    [...nodes].sort((a, b) => {
      if ((a.kind === 'none') !== (b.kind === 'none')) return a.kind === 'none' ? 1 : -1;
      return spanOf(all(a)).from.localeCompare(spanOf(all(b)).from) || a.label.localeCompare(b.label);
    });
  const rows: BaseRow[] = [];
  const emit = (n: Node, level: number): void => {
    const inside = all(n);
    const isFolded = folded.has(n.key);
    rows.push({ type: 'group', key: n.key, kind: n.kind, label: n.label, level, span: spanOf(inside), count: inside.length, folded: isFolded });
    if (isFolded) return;
    for (const group of ordered(n.groups)) emit(group, level + 1);
    for (const bar of n.bars.toSorted(byTime)) rows.push({ type: 'task', bar, level: level + 1 });
  };
  for (const n of ordered(top.values())) emit(n, 0);
  return rows;
}

/** An arrow between two bars: `to` waits for `from` (hard: `blocked_by`, soft: `after`). */
export interface TimeEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  /** The arrow points back in time: `from` ends after the day `to` begins. */
  backwards: boolean;
}

/**
 * The arrows between the bars: each `blocked_by` and `after` of a task whose other end is on the timeline too. Whether
 * an arrow points back in time is the engine's word when it has one (`engineLate`: capability `late_blockers`, the
 * blockers of a task due after it begins); an older engine leaves it to the two bars.
 */
export function edgesOf(bars: readonly Bar[], engineLate = false): TimeEdge[] {
  const byId = new Map(bars.map((b) => [b.task.id, b]));
  const out: TimeEdge[] = [];
  for (const bar of bars) {
    const seen = new Set<string>();
    const add = (ids: readonly string[], kind: EdgeKind): void => {
      for (const id of ids) {
        const other = byId.get(id);
        if (!other || id === bar.task.id || seen.has(id)) continue;
        seen.add(id);
        const backwards = engineLate
          ? (bar.task.late_blockers ?? []).some((late) => late.id === id && late.kind === kind)
          : other.to > bar.from;
        out.push({ from: id, to: bar.task.id, kind, backwards });
      }
    };
    add(bar.task.blocked_by, 'blocked_by');
    add(bar.task.after, 'after');
  }
  return out;
}

/**
 * The path of an arrow from the end of one bar (`x1`, `y1`) to the start of another (`x2`, `y2`): out to the right,
 * down or up, and in from the left. An arrow that points back goes around between the rows (`rowHeight`).
 */
export function arrowPath(x1: number, y1: number, x2: number, y2: number, rowHeight: number): string {
  const out = 8;
  if (x2 - out >= x1 + out) return `M ${x1} ${y1} H ${x1 + out} V ${y2} H ${x2}`;
  const mid = y1 + (y2 >= y1 ? rowHeight / 2 : -rowHeight / 2);
  return `M ${x1} ${y1} H ${x1 + out} V ${mid} H ${x2 - out} V ${y2} H ${x2}`;
}
