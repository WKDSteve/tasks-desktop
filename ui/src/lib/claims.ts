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

/** A name a claim can have (as the engine takes it): 1 to 64 letters, digits and `. _ : - @`; `''` is no name. */
export function cleanClaimName(text: string): string {
  const name = text.trim();
  return /^[A-Za-z0-9._:@-]{1,64}$/.test(name) ? name : '';
}
