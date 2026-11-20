// @vitest-environment jsdom
// The board button of the attach bar: a new board on the drawing surface, saved once it is closed; its preview is
// linked in the notes of a task (and of a meeting), never of a plan or a project, which `append_note` does not take.
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import { task } from '../lib/fixtures';
import { inkText } from '../lib/inkTexts';
import AttachBar from './AttachBar.svelte';

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
};
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver;

const NOW = new Date('2026-11-20T11:30:00').getTime();
let mounted: ReturnType<typeof mount> | undefined;
let made: ReturnType<typeof make> | undefined;

afterEach(() => {
  if (mounted) unmount(mounted);
  made?.app.stop();
  mounted = undefined;
  made = undefined;
  document.body.replaceChildren();
});

async function drawAndClose(owner: 'task' | 'plan' | undefined) {
  made = make({ token: 't', now: NOW });
  made.hub.doc = snapshot([task('pub/x', { etag: 'e1' })]);
  await made.app.start(null);
  made.app.stop();
  const target = document.createElement('div');
  document.body.append(target);
  mounted = mount(AttachBar, { target, props: { app: made.app, id: 'pub/x', ...(owner ? { owner } : {}) } });
  flushSync();
  (target.querySelector('button[data-attach="board"]') as HTMLButtonElement).click();
  flushSync();
  const svg = await vi.waitFor(() => {
    const found = target.querySelector('dialog.board svg[role="img"]');
    expect(found).not.toBeNull();
    return found as SVGSVGElement;
  });
  for (const [kind, x] of [['pointerdown', 10], ['pointermove', 60], ['pointerup', 90]] as const) {
    const e = new MouseEvent(kind, { bubbles: true, clientX: x, clientY: 40 });
    Object.defineProperties(e, { pointerType: { value: 'pen' }, pointerId: { value: 1 }, pressure: { value: 0.6 }, buttons: { value: 1 } });
    svg.dispatchEvent(e);
    flushSync();
  }
  const close = inkText(made.app.lang, 'close');
  ([...target.querySelectorAll('dialog.board button')].find((b) => b.textContent === close) as HTMLButtonElement).click();
  await vi.waitFor(() => expect(made?.hub.boards).toHaveLength(1));
  await vi.waitFor(() => expect(target.querySelector('dialog.board')).toBeNull());
  return made;
}

describe('the board of the attach bar', () => {
  it('links the preview of a new board in the notes of a task', async () => {
    const m = await drawAndClose(undefined);
    await vi.waitFor(() => expect(m.hub.sent).toHaveLength(1));
    expect(m.hub.sent[0]?.ops).toEqual([
      { op: 'append_note', id: 'pub/x', text: '![board-2026-11-20-1130](assets/boards/board-2026-11-20-1130.svg)' },
    ]);
  });

  it('writes no note into a plan: the board is an asset of its folder', async () => {
    const m = await drawAndClose('plan');
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(m.hub.sent).toEqual([]);
  });
});
