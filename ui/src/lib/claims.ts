// Who works on a task now (capability `claims`): the engine writes `claim` into each entry of the snapshot (who, since,
// until, and whether it has run out by the time of the document). The page judges no time (rule WEB-13): an expired
// claim is no claim. Whether a claim is "own" is the name this browser was given for its reservations (Defaults ...):
// without one, every valid claim is somebody else's.

import type { TaskEntry } from './contract';

/** The classes of the claim filter: a claim under this browser's name, one of somebody else, none (free or expired). */
export const CLAIM_CLASSES = ['own', 'foreign', 'none'] as const;
export type ClaimClass = (typeof CLAIM_CLASSES)[number];

export function isClaimClass(value: unknown): value is ClaimClass {
  return typeof value === 'string' && (CLAIM_CLASSES as readonly string[]).includes(value);
}

/** The class of a task's claim for `me` (the name of this browser, `''` for none). */
export function claimClass(task: Pick<TaskEntry, 'claim'>, me: string): ClaimClass {
  const claim = task.claim;
  if (!claim || claim.expired) return 'none';
  return me !== '' && claim.by === me ? 'own' : 'foreign';
}

/**
 * The job of an agent of ai-desktop that holds the claim: such a claim is named `ai-desktop:<job>` (ai-desktop's
 * docs/JOBS.md); null for any other name.
 */
export function agentJob(by: string | undefined): string | null {
  const found = /^ai-desktop:([A-Za-z0-9._-]{1,64})$/.exec(by ?? '');
  return found ? (found[1] ?? null) : null;
}

/** What an agent did to a task between two lists of the engine. */
export interface AgentNews {
  kind: 'claimed' | 'finished' | 'released' | 'expired';
  id: string;
  title: string;
  job: string;
}

/**
 * The feedback of the agents between the list `before` and the list `after`: a task an agent took, one it held that is
 * no longer open (finished; a finished task leaves the list of open tasks), one it gave back, one whose claim ran out.
 * Only the engine's words are read (the claim and its `expired`); nothing is judged by a clock here (WEB-13).
 */
export function agentNews(before: readonly TaskEntry[], after: readonly TaskEntry[]): AgentNews[] {
  const was = new Map(before.map((t) => [t.id, t]));
  const now = new Map(after.map((t) => [t.id, t]));
  const news: AgentNews[] = [];
  for (const task of after) {
    const job = agentJob(task.claim?.by);
    const old = was.get(task.id);
    if (!old || job === null || task.claim?.expired) continue;
    if (agentJob(old.claim?.by) !== job || old.claim?.expired) news.push({ kind: 'claimed', id: task.id, title: task.title, job });
  }
  for (const task of before) {
    const job = agentJob(task.claim?.by);
    if (job === null || task.claim?.expired) continue;
    const next = now.get(task.id);
    if (!next || next.status === 'done') news.push({ kind: 'finished', id: task.id, title: task.title, job });
    else if (agentJob(next.claim?.by) !== job) news.push({ kind: 'released', id: task.id, title: next.title, job });
    else if (next.claim?.expired) news.push({ kind: 'expired', id: task.id, title: next.title, job });
  }
  return news;
}

/** A name a claim can have (as the engine takes it): 1 to 64 letters, digits and `. _ : - @`; `''` is no name. */
export function cleanClaimName(text: string): string {
  const name = text.trim();
  return /^[A-Za-z0-9._:@-]{1,64}$/.test(name) ? name : '';
}
