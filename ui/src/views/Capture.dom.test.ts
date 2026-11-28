// @vitest-environment jsdom
// The new-task form in a DOM: "Suggest fields" asks before a text leaves this machine, and a no puts the waiting job of
// ai-desktop away. Closing the form while it asks is a no as well: the effect that follows `app.capturing` answers the
// question, which `svelte/server` never runs.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { make } from '../lib/appDouble';
import { translate, type Key } from '../lib/i18n';
import Capture from './Capture.svelte';

type Made = ReturnType<typeof make>;

let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;

beforeAll(() => {
  // jsdom draws a dialog but does not open one.
  const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
  proto.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

const t = (m: Made, key: Key): string => translate(m.app.lang, key);
function button(m: Made, key: Key): HTMLButtonElement {
  const name = t(m, key);
  const found = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === name);
  if (!found) throw new Error(`no button ${name}`);
  return found;
}

async function settle(): Promise<void> {
  await tick();
  flushSync();
  await Promise.resolve();
  flushSync();
}

/** The form open on a page that found ai-desktop, with a text typed into "Suggest fields" and the question asked. */
async function asking(): Promise<Made> {
  const m = make({ token: 't' });
  made = m;
  // ai-desktop is found by the hub itself, so every read of the page says so. Set on the page instead, a read the start
  // began would overwrite it when it answers late (under load in the full suite): the AI functions went, the question
  // with them, and nobody said no. The answer comes a moment late here on purpose.
  m.hub.aiDesktopFound = { installed: true, running: true };
  const found = m.hub.aiDesktop;
  m.hub.aiDesktop = async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return found();
  };
  await m.app.start(null);
  m.app.stop();
  await vi.waitFor(() => expect(m.app.aiFeatures).toBe(true));
  const target = document.createElement('div');
  document.body.append(target);
  mounted = mount(Capture, { target, props: { app: m.app } });
  m.app.openCapture();
  await settle();
  button(m, 'draft.button').click();
  await settle();
  const text = document.querySelector<HTMLTextAreaElement>('.draft textarea');
  if (!text) throw new Error('no text field');
  text.value = 'The button should be blue';
  text.dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
  button(m, 'draft.go').click();
  await vi.waitFor(() => expect(document.querySelector('.draft-ask')).not.toBeNull());
  expect(m.hub.drafts).toEqual(['The button should be blue']);
  return m;
}

afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.innerHTML = '';
});

describe('Suggest fields: a job that waits for a yes', () => {
  it('is put away in ai-desktop when the person says "Do not send"', async () => {
    const m = await asking();
    button(m, 'draft.confirm_no').click();
    await vi.waitFor(() => expect(m.hub.dropped).toEqual(['0123456789abcdef']));
    expect(m.hub.confirmed).toEqual([]);
    await settle();
    expect(document.querySelector('.draft-note')?.textContent).toContain(t(m, 'draft.declined'));
  });

  it('is put away as well when the form is closed while it asks', async () => {
    const m = await asking();
    m.app.closeCapture();
    await settle();
    await vi.waitFor(() => expect(m.hub.dropped).toEqual(['0123456789abcdef']));
    expect(m.hub.confirmed).toEqual([]);
  });

  it('runs after a yes, and nothing is put away', async () => {
    const m = await asking();
    button(m, 'draft.confirm_yes').click();
    await vi.waitFor(() => expect(m.hub.confirmed).toEqual(['0123456789abcdef']));
    expect(m.hub.dropped).toEqual([]);
  });
});
