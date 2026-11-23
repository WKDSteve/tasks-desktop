import { describe, expect, it } from 'vitest';
import { adoptOps, followUpOp, runAnswer, summaryOutcome, watchAnswer, type AnswerHub, type AnswerState } from './agentAnswer';

/** ai-desktop through the hub as a double: the job it gives, the states `agent_result` answers one by one. */
function hub(job: { job_id: string; status: string; note?: string }, states: (AnswerState | Error)[]) {
  const asked: string[] = [];
  const confirmed: string[] = [];
  const double: AnswerHub = {
    handToAgent: async (id, mode, kind) => {
      asked.push(`${id} ${mode} ${kind}`);
      return { ...job, private: false, port: 1 };
    },
    agentResult: async () => {
      const next = states.length > 1 ? states.shift() : states[0];
      if (next instanceof Error) throw next;
      return next ?? { status: 'running' };
    },
    confirmDraft: async (j) => {
      confirmed.push(j);
    },
  };
  return { double, asked, confirmed };
}

const SECTION = { heading: '## Prüfung', text: '- [x] it is done' };
const noWait = { sleep: async () => {}, confirm: async () => true };

describe('runAnswer', () => {
  it('runs the job at once and waits until the engine took its answer apart', async () => {
    const { double, asked } = hub({ job_id: 'j1', status: 'running' }, [
      { status: 'running' },
      { status: 'done', sections: [SECTION], follow_up: { title: 'Document it', summary: 'The README' } },
    ]);
    const started: string[] = [];
    const out = await runAnswer(double, 'pub/a', 'review-done', { ...noWait, started: (j) => started.push(j) });
    expect(asked).toEqual(['pub/a run review-done']);
    expect(started).toEqual(['j1']);
    expect(out).toEqual({
      kind: 'answer',
      answer: { job: 'j1', sections: [SECTION], followUp: { title: 'Document it', summary: 'The README' } },
    });
  });

  it('asks before a private area goes to a model that is not local; no keeps it from running', async () => {
    const yes = hub({ job_id: 'j2', status: 'needs_confirmation' }, [{ status: 'done', sections: [SECTION], questions_added: true }]);
    const out = await runAnswer(yes.double, 'pub/a', 'prepare-decision', noWait);
    expect(yes.confirmed).toEqual(['j2']);
    expect(out).toMatchObject({ kind: 'answer', answer: { questionsAdded: true } });

    const no = hub({ job_id: 'j3', status: 'needs_confirmation' }, [{ status: 'done', sections: [SECTION] }]);
    expect(await runAnswer(no.double, 'pub/a', 'review-done', { ...noWait, confirm: async () => false })).toEqual({
      kind: 'declined',
    });
    expect(no.confirmed).toEqual([]);
  });

  it('says why when nothing can be adopted', async () => {
    const failed = hub({ job_id: 'j4', status: 'running' }, [{ status: 'failed', error: 'boom' }]);
    expect(await runAnswer(failed.double, 'pub/a', 'review-done', noWait)).toEqual({ kind: 'failed', why: 'boom', job: 'j4' });
    const waiting = hub({ job_id: 'j5', status: 'prefilled', note: 'two jobs run' }, []);
    expect(await runAnswer(waiting.double, 'pub/a', 'review-done', noWait)).toMatchObject({ kind: 'failed', why: 'two jobs run' });
    // A section the hub should never give (a heading of two lines, another level) is not taken.
    const odd = hub({ job_id: 'j6', status: 'running' }, [
      { status: 'done', sections: [{ heading: '## a\n## b', text: 'x' }, { heading: '# Top', text: 'x' }] },
    ]);
    expect(await runAnswer(odd.double, 'pub/a', 'review-done', noWait)).toMatchObject({ kind: 'failed' });
    // The engine refused the answer: its reason.
    const refused = hub({ job_id: 'j7', status: 'running' }, [new Error('the answer has no review block')]);
    await expect(runAnswer(refused.double, 'pub/a', 'review-done', noWait)).rejects.toThrow('no review block');
  });

  it('stops watching once it is no longer wanted, and at its deadline', async () => {
    let wanted = true;
    const closed = hub({ job_id: 'j8', status: 'running' }, [{ status: 'running' }]);
    const out = runAnswer(closed.double, 'pub/a', 'review-done', {
      ...noWait,
      sleep: async () => {
        wanted = false;
      },
      wanted: () => wanted,
    });
    expect(await out).toEqual({ kind: 'declined' });

    let clock = 0;
    const slow = hub({ job_id: 'j9', status: 'running' }, [{ status: 'running' }]);
    const late = await runAnswer(slow.double, 'pub/a', 'review-done', {
      ...noWait,
      maxMs: 1000,
      now: () => clock,
      sleep: async () => {
        clock += 600;
      },
    });
    expect(late).toMatchObject({ kind: 'failed', job: 'j9' });
  });
});

describe('the writes of an answer', () => {
  it('writes each section with set_section, in order', () => {
    const answer = { job: 'j', sections: [SECTION, { heading: '## Offene Fragen', text: '### Which? [q1]' }] };
    expect(adoptOps('pub/a', answer)).toEqual([
      { op: 'set_section', id: 'pub/a', heading: '## Prüfung', text: '- [x] it is done' },
      { op: 'set_section', id: 'pub/a', heading: '## Offene Fragen', text: '### Which? [q1]' },
    ]);
  });

  it('makes the follow-up as an open task of the area, its summary only when there is one', () => {
    expect(followUpOp('pub', { title: ' Document it ', summary: 'The README' })).toEqual({
      op: 'new',
      area: 'pub',
      title: 'Document it',
      fields: { kind: 'task', summary: 'The README' },
    });
    expect(followUpOp('pub', { title: 'X', summary: '  ' })).toEqual({ op: 'new', area: 'pub', title: 'X', fields: { kind: 'task' } });
  });
});

const MD = '## Getan\n- a\n\n## Commits\nrepo@abc1234\n\n## Prüfungen\nCLEAN\n\n## Offen\n-\n';
const good = (over: Partial<NonNullable<AnswerState['summary']>> = {}): AnswerState => ({
  status: 'done',
  summary: { job_id: 'j1', date: '2026-11-23', markdown: MD, ...over },
});

describe('the summary of a hand-over', () => {
  it('becomes one section named by the job and the date, its four headings one level down', () => {
    const out = summaryOutcome('j1', good());
    expect(out).toMatchObject({ kind: 'answer', answer: { job: 'j1' } });
    if (out.kind !== 'answer') return;
    expect(out.answer.sections).toHaveLength(1);
    const [section] = out.answer.sections;
    expect(section?.heading).toBe('## Agent-Verlauf (Job j1, 2026-11-23)');
    // The engine takes no `## ` heading inside a section.
    expect(section?.text).not.toMatch(/^## /m);
    expect(section?.text).toContain('### Getan');
    expect(section?.text).toContain('### Offen');
  });

  it('is not taken when it is of another job, too long, or holds a control character; the reason is the hub text', () => {
    expect(summaryOutcome('j1', good({ job_id: 'j2' }))).toMatchObject({ kind: 'failed', noSummary: true });
    expect(summaryOutcome('j1', good({ date: 'yesterday' }))).toMatchObject({ kind: 'failed', noSummary: true });
    // 4097 bytes: a multi-byte letter counts by its bytes, not as one character.
    expect(summaryOutcome('j1', good({ markdown: MD + 'ü'.repeat(2100) }))).toMatchObject({ why: expect.stringContaining('4 KiB') });
    expect(summaryOutcome('j1', good({ markdown: MD.replace('CLEAN', 'a' + String.fromCharCode(27) + 'b') }))).toMatchObject({
      why: expect.stringContaining('control'),
    });
    expect(summaryOutcome('j1', { status: 'done', summary_error: 'no summary block' })).toEqual({
      kind: 'failed',
      why: 'no summary block',
      job: 'j1',
      noSummary: true,
    });
  });

  it('is watched without handing anything to the agent, and is a proposal only', async () => {
    const asked: string[] = [];
    const states: AnswerState[] = [{ status: 'running' }, good()];
    const hub = {
      agentResult: async (job: string, id: string, kind: string) => {
        asked.push(`${job} ${id} ${kind}`);
        return states.length > 1 ? states.shift()! : states[0]!;
      },
    };
    const out = await watchAnswer(hub, 'pub/a', 'handoff', 'j1', { sleep: async () => {} });
    expect(asked).toEqual(['j1 pub/a handoff', 'j1 pub/a handoff']);
    expect(out).toMatchObject({ kind: 'answer' });
    // A failed run has no summary: its own reason, nothing to adopt.
    const failed = await watchAnswer({ agentResult: async () => ({ status: 'failed', error: 'boom' }) }, 'pub/a', 'handoff', 'j1', {});
    expect(failed).toEqual({ kind: 'failed', why: 'boom', job: 'j1' });
  });
});
