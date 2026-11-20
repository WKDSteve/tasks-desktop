// @vitest-environment jsdom
// The drawing surface in a DOM, with synthetic pointer events: a pen draws a stroke that is saved after a moment as a
// new board (no `if_match`), the next save carries the version the first one gave; once a pen was seen a finger draws
// nothing (palm rejection); the eraser end of a pen takes a stroke away and undo brings it back; a conflict saves under
// the free name the engine names; an existing board is read back and saved on its version.
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { make } from '../lib/appDouble';
import { INK_SCHEMA, inkEtag, parseInk, serializeInk } from '../lib/ink';
import { inkText, type InkKey } from '../lib/inkTexts';
import BoardEditor from './BoardEditor.svelte';

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
};

// jsdom measures nothing: the surface keeps its size 0 and draws at scale 1 (a point of the screen is one of the page)
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver;

const NOW = new Date('2026-11-20T10:15:00').getTime();

let mounted: ReturnType<typeof mount> | undefined;
let made: ReturnType<typeof make> | undefined;
let host: HTMLElement | undefined;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  if (mounted) unmount(mounted);
  made?.app.stop();
  host?.remove();
  mounted = undefined;
  made = undefined;
  vi.useRealTimers();
});

function open(props: { name?: string } = {}) {
  made = make({ token: 't', now: NOW });
  host = document.createElement('div');
  document.body.append(host);
  const saved: unknown[] = [];
  const closed: number[] = [];
  mounted = mount(BoardEditor, {
    target: host,
    props: { app: made.app, owner: 'meeting', id: 'pub/now', ...props, onsaved: (s: unknown) => saved.push(s), onclose: () => closed.push(1) },
  });
  flushSync();
  const svg = host.querySelector('svg[role="img"]') as SVGSVGElement;
  return { hub: made.hub, svg, saved, closed, host };
}

interface Init {
  x: number;
  y: number;
  type?: string;
  id?: number;
  button?: number;
  buttons?: number;
  pressure?: number;
}

function pointer(target: Element, kind: string, init: Init): void {
  const e = new MouseEvent(kind, { bubbles: true, cancelable: true, clientX: init.x, clientY: init.y, button: init.button ?? 0 });
  Object.defineProperties(e, {
    pointerType: { value: init.type ?? 'pen' },
    pointerId: { value: init.id ?? 1 },
    pressure: { value: init.pressure ?? 0.7 },
    buttons: { value: init.buttons ?? 1 },
  });
  target.dispatchEvent(e);
  flushSync();
}

function stroke(svg: Element, from: [number, number], to: [number, number], init: Partial<Init> = {}): void {
  pointer(svg, 'pointerdown', { ...init, x: from[0], y: from[1] });
  for (let i = 1; i <= 5; i++) {
    pointer(svg, 'pointermove', { ...init, x: from[0] + ((to[0] - from[0]) * i) / 5, y: from[1] + ((to[1] - from[1]) * i) / 5 });
  }
  pointer(svg, 'pointerup', { ...init, x: to[0], y: to[1], buttons: 0 });
}

/** The button of the surface with the word `key`, in the language of the page. */
function button(host: Element, key: InkKey): HTMLButtonElement {
  const word = inkText(made?.app.lang ?? 'en', key);
  return [...host.querySelectorAll('button')].find((b) => b.textContent === word) as HTMLButtonElement;
}

const strokes = (svg: Element): number => svg.querySelectorAll('path:not(.rules)').length;

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(3000);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  flushSync();
}

describe('the drawing surface', () => {
  it('saves a new board after a moment, the next change on the version it got', async () => {
    const { hub, svg, saved } = open();
    stroke(svg, [100, 100], [300, 200]);
    expect(strokes(svg)).toBe(1);
    expect(hub.boards).toHaveLength(0);
    await settle();
    expect(hub.boards).toHaveLength(1);
    const first = hub.boards[0];
    expect(first?.name).toBe('board-2026-11-20-1015');
    expect(first?.if_match).toBeUndefined();
    expect(first?.svg.startsWith('<svg')).toBe(true);
    const doc = parseInk(first?.ink ?? '');
    expect(doc?.pages[0]?.strokes).toHaveLength(1);
    expect(doc?.pages[0]?.strokes[0]?.points[2]).toBe(0.7);
    expect(saved).toHaveLength(1);

    stroke(svg, [100, 300], [300, 300]);
    await settle();
    expect(hub.boards).toHaveLength(2);
    expect(hub.boards[1]?.if_match).toBe('sha256:0000000000000001');
    expect(saved).toHaveLength(1);
  });

  it('ignores a finger once a pen was seen', async () => {
    const { svg } = open();
    stroke(svg, [10, 10], [50, 50], { type: 'touch', id: 7 });
    expect(strokes(svg)).toBe(1);
    stroke(svg, [100, 100], [200, 100]);
    expect(strokes(svg)).toBe(2);
    stroke(svg, [10, 300], [200, 300], { type: 'touch', id: 8 });
    expect(strokes(svg)).toBe(2);
  });

  it('erases with the eraser end of a pen, and undo brings the stroke back', async () => {
    const { svg, host } = open();
    stroke(svg, [100, 100], [300, 100]);
    stroke(svg, [100, 400], [300, 400]);
    expect(strokes(svg)).toBe(2);
    stroke(svg, [200, 95], [200, 105], { button: 5, buttons: 32 });
    expect(strokes(svg)).toBe(1);
    button(host, 'undo').click();
    flushSync();
    expect(strokes(svg)).toBe(2);
  });

  it('saves under the free name when another device saved the board first', async () => {
    const { hub, svg, host } = open({});
    hub.boardAnswers.push({ ok: false, error: { code: 'conflict', details: { suggestion: 'board-2026-11-20-1015-2' } } });
    stroke(svg, [100, 100], [300, 200]);
    await settle();
    expect(hub.boards.map((b) => [b.name, b.if_match])).toEqual([
      ['board-2026-11-20-1015', undefined],
      ['board-2026-11-20-1015-2', undefined],
    ]);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('board-2026-11-20-1015-2');
  });

  it('reads an existing board and saves it on the version read', async () => {
    made = undefined;
    const text = serializeInk({ schema: INK_SCHEMA, pages: [{ background: 'grid', strokes: [{ tool: 'pen', color: 'bad', width: 6, points: [5, 5, 0.5, 50, 50, 0.5] }] }] });
    const m = make({ token: 't', now: NOW });
    m.hub.assetAnswers.set('assets/boards/skizze.ink.json', new Blob([text]));
    host = document.createElement('div');
    document.body.append(host);
    mounted = mount(BoardEditor, { target: host, props: { app: m.app, owner: 'meeting', id: 'pub/now', name: 'skizze', onclose: () => undefined } });
    made = m;
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await vi.waitFor(() => {
      flushSync();
      expect(host?.querySelectorAll('svg[role="img"] path:not(.rules)').length).toBe(1);
      expect(host?.querySelector('.status')?.textContent).toBe(inkText(m.app.lang, 'saved'));
    });
    expect(m.hub.assetReads).toEqual(['meeting pub/now assets/boards/skizze.ink.json']);
    const svg = host.querySelector('svg[role="img"]') as SVGSVGElement;
    stroke(svg, [100, 100], [300, 200]);
    await settle();
    expect(m.hub.boards[0]?.name).toBe('skizze');
    expect(m.hub.boards[0]?.if_match).toBe(await inkEtag(text));
  });

  it('stays open when the save on closing reached no hub, and gives up only when closed again', async () => {
    const { hub, svg, host, closed } = open();
    hub.boardAnswers.push(new Error('offline'));
    stroke(svg, [100, 100], [300, 200]);
    button(host, 'close').click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    flushSync();
    expect(hub.boards).toHaveLength(1);
    expect(closed).toEqual([]);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(inkText(made?.app.lang ?? 'en', 'closeAgain'));
    hub.boardAnswers.push(new Error('offline'));
    button(host, 'close').click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(closed).toEqual([1]);
  });

  it('saves what is not saved yet when it goes away without being closed', async () => {
    const { hub, svg } = open();
    stroke(svg, [100, 100], [300, 200]);
    if (mounted) unmount(mounted);
    mounted = undefined;
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(hub.boards).toHaveLength(1);
  });

  it('saves what is left when it is closed', async () => {
    const { hub, svg, host, closed } = open();
    stroke(svg, [100, 100], [300, 200]);
    button(host, 'close').click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(hub.boards).toHaveLength(1);
    expect(closed).toEqual([1]);
  });
});
