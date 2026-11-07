// Projects, the level above plans (capability `projects`): a project groups plans and may hold tasks of its own. The
// engine says which plan belongs to which project (`plans[].project`, `phase`), which task is the project's own
// (`tasks[].project`) and how far the project is (`rollup`); this only reads it and lays it out. A task of a plan
// belongs to the plan's project: the engine has no grouping or view by project yet, so that one step is taken here.

import type { Snapshot, TaskEntry } from './contract';

export type Project = Snapshot['projects'][number];
export type PlanInfo = Snapshot['plans'][number];

/** The projects of a snapshot (an engine without the capability has none). */
export function projectsOf(snapshot: Snapshot | null | undefined): Project[] {
  return snapshot?.projects ?? [];
}

/** For every plan that names a project: the project's id. */
export function planProjects(plans: readonly PlanInfo[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const plan of plans) if (plan.project) out.set(plan.id, plan.project);
  return out;
}

/**
 * The project a task belongs to: its own (`project`, a task of the project itself) or that of its plan. Undefined for
 * a task in no project.
 */
export function projectOfTask(task: TaskEntry, byPlan: ReadonlyMap<string, string>): string | undefined {
  if (task.project) return task.project;
  return task.plan ? byPlan.get(task.plan) : undefined;
}

/** The project of a plan, when the plan names one that the vault has. */
export function projectOfPlan(projects: readonly Project[], plan: PlanInfo | undefined): Project | undefined {
  if (!plan?.project) return undefined;
  return projects.find((p) => p.id === plan.project);
}

/** One plan of a project, as its card shows it. */
export interface PlanCard {
  plan: PlanInfo;
  /** The open tasks of the plan, in the engine's plan order. */
  open: TaskEntry[];
  /** The first open task the engine counts as ready, else the first open one: what comes next. */
  next: TaskEntry | undefined;
}

/** The plans of one stage of the project (`phase` of the plan); `null` for the plans that name no stage. */
export interface PlanStage {
  phase: string | null;
  cards: PlanCard[];
}

/** The project page: its own open tasks and its plans, by stage. */
export interface ProjectPage {
  project: Project;
  own: TaskEntry[];
  stages: PlanStage[];
}

/**
 * The page of `project`: its own open tasks and the cards of its plans, grouped by stage in the order of the project's
 * `phase_order` (a stage it does not name after those, in the order met; the plans without a stage last). Inside a
 * stage the plans keep the engine's order of `plans`. `tasks` are the open tasks of the snapshot, in plan order.
 */
export function projectPage(project: Project, plans: readonly PlanInfo[], tasks: readonly TaskEntry[]): ProjectPage {
  const own = tasks.filter((t) => t.project === project.id && !t.plan);
  const members = plans.filter((p) => p.project === project.id);
  const byPlan = new Map<string, TaskEntry[]>();
  for (const plan of members) byPlan.set(plan.id, []);
  for (const task of tasks) if (task.plan) byPlan.get(task.plan)?.push(task);
  const byStage = new Map<string | null, PlanCard[]>();
  for (const phase of project.phase_order) byStage.set(phase, []);
  for (const plan of members) {
    const open = byPlan.get(plan.id) ?? [];
    const card: PlanCard = { plan, open, next: open.find((t) => t.readiness?.state === 'ready') ?? open[0] };
    const key = plan.phase ?? null;
    const list = byStage.get(key);
    if (list) list.push(card);
    else byStage.set(key, [card]);
  }
  const stages = [...byStage.entries()]
    .filter(([, cards]) => cards.length > 0)
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : 0))
    .map(([phase, cards]) => ({ phase, cards }));
  return { project, own, stages };
}

/** How far a plan is: its finished tasks out of all, as a share from 0 to 1 (0 for a plan without tasks). */
export function share(done: number, open: number): number {
  const total = done + open;
  return total === 0 ? 0 : done / total;
}

/** What finishing a plan or a project by hand would do (a dry run of `plan_close` / `project_close`). */
export type ClosePreview =
  | { kind: 'ok' }
  /** The engine refuses: these ids (open tasks, plans other than parked ones) hold it open. */
  | { kind: 'holding'; ids: string[] }
  | { kind: 'refused'; message: string }
  | { kind: 'unknown' };

/** The steps of a task (its subtasks) as the counter shows them, `3/5`; undefined for a task without steps. */
export function subtaskCount(task: Pick<TaskEntry, 'steps'>): string | undefined {
  const steps = task.steps;
  return steps && steps.total > 0 ? `${steps.ticked}/${steps.total}` : undefined;
}
