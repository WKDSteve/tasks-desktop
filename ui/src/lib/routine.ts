// A routine as the engine writes it (capability `repeat`, ladders and a start after a finish with `repeat_steps`): what
// the page shows of it. The engine judges every value; this only reads what it wrote.

import type { Result, ResultEntry, TaskEntry } from './contract';

/** The intervals of `repeat`: one (`8w`) or a ladder (`1w,4w,12w`), as written (no blanks inside, the engine's rule). */
export function intervalsOf(repeat: string | undefined): string[] {
  if (!repeat) return [];
  return repeat
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/** The round of a ladder the task is (`repeat_step`, 1 when absent) and how many it has; `null` for no ladder. */
export function roundOf(task: Pick<TaskEntry, 'repeat' | 'repeat_step'>): { step: number; of: number } | null {
  const of = intervalsOf(task.repeat).length;
  if (of < 2) return null;
  const step = typeof task.repeat_step === 'number' && task.repeat_step >= 1 ? task.repeat_step : 1;
  return { step, of };
}

/** The intervals as a person reads them: `1w, 4w, 12w`. */
export function everyOf(repeat: string | undefined): string {
  return intervalsOf(repeat).join(', ');
}

/**
 * Whether the routine waits for something to be finished (`repeat_after` and no `due` yet): the finish writes its first
 * due date. Once it has one, it runs like any routine.
 */
export function waitsFor(task: Pick<TaskEntry, 'repeat_after' | 'due'>): string | null {
  return task.repeat_after && !task.due ? task.repeat_after : null;
}

/** The task or path a `repeat_after` names: a point of a path (`<area>/<slug>#<key>`) is of its path. */
export function pathOfRef(ref: string): string {
  const hash = ref.indexOf('#');
  return hash < 0 ? ref : ref.slice(0, hash);
}

export type RoutineStarted = NonNullable<ResultEntry['routines_started']>[number];

/** The routines a write started (`routines_started` of its entries that went through), in their order. */
export function routinesStarted(result: Result): RoutineStarted[] {
  return result.results.flatMap((entry) => (entry.ok ? (entry.routines_started ?? []) : []));
}

/** The question before a routine is discarded: a ladder names its intervals and the round it is at. */
export function discardAsk(task: Pick<TaskEntry, 'repeat' | 'repeat_step'>): {
  key: 'discard.routine.ask' | 'discard.routine.ask_ladder';
  params: Record<string, string | number>;
} {
  const round = roundOf(task);
  return round
    ? { key: 'discard.routine.ask_ladder', params: { every: everyOf(task.repeat), ...round } }
    : { key: 'discard.routine.ask', params: { every: task.repeat ?? '' } };
}
