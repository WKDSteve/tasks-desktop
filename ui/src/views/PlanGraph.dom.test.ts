// @vitest-environment jsdom
// The menu of an arrow of the plan graph in a DOM: opened with Enter, it gets the focus a frame later. An Escape that
// comes before that frame (fast keys, a busy machine) is on the arrow still and closes the menu all the same. The
// drawing, the drags and the engine are the browser tests' (e2e/app.spec.ts, "the plan as a graph").
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import { task } from '../lib/fixtures';
import PlanGraph from './PlanGraph.svelte';

let mounted: ReturnType<typeof mount> | undefined;
let made: ReturnType<typeof make> | undefined;

beforeAll(() => {
  // jsdom draws nothing: the middle of an arrow, where the menu of the keys stands, is asked of the path.
  const proto = (globalThis.SVGElement ?? Element).prototype as unknown as Record<string, unknown>;
  proto['getTotalLength'] = () => 10;
  proto['getPointAtLength'] = () => ({ x: 5, y: 5 });
  // nor does it measure: the graph follows the width of its box.
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

describe('the menu of an arrow of the plan graph', () => {
  it('closes with an Escape that comes before it took the focus, and the arrow keeps the keys', async () => {
    const first = task('pub/first', { title: 'First', etag: 'e1' });
    const second = task('pub/second', { title: 'Second', blocked_by: ['pub/first'], etag: 'e1' });
    const m = make({ token: 't' });
    made = m;
    m.hub.doc = snapshot([first, second]);
    await m.app.start(null);
    const root = document.createElement('div');
    document.body.append(root);
    const stages = [
      { stage: 0, tasks: [m.app.tasks.find((x) => x.id === 'pub/first')!] },
      { stage: 1, tasks: [m.app.tasks.find((x) => x.id === 'pub/second')!] },
    ];
    mounted = mount(PlanGraph, {
      target: root,
      props: { app: m.app, stages, critical: new Set<string>(), path: [], cycles: [], onopen: () => undefined },
    });
    flushSync();
    const hit = root.querySelector<SVGElement>('path.hit')!;
    expect(hit, 'the arrow').not.toBeNull();
    hit.focus();
    const key = (name: string) => hit.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
    key('Enter');
    flushSync();
    expect(root.querySelector('.edge-menu'), 'the menu is open').not.toBeNull();
    // Escape at once, before the frame in which the menu takes the focus.
    expect(key('Escape')).toBe(false);
    flushSync();
    expect(root.querySelector('.edge-menu'), 'the menu is closed').toBeNull();
    expect(document.activeElement).toBe(hit);
    // The frame that comes later does not take the focus into a menu that is gone.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    expect(document.activeElement).toBe(hit);
  });
});
