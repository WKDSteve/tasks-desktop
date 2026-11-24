// The suggestions of the participant field of the meeting form (Office concept, wave 4): the names of the contacts are
// offered as the person types, and a name that is exactly one contact fills the address and the role that are still
// empty. The participant line stays what it was (`Name <mail> (role)`); which contact a line is, is the engine's to say
// when the meeting is read (`participants[].contact`), nothing is decided here beyond a name that matches.

import type { ContactEntry } from './contract';

/** A participant row of the form, as typed. */
export interface ParticipantRow {
  name: string;
  email: string;
  role: string;
}

/** What the name field offers: the contact names, sorted, once each; the organisation tells two of a name apart. */
export function nameOptions(items: readonly ContactEntry[]): { value: string; label: string }[] {
  const seen = new Set<string>();
  const out: { value: string; label: string }[] = [];
  for (const c of [...items].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!c.valid) continue;
    const key = c.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ value: c.name, label: c.org ?? c.role ?? '' });
  }
  return out;
}

/**
 * The row once its name was chosen: the address (the first one of the contact) and the role are filled in where they
 * are empty. A name that is no contact, or that two contacts have, leaves the row as it is (nothing is guessed, as the
 * engine does not guess).
 */
export function fillFromContact(row: ParticipantRow, items: readonly ContactEntry[]): ParticipantRow {
  const name = row.name.trim().toLowerCase();
  if (name === '') return row;
  const same = items.filter((c) => c.valid && c.name.toLowerCase() === name);
  if (same.length !== 1) return row;
  const c = same[0]!;
  return {
    name: c.name,
    email: row.email.trim() === '' ? (c.emails[0] ?? '') : row.email,
    role: row.role.trim() === '' ? (c.role ?? '') : row.role,
  };
}
