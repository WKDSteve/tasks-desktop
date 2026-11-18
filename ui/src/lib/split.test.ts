import { describe, expect, it } from 'vitest';
import { createDrafts, draftBody, newPhases, parseSplit, runSplit, type Split, type SplitHub, type SplitState, type SplitWriter } from './split';

const block = JSON.stringify({
  phases: [
    { name: 'build', new: false },
    { name: 'polish', new: true },
  ],
  tasks: [
    { title: 'Build it', area: 'lib.nvim', kind: 'feature', prio: 2, effort: 'S', value: 4, phase: 'build', acceptance: ['it runs'], after: [], blocked_by: [] },
    { title: 'Polish it', area: 'lib.nvim', phase: 'polish', after: ['#1'], blocked_by: ['#1', 'lib.nvim/other'] },
    { title: 'Broken', area: 'lib.nvim', prio: 1.5 },
    { area: 'lib.nvim' },
    'text',
  ],
});

describe('parseSplit', () => {
  it('reads the phases and drafts; a draft of the wrong form is kept with its reason', () => {
    const out = parseSplit(`\`\`\`json\n${block}\n\`\`\``);
    if ('error' in out) throw new Error(out.error);
    expect(out.phases).toEqual([
      { name: 'build', new: false },
      { name: 'polish', new: true },
    ]);
    expect(out.drafts[0]).toMatchObject({ n: 1, title: 'Build it', prio: 2, acceptance: ['it runs'] });
    expect(out.drafts[0]?.invalid).toBeUndefined();
    expect(out.drafts[2]?.invalid).toBe('prio is not a whole number');
    expect(out.drafts[3]?.invalid).toBe('it has no title');
    expect(out.drafts[4]?.invalid).toBe('not an object');
  });

  it.each([
    ['not json', 'not one JSON object'],
    ['[]', 'not one JSON object'],
    ['{"tasks":[]}', 'proposes no task'],
    [JSON.stringify({ tasks: Array.from({ length: 31 }, () => ({ title: 't', area: 'a' })) }), 'more than 30'],
  ])('refuses %s', (text, why) => {
    const out = parseSplit(text);
    expect('error' in out && out.error).toContain(why);
  });
});

function split(): Split {
  const out = parseSplit(block);
  if ('error' in out) throw new Error(out.error);
  return out;
}

/** A writer that makes ids from the titles and refuses what it is told to. */
function writer(refuse: string[] = []): SplitWriter & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    create: async (area, title, fields, body) => {
      calls.push(`new ${area} ${title} ${JSON.stringify(fields)} ${body.includes('## Akzeptanz') ? 'body' : ''}`);
      if (refuse.includes(title)) return { error: `the engine refused ${title}` };
      return { id: `${area}/${title.toLowerCase().replace(/\s+/g, '-')}` };
    },
    setBlockedBy: async (id, ids) => {
      calls.push(`set ${id} ${ids.join(',')}`);
      return null;
    },
  };
}

describe('createDrafts', () => {
  it('creates the ticked drafts in order and turns #n into the id of draft n', async () => {
    const w = writer();
    const results = await createDrafts(w, split(), [2, 1], { plan: 'lib.nvim/p', job: 'j1', lang: 'de', newPhases: ['polish'], phasesOk: true });
    expect(results).toEqual([
      { n: 1, id: 'lib.nvim/build-it' },
      { n: 2, id: 'lib.nvim/polish-it' },
    ]);
    expect(w.calls[0]).toContain('"plan":"lib.nvim/p"');
    expect(w.calls[0]).toContain('"phase":"build"');
    expect(w.calls[1]).toContain('"after":["lib.nvim/build-it"]');
    expect(w.calls[2]).toBe('set lib.nvim/polish-it lib.nvim/build-it,lib.nvim/other');
  });

  it('refuses a draft of a new phase without the yes, one of the wrong form, one the engine refuses; the rest is made', async () => {
    const w = writer(['Build it']);
    const results = await createDrafts(w, split(), [1, 2, 3], { plan: 'lib.nvim/p', job: 'j1', lang: 'en', newPhases: ['polish'], phasesOk: false });
    expect(results).toEqual([
      { n: 1, refused: 'the engine refused Build it' },
      { n: 2, refused: 'its phase polish is not in the plan' },
      { n: 3, refused: 'prio is not a whole number' },
    ]);
    // #1 was not made: draft 2 with the yes would leave the reference out and say so.
    const ok = await createDrafts(writer(['Build it']), split(), [1, 2], { plan: 'p', job: 'j', lang: 'en', newPhases: [], phasesOk: true });
    expect(ok[1]).toEqual({ n: 2, id: 'lib.nvim/polish-it', warning: 'its after #1 was not created, left out; its blocked_by #1 was not created, left out' });
  });

  it('names the new phases of the ticked drafts only', () => {
    expect(newPhases(split().drafts, [1, 2], ['build'])).toEqual(['polish']);
    expect(newPhases(split().drafts, [1], ['build'])).toEqual([]);
  });

  it('writes a body with the acceptance', () => {
    const d = split().drafts[0]!;
    expect(draftBody(d, 'lib.nvim/p', 'j1', 'de')).toContain('## Akzeptanz\n\n- [ ] it runs\n\n## Notizen');
    expect(draftBody({ ...d, acceptance: [] }, 'p', 'j', 'en')).toContain('## Acceptance\n\n- [ ] \n');
  });
});

function hub(status: string, states: SplitState[]): SplitHub & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    splitPlan: async (plan) => {
      calls.push(`split ${plan}`);
      return { job_id: '0123456789abcdef', status, private: true };
    },
    splitJob: async () => states.shift() ?? { status: 'running' },
    confirmSplit: async (job) => {
      calls.push(`confirm ${job}`);
    },
  };
}

const quick = { sleep: async () => undefined, interval: 0 };

describe('runSplit', () => {
  it('asks first for a private area, then reads the drafts', async () => {
    const h = hub('needs_confirmation', [{ status: 'running' }, { status: 'done', block }]);
    const out = await runSplit(h, 'lib.nvim/p', { ...quick, confirm: async () => true });
    expect(out.kind).toBe('split');
    expect(h.calls).toEqual(['split lib.nvim/p', 'confirm 0123456789abcdef']);
    expect(await runSplit(hub('needs_confirmation', []), 'p', { ...quick, confirm: async () => false })).toEqual({ kind: 'declined' });
  });

  it('says why there are no drafts', async () => {
    expect(await runSplit(hub('running', [{ status: 'done', block_error: 'no block' }]), 'p', { ...quick, confirm: async () => true })).toEqual({
      kind: 'failed',
      why: 'no block',
    });
    expect(await runSplit(hub('running', [{ status: 'done', block: '{"tasks":[]}' }]), 'p', { ...quick, confirm: async () => true })).toEqual({
      kind: 'failed',
      why: 'the split proposes no task',
    });
    expect((await runSplit(hub('prefilled', []), 'p', { ...quick, confirm: async () => true })).kind).toBe('failed');
  });

  it('stops asking once the dialog is closed (the job stays in the dashboard of ai-desktop)', async () => {
    const h = hub('running', []);
    let asked = 0;
    const counting: SplitHub = { ...h, splitJob: async (job) => (asked++, h.splitJob(job)) };
    let open = true;
    const out = await runSplit(counting, 'p', {
      confirm: async () => true,
      interval: 0,
      sleep: async () => {
        if (asked === 3) open = false;
      },
      wanted: () => open,
      // Without the stop it would ask until its time is up (ten more times here).
      now: () => asked * 100,
      maxMs: 1000,
    });
    expect(out).toEqual({ kind: 'declined' });
    expect(asked).toBe(3);
  });
});
