// The calendar view: which days a grid shows and where each task stands in it. Only layout: whether a task is overdue
// or may start on a day is the engine's to say (a drop writes `due` through the engine, which refuses `start > due`).

import type { TaskEntry } from './contract';

export type CalendarMode = 'month' | 'week';
export const CALENDAR_MODES: readonly CalendarMode[] = ['month', 'week'];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** A calendar date as `YYYY-MM-DD`, or null for text that is none (also 2026-02-31). */
export function parseDate(text: string | undefined): Date | null {
  if (text === undefined || !DATE.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? null : date;
}

const iso = (date: Date): string => date.toISOString().slice(0, 10);

/** `date` moved by `days` (negative: back). The date must be one. */
export function addDays(date: string, days: number): string {
  const d = parseDate(date);
  if (!d) return date;
  return iso(new Date(d.getTime() + days * DAY_MS));
}

/** The Monday of the week of `date`. */
export function startOfWeek(date: string): string {
  const d = parseDate(date);
  if (!d) return date;
  const back = (d.getUTCDay() + 6) % 7;
  return addDays(date, -back);
}

/** The first day of the month of `date`, moved by `months`. */
export function addMonths(date: string, months: number): string {
  const d = parseDate(date);
  if (!d) return date;
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1)));
}

/** The days a grid shows around `anchor`: the weeks (Monday first) that hold the month, or the one week. */
export function daysOf(mode: CalendarMode, anchor: string): string[] {
  if (mode === 'week') {
    const first = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(first, i));
  }
  const first = addMonths(anchor, 0);
  const start = startOfWeek(first);
  const next = addMonths(anchor, 1);
  // Whole weeks up to the one that holds the last day of the month.
  const last = addDays(next, -1);
  const weeks = Math.round((parseDate(startOfWeek(last))!.getTime() - parseDate(start)!.getTime()) / (7 * DAY_MS)) + 1;
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
}

/** The anchor after a step: a month or a week forward (`1`) or back (`-1`). */
export function step(mode: CalendarMode, anchor: string, direction: 1 | -1): string {
  return mode === 'week' ? addDays(anchor, 7 * direction) : addMonths(anchor, direction);
}

/** How a task stands on a day: it is due, it starts, or it is in between (the bar from `start` to `due`). */
export type MarkKind = 'due' | 'start' | 'span';
export interface Mark {
  task: TaskEntry;
  kind: MarkKind;
}

const RANK: Record<MarkKind, number> = { due: 0, start: 1, span: 2 };

/**
 * The marks of `tasks` on `days`, by day. A task with a `due` stands on that day; with a `start` before it, also on the
 * start day and between (the bar). A task with only a `start` stands on it. A task without a valid date is not here
 * (see `undated`). Inside a day: due, start, span; then the more urgent task, then the title.
 */
export function marksByDay(tasks: readonly TaskEntry[], days: readonly string[]): Map<string, Mark[]> {
  const out = new Map<string, Mark[]>(days.map((d) => [d, []]));
  const first = days[0];
  const last = days[days.length - 1];
  if (first === undefined || last === undefined) return out;
  const put = (day: string, task: TaskEntry, kind: MarkKind): void => {
    out.get(day)?.push({ task, kind });
  };
  for (const task of tasks) {
    const due = parseDate(task.due) ? task.due : undefined;
    const start = parseDate(task.start) ? task.start : undefined;
    if (due !== undefined && start !== undefined && start < due) {
      // Only the days of the grid are walked, not the whole bar.
      const from = start < first ? first : start;
      const to = due > last ? last : due;
      for (let day = from; day <= to; day = addDays(day, 1)) put(day, task, day === due ? 'due' : day === start ? 'start' : 'span');
    } else if (due !== undefined) {
      if (due >= first && due <= last) put(due, task, 'due');
    } else if (start !== undefined) {
      if (start >= first && start <= last) put(start, task, 'start');
    }
  }
  for (const marks of out.values()) {
    marks.sort(
      (a, b) =>
        RANK[a.kind] - RANK[b.kind] ||
        (a.task.prio ?? 9) - (b.task.prio ?? 9) ||
        a.task.title.localeCompare(b.task.title),
    );
  }
  return out;
}

/** The tasks that stand on no day: no valid `due` and no valid `start`. */
export function undated(tasks: readonly TaskEntry[]): TaskEntry[] {
  return tasks.filter((t) => !parseDate(t.due) && !parseDate(t.start));
}

/** Whether a date is in the month of `anchor` (the days of the neighbouring months in the grid are dimmed). */
export function sameMonth(date: string, anchor: string): boolean {
  return date.slice(0, 7) === anchor.slice(0, 7);
}
