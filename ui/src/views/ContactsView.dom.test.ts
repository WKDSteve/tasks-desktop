// @vitest-environment jsdom
// The contacts in a DOM: the list view (rows, search, the filters, the key n, a click that opens the page), the page
// (links that write and call, Delete with its question), the form (a dry run, Esc that does not throw a changed form
// away, the operation that goes out) and the way back. A contact is a person of a third party: what the page says in
// toasts never holds an address or a number. The engine's reading is the browser tests'.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import { formOfContact } from '../lib/contacts';
import type { ContactEntry } from '../lib/contract';
import ContactForm from './ContactForm.svelte';
import ContactPage from './ContactPage.svelte';
import ContactsView from './ContactsView.svelte';

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
  this.dispatchEvent(new Event('close'));
};

type Made = ReturnType<typeof make>;

const MAIL = 'rick.secret@example.org';
const PHONE = '+43 1 2345678';

function contact(id: string, more: Partial<ContactEntry> = {}): ContactEntry {
  const [area, slug] = id.split('/') as [string, string];
  return {
    id,
    area,
    slug,
    name: `Person ${slug}`,
    emails: [],
    phones: [],
    tags: [],
    summary: '',
    file: `${area}/CONTACTS/${slug}.md`,
    etag: `sha256:${slug}`,
    valid: true,
    problems: [],
    ...more,
  } as ContactEntry;
}

const RICK = contact('pub/rick', { name: 'Rick Beispiel', org: 'Beispiel GmbH', role: 'Support', emails: [MAIL], phones: [PHONE], tags: ['t2'], tz: 'Europe/Vienna' });
const ANNA = contact('pub/anna', { name: 'Anna Muster', tags: ['family'] });

let mounted: ReturnType<typeof mount>[] = [];
let made: Made | undefined;

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await tick();
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
  }
}

async function boot(items: ContactEntry[], caps: string[] = ['contacts', 'contact']): Promise<Made> {
  const m = make({ token: 't', now: new Date('2026-11-24T10:00:00').getTime() });
  made = m;
  m.hub.capabilities = caps;
  m.hub.contactItems = items;
  m.hub.doc = snapshot([]);
  await m.app.start(null);
  return m;
}

async function show(component: typeof ContactsView | typeof ContactPage | typeof ContactForm, m: Made): Promise<HTMLElement> {
  const root = document.createElement('div');
  document.body.append(root);
  mounted.push(mount(component as typeof ContactsView, { target: root, props: { app: m.app } }));
  await settle();
  return root;
}

afterEach(() => {
  for (const x of mounted) void unmount(x);
  mounted = [];
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

const rows = (root: HTMLElement): string[] => [...root.querySelectorAll<HTMLElement>('[data-contact]')].map((b) => b.dataset.contact!);
const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string): void => {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
};
/** What the toast says (its way back, `undo`, holds the data it would bring back: that is not a message). */
const toastText = (m: Made): string => m.app.toast?.text ?? '';

describe('the view Contacts', () => {
  it('lists the contacts by what the person is, never by an address or a number', async () => {
    const m = await boot([RICK, ANNA]);
    const root = await show(ContactsView, m);
    expect(rows(root)).toEqual(['pub/rick', 'pub/anna']);
    expect(root.textContent).toContain('Rick Beispiel');
    expect(root.textContent).toContain('Beispiel GmbH · Support');
    expect(root.textContent).not.toContain(MAIL);
    expect(root.textContent).not.toContain('2345678');
  });

  it('searches and filters', async () => {
    const m = await boot([RICK, ANNA]);
    const root = await show(ContactsView, m);
    type(root.querySelector<HTMLInputElement>('[data-contacts-search]')!, 'beispiel');
    expect(rows(root)).toEqual(['pub/rick']);
    type(root.querySelector<HTMLInputElement>('[data-contacts-search]')!, 'zzz');
    expect(root.querySelector('[data-contacts-empty]')).not.toBeNull();
    type(root.querySelector<HTMLInputElement>('[data-contacts-search]')!, '');
    const tag = root.querySelector<HTMLSelectElement>('[data-contacts-tag]')!;
    tag.value = 'family';
    tag.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(rows(root)).toEqual(['pub/anna']);
  });

  it('reads all pages and says when the list is cut', async () => {
    const m = await boot([RICK, ANNA, contact('pub/c')]);
    m.hub.contactPageSize = 2;
    const root = await show(ContactsView, m);
    expect(rows(root)).toHaveLength(3);
    expect(m.hub.contactQueries.map((q) => q.offset)).toEqual([0, 2]);
  });

  it('opens the page on a click, and n makes a new contact', async () => {
    const m = await boot([RICK]);
    const root = await show(ContactsView, m);
    root.querySelector<HTMLButtonElement>('[data-contact="pub/rick"]')!.click();
    expect(m.app.contactOpen).toBe('pub/rick');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    expect(m.app.contactDraft).not.toBeNull();
    expect(m.app.contactDraft?.id).toBeUndefined();
  });

  it('is empty, and offers nothing, without the engine capability', async () => {
    const m = await boot([RICK], []);
    const root = await show(ContactsView, m);
    expect(rows(root)).toEqual([]);
    expect(root.querySelector('[data-contacts-new]')).toBeNull();
    expect(m.hub.contactQueries).toEqual([]);
  });

  it('says so when the engine cannot be read', async () => {
    const m = await boot([RICK]);
    m.hub.contactsError = new (await import('../lib/api')).ApiError(502, 'engine_failed', 'x');
    const root = await show(ContactsView, m);
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
  });
});

describe('the page of a contact', () => {
  it('writes and calls through links, named by the person, and keeps the data out of the labels', async () => {
    const m = await boot([RICK]);
    m.app.openContact('pub/rick');
    const root = await show(ContactPage, m);
    const mail = root.querySelector<HTMLAnchorElement>('[data-contact-mail]')!;
    expect(mail.getAttribute('href')).toBe(`mailto:${MAIL}`);
    expect(mail.getAttribute('aria-label')).toBe('Rick Beispiel schreiben');
    const phone = root.querySelector<HTMLAnchorElement>('[data-contact-phone]')!;
    expect(phone.getAttribute('href')).toBe('tel:+4312345678');
    expect(phone.getAttribute('aria-label')).not.toContain('2345678');
  });

  it('shows the meetings that name the person, the latest first, and opens one', async () => {
    const m = await boot([RICK], ['contacts', 'contact', 'meetings', 'meeting']);
    m.hub.contactBodies.set('pub/rick', {
      history: [
        { id: 'pub/sync', title: 'Sync', date: '2026-11-10', participant: 1, role: 'Lead', present: true },
        { id: 'pub/old', title: 'Old', date: '2026-09-01', participant: 2, present: false },
      ],
    });
    m.app.openContact('pub/rick');
    const root = await show(ContactPage, m);
    const rows = [...root.querySelectorAll('[data-contact-history] li')];
    expect(rows.map((r) => r.querySelector('button')!.textContent)).toEqual(['Sync', 'Old']);
    expect(rows[0]!.textContent).toContain('Lead');
    expect(root.querySelector('[data-contact-history-none]')).toBeNull();
    rows[0]!.querySelector('button')!.click();
    expect(m.app.meetingOpen).toBe('pub/sync');
    expect(m.app.contactOpen).toBeNull();
  });

  it('says so when no meeting names the person, and shows nothing for an engine that has no history', async () => {
    const m = await boot([RICK, ANNA]);
    m.hub.contactBodies.set('pub/rick', { history: [] });
    m.app.openContact('pub/rick');
    const root = await show(ContactPage, m);
    expect(root.querySelector('[data-contact-history-none]')).not.toBeNull();
    m.app.openContact('pub/anna');
    await settle();
    expect(root.querySelector('[data-contact-history]')).toBeNull();
    expect(root.querySelector('[data-contact-history-none]')).toBeNull();
  });

  it('asks before it deletes, then removes the file on the version shown and offers the way back', async () => {
    const m = await boot([RICK]);
    m.app.openContact('pub/rick');
    const root = await show(ContactPage, m);
    root.querySelector<HTMLButtonElement>('[data-contact-delete]')!.click();
    await settle();
    expect(m.hub.sent).toEqual([]);
    expect(root.querySelector('[data-contact-ask]')?.textContent).toContain('Rick Beispiel');
    root.querySelector<HTMLButtonElement>('[data-contact-delete-yes]')!.click();
    await settle();
    expect(m.hub.sent[0]?.ops).toEqual([{ op: 'contact_delete', id: 'pub/rick', if_match: 'sha256:rick' }]);
    // the inverse makes it again, with what the engine kept
    expect(m.app.toast?.undo).toEqual([
      { op: 'contact_new', id: 'pub/rick', name: 'Gone Person', fields: { emails: ['gone@example.org'] }, body: '\n## Notes\nkept\n' },
    ]);
    expect(toastText(m)).not.toContain(MAIL);
    expect(toastText(m)).not.toContain('gone@example.org');
  });

  it('says that a contact is gone', async () => {
    const m = await boot([]);
    m.app.openContact('pub/ghost');
    const root = await show(ContactPage, m);
    expect(root.querySelector('[data-contact-failed]')).not.toBeNull();
  });
});

describe('the form of a contact', () => {
  it('makes a contact with the fields it has, and the engine is asked first (dry run)', async () => {
    const m = await boot([]);
    m.app.openContactForm({ area: 'pub' });
    const root = await show(ContactForm, m);
    type(root.querySelector<HTMLInputElement>('[data-contact-name]')!, 'Rick');
    type(root.querySelector<HTMLInputElement>('[data-contact-emails]')!, `${MAIL}, b@example.org`);
    await new Promise((r) => setTimeout(r, 400));
    await settle();
    expect(m.hub.sent[0]?.dry_run).toBe(true);
    expect(root.textContent).toContain('pub/made-contact');
    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await settle();
    expect(m.hub.sent[1]?.ops).toEqual([
      { op: 'contact_new', area: 'pub', name: 'Rick', fields: { emails: [MAIL, 'b@example.org'] }, lang: 'de' },
    ]);
    // made: the dialogs are closed (they would cover the toast), the toast offers the way back and names no address
    expect(m.app.contactDraft).toBeNull();
    expect(m.app.contactOpen).toBeNull();
    expect(m.app.toast?.undo).toEqual([{ op: 'contact_delete', id: 'pub/made-contact', if_match: 'c-made' }]);
    expect(toastText(m)).not.toContain('example.org');
  });

  it('changes only what was changed, on the version the form was opened on', async () => {
    const m = await boot([RICK]);
    m.app.openContactDraft(formOfContact(RICK));
    const root = await show(ContactForm, m);
    type(root.querySelector<HTMLInputElement>('[data-contact-role]')!, 'Lead');
    await new Promise((r) => setTimeout(r, 400));
    await settle();
    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await settle();
    const op = m.hub.sent.at(-1)?.ops[0];
    expect(op).toEqual({ op: 'contact_set', id: 'pub/rick', patch: { role: 'Lead' }, if_match: 'sha256:rick' });
    expect(m.app.toast?.undo).toEqual([{ op: 'contact_set', id: 'pub/rick', patch: { role: 'Before' }, if_match: 'c-after' }]);
  });

  it('does not throw a changed form away on Esc, and asks; an untouched form closes at once', async () => {
    const m = await boot([]);
    m.app.openContactForm({ area: 'pub' });
    const root = await show(ContactForm, m);
    const dialog = root.querySelector<HTMLDialogElement>('dialog')!;
    // untouched: Esc is not stopped
    const calm = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(calm);
    expect(calm.defaultPrevented).toBe(false);
    type(root.querySelector<HTMLInputElement>('[data-contact-name]')!, 'Rick');
    const esc = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(esc);
    flushSync();
    expect(esc.defaultPrevented).toBe(true);
    expect(root.querySelector('[data-contact-discard-ask]')).not.toBeNull();
    expect(m.app.contactDraft).not.toBeNull();
    root.querySelector<HTMLButtonElement>('[data-contact-keep]')!.click();
    flushSync();
    expect(root.querySelector('[data-contact-discard-ask]')).toBeNull();
    root.querySelector<HTMLButtonElement>('[data-contact-cancel]')!.click();
    flushSync();
    root.querySelector<HTMLButtonElement>('[data-contact-discard]')!.click();
    flushSync();
    expect(m.app.contactDraft).toBeNull();
  });
});
