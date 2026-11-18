// @vitest-environment jsdom
// A part of the page whose chunk does not come (the hub was replaced since the page was loaded): the state that wanted
// it is taken back, the notice can be closed, and asking again loads again.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { make } from '../lib/appDouble';
import LazyProbe from '../lib/fixtures/LazyProbe.svelte';
import Lazy from './Lazy.svelte';

type Made = ReturnType<typeof make>;

let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;

/** The promise of the import has settled, and what it changed is drawn. */
async function settle(): Promise<void> {
  await tick();
  await Promise.resolve();
  await tick();
  flushSync();
}

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

/** A dialog of the page as `App.svelte` holds it: a flag, and a chunk that comes or does not. */
function dialogOf(chunk: { gone: boolean }) {
  made = make({ token: 't' });
  const page = $state({ open: false });
  let loads = 0;
  const target = document.createElement('div');
  document.body.append(target);
  // Not `Lazy<...>`: a plain `tsc` reads a `.svelte` file through the shim, which knows no generics of a component.
  mounted = mount(Lazy as never, {
    target,
    props: {
      app: made.app,
      get when() {
        return page.open;
      },
      load: () => {
        loads += 1;
        return chunk.gone ? Promise.reject(new TypeError('Failed to fetch dynamically imported module')) : Promise.resolve({ default: LazyProbe });
      },
      get extra() {
        return { open: page.open, onclose: () => (page.open = false) };
      },
      onfailed: () => (page.open = false),
    },
  });
  flushSync();
  return { page, target, loads: () => loads };
}

describe('Lazy, a chunk that does not come', () => {
  it('takes the state back, and the notice can be closed', async () => {
    const d = dialogOf({ gone: true });
    expect(d.loads()).toBe(0);
    d.page.open = true;
    await settle();
    expect(d.loads()).toBe(1);
    expect(d.page.open).toBe(false);
    const notice = d.target.querySelector('[role="alert"]');
    expect(notice).not.toBeNull();
    notice?.querySelector<HTMLButtonElement>('button.dismiss')?.click();
    await settle();
    expect(d.target.querySelector('[role="alert"]')).toBeNull();
    // Closing the notice asks for nothing: only the entry of the menu does.
    expect(d.loads()).toBe(1);
  });

  it('loads again when it is wanted again, and shows the dialog once the chunk comes', async () => {
    const chunk = { gone: true };
    const d = dialogOf(chunk);
    d.page.open = true;
    await settle();
    expect(d.target.querySelector('[role="alert"]')).not.toBeNull();
    chunk.gone = false;
    d.page.open = true;
    await settle();
    expect(d.loads()).toBe(2);
    expect(d.target.querySelector('[role="alert"]')).toBeNull();
    const probe = d.target.querySelector('[data-testid="probe"]');
    expect(probe?.textContent).toContain('open');
    // Kept from then on: closed and opened again without another request.
    probe?.querySelector('button')?.click();
    await settle();
    expect(d.page.open).toBe(false);
    expect(d.target.querySelector('[data-testid="probe"]')?.textContent).toContain('closed');
    d.page.open = true;
    await settle();
    expect(d.loads()).toBe(2);
  });
});
