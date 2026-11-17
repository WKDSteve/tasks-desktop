import { describe, expect, it } from 'vitest';
import {
  badPhaseOf,
  canCreate,
  emptyForm,
  parsePhases,
  planOp,
  replacePhase,
  targetTaskOp,
  targetTitle,
  type PlanForm,
} from './planwizard';

const form = (extra: Partial<PlanForm> = {}): PlanForm => ({ ...emptyForm('lib.nvim'), title: 'A plan', ...extra });

describe('planOp', () => {
  it('sends only what was filled in', () => {
    expect(planOp(form())).toEqual({ op: 'plan_new', area: 'lib.nvim', title: 'A plan', areas: ['lib.nvim'] });
  });

  it('sends everything that was chosen, the phases as a list in order', () => {
    expect(
      planOp(
        form({
          title: '  Spaced  ',
          areas: ['lib.nvim', 'cascade.nvim'],
          status: 'doing',
          phases: ' design, build ,, design, ship',
          target: ' lib.nvim/alpha ',
          hard: true,
          summary: ' One line. ',
        }),
      ),
    ).toEqual({
      op: 'plan_new',
      area: 'lib.nvim',
      title: 'Spaced',
      areas: ['lib.nvim', 'cascade.nvim'],
      phases: ['design', 'build', 'ship'],
      target: 'lib.nvim/alpha',
      gate: 'hard',
      status: 'doing',
      summary: 'One line.',
    });
  });

  it('leaves out an empty list and an empty text instead of sending an empty value', () => {
    const op = planOp(form({ areas: [], phases: ' , ', target: '  ', summary: '' }));
    expect(op).toEqual({ op: 'plan_new', area: 'lib.nvim', title: 'A plan' });
  });
});

describe('planOp with projects', () => {
  it('a plan names its project and its stage there', () => {
    expect(planOp(form({ project: ' ALL/mobile ', phase: ' basis ' }))).toEqual({
      op: 'plan_new',
      area: 'lib.nvim',
      title: 'A plan',
      areas: ['lib.nvim'],
      project: 'ALL/mobile',
      phase: 'basis',
    });
  });

  it('a stage without a project is not sent (the engine refuses plan-phase-without-project)', () => {
    expect(planOp(form({ phase: 'basis' }))).toEqual({ op: 'plan_new', area: 'lib.nvim', title: 'A plan', areas: ['lib.nvim'] });
  });

  it('a project is project_new and is in no project', () => {
    expect(planOp({ ...emptyForm('ALL', 'project', 'ALL/x'), title: 'Mobile', phases: 'basis, group-a', project: 'ALL/x', phase: 'p' })).toEqual({
      op: 'project_new',
      area: 'ALL',
      title: 'Mobile',
      areas: ['ALL'],
      phases: ['basis', 'group-a'],
    });
  });

  it('the empty form of a plan of a project starts in that project', () => {
    expect(emptyForm('a', 'plan', 'ALL/mobile')).toMatchObject({ kind: 'plan', project: 'ALL/mobile', phase: '' });
    expect(emptyForm('a', 'project', 'ALL/mobile')).toMatchObject({ kind: 'project', project: '' });
  });
});

describe('parsePhases', () => {
  it('keeps the order and drops empties and repeats', () => {
    expect(parsePhases('b, a,,b')).toEqual(['b', 'a']);
    expect(parsePhases('')).toEqual([]);
  });
});

describe('canCreate', () => {
  it('needs a title, an area and a dry run the engine accepted', () => {
    const ok = { kind: 'ok', id: 'lib.nvim/a-plan', renamed: false } as const;
    expect(canCreate(form(), ok)).toBe(true);
    expect(canCreate(form({ title: '  ' }), ok)).toBe(false);
    expect(canCreate(form({ area: '' }), ok)).toBe(false);
    expect(canCreate(form(), null)).toBe(false);
    expect(canCreate(form(), { kind: 'unknown' })).toBe(false);
    expect(canCreate(form(), { kind: 'refused', message: 'x' })).toBe(false);
  });
});

describe('a target task made with the plan', () => {
  it('the plan names the id the dry run gave the task, not the typed target', () => {
    const op = planOp(form({ targetNew: true, target: 'lib.nvim/old' }), 'lib.nvim/done-a-plan');
    expect(op).toMatchObject({ op: 'plan_new', target: 'lib.nvim/done-a-plan' });
    expect(planOp(form({ targetNew: true, target: 'lib.nvim/old' }))).not.toHaveProperty('target');
  });

  it('the task goes into the plan and its last phase, a project task into the project; a dry run asks the bare id', () => {
    const f = form({ phases: 'design, build, ship', targetNew: true });
    expect(targetTaskOp(f, 'Done: A plan', 'lib.nvim/a-plan')).toEqual({
      op: 'new',
      area: 'lib.nvim',
      title: 'Done: A plan',
      fields: { plan: 'lib.nvim/a-plan', phase: 'ship' },
    });
    expect(targetTaskOp(form({ targetNew: true }), 'T', 'lib.nvim/a-plan')).toEqual({
      op: 'new',
      area: 'lib.nvim',
      title: 'T',
      fields: { plan: 'lib.nvim/a-plan' },
    });
    expect(targetTaskOp({ ...f, kind: 'project' }, 'T', 'lib.nvim/p')).toEqual({
      op: 'new',
      area: 'lib.nvim',
      title: 'T',
      fields: { project: 'lib.nvim/p' },
    });
    expect(targetTaskOp(f, 'T')).toEqual({ op: 'new', area: 'lib.nvim', title: 'T' });
  });

  it('the typed title wins over the offered one', () => {
    expect(targetTitle(form({ targetTitle: '  Mine ' }), 'Done: A plan')).toBe('Mine');
    expect(targetTitle(form(), ' Done: A plan ')).toBe('Done: A plan');
  });

  it('cannot be sent before the dry run gave the task its id', () => {
    const f = form({ targetNew: true });
    expect(canCreate(f, { kind: 'ok', id: 'lib.nvim/a-plan', renamed: false })).toBe(false);
    expect(canCreate(f, { kind: 'ok', id: 'lib.nvim/a-plan', renamed: false, target: 'lib.nvim/t' })).toBe(true);
  });
});

describe('a phase the engine refused', () => {
  it('is read from the details of the error, and only a phase is', () => {
    expect(badPhaseOf({ field: 'phase', value: 'einführung', char: 'ü', suggestion: 'einfuehrung' })).toEqual({
      value: 'einführung',
      char: 'ü',
      suggestion: 'einfuehrung',
    });
    expect(badPhaseOf({ field: 'phase', value: '!!!', char: '!' })).toEqual({ value: '!!!', char: '!' });
    expect(badPhaseOf({ field: 'slug', value: 'x' })).toBeUndefined();
    expect(badPhaseOf(undefined)).toBeUndefined();
    expect(badPhaseOf('phase')).toBeUndefined();
  });

  it('is replaced by the suggestion in place, the others kept in their order', () => {
    expect(replacePhase('abstimmungen, testen, einführung, abschluss', 'einführung', 'einfuehrung')).toBe(
      'abstimmungen, testen, einfuehrung, abschluss',
    );
  });
});
