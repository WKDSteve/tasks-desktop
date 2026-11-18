import { describe, expect, it } from 'vitest';
import { checkDraft, draftChoices, runDraft, type DraftHub, type DraftState } from './suggestFields';

const choices = draftChoices({
  areas: ['tasks.nvim', 'lib.nvim', 'bad name'],
  kinds: ['task', 'bug'],
  tags: ['ui', 'tasks-family'],
  categories: ['ux'],
  plans: ['ALL/ki-plan'],
});

describe('draftChoices', () => {
  it('keeps names only, each once, sorted', () => {
    expect(choices.areas).toEqual(['lib.nvim', 'tasks.nvim']);
    expect(draftChoices({ areas: ['a', 'a', '..'], kinds: [], tags: [], categories: [], plans: [] }).areas).toEqual(['a']);
  });
});

describe('checkDraft', () => {
  it('keeps the allowed values and names what it left out', () => {
    const out = checkDraft(
      {
        title: '  Knopf blau  ',
        area: 'tasks.nvim',
        kind: 'chore',
        prio: '2',
        effort: 'XXL',
        value: 9,
        tags: ['ui', 'made-up', 'ui'],
        category: 'ux',
        plan: '',
        summary: 'Eins.\nZwei.',
        acceptance: ['- [ ] Der Knopf ist blau', '', 'Kontrast reicht'],
      },
      choices,
    );
    expect('draft' in out).toBe(true);
    if (!('draft' in out)) return;
    expect(out.draft).toMatchObject({
      title: 'Knopf blau',
      area: 'tasks.nvim',
      prio: 2,
      tags: ['ui'],
      category: ['ux'],
      summary: 'Eins.\nZwei.',
      acceptance: ['Der Knopf ist blau', 'Kontrast reicht'],
    });
    expect(out.draft.kind).toBeUndefined();
    expect(out.draft.plan).toBeUndefined();
    expect(out.draft.dropped).toEqual(expect.arrayContaining(['kind: chore', 'tags: made-up', 'effort: XXL', 'value: 9']));
  });

  it.each([
    ['text', 'not an object'],
    [{ kind: 'task' }, 'no title'],
    [{ title: '' }, 'empty'],
    [{ title: 'a\nb' }, 'control character'],
    [{ title: `x${String.fromCodePoint(0x202e)}y` }, 'control character'],
    [{ title: 'x', prio: 'high' }, 'whole number'],
    [{ title: 'x', tags: 3 }, 'list of names'],
    [{ title: 'x', acceptance: 'one' }, 'acceptance'],
    [{ title: 'x', summary: 'a\u001b[31m' }, 'control character'],
    [{ title: 'a'.repeat(400) }, 'longer than'],
  ])('refuses %j', (raw, why) => {
    const out = checkDraft(raw, choices);
    expect('error' in out && out.error).toContain(why);
  });
});

/** A hub that answers a draft as it is told and keeps what it was asked. */
function hub(status: string, states: DraftState[]): DraftHub & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    sendDraft: async (text) => {
      calls.push(`send ${text}`);
      return { job_id: '0123456789abcdef', status, private: true };
    },
    draftJob: async (job) => {
      calls.push(`job ${job}`);
      return states.shift() ?? { status: 'running' };
    },
    confirmDraft: async (job) => {
      calls.push(`confirm ${job}`);
    },
  };
}

const quick = { sleep: async () => undefined, interval: 0 };

describe('runDraft', () => {
  it('stops asking once the form is closed (the job stays in the dashboard of ai-desktop)', async () => {
    const h = hub('running', []);
    let open = true;
    const out = await runDraft(h, 'x', choices, {
      confirm: async () => true,
      interval: 0,
      sleep: async () => {
        if (h.calls.length === 3) open = false;
      },
      wanted: () => open,
      // Without the stop it would ask until its time is up (ten more times here).
      now: () => h.calls.length * 100,
      maxMs: 1000,
    });
    expect(out).toEqual({ kind: 'declined' });
    expect(h.calls).toEqual(['send x', 'job 0123456789abcdef', 'job 0123456789abcdef']);
  });

  it('waits for the job and checks its draft', async () => {
    const h = hub('running', [
      { status: 'running' },
      { status: 'done', draft: { title: 'Blau', area: 'gone', dropped: ['plan: nowhere', 7, 'a\nb'] } },
    ]);
    const out = await runDraft(h, 'Notiz', choices, { ...quick, confirm: async () => true });
    // What ai-desktop left out comes first (texts of one line only), then what the page leaves out.
    expect(out).toEqual({ kind: 'draft', draft: { title: 'Blau', dropped: ['plan: nowhere', 'area: gone'] } });
    expect(h.calls).toEqual(['send Notiz', 'job 0123456789abcdef', 'job 0123456789abcdef']);
  });

  it('asks before a model that is not local; no means nothing runs', async () => {
    const no = hub('needs_confirmation', []);
    expect(await runDraft(no, 'x', choices, { ...quick, confirm: async () => false })).toEqual({ kind: 'declined' });
    expect(no.calls).toEqual(['send x']);
    const yes = hub('needs_confirmation', [{ status: 'done', draft: { title: 'T' } }]);
    const out = await runDraft(yes, 'x', choices, { ...quick, confirm: async () => true });
    expect(out.kind).toBe('draft');
    expect(yes.calls).toEqual(['send x', 'confirm 0123456789abcdef', 'job 0123456789abcdef']);
  });

  it('says why there is no draft', async () => {
    const none = await runDraft(hub('running', [{ status: 'done', draft_error: 'the answer holds no draft block' }]), 'x', choices, {
      ...quick,
      confirm: async () => true,
    });
    expect(none).toEqual({ kind: 'failed', why: 'the answer holds no draft block' });
    const failed = await runDraft(hub('running', [{ status: 'failed', error: 'boom' }]), 'x', choices, {
      ...quick,
      confirm: async () => true,
    });
    expect(failed).toEqual({ kind: 'failed', why: 'boom' });
    const bad = await runDraft(hub('running', [{ status: 'done', draft: { title: 5 } }]), 'x', choices, {
      ...quick,
      confirm: async () => true,
    });
    expect(bad).toEqual({ kind: 'failed', why: "'title' must be a string" });
    const busy = await runDraft(hub('prefilled', []), 'x', choices, { ...quick, confirm: async () => true });
    expect(busy.kind).toBe('failed');
    let t = 0;
    const late = await runDraft(hub('running', []), 'x', choices, {
      ...quick,
      confirm: async () => true,
      maxMs: 5,
      now: () => (t += 3),
    });
    expect(late.kind).toBe('failed');
  });
});
