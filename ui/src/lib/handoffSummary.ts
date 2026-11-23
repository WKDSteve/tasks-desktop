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

/** What the watch needs of the page. */
export interface HandoffWatchDeps {
  hub: Pick<AnswerHub, 'agentResult'>;
  sleep(ms: number): Promise<void>;
  now(): number;
  /** False once the page ended the watch. */
  wanted(): boolean;
  /** Another answer is open in the dialog. */
  busy(): boolean;
  /** Tells the person (an error message by its key). */
  say(key: 'handoff.summary_missing', params: Record<string, string>): void;
  /** Opens the dialog on the summary as a proposal. */
  show(view: { id: string; area: string; title: string; kind: 'handoff'; phase: 'shown'; job: string; answer: Answer }): void;
  title: string;
}

/**
 * Watches the hand-over `job` of the task `id` until it ends. A run that failed or was cancelled has no summary and
 * says nothing (ai-desktop shows it); one that ended without a usable summary says why; otherwise the summary opens as
 * a proposal, after another open answer is closed. Nothing is written.
 */
export async function watchHandoffRun(deps: HandoffWatchDeps, id: string, job: string): Promise<void> {
  const outcome = await watchAnswer(deps.hub, id, 'handoff', job, {
    finish: summaryOutcome,
    wanted: deps.wanted,
    sleep: deps.sleep,
    now: deps.now,
    interval: 3000,
    maxMs: 6 * 60 * 60 * 1000,
  });
  if (outcome.kind === 'failed') {
    if (outcome.noSummary) deps.say('handoff.summary_missing', { why: outcome.why, job });
    return;
  }
  if (outcome.kind !== 'answer') return;
  while (deps.wanted() && deps.busy()) await deps.sleep(1000);
  if (!deps.wanted()) return;
  deps.show({ id, area: id.split('/')[0] ?? '', title: deps.title, kind: 'handoff', phase: 'shown', job, answer: outcome.answer });
}
