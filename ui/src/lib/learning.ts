// Learning tasks: work done to learn and get better, not out of need. The engine knows them by the category `learning`
// (tasks.nvim@6abac8e); the filter of the list finds them like any category. Here: which task is one, and the lists of
// the page that leave them out when the person switched them off (the saved views, the lists of tasks of the overview).

import type { TaskEntry } from './contract';

/** The word of the category. */
export const LEARNING = 'learning';

/** Whether a task is a learning task: its categories name it. */
export function isLearning(task: Pick<TaskEntry, 'category'>): boolean {
  return (task.category ?? []).some((c) => String(c) === LEARNING);
}

/** `tasks` as they are, or without the learning tasks when those are hidden. */
export function withoutLearning<T extends Pick<TaskEntry, 'category'>>(tasks: readonly T[], hidden: boolean): T[] {
  return hidden ? tasks.filter((task) => !isLearning(task)) : [...tasks];
}

/**
 * The ids of the learning tasks among `tasks`: what a list of the engine that names tasks only by id (the next tasks
 * of the overview) is narrowed with.
 */
export function learningIds(tasks: readonly Pick<TaskEntry, 'id' | 'category'>[]): Set<string> {
  return new Set(tasks.filter(isLearning).map((task) => task.id));
}
