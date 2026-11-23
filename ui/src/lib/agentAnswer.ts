// A review of a finished task (`review-done`) or a prepared decision (`prepare-decision`): the job goes to ai-desktop
// through the hub, the page watches it, and the answer comes back taken apart by the engine (`agent_answer`) as the
// sections to adopt. Nothing is written until the person says so: `adoptOps` writes the sections with `set_section`,
// `followUpOp` makes the follow-up task a review proposes, each on its own click.
import type { AgentJob, Op } from './api';

/** The kinds whose answer comes back to the page (`handoff`: the summary at the end of a hand-over). */
export type AnswerKind = 'review-done' | 'prepare-decision' | 'handoff';

/** One section to write: its heading (one line, `## ` and a word) and the text below it. */
export interface AnswerSection {
  heading: string;
  text: string;
}

/** Where a review or a prepared decision stands (`POST /api/tasks/agent_result`). */
export interface AnswerState {
  status: string;
  sections?: AnswerSection[];
  follow_up?: { title: string; summary?: string };
  questions_added?: boolean;
  /** A finished hand-over: its summary (`handoff-summary/1`, checked by the hub) or why there is none. */
  summary?: { job_id?: string; date?: string; markdown?: string };
  summary_error?: string;
  error?: string;
  note?: string;
}

/** The routes of the hub a review or a prepared decision uses. */
export interface AnswerHub {
  handToAgent(id: string, mode: 'prefill' | 'run', kind: AnswerKind): Promise<AgentJob>;
  agentResult(job: string, id: string, kind: AnswerKind): Promise<AnswerState>;
  confirmDraft(job: string): Promise<void>;
}

/** The answer, checked by the engine: what to show and, after a yes, to write. */
export interface Answer {
  job: string;
  sections: AnswerSection[];
  followUp?: { title: string; summary?: string };
  questionsAdded?: boolean;
}

/** What `runAnswer` ends with. */
export type AnswerOutcome =
  | { kind: 'answer'; answer: Answer }
  | { kind: 'declined' }
  | { kind: 'failed'; why: string; job?: string; /** A run that ended well, but whose summary is no use. */ noSummary?: true };

export interface AnswerOptions {
  /** Asked when the job waits for a yes (a private area on a model that is not local); false: nothing runs. */
  confirm(): Promise<boolean>;
  /** Told the job id as soon as ai-desktop gave it (the page can name it while it waits). */
  started?(job: string): void;
  /** False once the person closed it: the watch ends without a word. */
  wanted?(): boolean;
  /** Waits between two looks at the job (default: a timer of `interval` ms). */
  sleep?(ms: number): Promise<void>;
  interval?: number;
  /** How long the job is watched at most (default an hour: an agent reading diffs takes its time). */
  maxMs?: number;
  /** The clock (default `Date.now`). */
  now?(): number;
}

const RUNNING = new Set(['running', 'prefilled', 'needs_confirmation']);

/** A section as the hub must give it: a heading of one line that starts with `## ` and a word, a text. */
function isSection(value: unknown): value is AnswerSection {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return typeof s.heading === 'string' && /^## \S[^\r\n]*$/.test(s.heading) && typeof s.text === 'string';
}

/**
 * Sends the task `id` as a job of `kind` (it runs at once) and waits for its answer: a model that is not local runs
 * only after `confirm()`; the answer is the engine's (the hub asks it), nothing is written anywhere.
 */
export async function runAnswer(hub: AnswerHub, id: string, kind: AnswerKind, options: AnswerOptions): Promise<AnswerOutcome> {
  const job = await hub.handToAgent(id, 'run', kind);
  options.started?.(job.job_id);
  // Not started (two jobs of ai-desktop run already): it waits in the dashboard of ai-desktop, not here.
  if (job.status === 'prefilled') {
    return { kind: 'failed', why: job.note ?? 'ai-desktop runs two jobs already; try again later', job: job.job_id };
  }
  if (job.status === 'needs_confirmation') {
    if (!(await options.confirm())) return { kind: 'declined' };
    await hub.confirmDraft(job.job_id);
  }
  return watchAnswer(hub, id, kind, job.job_id, options);
}

/**
 * Waits for the answer of the job `jobId` of the task `id` (a review, a prepared decision, or the summary of a
 * hand-over that went out earlier) and gives it as the sections to adopt. Nothing is written anywhere.
 */
export async function watchAnswer(
  hub: Pick<AnswerHub, 'agentResult'>,
  id: string,
  kind: AnswerKind,
  jobId: string,
  options: Omit<AnswerOptions, 'confirm' | 'started'>,
): Promise<AnswerOutcome> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const wanted = options.wanted ?? (() => true);
  const job = { job_id: jobId };
  const deadline = now() + (options.maxMs ?? 60 * 60 * 1000);
  for (;;) {
    if (!wanted()) return { kind: 'declined' };
    const state = await hub.agentResult(job.job_id, id, kind);
    if (state.status === 'done') {
      if (kind === 'handoff') return summaryOutcome(job.job_id, state);
      const sections = Array.isArray(state.sections) ? state.sections.filter(isSection) : [];
      if (sections.length === 0) return { kind: 'failed', why: 'the answer holds nothing to adopt', job: job.job_id };
      return {
        kind: 'answer',
        answer: {
          job: job.job_id,
          sections,
          ...(state.follow_up && typeof state.follow_up.title === 'string' && state.follow_up.title.trim() !== ''
            ? { followUp: state.follow_up }
            : {}),
          ...(typeof state.questions_added === 'boolean' ? { questionsAdded: state.questions_added } : {}),
        },
      };
    }
    if (!RUNNING.has(state.status)) return { kind: 'failed', why: state.error ?? state.status, job: job.job_id };
    if (now() > deadline) {
      return { kind: 'failed', why: 'no answer in time; the job is in the dashboard of ai-desktop', job: job.job_id };
    }
    await sleep(options.interval ?? 2000);
  }
}

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

/** The operations that write the answer into the task `id`: one `set_section` per section, in order. */
export function adoptOps(id: string, answer: Answer): Op[] {
  return answer.sections.map((s) => ({ op: 'set_section' as const, id, heading: s.heading, text: s.text }));
}

/** The operation that makes the follow-up task a review proposes, in the area of the reviewed task. */
export function followUpOp(area: string, followUp: { title: string; summary?: string }): Op {
  return {
    op: 'new',
    area,
    title: followUp.title.trim(),
    fields: { kind: 'task', ...(followUp.summary?.trim() ? { summary: followUp.summary.trim() } : {}) },
  };
}
