import { describe, expect, it } from 'vitest';
import type { ContactEntry } from './contract';
import {
  contactChoices,
  contactNewOp,
  contactSetOp,
  emptyContactForm,
  filterContacts,
  formOfContact,
  isDirty,
  mailHref,
  NO_CONTACT_FILTER,
  splitList,
  telHref,
} from './contacts';

const rick = (extra: Partial<ContactEntry> = {}): ContactEntry =>
  ({
    id: 'work/rick',
    area: 'work',
    slug: 'rick',
    name: 'Rick Beispiel',
    org: 'Beispiel GmbH',
    role: 'Support',
    emails: ['rick@example.org'],
    phones: ['+43 1 2345678'],
    tz: 'Europe/Vienna',
    tags: ['t2', 'kunde'],
    summary: 'Knows the old setup.',
    file: 'work/CONTACTS/rick.md',
    etag: 'sha256:aa',
    valid: true,
    problems: [],
    ...extra,
  }) as ContactEntry;

describe('splitList', () => {
  it('trims, drops empty entries and repeats, takes commas and lines', () => {
    expect(splitList(' a@x.org, ,b@x.org\n a@x.org ')).toEqual(['a@x.org', 'b@x.org']);
    expect(splitList('')).toEqual([]);
  });
});

describe('the operations of the form', () => {
  it('a new contact sends the fields it has and the notes as the section of the language', () => {
    const form = { ...emptyContactForm('work'), name: ' Rick ', emails: 'r@x.org, s@x.org', tags: 't2', notes: 'Likes tea.' };
    expect(contactNewOp(form, 'en')).toEqual({
      op: 'contact_new',
      area: 'work',
      name: 'Rick',
      fields: { emails: ['r@x.org', 's@x.org'], tags: ['t2'] },
      body: '\n## Notes\nLikes tea.\n',
      lang: 'en',
    });
    expect(contactNewOp({ ...form, notes: '' }, 'de')).not.toHaveProperty('body');
    expect(contactNewOp(form, 'de')).toMatchObject({ body: '\n## Notizen\nLikes tea.\n' });
  });

  it('a change sends only the keys that differ, a cleared field as null, on the version it was opened on', () => {
    const c = rick();
    const form = { ...formOfContact(c), role: 'Lead', org: '', phones: '+43 1 2345678' };
    expect(contactSetOp(form, c)).toEqual({
      op: 'contact_set',
      id: 'work/rick',
      patch: { role: 'Lead', org: null },
      if_match: 'sha256:aa',
    });
  });

  it('a form as opened is no change', () => {
    expect(contactSetOp(formOfContact(rick()), rick())).toBeNull();
    expect(contactSetOp({ ...formOfContact(rick()), emails: ' rick@example.org ' }, rick())).toBeNull();
  });

  it('a contact without a field and a form without it are the same', () => {
    const c = rick({ org: undefined, tz: undefined, tags: [] });
    expect(contactSetOp(formOfContact(c), c)).toBeNull();
  });

  it('knows a form that was touched', () => {
    const opened = formOfContact(rick());
    expect(isDirty({ ...opened }, opened)).toBe(false);
    expect(isDirty({ ...opened, name: 'R' }, opened)).toBe(true);
  });
});

describe('the links', () => {
  it('writes mailto: for an address and tel: for a number, nothing for text that is neither', () => {
    expect(mailHref(' rick@example.org ')).toBe('mailto:rick@example.org');
    expect(mailHref('not a mail')).toBeNull();
    expect(mailHref('a@b')).toBeNull();
    // a header or a second address smuggled into the link is no address
    expect(mailHref('x@y.org?cc=evil@z.org')).toBeNull();
    expect(mailHref('x@y.org,z@y.org')).toBeNull();
    expect(mailHref('x@y.org?subject=hi')).toBeNull();
    expect(mailHref('x@y.org&bcc=evil')).toBeNull();
    expect(mailHref('x@y.org#top')).toBeNull();
    expect(mailHref('x@y.org/evil')).toBeNull();
    expect(mailHref('x%40y.org')).toBeNull();
    expect(telHref('+43 1 2345678')).toBe('tel:+4312345678');
    expect(telHref('(01) 23-45')).toBe('tel:012345');
    expect(telHref('12')).toBeNull();
    expect(telHref('call me')).toBeNull();
  });
});

describe('the list', () => {
  const list = [rick(), rick({ id: 'home/anna', area: 'home', name: 'Anna Muster', org: undefined, tags: ['family'], emails: [], phones: [], summary: '' })];

  it('searches every word anywhere, and filters by organisation, tag and area', () => {
    expect(filterContacts(list, NO_CONTACT_FILTER)).toHaveLength(2);
    expect(filterContacts(list, { ...NO_CONTACT_FILTER, text: 'beispiel support' }).map((c) => c.id)).toEqual(['work/rick']);
    expect(filterContacts(list, { ...NO_CONTACT_FILTER, text: 'muster' }).map((c) => c.id)).toEqual(['home/anna']);
    expect(filterContacts(list, { ...NO_CONTACT_FILTER, org: 'Beispiel GmbH' })).toHaveLength(1);
    expect(filterContacts(list, { ...NO_CONTACT_FILTER, tag: 'family' }).map((c) => c.id)).toEqual(['home/anna']);
    expect(filterContacts(list, { ...NO_CONTACT_FILTER, area: 'work', text: 'zzz' })).toEqual([]);
  });

  it('offers the choices the contacts carry', () => {
    expect(contactChoices(list)).toEqual({ orgs: ['Beispiel GmbH'], tags: ['family', 'kunde', 't2'], areas: ['home', 'work'] });
  });
});
