// What the views of the contacts do with the app: read every contact, ask the engine for a dry run, make, change and
// delete one. It lives beside the views (not in `app.svelte.ts`) so the start of the page does not carry it: the state
// the views share (`contactDraft`, `contactOpen`, `conflictContacts`) is the app's, the work is here. A contact is a
// person of a third party: no message made here names an address or a number; a write says "saved" and offers the way
// back (the engine's inverse), like any other.

import type { App } from './app.svelte';
import { ApiError } from './api';
import { CONFLICT_CODES } from './conflicts';
import { contactNewOp, contactSetOp, type ContactForm, type ContactPreview } from './contacts';
import type { ContactEntry } from './contract';

/** The pages (100 contacts each) the list of the contacts reads at most. */
export const CONTACT_PAGES = 10;

/** Every contact, all pages; `total` is the engine's count (more than the items when the pages ran out). */
export async function contactsAll(app: App, signal?: AbortSignal): Promise<{ items: ContactEntry[]; total: number }> {
  const items: ContactEntry[] = [];
  let total = 0;
  let offset: number | undefined = 0;
  for (let page = 0; page < CONTACT_PAGES && offset !== undefined; page += 1) {
    const answer = await app.env.hub.contacts({ limit: 100, offset }, signal);
    items.push(...answer.items);
    total = answer.total;
    offset = answer.next_offset;
  }
  return { items, total };
}

/**
 * What the contact of the form would be called, or why the engine would refuse it: a dry run of `contact_new` or
 * `contact_set` (nothing is written). The engine's words never name an address or a number.
 */
export async function previewContact(app: App, form: ContactForm, before: ContactEntry | null, signal?: AbortSignal): Promise<ContactPreview> {
  if (form.name.trim() === '' || form.area === '' || app.readOnly) return { kind: 'unknown' };
  const op = before === null ? contactNewOp(form, app.lang) : contactSetOp(form, before);
  if (op === null) return before ? { kind: 'ok', id: before.id, changed: false } : { kind: 'unknown' };
  try {
    const result = await app.env.hub.ops({ client_op_id: app.opId(), dry_run: true, ops: [op] }, signal);
    const entry = result.results[0];
    if (entry?.ok && typeof entry.id === 'string') return { kind: 'ok', id: entry.id, changed: true };
    return { kind: 'refused', message: entry?.error?.message ?? '' };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) return { kind: 'refused', message: error.message };
    return { kind: 'unknown' };
  }
}

/**
 * Make the contact of the form, or change `before` into it. True when it was written (or there was nothing to write);
 * a refusal is told, a conflict also waits in the conflict center. The form and the page close: a dialog on top would
 * cover the toast with its way back (Undo), and the list below shows the contact.
 */
export async function saveContact(app: App, form: ContactForm, before: ContactEntry | null): Promise<boolean> {
  if (app.phase !== 'ready' || !app.canMakeContacts) return false;
  const op = before === null ? contactNewOp(form, app.lang) : contactSetOp(form, before);
  if (op === null) {
    app.closeContactForm();
    return true;
  }
  const result = await app.write([op]);
  const entry = result?.results[0];
  // A change the file moved on from is kept in the conflict center (with what was typed): the dialogs close for it too,
  // or they would cover the toast and the button of the center. Any other refusal leaves the form open, with its reason.
  const refusedForGood = entry?.error?.code !== undefined && CONFLICT_CODES.includes(entry.error.code);
  if (!entry?.ok && !refusedForGood) return false;
  app.closeContactForm();
  app.closeContact();
  return entry?.ok === true;
}

/** Delete a contact on the version shown; the inverse makes it again with its fields and its text. */
export async function deleteContact(app: App, entry: Pick<ContactEntry, 'id' | 'etag'>): Promise<boolean> {
  if (app.phase !== 'ready' || !app.canMakeContacts) return false;
  const result = await app.write([{ op: 'contact_delete', id: entry.id, ...(entry.etag ? { if_match: entry.etag } : {}) }]);
  const ok = result?.results[0]?.ok === true;
  if (ok && app.contactOpen === entry.id) app.closeContact();
  return ok;
}
