// @vitest-environment jsdom
// The choices of a row in a DOM: a choice is written at once, and when the write does not go through the element
// shows what the task has again (a select keeps the option that was chosen until its value changes). A page without a
// clipboard says that the copy failed instead of throwing.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import type { Result, Snapshot } from '../lib/contract';
import { task } from '../lib/fixtures';
import { labelOf, translate } from '../lib/i18n';
import RowActions from './RowActions.svelte';

type Made = ReturnType<typeof make>;
let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await tick();
    await Promise.resolve();
  }
  flushSync();
}

async function row(meant = true): Promise<{ m: Made; host: HTMLElement; select: (name: string) => HTMLSelectElement }> {
  const m = make({ token: 't' });
  made = m;
  m.hub.capabilities = ['ops', 'move_area'];
  m.hub.doc = snapshot([task('pub/a', { status: 'open', prio: 2, etag: 'ea' })]) as Snapshot;
  await m.app.start(null);
  m.app.setRowActions({ shown: ['status', 'prio', 'copy'], always: true });
  // The element of a row of the list: the bar is meant while the pointer is on it or the focus is in it.
  const host = document.createElement('div');
  host.className = 'row-host';
  document.body.append(host);
  mounted = mount(RowActions, { target: host, props: { app: m.app, task: m.app.tasks[0]! } });
  flushSync();
  if (meant) {
    host.dispatchEvent(new Event('pointerenter'));
    await settle();
  }
  return {
    m,
    host,
    select: (name) => host.querySelector<HTMLSelectElement>(`select[data-row-action="${name}"]`)!,
  };
}

function pick(el: HTMLSelectElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('the choices of a row', () => {
  it('write the status at once, with the version that was shown', async () => {
    const { m, select } = await row();
    expect(select('status').value).toBe('open');
    pick(select('status'), 'doing');
    await settle();
    expect(m.hub.sent[0]?.ops).toEqual([{ op: 'set', id: 'pub/a', patch: { status: 'doing' }, if_match: 'ea' }]);
  });

  it('show what the task has again when the write did not go through', async () => {
    const { m, select } = await row();
    m.hub.next_ops = {
      kind: 'tasks.result',
      ok: false,
      dry_run: false,
      results: [{ n: 1, op: 'set', ok: false, outcome: 'failed', changed_ids: [], error: { code: 'conflict', message: 'changed meanwhile', retryable: false } }],
    } as unknown as Result;
    pick(select('status'), 'doing');
    await settle();
    expect(m.hub.sent).toHaveLength(1);
    // The file still says open: so does the row, in its tag and in its choice.
    expect(m.app.tasks[0]?.status).toBe('open');
    expect(select('status').value).toBe('open');

    m.hub.next_ops = {
      kind: 'tasks.result',
      ok: false,
      dry_run: false,
      results: [{ n: 1, op: 'set', ok: false, outcome: 'failed', changed_ids: [], error: { code: 'conflict', message: 'changed meanwhile', retryable: false } }],
    } as unknown as Result;
    pick(select('prio'), '1');
    await settle();
    expect(select('prio').value).toBe('2');
  });

  it('say that the copy failed where the page has no clipboard', async () => {
    const { m } = await row();
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    document.querySelector<HTMLButtonElement>('button[data-row-action="copy"]')?.click();
    await settle();
    expect(m.app.toast).toMatchObject({ kind: 'error', text: translate(m.app.lang, 'about.copy_failed') });
  });

  it('draw a select only while the row is meant: a stand-in before, while the pointer is on it or the focus is in it, and a stand-in after', async () => {
    const { m, host, select } = await row(false);
    const ghost = (name: string) => host.querySelector(`.ghost[data-row-action="${name}"]`);
    expect(host.querySelectorAll('select')).toHaveLength(0);
    expect(ghost('status')?.textContent).toBe(labelOf(m.app.lang, 'status', 'open'));
    expect(ghost('prio')?.textContent).toBe('P2');

    host.dispatchEvent(new Event('pointerenter'));
    await settle();
    expect(host.querySelectorAll('select')).toHaveLength(2);
    expect(ghost('status')).toBeNull();
    // Its choice has the width of the stand-in it replaced: nothing in the row moves.
    expect(select('status').style.width).toMatch(/^min\(7\.5rem, \d+ch \+ 2\.4rem\)$/);

    host.dispatchEvent(new Event('pointerleave'));
    await settle();
    expect(host.querySelectorAll('select')).toHaveLength(0);

    // The focus does it too: the row's own button takes the focus, and the choices are there for the next Tab.
    host.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await settle();
    expect(host.querySelectorAll('select')).toHaveLength(2);
    host.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    await settle();
    expect(host.querySelectorAll('select')).toHaveLength(0);
  });

  it('keep the select while its write is on its way, also when the pointer has left the row', async () => {
    const { m, host, select } = await row();
    let release: () => void = () => undefined;
    m.hub.holdOps = new Promise<void>((resolve) => (release = resolve));
    pick(select('status'), 'doing');
    host.dispatchEvent(new Event('pointerleave'));
    await settle();
    expect(host.querySelectorAll('select')).toHaveLength(2);
    release();
    await settle();
    expect(host.querySelectorAll('select')).toHaveLength(0);
  });
});
