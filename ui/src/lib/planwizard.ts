// The plan wizard: what the form holds and the one operation it makes of it. The rules of a plan (the name, the
// phases, the target, the gate) are the engine's: the wizard asks it for a dry run while the person types and shows
// its answer, so the page keeps no second copy of them.

import type { Op } from './api';
import { parseTags } from './fields';

export type PlanStatus = 'planning' | 'doing' | 'parked';
export const PLAN_STATUSES: readonly PlanStatus[] = ['planning', 'doing', 'parked'];

/** What the wizard makes: a plan, or a project (the level above plans, capability `project_new`). */
export type PlanKind = 'plan' | 'project';

export interface PlanForm {
  kind: PlanKind;
  title: string;
  /** The area whose `ROADMAP/plans/` holds the file. */
  area: string;
  /** The areas the plan covers (may be none). */
  areas: string[];
  status: PlanStatus;
  /** The phases in order, comma separated. */
  phases: string;
  /** The task a finished plan is aiming at (`<area>/<slug>`), or empty. */
  target: string;
  /**
   * The target task is made with the plan (in the same request) instead of named: `target` is not sent then, the
   * new task goes into the plan (its last phase) or the project, and the plan names it as its target.
   */
  targetNew: boolean;
  /** The title of the target task to make; empty: the default the wizard offers (`targetTitle`). */
  targetTitle: string;
  /** Each phase waits for the one before (`gate: hard`). */
  hard: boolean;
  summary: string;
  /** A plan only: the project it belongs to (an id), or empty. */
  project: string;
  /** A plan only: its stage in that project (one of the project's phases), or empty. */
  phase: string;
}

export function emptyForm(area = '', kind: PlanKind = 'plan', project = ''): PlanForm {
  return {
    kind,
    title: '',
    area,
    areas: area ? [area] : [],
    status: 'planning',
    phases: '',
    target: '',
    targetNew: false,
    targetTitle: '',
    hard: false,
    summary: '',
    project: kind === 'plan' ? project : '',
    phase: '',
  };
}

/** The phases as typed: trimmed words in order, no empty one, no repeat. */
export function parsePhases(text: string): string[] {
  return parseTags(text);
}

/**
 * The `plan_new` (or `project_new`) operation of a form. Only what was filled in is sent: the engine has its own
 * defaults, and an empty list or text is "not given", never an empty value. A project is in no project, so its form
 * sends neither `project` nor `phase`; a stage without a project is not sent either (the engine would refuse it).
 */
export function planOp(form: PlanForm, newTarget = ''): Op {
  const phases = parsePhases(form.phases);
  const summary = form.summary.trim();
  // A target made with the plan is named by the id the engine gave it in the dry run (none yet: no target).
  const target = form.targetNew ? newTarget : form.target.trim();
  const project = form.kind === 'plan' ? form.project.trim() : '';
  const phase = project !== '' ? form.phase.trim() : '';
  const common = {
    area: form.area,
    title: form.title.trim(),
    ...(form.areas.length > 0 ? { areas: form.areas } : {}),
    ...(phases.length > 0 ? { phases } : {}),
    ...(target !== '' ? { target } : {}),
    ...(form.hard ? { gate: 'hard' } : {}),
    ...(form.status !== 'planning' ? { status: form.status } : {}),
    ...(summary !== '' ? { summary } : {}),
  };
  if (form.kind === 'project') return { op: 'project_new', ...common };
  return {
    op: 'plan_new',
    ...common,
    ...(project !== '' ? { project } : {}),
    ...(phase !== '' ? { phase } : {}),
  };
}

/**
 * The title of the target task to make: the one typed, else `fallback` (the wizard offers "Done: <plan title>").
 * Empty when neither is there.
 */
export function targetTitle(form: PlanForm, fallback: string): string {
  return form.targetTitle.trim() || fallback.trim();
}

/**
 * The `new` operation of the target task made with the plan `planId`: in the area of the plan file, in the plan and
 * its last phase (a project: in the project). With `planId` empty it is the bare `new` of a dry run, which only asks
 * the id: the engine's dry run does not see the plan the same request would make, so it would refuse the plan field.
 */
export function targetTaskOp(form: PlanForm, title: string, planId = ''): Op {
  const phases = parsePhases(form.phases);
  const last = phases[phases.length - 1];
  const fields: Record<string, unknown> =
    planId === ''
      ? {}
      : form.kind === 'project'
        ? { project: planId }
        : { plan: planId, ...(last !== undefined ? { phase: last } : {}) };
  return { op: 'new', area: form.area, title, ...(Object.keys(fields).length > 0 ? { fields } : {}) };
}

/** What the dry run said. `target` is the id the target task made with the plan would get. */
export type PlanPreview =
  | { kind: 'ok'; id: string; renamed: boolean; target?: string }
  | { kind: 'refused'; message: string }
  | { kind: 'unknown' };

/**
 * Whether the form can be sent: a title and an area, and the engine did not refuse the last dry run; a target task
 * to make needs the id the dry run gave it.
 */
export function canCreate(form: PlanForm, preview: PlanPreview | null): boolean {
  if (form.title.trim() === '' || form.area === '' || preview?.kind !== 'ok') return false;
  return !form.targetNew || preview.target !== undefined;
}
