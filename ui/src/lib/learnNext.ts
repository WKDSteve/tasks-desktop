// The view "Next learning step" (concept "Reiter Lernpläne" 4): what the engine chose (`tasks.learn_next`, WEB-13) turned
// into what the view draws and the person's choice into the operation the engine takes. Which point comes next, which
// path runs, whether a point needs `ack`, is the engine's; nothing here decides it.

import type { Op } from './api';
import type { LearnNext, LearnPoint } from './contract';
import { pointRef } from './paths';

export type LearnNextItem = LearnNext['items'][number];

/** The states this view sets: learned at once, seen and does-not-apply with a reason (the engine needs one). */
export type StepState = 'learned' | 'seen' | 'dropped';

/** Whether a state is written with a reason (the engine refuses `seen` and `dropped` without one). */
export function stepNeedsReason(state: StepState): boolean {
  return state !== 'learned';
}

/** Whether closing a point to `state` needs the person's confirmation first (`{safety}`: `learned` and `seen` close it). */
export function stepNeedsAck(point: Pick<LearnPoint, 'safety'>, state: StepState): boolean {
  return point.safety === true && state !== 'dropped';
}

/**
 * The operation that marks `point` of path `path`. `learn_next` carries no version of the file, so none is sent: the
 * engine names the point by its key (or `#<index>`) and refuses one that is gone. `ack` only when the person confirmed
 * a point under `{safety}`.
 */
export function stepOp(path: string, point: Pick<LearnPoint, 'key' | 'index'>, state: StepState, reason?: string, ack = false): Op {
  return {
    op: 'node_set',
    id: path,
    point: pointRef(point),
    state,
    ...(reason !== undefined ? { reason } : {}),
    ...(ack ? { ack: true as const } : {}),
  };
}

/** The planned hours of a point as shown: `2`, `2–3`; null without any. */
export function hoursText(point: Pick<LearnPoint, 'h_min' | 'h_max'>): string | null {
  const min = point.h_min;
  const max = point.h_max;
  if (min === undefined && max === undefined) return null;
  const lo = min ?? max!;
  const hi = max ?? min!;
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}

/** The projects of the paths in the list, for the filter, by id (a path without a project is not one). */
export function projectsOf(items: readonly Pick<LearnNextItem, 'project'>[]): string[] {
  return [...new Set(items.flatMap((i) => (i.project ? [i.project] : [])))].toSorted();
}

/** The paths of project `project` ('' every path), in the engine's order. */
export function ofProject<T extends Pick<LearnNextItem, 'project'>>(items: readonly T[], project: string): T[] {
  return project === '' ? [...items] : items.filter((i) => i.project === project);
}

/** The key that does something on a card, or null: `l`, `s`, `n` without a modifier, Enter to open it in the path. */
export function cardKey(event: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey'>): StepState | 'open' | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  switch (event.key) {
    case 'l':
      return 'learned';
    case 's':
      return 'seen';
    case 'n':
      return 'dropped';
    case 'Enter':
      return 'open';
    default:
      return null;
  }
}
