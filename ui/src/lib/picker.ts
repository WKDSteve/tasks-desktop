// The searchable choices of the page (`PickList.svelte`): which entries a choice of a plan, a phase, a project or of
// tasks offers, how a typed word narrows them, and the `set` operations that put chosen tasks into a plan. The lists come
// from the engine's snapshot as they are; nothing here judges whether a plan may take a task (the engine refuses and
// says why, and that answer is what the page shows).
import type { Snapshot, TaskEntry } from './contract';
import type { Project } from './projects';

/** One entry of a searchable choice. */
export interface PickOption {
  /** What is chosen (an id, a phase name). */
  value: string;
  /** The words shown first (a title). */
  label: string;
  /** A second, smaller line (the id, the areas, the status). Searched like the label. */
  detail?: string;
  /** A short mark after the label (e.g. "in another plan"); not searched. */
  note?: string;
  /** Shown first in the list, before the others (e.g. plans that name the area of the task). */
  near?: boolean;
}

/** An entry of a choice that does something instead of choosing a value ("No plan", "Create a plan ..."). */
export interface PickAction {
  id: string;
  label: string;
}

export type Plan = Snapshot['plans'][number];

/**
 * The entries a typed word leaves: every word of it must stand in the label or the detail (any case, any order). The
 * entries near the thing being chosen for come first; within each part the order is the one given.
 */
export function filterOptions(options: readonly PickOption[], needle: string): PickOption[] {
  const words = needle.toLowerCase().split(/\s+/).filter((w) => w !== '');
  const hit = (o: PickOption): boolean => {
    const text = `${o.label}\n${o.detail ?? ''}\n${o.value}`.toLowerCase();
    return words.every((w) => text.includes(w));
  };
  const left = options.filter(hit);
  return [...left.filter((o) => o.near), ...left.filter((o) => !o.near)];
}

/** The open plans as entries: title, id and areas; the plans that name `area` (the task's) first. */
export function planOptions(plans: readonly Plan[], area: string | undefined): PickOption[] {
  return plans
    .filter((p) => p.status !== 'done')
    .map((p) => ({
      value: p.id,
      label: p.title || p.id,
      detail: [p.id, p.areas.join(', ')].filter((x) => x !== '').join(' · '),
      ...(area !== undefined && p.areas.includes(area) ? { near: true } : {}),
    }));
}

/**
 * The phases of a plan as entries: its `phase_order`, then a phase the tasks name that the plan does not (as the plan
 * view counts them), so a task's own phase is never missing from its choice.
 */
export function phaseOptions(plan: Plan | undefined, tasks: readonly TaskEntry[]): PickOption[] {
  if (!plan) return [];
  const named = [...plan.phase_order];
  for (const t of tasks) {
    if (t.plan === plan.id && t.phase && !named.includes(t.phase)) named.push(t.phase);
  }
  return named.map((phase) => ({ value: phase, label: phase }));
}

/** The open projects as entries, those that name `area` first. */
export function projectOptions(projects: readonly Project[], area: string | undefined): PickOption[] {
  return projects
    .filter((p) => p.status !== 'done')
    .map((p) => ({
      value: p.id,
      label: p.title || p.id,
      detail: [p.id, p.areas.join(', ')].filter((x) => x !== '').join(' · '),
      ...(area !== undefined && p.areas.includes(area) ? { near: true } : {}),
    }));
}

/** Where tasks are added to: a plan (and one of its phases) or a project (its own tasks). */
export type AddTarget =
  | { kind: 'plan'; id: string; phase?: string; areas: readonly string[] }
  | { kind: 'project'; id: string; areas: readonly string[] };

/** The tasks of the target already: they are not offered. */
function inTarget(task: TaskEntry, target: AddTarget): boolean {
  if (target.kind === 'project') return task.project === target.id;
  return task.plan === target.id && (target.phase === undefined || task.phase === target.phase);
}

/** The plan or project a task is in now, other than the target: it is moved only after a question. */
export function elsewhere(task: TaskEntry, target: AddTarget): string | undefined {
  if (task.plan && !(target.kind === 'plan' && task.plan === target.id)) return task.plan;
  if (task.project && !(target.kind === 'project' && task.project === target.id)) return task.project;
  return undefined;
}

/**
 * The open tasks that can be added to the target, as entries: title, then id, area and status; a task that is in
 * another plan or project carries `elsewhereNote` with its name. `onlyAreas`: only the tasks of the target's areas (a
 * target without areas narrows nothing).
 */
export function taskOptions(
  tasks: readonly TaskEntry[],
  target: AddTarget,
  onlyAreas: boolean,
  words: { status: (status: string | undefined) => string; elsewhere: (where: string) => string },
): PickOption[] {
  const areas = new Set(target.areas);
  return tasks
    .filter((t) => !inTarget(t, target))
    .filter((t) => !onlyAreas || areas.size === 0 || areas.has(t.area))
    .map((t) => {
      const other = elsewhere(t, target);
      return {
        value: t.id,
        label: t.title || t.id,
        detail: [t.id, t.area, words.status(t.status)].join(' · '),
        ...(other !== undefined ? { note: words.elsewhere(other) } : {}),
      };
    });
}

export type SetOp = { op: 'set'; id: string; patch: Record<string, unknown>; if_match?: string };

/**
 * The `set` operations that put the chosen tasks into the target, each with the version that was shown (`if_match`).
 * Into a plan: `plan`, and `phase` when the target names one (a task from another plan leaves that plan's phase
 * behind); a task that belonged to a project directly leaves it for the plan. Into a project: `project`, and the task
 * leaves its plan. Ids that are not open tasks any more are left out.
 */
export function addOps(tasks: readonly TaskEntry[], ids: readonly string[], target: AddTarget): SetOp[] {
  const byId = new Map(tasks.map((t) => [t.id, t] as const));
  const ops: SetOp[] = [];
  for (const id of ids) {
    const task = byId.get(id);
    if (!task) continue;
    const patch: Record<string, unknown> = {};
    if (target.kind === 'plan') {
      patch.plan = target.id;
      if (target.phase !== undefined) patch.phase = target.phase;
      else if (task.phase && task.plan !== target.id) patch.phase = null;
      if (task.project) patch.project = null;
    } else {
      patch.project = target.id;
      if (task.plan) patch.plan = null;
      if (task.phase) patch.phase = null;
    }
    ops.push({ op: 'set', id, patch, ...(task.etag ? { if_match: task.etag } : {}) });
  }
  return ops;
}
