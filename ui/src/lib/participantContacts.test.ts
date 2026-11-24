import { describe, expect, it } from 'vitest';
import type { ContactEntry } from './contract';
import { fillFromContact, nameOptions } from './participantContacts';

function contact(id: string, name: string, extra: Partial<ContactEntry> = {}): ContactEntry {
  return { id, area: 'lib', slug: id.split('/')[1]!, name, emails: [], phones: [], tags: [], summary: '', file: `${id}.md`, valid: true, problems: [], ...extra } as ContactEntry;
}

const RICK = contact('lib/rick', 'Rick Beispiel', { emails: ['rick@example.org', 'r2@example.org'], role: 'Support', org: 'Beispiel GmbH' });
const ANNA = contact('lib/anna', 'Anna Muster');
const TWIN_A = contact('lib/twin-a', 'Twin', { emails: ['a@example.org'] });
const TWIN_B = contact('lib/twin-b', 'Twin', { emails: ['b@example.org'] });
const BROKEN = contact('lib/broken', 'Broken', { valid: false, emails: ['x@example.org'] });

describe('nameOptions', () => {
  it('lists each name once, sorted, with the organisation as the label', () => {
    expect(nameOptions([RICK, TWIN_A, ANNA, TWIN_B, BROKEN])).toEqual([
      { value: 'Anna Muster', label: '' },
      { value: 'Rick Beispiel', label: 'Beispiel GmbH' },
      { value: 'Twin', label: '' },
    ]);
  });
});

describe('fillFromContact', () => {
  it('fills the first address and the role that are empty, whatever the case of the name', () => {
    expect(fillFromContact({ name: 'rick beispiel', email: '', role: '' }, [RICK, ANNA])).toEqual({
      name: 'Rick Beispiel',
      email: 'rick@example.org',
      role: 'Support',
    });
  });
  it('keeps what was typed', () => {
    const row = { name: 'Rick Beispiel', email: 'other@example.org', role: 'Gast' };
    expect(fillFromContact(row, [RICK])).toEqual(row);
  });
  it('leaves a name that is no contact, and a name two contacts have', () => {
    const stranger = { name: 'Fremd', email: '', role: '' };
    expect(fillFromContact(stranger, [RICK])).toBe(stranger);
    const twin = { name: 'Twin', email: '', role: '' };
    expect(fillFromContact(twin, [TWIN_A, TWIN_B])).toBe(twin);
  });
  it('does not take a contact whose file is broken', () => {
    const row = { name: 'Broken', email: '', role: '' };
    expect(fillFromContact(row, [BROKEN])).toBe(row);
  });
});
