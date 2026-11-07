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
export function planOp(form: PlanForm): Op {
  const phases = parsePhases(form.phases);
  const summary = form.summary.trim();
  const target = form.target.trim();
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

/** What the dry run said. */
export type PlanPreview =
  | { kind: 'ok'; id: string; renamed: boolean }
  | { kind: 'refused'; message: string }
  | { kind: 'unknown' };

/** Whether the form can be sent: a title and an area, and the engine did not refuse the last dry run. */
export function canCreate(form: PlanForm, preview: PlanPreview | null): boolean {
  return form.title.trim() !== '' && form.area !== '' && preview?.kind === 'ok';
}
