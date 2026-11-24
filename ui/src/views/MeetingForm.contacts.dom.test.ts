// @vitest-environment jsdom
// The participant field of the meeting form suggests the contacts (Office concept, wave 4): the names are offered, and a
// name that is exactly one contact fills the address and the role that are still empty. What is typed stays; a name two
// contacts have, or none, fills nothing. Without the engine capability nothing is read or offered.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import type { ContactEntry } from '../lib/contract';
import MeetingForm from './MeetingForm.svelte';

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
  this.dispatchEvent(new Event('close'));
};

type Made = ReturnType<typeof make>;

function contact(id: string, name: string, more: Partial<ContactEntry> = {}): ContactEntry {
  const [area, slug] = id.split('/') as [string, string];
  return { id, area, slug, name, emails: [], phones: [], tags: [], summary: '', file: `${id}.md`, valid: true, problems: [], ...more } as ContactEntry;
}

const RICK = contact('pub/rick', 'Rick Beispiel', { emails: ['rick@example.org'], role: 'Support', org: 'Beispiel GmbH' });
const TWIN_A = contact('pub/twin-a', 'Twin', { emails: ['a@example.org'] });
const TWIN_B = contact('pub/twin-b', 'Twin', { emails: ['b@example.org'] });

let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await tick();
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
  }
}

async function open(items: ContactEntry[], caps = ['meetings', 'meeting', 'meeting_ops', 'contacts']): Promise<HTMLElement> {
  made = make({ token: 't', now: new Date('2026-11-24T10:00:00').getTime() });
  made.hub.capabilities = caps;
  made.hub.contactItems = items;
  made.hub.doc = snapshot([]);
  await made.app.start(null);
  made.app.openMeetingForm({ date: '2026-11-25' });
  const root = document.createElement('div');
  document.body.append(root);
  mounted = mount(MeetingForm, { target: root, props: { app: made.app } });
  await settle();
  root.querySelector<HTMLButtonElement>('fieldset.group > button')!.click();
  await settle();
  return root;
}

async function type(root: HTMLElement, value: string): Promise<HTMLInputElement[]> {
  const name = root.querySelector<HTMLInputElement>('[data-participant-name]')!;
  name.value = value;
  name.dispatchEvent(new Event('input', { bubbles: true }));
  name.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  return [...root.querySelectorAll<HTMLInputElement>('.person input')];
}

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  document.body.replaceChildren();
});

describe('the participant field and the contacts', () => {
  it('offers the contact names, once each, with the organisation', async () => {
    const root = await open([RICK, TWIN_A, TWIN_B]);
    const options = [...root.querySelectorAll('#meeting-contact-names option')].map((o) => [(o as HTMLOptionElement).value, o.textContent]);
    expect(options).toEqual([
      ['Rick Beispiel', 'Beispiel GmbH'],
      ['Twin', ''],
    ]);
  });

  it('fills the address and the role of the chosen contact where they are empty', async () => {
    const root = await open([RICK]);
    const [name, email, role] = await type(root, 'Rick Beispiel');
    expect([name!.value, email!.value, role!.value]).toEqual(['Rick Beispiel', 'rick@example.org', 'Support']);
  });

  it('keeps an address that was typed, and fills nothing for a name that is none or two contacts', async () => {
    const root = await open([RICK, TWIN_A, TWIN_B]);
    const [name, email, role] = await type(root, 'Twin');
    expect([name!.value, email!.value, role!.value]).toEqual(['Twin', '', '']);
    email!.value = 'mine@example.org';
    email!.dispatchEvent(new Event('input', { bubbles: true }));
    const again = await type(root, 'Rick Beispiel');
    expect(again[1]!.value).toBe('mine@example.org');
    expect(again[2]!.value).toBe('Support');
  });

  it('reads and offers no contact without the capability', async () => {
    const root = await open([RICK], ['meetings', 'meeting', 'meeting_ops']);
    expect(root.querySelectorAll('#meeting-contact-names option')).toHaveLength(0);
    expect(made!.hub.contactQueries).toEqual([]);
  });
});
