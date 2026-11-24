// The contacts of the page (Office concept, wave 3): the form that makes or changes one, the list with its search and
// its filters, and the links to write to a person (`mailto:`, `tel:`). The rules of a contact are the engine's: the form
// is judged by a dry run (`contact_new`, `contact_set`), nothing here decides whether an address is one beyond what a
// link needs. A contact is a person of a third party: no text made here (a message, a label of a link, a note of a
// conflict) holds an address or a number, only the data fields of the contact do.

import type { Op } from './api';
import type { ContactEntry } from './contract';

/** What a dry run of `contact_new` or `contact_set` said: the id, the engine's refusal (scrubbed), or nothing yet. */
export type ContactPreview = { kind: 'ok'; id: string; changed: boolean } | { kind: 'refused'; message: string } | { kind: 'unknown' };

/** What the form holds. Every text as typed; the lists are comma separated, as the tags of a task. */
export interface ContactForm {
  /** The contact being changed (`<area>/<slug>`); absent for a new one. */
  id?: string;
  /** The version the form was opened on: the change is made on it, a change in between is a conflict. */
  etag?: string;
  area: string;
  name: string;
  org: string;
  role: string;
  emails: string;
  phones: string;
  tz: string;
  tags: string;
  /** Only for a new contact (the engine changes the text of an existing one in the file): its notes section. */
  notes: string;
}

/** The most entries a mail or phone list takes (`contacts.MAX_LIST` of the engine). */
export const MAX_LIST = 20;

/** A comma (or line) separated list as the engine takes it: trimmed, without empty entries or repeats. */
export function splitList(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[,\n]/)) {
    const entry = part.trim();
    if (entry !== '' && !out.includes(entry)) out.push(entry);
  }
  return out;
}

export function emptyContactForm(area: string): ContactForm {
  return { area, name: '', org: '', role: '', emails: '', phones: '', tz: '', tags: '', notes: '' };
}

/** The form of a contact to change. */
export function formOfContact(c: ContactEntry): ContactForm {
  return {
    id: c.id,
    ...(c.etag ? { etag: c.etag } : {}),
    area: c.area,
    name: c.name,
    org: c.org ?? '',
    role: c.role ?? '',
    emails: c.emails.join(', '),
    phones: c.phones.join(', '),
    tz: c.tz ?? '',
    tags: c.tags.join(', '),
    notes: '',
  };
}

/** The fields of the form as the engine's frontmatter keys: an empty text or list is a removal (`null`) when `remove`. */
function fieldsOf(form: ContactForm, remove: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const text = (key: 'org' | 'role' | 'tz', value: string) => {
    const v = value.trim();
    if (v !== '') out[key] = v;
    else if (remove) out[key] = null;
  };
  const list = (key: 'emails' | 'phones' | 'tags', value: string) => {
    const v = splitList(value);
    if (v.length > 0) out[key] = v;
    else if (remove) out[key] = null;
  };
  text('org', form.org);
  text('role', form.role);
  list('emails', form.emails);
  list('phones', form.phones);
  text('tz', form.tz);
  list('tags', form.tags);
  return out;
}

/** The heading of the notes section the engine reads (`## Notizen`, `## Notes`). */
const NOTES_HEAD = { de: '## Notizen', en: '## Notes' } as const;

/** The operation that makes the contact of the form. */
export function contactNewOp(form: ContactForm, lang: 'de' | 'en'): Op {
  const notes = form.notes.trim();
  return {
    op: 'contact_new',
    area: form.area,
    name: form.name.trim(),
    fields: fieldsOf(form, false),
    ...(notes !== '' ? { body: `\n${NOTES_HEAD[lang]}\n${notes}\n` } : {}),
    lang,
  };
}

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * The operation that changes `before` into the contact of the form: only the keys that differ (a key of the form that
 * the contact already has is no change), on the version the form was opened on. `null`: nothing to write.
 */
export function contactSetOp(form: ContactForm, before: ContactEntry): Op | null {
  const patch: Record<string, unknown> = {};
  const name = form.name.trim();
  if (name !== before.name) patch['name'] = name;
  const now = fieldsOf(form, true);
  const had: Record<string, string | readonly string[]> = {
    org: before.org ?? '',
    role: before.role ?? '',
    tz: before.tz ?? '',
    emails: before.emails,
    phones: before.phones,
    tags: before.tags,
  };
  for (const [key, value] of Object.entries(now)) {
    const old = had[key] ?? '';
    const same = Array.isArray(old)
      ? value === null
        ? old.length === 0
        : sameList(old, value as string[])
      : value === null
        ? old === ''
        : value === old;
    if (!same) patch[key] = value;
  }
  if (Object.keys(patch).length === 0) return null;
  return { op: 'contact_set', id: before.id, patch, ...(form.etag ? { if_match: form.etag } : {}) };
}

/** Whether the form differs from the one it was opened with (what Esc must not throw away unasked). */
export function isDirty(form: ContactForm, opened: ContactForm): boolean {
  return (Object.keys(opened) as (keyof ContactForm)[]).some((k) => form[k] !== opened[k]);
}

// ── links ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Characters that never stand in an address a link may carry (a header of the mail, a second address, a fragment). */
const NOT_IN_MAIL = '\\s@<>"\',;:()\\[\\]\\\\?#%&=/';
const MAIL = new RegExp(`^[^${NOT_IN_MAIL}]+@[^${NOT_IN_MAIL}]+\\.[^${NOT_IN_MAIL}]+$`);

/** `mailto:` for an address that looks like one (the engine checks the real rule); null otherwise. */
export function mailHref(email: string): string | null {
  const e = email.trim();
  return MAIL.test(e) ? `mailto:${e}` : null;
}

/** `tel:` for a number with at least three digits, keeping `+` and the digits only; null otherwise. */
export function telHref(phone: string): string | null {
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.length < 3 || digits.length > 20) return null;
  return `tel:${phone.trim().startsWith('+') ? '+' : ''}${digits}`;
}

// ── list ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ContactFilter {
  text: string;
  org: string;
  tag: string;
  area: string;
}

export const NO_CONTACT_FILTER: ContactFilter = { text: '', org: '', tag: '', area: '' };

/** The contacts that match the search (every word, anywhere in a name, organisation, role, tag, area or summary) and the choices. */
export function filterContacts(list: readonly ContactEntry[], f: ContactFilter): ContactEntry[] {
  const words = f.text
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== '');
  return list.filter((c) => {
    if (f.org !== '' && (c.org ?? '') !== f.org) return false;
    if (f.tag !== '' && !c.tags.includes(f.tag)) return false;
    if (f.area !== '' && c.area !== f.area) return false;
    if (words.length === 0) return true;
    const hay = [c.name, c.org ?? '', c.role ?? '', c.area, c.summary, ...c.tags, ...c.emails, ...c.phones].join('\n').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** The organisations, tags and areas the contacts carry, for the three choices of the filter. */
export function contactChoices(list: readonly ContactEntry[]): { orgs: string[]; tags: string[]; areas: string[] } {
  const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort((a, b) => a.localeCompare(b));
  return {
    orgs: sorted(list.flatMap((c) => (c.org ? [c.org] : []))),
    tags: sorted(list.flatMap((c) => c.tags)),
    areas: sorted(list.map((c) => c.area)),
  };
}
