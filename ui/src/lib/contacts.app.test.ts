// The contacts in the state of the page (no DOM): a refused change waits in the conflict center with the contact as it is
// now and is tried again on the version that is there; a write says only "saved"/"refused" and never an address; a
// contact the engine cannot read is not offered.
import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { make, snapshot } from './appDouble';
import { conflictsOf } from './conflicts';
import { contactDifferences, contactRetryOp } from './contactConflicts';
import type { ContactEntry, Result } from './contract';
import { emptyContactForm, formOfContact } from './contacts';
import { deleteContact, previewContact, saveContact } from './contactsApp';

const MAIL = 'rick.secret@example.org';

const RICK = {
  id: 'pub/rick',
  area: 'pub',
  slug: 'rick',
  name: 'Rick Beispiel',
  role: 'Support',
  emails: [MAIL],
  phones: [],
  tags: [],
  summary: '',
  file: 'pub/CONTACTS/rick.md',
  etag: 'sha256:old',
  valid: true,
  problems: [],
} as unknown as ContactEntry;

const refused = (code: string): Result =>
  ({ kind: 'tasks.result', ok: false, dry_run: false, results: [{ n: 1, op: 'contact_set', ok: false, error: { code, message: 'the contact moved on' } }] }) as unknown as Result;

async function boot(caps: string[] = ['contacts', 'contact']) {
  const m = make({ token: 't' });
  m.hub.capabilities = caps;
  m.hub.contactItems = [RICK];
  m.hub.doc = snapshot([]);
  await m.app.start(null);
  return m;
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('a refused change of a contact', () => {
  it('waits in the conflict center with the contact as it is now, and is tried again on that version', async () => {
    const m = await boot();
    m.app.openContactDraft(formOfContact(RICK));
    const form = { ...formOfContact(RICK), role: 'Lead', tags: 'a' };
    m.hub.next_ops = refused('conflict');
    // somebody else changed the contact meanwhile: the engine has a newer version, and the role already
    m.hub.contactItems = [{ ...RICK, etag: 'sha256:new', role: 'Lead' } as ContactEntry];
    expect(await saveContact(m.app, form, RICK)).toBe(false);
    await settle();
    // the dialogs closed: they would cover the toast and the button of the center
    expect(m.app.contactDraft).toBeNull();
    expect(m.app.conflicts).toHaveLength(1);
    expect(m.app.conflicts[0]?.id).toBe('pub/rick');
    expect(m.app.conflictContacts['pub/rick']?.etag).toBe('sha256:new');
    // what was wanted against what is there now: the role is there already, the tags are not
    const rows = contactDifferences(m.app.conflicts[0]!, m.app.conflictContacts['pub/rick'] ?? undefined);
    expect(rows).toEqual([
      { key: 'role', wanted: 'Lead', now: 'Lead' },
      { key: 'tags', wanted: 'a', now: '-' },
    ]);
    // the toast of the refusal says the words of the page, not the contact's data
    expect(m.app.toast?.text).not.toContain(MAIL);
    const before = m.hub.sent.length;
    await m.app.retryConflict(m.app.conflicts[0]!.key);
    expect(m.hub.sent.length).toBe(before + 1);
    expect(m.hub.sent.at(-1)?.ops).toEqual([{ op: 'contact_set', id: 'pub/rick', patch: { tags: ['a'] }, if_match: 'sha256:new' }]);
    expect(m.app.conflicts).toHaveLength(0);
  });

  it('closes the page behind the form after a change, or the toast with its way back would be covered', async () => {
    const m = await boot();
    m.app.openContact('pub/rick');
    m.app.openContactDraft(formOfContact(RICK));
    expect(await saveContact(m.app, { ...formOfContact(RICK), role: 'Lead' }, RICK)).toBe(true);
    expect(m.app.contactDraft).toBeNull();
    expect(m.app.contactOpen).toBeNull();
    expect(m.app.toast?.undo).toBeDefined();
  });

  it('keeps the form open, with its reason, for a refusal that is no conflict', async () => {
    const m = await boot();
    m.app.openContactDraft(formOfContact(RICK));
    m.hub.next_ops = { kind: 'tasks.result', ok: false, dry_run: false, results: [{ n: 1, op: 'contact_set', ok: false, error: { code: 'invalid_argument', message: 'emails[1] is no mail address' } }] } as unknown as Result;
    expect(await saveContact(m.app, { ...formOfContact(RICK), emails: 'nope' }, RICK)).toBe(false);
    expect(m.app.contactDraft).not.toBeNull();
    expect(m.app.conflicts).toHaveLength(0);
  });

  it('has nothing to try for a contact that is gone', () => {
    const op = { op: 'contact_set', id: 'pub/rick', patch: { role: 'Lead' } } as const;
    const [conflict] = conflictsOf([op], refused('not_found'), 1);
    expect(conflict).toBeDefined();
    expect(contactRetryOp(conflict!, undefined)).toBeNull();
    // and one the contact has already: nothing either
    expect(contactRetryOp(conflict!, { ...RICK, role: 'Lead' } as ContactEntry)).toBeNull();
  });

  it('keeps one entry for the same change of the same contact', () => {
    const op = { op: 'contact_set', id: 'pub/rick', patch: { role: 'Lead', org: 'X' } } as const;
    const a = conflictsOf([op], refused('conflict'), 1)[0]!;
    const b = conflictsOf([{ ...op, patch: { org: 'Y', role: 'Z' } }], refused('conflict'), 2)[0]!;
    expect(a.key).toBe(b.key);
    // another key of the same contact, or another contact, is another change
    const other = conflictsOf([{ ...op, patch: { role: 'Lead' } }], refused('conflict'), 3)[0]!;
    const elsewhere = conflictsOf([{ ...op, id: 'pub/anna' }], refused('conflict'), 4)[0]!;
    expect(new Set([a.key, other.key, elsewhere.key]).size).toBe(3);
  });
});

describe('the contacts in the state', () => {
  it('are offered with the two capabilities and not without', async () => {
    const on = await boot();
    expect(on.app.canContacts).toBe(true);
    expect(on.app.canMakeContacts).toBe(true);
    const half = await boot(['contacts']);
    expect(half.app.canContacts).toBe(false);
    half.app.openContactForm();
    expect(half.app.contactDraft).toBeNull();
    half.app.openContact('pub/rick');
    expect(half.app.contactOpen).toBeNull();
  });

  it('are shown only, never written, in a vault that is shown only', async () => {
    const m = make({ token: 't', readOnly: true });
    m.hub.capabilities = ['contacts', 'contact'];
    m.hub.doc = snapshot([]);
    await m.app.start(null);
    expect(m.app.canContacts).toBe(true);
    expect(m.app.canMakeContacts).toBe(false);
    expect(await saveContact(m.app, { ...emptyContactForm('pub'), name: 'X' }, null)).toBe(false);
    expect(await deleteContact(m.app, RICK)).toBe(false);
    expect(m.hub.sent).toEqual([]);
  });

  it('tell a refusal of the dry run in the engine\'s words', async () => {
    const m = await boot();
    m.hub.next_ops = { kind: 'tasks.result', ok: false, dry_run: true, results: [{ n: 1, op: 'contact_new', ok: false, error: { code: 'invalid_argument', message: 'emails[1] is no mail address' } }] } as unknown as Result;
    const preview = await previewContact(m.app, { ...emptyContactForm('pub'), name: 'X', emails: 'nope' }, null);
    expect(preview).toEqual({ kind: 'refused', message: 'emails[1] is no mail address' });
    m.hub.next_ops = new ApiError(503, 'engine_unavailable', 'x');
    expect((await previewContact(m.app, { ...emptyContactForm('pub'), name: 'X' }, null)).kind).toBe('unknown');
  });

  it('write nothing for a form that changed nothing', async () => {
    const m = await boot();
    m.app.openContactDraft(formOfContact(RICK));
    expect(await saveContact(m.app, formOfContact(RICK), RICK)).toBe(true);
    expect(m.hub.sent).toEqual([]);
    expect(m.app.contactDraft).toBeNull();
  });
});
