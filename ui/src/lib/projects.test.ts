import { describe, expect, it } from 'vitest';
import { applyFilter, emptyFilter, fieldOptions, NONE } from './filter';
import { task } from './fixtures';
import { planProjects, projectOfPlan, projectOfTask, projectPage, share, subtaskCount, type PlanInfo, type Project } from './projects';

const rollup = { plans_total: 3, plans_done: 1, plans_parked: 0, tasks_open: 4, tasks_done: 6, own_open: 1, days_open: 5 };
const mobile: Project = {
  id: 'ALL/mobile',
  title: 'Mobile',
  status: 'doing',
  areas: ['ALL'],
  phase_order: ['basis', 'group-a'],
  valid: true,
  plans: ['a/app', 'b/web', 'c/late'],
  rollup,
};
const plan = (id: string, extra: Partial<PlanInfo> = {}): PlanInfo => ({
  id,
  title: id,
  status: 'doing',
  areas: [],
  phase_order: [],
  valid: true,
  ...extra,
});
const plans: PlanInfo[] = [
  plan('c/late', { project: 'ALL/mobile', phase: 'group-a' }),
  plan('a/app', { project: 'ALL/mobile', phase: 'basis' }),
  plan('b/web', { project: 'ALL/mobile' }),
  plan('d/alone'),
  plan('e/other', { project: 'ALL/elsewhere', phase: 'zeta' }),
];
const tasks = [
  task('a/one', { plan: 'a/app', readiness: { state: 'waiting' } as never }),
  task('a/two', { plan: 'a/app', readiness: { state: 'ready' } as never }),
  task('ALL/decide', { project: 'ALL/mobile', steps: { total: 5, ticked: 3, dropped: 0 } }),
  task('d/x', { plan: 'd/alone' }),
  task('z/free'),
];

describe('the project of a task', () => {
  const byPlan = planProjects(plans);

  it('is its own, else that of its plan, else none', () => {
    expect(projectOfTask(tasks[2]!, byPlan)).toBe('ALL/mobile');
    expect(projectOfTask(tasks[0]!, byPlan)).toBe('ALL/mobile');
    expect(projectOfTask(tasks[3]!, byPlan)).toBeUndefined();
    expect(projectOfTask(tasks[4]!, byPlan)).toBeUndefined();
  });

  it('filters: a project keeps the tasks of its plans and its own', () => {
    const projectOf = (t: (typeof tasks)[number]) => projectOfTask(t, byPlan);
    const filter = { ...emptyFilter, fields: { project: ['ALL/mobile'] } };
    expect(applyFilter(tasks, filter, '2026-11-07', undefined, undefined, projectOf).map((t) => t.id)).toEqual([
      'a/one',
      'a/two',
      'ALL/decide',
    ]);
    // `none` is the tasks in no project.
    const none = { ...emptyFilter, fields: { project: [NONE] } };
    expect(applyFilter(tasks, none, '2026-11-07', undefined, undefined, projectOf).map((t) => t.id)).toEqual(['d/x', 'z/free']);
    expect(fieldOptions(tasks, 'project', projectOf)).toEqual([
      { value: 'ALL/mobile', count: 3 },
      { value: NONE, count: 2 },
    ]);
  });

  it('without the plans read, only the task that names the project is in it', () => {
    const filter = { ...emptyFilter, fields: { project: ['ALL/mobile'] } };
    expect(applyFilter(tasks, filter, '2026-11-07').map((t) => t.id)).toEqual(['ALL/decide']);
  });

  it('of a plan: the project it names, when the vault has it', () => {
    expect(projectOfPlan([mobile], plans[1])?.id).toBe('ALL/mobile');
    expect(projectOfPlan([mobile], plans[4])).toBeUndefined();
    expect(projectOfPlan([mobile], plans[3])).toBeUndefined();
    expect(projectOfPlan([mobile], undefined)).toBeUndefined();
  });
});

describe('the project page', () => {
  const page = projectPage(mobile, plans, tasks);

  it('lists the own open tasks, not those of its plans', () => {
    expect(page.own.map((t) => t.id)).toEqual(['ALL/decide']);
  });

  it('groups the plans by stage in the order of the project, the plans without one last', () => {
    expect(page.stages.map((s) => [s.phase, s.cards.map((c) => c.plan.id)])).toEqual([
      ['basis', ['a/app']],
      ['group-a', ['c/late']],
      [null, ['b/web']],
    ]);
  });

  it('a stage the project does not name comes after its own, before the plans without one', () => {
    const odd = projectPage(mobile, [...plans, plan('f/odd', { project: 'ALL/mobile', phase: 'later' })], tasks);
    expect(odd.stages.map((s) => s.phase)).toEqual(['basis', 'group-a', 'later', null]);
  });

  it('a card carries the open tasks of its plan and the next one: the first ready, else the first', () => {
    const app = page.stages[0]!.cards[0]!;
    expect(app.open.map((t) => t.id)).toEqual(['a/one', 'a/two']);
    expect(app.next?.id).toBe('a/two');
    const late = page.stages[1]!.cards[0]!;
    expect(late.open).toEqual([]);
    expect(late.next).toBeUndefined();
  });

  it('leaves out an empty stage', () => {
    const empty = projectPage({ ...mobile, phase_order: ['basis', 'unused', 'group-a'] }, plans, tasks);
    expect(empty.stages.map((s) => s.phase)).toEqual(['basis', 'group-a', null]);
  });
});

describe('the figures', () => {
  it('share: finished out of all, 0 without tasks', () => {
    expect(share(3, 1)).toBe(0.75);
    expect(share(0, 0)).toBe(0);
  });

  it('subtasks: the steps as "3/5", none without steps', () => {
    expect(subtaskCount({ steps: { total: 5, ticked: 3, dropped: 1 } })).toBe('3/5');
    expect(subtaskCount({ steps: { total: 0, ticked: 0, dropped: 0 } })).toBeUndefined();
    expect(subtaskCount({})).toBeUndefined();
  });
});
