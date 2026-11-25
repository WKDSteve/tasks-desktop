// The summary at the end of a hand-over (`handoff`): checked once more before it can be written. A module of its own,
// loaded when the first hand-over runs, so the start of the page does not carry it.

import { watchAnswer, type Answer, type AnswerHub, type AnswerOutcome, type AnswerState } from './agentAnswer';

/** The most a summary weighs once it is written into the task (UTF-8 bytes; the limit of ai-desktop and the hub). */
export const SUMMARY_MAX_BYTES = 4096;

/**
 * The summary of a hand-over as the section to adopt, or why there is none. The text comes out of an agent's run: the
 * hub and ai-desktop checked it, and it is checked here once more before it can be written (the job, the date, the
 * size). It is shown as text (Markdown blocks, never HTML). The engine takes no `## ` heading inside a section, so the
 * four headings of the summary go one level down; the section's own heading names the job and the date.
 */
export function summaryOutcome(jobId: string, state: AnswerState): AnswerOutcome {
  const summary = state.summary;
  if (!summary) return { kind: 'failed', why: state.summary_error ?? 'the run left no summary', job: jobId, noSummary: true };
  const { job_id: from, date, markdown } = summary;
  if (from !== jobId || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof markdown !== 'string') {
    return { kind: 'failed', why: 'the summary does not belong to this job', job: jobId, noSummary: true };
  }
  if (new TextEncoder().encode(markdown).length > SUMMARY_MAX_BYTES) {
    return { kind: 'failed', why: 'the summary is longer than 4 KiB', job: jobId, noSummary: true };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(markdown)) {
    return { kind: 'failed', why: 'the summary holds a control character', job: jobId, noSummary: true };
  }
  const text = markdown.replace(/^## /gm, '### ').trim();
  return {
    kind: 'answer',
    answer: { job: jobId, sections: [{ heading: `## Agent-Verlauf (Job ${jobId}, ${date})`, text }] },
  };
}

/** What the watch needs of the page (`App`). */
export interface HandoffHost {
  env: { hub: Pick<AnswerHub, 'agentResult'>; sleep(ms: number): Promise<void>; now(): number };
  answer: unknown;
  tasks: readonly { id: string; title: string }[];
  say(kind: 'error', key: 'answer.failed', params: Record<string, string>): void;
  showAnswer(view: {
    id: string;
    area: string;
    title: string;
    kind: 'handoff';
    phase: 'shown';
    job: string;
    answer: Answer;
  }): void;
}

/** The jobs watched now, by id. */
const watched = new Set<string>();

/** Ends every watch (the page stopped). */
export function stopHandoffs(): void {
  watched.clear();
}

/**
 * Watches the hand-over `job` of the task `id` until it ends. A run that failed or was cancelled has no summary and
 * says nothing (ai-desktop shows it); one that ended without a usable summary says why; otherwise the summary opens as
 * a proposal, after another open answer is closed. A job of ai-desktop has 16 hex digits (the hub refuses any other
 * id): nothing else is watched. Nothing is written.
 */
export async function watchHandoffRun(app: HandoffHost, id: string, job: string): Promise<void> {
  if (watched.has(job) || !/^[0-9a-f]{16}$/.test(job)) return;
  watched.add(job);
  const wanted = () => watched.has(job);
  try {
    const outcome = await watchAnswer(app.env.hub, id, 'handoff', job, {
      finish: summaryOutcome,
      wanted,
      sleep: (ms) => app.env.sleep(ms),
      now: () => app.env.now(),
      interval: 3000,
      maxMs: 6 * 60 * 60 * 1000,
    });
    if (outcome.kind === 'failed') {
      if (outcome.noSummary) app.say('error', 'answer.failed', { why: outcome.why });
      return;
    }
    if (outcome.kind !== 'answer') return;
    while (wanted() && app.answer !== null) await app.env.sleep(1000);
    if (!wanted()) return;
    const title = app.tasks.find((t) => t.id === id)?.title ?? id;
    app.showAnswer({ id, area: id.split('/')[0] ?? '', title, kind: 'handoff', phase: 'shown', job, answer: outcome.answer });
  } finally {
    watched.delete(job);
  }
}
