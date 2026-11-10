// The orders the engine offers for the list (`tasks list --sort`). The page never sorts by itself: it asks the
// engine for the ids in the order of a word and lays the tasks it holds along that order.

import type { TaskEntry } from './contract';

export const SORTS = [
  'default',
  'prio-effort',
  'severity',
  'frecency',
  'roi',
  'due',
  'created-desc',
  'created-asc',
  'updated-desc',
  'updated-asc',
  'remind',
  'title',
] as const;
export type SortWord = (typeof SORTS)[number];

/**
 * The words in the groups the dropdowns show them in (the list and Options > Defaults ...): every word once, in the
 * order of `SORTS`.
 */
export const SORT_GROUPS = [
  { group: 'plan', words: ['default', 'prio-effort', 'severity', 'frecency', 'roi'] },
  { group: 'date', words: ['due', 'created-desc', 'created-asc', 'updated-desc', 'updated-asc', 'remind'] },
  { group: 'title', words: ['title'] },
] as const satisfies readonly { group: string; words: readonly SortWord[] }[];
export type SortGroup = (typeof SORT_GROUPS)[number]['group'];

/** Which date of a task an order goes by, for the words that go by one. */
export type StampKind = 'due' | 'created' | 'updated' | 'remind';

/**
 * The date the list is in the order of, as the row shows it next to the task (YYYY-MM-DD): none for an order that
 * goes by no date, or a task without that date (the engine puts it last).
 */
export function sortStamp(task: TaskEntry, word: SortWord): { kind: StampKind; date: string } | undefined {
  const kind: StampKind | undefined =
    word === 'due' || word === 'remind'
      ? word
      : word === 'created-desc' || word === 'created-asc'
        ? 'created'
        : word === 'updated-desc' || word === 'updated-asc'
          ? 'updated'
          : undefined;
  if (kind === undefined) return undefined;
  const value: unknown = task[kind];
  const text = value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : '';
  const date = text.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? { kind, date } : undefined;
}

/** A remembered word, or the plan's order when it is none of ours. */
export function parseSort(value: unknown): SortWord {
  return typeof value === 'string' && (SORTS as readonly string[]).includes(value) ? (value as SortWord) : 'default';
}

/** The ids of an answer as a place each: the first id is 0. */
export function orderOf(ids: readonly string[]): Map<string, number> {
  return new Map(ids.map((id, i) => [id, i]));
}

/**
 * The tasks along `order`. A task the order does not name (it came after the answer) follows the named ones in
 * the order it had; the sort is stable, so ties keep the order they came in.
 */
export function applyOrder(tasks: readonly TaskEntry[], order: ReadonlyMap<string, number> | null): TaskEntry[] {
  if (order === null) return [...tasks];
  const last = order.size;
  return tasks
    .map((task, i) => ({ task, i }))
    .sort((a, b) => (order.get(a.task.id) ?? last) - (order.get(b.task.id) ?? last) || a.i - b.i)
    .map((x) => x.task);
}
