// @vitest-environment jsdom
// The plan wizard in a DOM: what is typed into one of the two ways to name the target (an existing task, or the title
// of a new one) is still there after the person switched to the other way and back (nothing typed twice).
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { make } from '../lib/appDouble';
import { translate } from '../lib/i18n';
import PlanWizard from './PlanWizard.svelte';

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

async function settle(): Promise<void> {
  await tick();
  flushSync();
  await Promise.resolve();
  flushSync();
}

function type(field: HTMLInputElement, text: string): void {
  field.value = text;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.innerHTML = '';
});

describe('plan wizard, the two ways to name the target', () => {
  it('keeps what was typed in each when the person switches between them', async () => {
    const m = make({ token: 't' });
    made = m;
    await m.app.start(null);
    m.app.stop();
    const target = document.createElement('div');
    document.body.append(target);
    mounted = mount(PlanWizard, { target, props: { app: m.app } });
    m.app.openPlanWizard();
    await settle();
    const word = (key: 'plan.new.target_make' | 'plan.new.target_pick'): HTMLButtonElement => {
      const name = translate(m.app.lang, key);
      const found = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === name);
      if (!found) throw new Error(`no button ${name}`);
      return found;
    };

    type(document.querySelector<HTMLInputElement>('#plan-target')!, 'pub/existing');
    await settle();
    word('plan.new.target_make').click();
    await settle();
    type(document.querySelector<HTMLInputElement>('#plan-target-title')!, 'A new target');
    await settle();
    word('plan.new.target_pick').click();
    await settle();
    expect(document.querySelector<HTMLInputElement>('#plan-target')?.value).toBe('pub/existing');
    word('plan.new.target_make').click();
    await settle();
    expect(document.querySelector<HTMLInputElement>('#plan-target-title')?.value).toBe('A new target');
  });
});
