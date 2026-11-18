import { describe, expect, it } from 'vitest';
import { adoptOps, followUpOp, runAnswer, type AnswerHub, type AnswerState } from './agentAnswer';

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
