import { describe, expect, it } from 'vitest';
import type { Result, Snapshot } from './contract';
import { task } from './fixtures';
import { make, snapshot } from './appDouble';
import { translate } from './i18n';
import { emptyForm } from './planwizard';
import { addOps, elsewhere, filterOptions, phaseOptions, planOptions, projectOptions, taskOptions, type AddTarget, type Plan } from './picker';
import type { Project } from './projects';

const plan = (id: string, extra: Partial<Plan> = {}): Plan => ({
  id,
  title: `Plan ${id}`,
  areas: [id.split('/')[0] ?? ''],
  phase_order: [],
  valid: true,
  ...extra,
});
const words = { status: (s: string | undefined) => s ?? 'open', elsewhere: (w: string) => `in ${w}` };

describe('the entries of a choice', () => {
  it('narrows to the entries holding every typed word, in label, detail or value, the near ones first', () => {
    const options = [
      { value: 'a/x', label: 'Release train', detail: 'a/x · a' },
      { value: 'b/y', label: 'Mobile app', detail: 'b/y · b', near: true },
      { value: 'c/z', label: 'Release notes', detail: 'c/z · c', near: true },
    ];
    expect(filterOptions(options, '').map((o) => o.value)).toEqual(['b/y', 'c/z', 'a/x']);
    expect(filterOptions(options, 'release').map((o) => o.value)).toEqual(['c/z', 'a/x']);
    expect(filterOptions(options, 'NOTES rel').map((o) => o.value)).toEqual(['c/z']);
    expect(filterOptions(options, 'b/y').map((o) => o.value)).toEqual(['b/y']);
    expect(filterOptions(options, 'nothing')).toEqual([]);
  });

  it('offers the open plans with id and areas, those of the task area first; a finished plan is not offered', () => {
    const plans = [plan('pub/one'), plan('ops/two', { areas: ['ops', 'pub'] }), plan('ops/three'), plan('pub/old', { status: 'done' })];
    const options = planOptions(plans, 'pub');
    expect(options.map((o) => o.value)).toEqual(['pub/one', 'ops/two', 'ops/three']);
    expect(options[1]).toEqual({ value: 'ops/two', label: 'Plan ops/two', detail: 'ops/two · ops, pub', near: true });
    expect(options[2]?.near).toBeUndefined();
    // A plan outside the area is offered too: whether it takes the task is the engine's to say.
    expect(filterOptions(options, '').map((o) => o.value)).toEqual(['pub/one', 'ops/two', 'ops/three']);
  });

  it('offers the phases of the plan in its order, then a phase only its tasks name', () => {
    const p = plan('pub/p', { phase_order: ['design', 'build'] });
    const tasks = [task('pub/a', { plan: 'pub/p', phase: 'ship' }), task('pub/b', { plan: 'pub/q', phase: 'other' }), task('pub/c', { plan: 'pub/p', phase: 'build' })];
    expect(phaseOptions(p, tasks).map((o) => o.value)).toEqual(['design', 'build', 'ship']);
    expect(phaseOptions(undefined, tasks)).toEqual([]);
  });

  it('offers the open projects, those of the area first', () => {
    const projects = [
      { id: 'ops/m', title: 'Mobile', areas: ['ops'], phase_order: [], valid: true, plans: [] },
      { id: 'pub/w', title: 'Web', areas: ['pub'], phase_order: [], valid: true, plans: [] },
      { id: 'pub/d', title: 'Done', status: 'done', areas: ['pub'], phase_order: [], valid: true, plans: [] },
    ] as unknown as Project[];
    expect(filterOptions(projectOptions(projects, 'pub'), '').map((o) => o.value)).toEqual(['pub/w', 'ops/m']);
  });
});

describe('the tasks to add to a plan', () => {
  const tasks = [
    task('pub/a'),
    task('pub/b', { plan: 'pub/p', phase: 'build' }),
    task('pub/c', { plan: 'pub/other', phase: 'x' }),
    task('ops/d'),
    task('pub/e', { project: 'pub/proj' }),
    task('pub/f', { plan: 'pub/p' }),
  ];
  const target: AddTarget = { kind: 'plan', id: 'pub/p', areas: ['pub'] };

  it('offers the open tasks not in the plan yet, of its areas unless switched off, the ones elsewhere marked', () => {
    expect(taskOptions(tasks, target, true, words).map((o) => o.value)).toEqual(['pub/a', 'pub/c', 'pub/e']);
    expect(taskOptions(tasks, target, false, words).map((o) => o.value)).toEqual(['pub/a', 'pub/c', 'ops/d', 'pub/e']);
    const c = taskOptions(tasks, target, true, words).find((o) => o.value === 'pub/c');
    expect(c).toMatchObject({ label: 'Task pub/c', detail: 'pub/c · pub · open', note: 'in pub/other' });
    // Into one phase: a task of the plan in another phase is offered (it moves within its plan, no question).
    const phase: AddTarget = { ...target, phase: 'design' };
    expect(taskOptions(tasks, phase, true, words).map((o) => o.value)).toEqual(['pub/a', 'pub/b', 'pub/c', 'pub/e', 'pub/f']);
    expect(elsewhere(tasks[1]!, phase)).toBeUndefined();
    expect(elsewhere(tasks[4]!, phase)).toBe('pub/proj');
  });

  it('writes plan and phase with the version shown; a task from elsewhere leaves its old phase and project', () => {
    const versioned = tasks.map((t) => ({ ...t, etag: `e-${t.id}` }));
    expect(addOps(versioned, ['pub/a', 'pub/c', 'pub/e', 'gone/x'], target)).toEqual([
      { op: 'set', id: 'pub/a', patch: { plan: 'pub/p' }, if_match: 'e-pub/a' },
      { op: 'set', id: 'pub/c', patch: { plan: 'pub/p', phase: null }, if_match: 'e-pub/c' },
      { op: 'set', id: 'pub/e', patch: { plan: 'pub/p', project: null }, if_match: 'e-pub/e' },
    ]);
    expect(addOps(versioned, ['pub/b'], { ...target, phase: 'design' })).toEqual([
      { op: 'set', id: 'pub/b', patch: { plan: 'pub/p', phase: 'design' }, if_match: 'e-pub/b' },
    ]);
    expect(addOps(versioned, ['pub/b', 'pub/a'], { kind: 'project', id: 'pub/proj', areas: ['pub'] })).toEqual([
      { op: 'set', id: 'pub/b', patch: { project: 'pub/proj', plan: null, phase: null }, if_match: 'e-pub/b' },
      { op: 'set', id: 'pub/a', patch: { project: 'pub/proj' }, if_match: 'e-pub/a' },
    ]);
  });
});

describe('the app with the choices', () => {
  async function ready() {
    const m = make({ token: 't' });
    m.hub.capabilities = ['plan_new', 'projects'];
    m.hub.doc = {
      ...snapshot([task('pub/a', { etag: 'ea' }), task('pub/b', { etag: 'eb' }), task('pub/c', { etag: 'ec' })]),
      plans: [plan('pub/p', { phase_order: ['one'] })],
    } as Snapshot;
    await m.app.start(null);
    expect(m.app.phase).toBe('ready');
    m.app.stop();
    return m;
  }

  it('adds the chosen tasks in one write, tells each refusal with the engine words, and offers the way back', async () => {
    const m = await ready();
    m.hub.next_ops = {
      kind: 'tasks.result',
      ok: false,
      dry_run: false,
      results: [
        { n: 1, op: 'set', id: 'pub/a', ok: true, outcome: 'changed', changed_ids: ['pub/a'], inverse: { op: 'set', id: 'pub/a', patch: { plan: null, phase: null } } },
        { n: 2, op: 'set', ok: false, outcome: 'failed', changed_ids: [], error: { code: 'invalid_argument', message: 'plan pub/p does not cover area ops', retryable: false } },
        { n: 3, op: 'set', id: 'pub/c', ok: true, outcome: 'changed', changed_ids: ['pub/c'], inverse: { op: 'set', id: 'pub/c', patch: { plan: null, phase: null } } },
      ],
    } as unknown as Result;
    const answer = await m.app.addTasksTo(['pub/a', 'pub/b', 'pub/c'], { kind: 'plan', id: 'pub/p', phase: 'one', areas: ['pub'] });
    expect(m.hub.sent).toHaveLength(1);
    expect(m.hub.sent[0]?.ops).toEqual([
      { op: 'set', id: 'pub/a', patch: { plan: 'pub/p', phase: 'one' }, if_match: 'ea' },
      { op: 'set', id: 'pub/b', patch: { plan: 'pub/p', phase: 'one' }, if_match: 'eb' },
      { op: 'set', id: 'pub/c', patch: { plan: 'pub/p', phase: 'one' }, if_match: 'ec' },
    ]);
    expect(answer).toEqual({ added: 2, failed: [{ id: 'pub/b', message: 'plan pub/p does not cover area ops' }] });
    expect(m.app.toast).toMatchObject({ kind: 'error', text: translate(m.app.lang, 'pick.partial', { done: 2, failed: 1 }) });
    expect(m.app.toast?.undo).toHaveLength(2);
    m.app.stop();
  });

  it('says how many went in when all did, with the way back', async () => {
    const m = await ready();
    const answer = await m.app.addTasksTo(['pub/a', 'pub/b'], { kind: 'plan', id: 'pub/p', areas: ['pub'] });
    expect(answer).toEqual({ added: 2, failed: [] });
    expect(m.app.toast).toMatchObject({ kind: 'ok', text: translate(m.app.lang, 'pick.added', { n: 2 }) });
    expect(m.app.toast?.undo).toHaveLength(2);
    m.app.stop();
  });

  it('opens the plan wizard in the area of the task and hands the new plan back instead of opening it', async () => {
    const m = await ready();
    m.app.setView('list');
    const got: string[] = [];
    m.app.openPlanWizard('plan', '', { area: 'ops', then: (id) => got.push(id) });
    expect(m.app.planningArea).toBe('ops');
    await m.app.createPlan({ ...emptyForm('ops'), title: 'New' });
    expect(got).toEqual(['ops/made-plan']);
    expect(m.app.planning).toBe(false);
    expect(m.app.view).toBe('list');
    // A wizard opened without a choice afterwards opens the plan as before.
    m.app.openPlanWizard();
    expect(m.app.planningArea).toBeUndefined();
    await m.app.createPlan({ ...emptyForm('pub'), title: 'Other' });
    expect(got).toEqual(['ops/made-plan']);
    expect(m.app.view).toBe('plan');
    m.app.stop();
  });

  it('a wizard given up hands nothing back later', async () => {
    const m = await ready();
    const got: string[] = [];
    m.app.openPlanWizard('plan', '', { then: (id) => got.push(id) });
    m.app.closePlanWizard();
    m.app.openPlanWizard();
    await m.app.createPlan({ ...emptyForm('pub'), title: 'Other' });
    expect(got).toEqual([]);
    m.app.stop();
  });

  it('writes a new plan and the phase it takes away in one set (auto save)', async () => {
    const m = await ready();
    await m.app.editFields('pub/a', { plan: 'pub/p', phase: null });
    expect(m.hub.sent.at(-1)?.ops).toEqual([{ op: 'set', id: 'pub/a', patch: { plan: 'pub/p', phase: null }, if_match: 'ea' }]);
    m.app.stop();
  });

  it('opens the capture form with the plan and phase of a plan page', async () => {
    const m = await ready();
    m.app.openCapture('', 'pub', { plan: 'pub/p', phase: 'one' });
    expect(m.app.capturing).toBe(true);
    expect(m.app.captureFill).toEqual({ plan: 'pub/p', phase: 'one' });
    m.app.closeCapture();
    m.app.openCapture('', 'pub', { project: 'pub/proj' });
    expect(m.app.captureFill).toEqual({ project: 'pub/proj' });
    m.app.closeCapture();
    m.app.openCapture();
    expect(m.app.captureFill).toEqual({});
    m.app.stop();
  });
});
