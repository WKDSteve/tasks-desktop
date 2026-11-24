// The refused changes of a contact (the conflict center, "try again"): what was wanted next to what the contact has
// now, and the change repeated on the version that is there. It lives beside the conflict center (a chunk loaded when
// the center opens or a contact change is refused), not in `conflicts.ts`, so the start of the page does not carry it.
// A contact is a person of a third party: the values are the data of the form, shown to the person who typed them, and
// nowhere else.

import type { Op } from './api';
import type { App } from './app.svelte';
import { formatValue, type Conflict, type Difference } from './conflicts';
import type { ContactEntry } from './contract';

/**
 * For a refused change of a contact: each key that was wanted, what was wanted and what the contact has now (`-` while
 * it is not read). A contact is a person of a third party: the values are the data of the form, shown to the person
 * who typed them, and nowhere else.
 */
export function contactDifferences(conflict: Conflict, contact: ContactEntry | undefined): Difference[] {
  if (conflict.op.op !== 'contact_set') return [];
  const current = contact as unknown as Record<string, unknown> | undefined;
  return Object.entries(conflict.op.patch).map(([key, wanted]) => ({
    key,
    wanted: formatValue(wanted),
    now: current ? formatValue(current[key]) : '-',
  }));
}

/** Whether the contact has what the refused change wanted already (a retry would write nothing). */
export function contactDoneAlready(conflict: Conflict, contact: ContactEntry | undefined): boolean {
  return contact !== undefined && contactDifferences(conflict, contact).every((d) => d.wanted === d.now);
}

/**
 * The operation for "try again" on a contact: the keys that differ, on the version the contact has now. A contact that
 * is not there (or not read yet) has nothing to try.
 */
export function contactRetryOp(conflict: Conflict, contact: ContactEntry | undefined): Op | null {
  if (conflict.op.op !== 'contact_set' || contact === undefined) return null;
  const rows = new Set(contactDifferences(conflict, contact).filter((d) => d.wanted !== d.now).map((d) => d.key));
  const patch = Object.fromEntries(Object.entries(conflict.op.patch).filter(([key]) => rows.has(key)));
  if (Object.keys(patch).length === 0) return null;
  return { op: 'contact_set', id: conflict.id, patch, ...(contact.etag ? { if_match: contact.etag } : {}) };
}

/**
 * Read the contacts the refused changes are about, as they are now, into `app.conflictContacts` (kept by id): the
 * conflict center shows them next to what was wanted. A contact that cannot be read is `null` (gone).
 */
export function readContactsOf(app: App, refused: readonly Conflict[]): void {
  for (const conflict of refused) {
    if (conflict.op.op !== 'contact_set') continue;
    const id = conflict.id;
    app.env.hub.contact(id).then(
      (doc) => (app.conflictContacts = { ...app.conflictContacts, [id]: doc.contact }),
      () => (app.conflictContacts = { ...app.conflictContacts, [id]: null }),
    );
  }
}
