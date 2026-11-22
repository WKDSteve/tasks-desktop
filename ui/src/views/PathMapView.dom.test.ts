// @vitest-environment jsdom
// The competence map in a DOM, with its effects running: it reads the paths with the finished ones (capability
// `requires`), draws a box per path with the engine's stage, an arrow per requirement, a frame per project; the keys
// walk the chain, Space holds it, f shows only it; a box opens its path (a middle click in a new tab); the finished
// ones can be hidden and the list shown instead, both kept. Stage, waiting and met come from the fixtures (the engine).
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import type { PathEntry, PathProgress, Snapshot } from '../lib/contract';
import PathMapView from './PathMapView.svelte';

type Made = ReturnType<typeof make>;

// jsdom measures and scrolls nothing.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= function () {};

const progress = (p: Partial<PathProgress> = {}): PathProgress => ({ learned: 0, seen: 0, dropped: 0, open: 2, blocked: 0, total: 2, ...p });

function entry(slug: string, title: string, extra: Partial<PathEntry> = {}): PathEntry {
  return {
    id: `lib/${slug}`,
    area: 'lib',
    slug,
    title,
    areas: ['lib'],
    summary: '',
    has_tree: true,
    points: 2,
    progress: progress(),
    file: `lib/ROADMAP/paths/${slug}.md`,
    valid: true,
    problems: [],
    stage: 'idle',
    ...extra,
  };
}

// Grundlagen (finished) <- Ohm (base project, running) ; project Oben needs project Basis (hard, open), so Gatter waits.
const ITEMS: PathEntry[] = [
  entry('ohm', 'Ohm', { project: 'lib/basis', stage: 'doing', progress: progress({ learned: 1, open: 1 }), requires: [{ id: 'lib/grund', gate: 'soft', kind: 'path', met: true }] }),
  entry('gatter', 'Gatter', { project: 'lib/oben', stage: 'waiting', waiting_on: [{ id: 'lib/basis', via: 'lib/oben' }] }),
  entry('frei', 'Frei', { requires: [{ id: 'lib/ohm', gate: 'soft', kind: 'path', met: false }] }),
  entry('grund', 'Grundlagen', { stage: 'done', status: 'done', progress: progress({ learned: 2, open: 0 }) }),
];

function withProjects(): Snapshot {
  return {
    ...snapshot([], 'rev:1'),
    projects: [
      { id: 'lib/basis', title: 'Basis', areas: ['lib'], phase_order: [], valid: true, plans: [], rollup: {} },
      {
        id: 'lib/oben',
        title: 'Oben',
        areas: ['lib'],
        phase_order: [],
        valid: true,
        plans: [],
        rollup: {},
        requires: [{ id: 'lib/basis', gate: 'hard', kind: 'project', met: false }],
        waiting_on: [{ id: 'lib/basis' }],
      },
    ],
  } as unknown as Snapshot;
}

let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await tick();
    await Promise.resolve();
  }
  flushSync();
}

async function show(opts: { requires?: boolean; prefs?: Map<string, string>; openWindow?: (route: string) => boolean; items?: PathEntry[] } = {}) {
  const m = make({ token: 't', ...(opts.prefs ? { prefs: opts.prefs } : {}), ...(opts.openWindow ? { openWindow: opts.openWindow } : {}) });
  made = m;
  m.hub.capabilities = ['paths', 'path', ...(opts.requires === false ? [] : ['requires'])];
  m.hub.doc = withProjects();
  m.hub.pathsDoc = { kind: 'tasks.paths', rev: 'p1', digest: 'd', items: opts.items ?? ITEMS, incomplete: [] };
  await m.app.start(null);
  const page = document.createElement('div');
  document.body.append(page);
  mounted = mount(PathMapView, { target: page, props: { app: m.app } });
  await settle();
  await vi.waitFor(() => expect(page.querySelector('[data-box="lib/ohm"]')).not.toBeNull());
  return { m, page };
}

const box = (page: HTMLElement, id: string) => page.querySelector<HTMLButtonElement>(`[data-box="${id}"]`);
const key = async (el: Element, k: string, init: KeyboardEventInit = {}) => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  await settle();
};

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

describe('PathMapView', () => {
  it('asks for the finished paths too, and draws each box with the stage the engine gave', async () => {
    const { m, page } = await show();
    expect(m.hub.pathCalls).toContain('paths include_done');
    expect(box(page, 'lib/grund')!.dataset.stage).toBe('done');
    expect(box(page, 'lib/ohm')!.dataset.stage).toBe('doing');
    expect(box(page, 'lib/gatter')!.dataset.stage).toBe('waiting');
    // the frame of each project, and the project's requirement drawn from frame to frame
    expect(page.querySelector('[data-frame="lib/basis"]')).not.toBeNull();
    // the title of an open project's frame opens the project, by the keyboard too (a stop of the Tab key)
    const title = page.querySelector<HTMLButtonElement>('[data-frame="lib/basis"] button.frame-title')!;
    expect(title.tabIndex).toBe(0);
    title.click();
    expect([m.app.view, m.app.projectChoice]).toEqual(['plan', 'lib/basis']);
    expect(page.querySelector('[data-edge="j:lib/basis>j:lib/oben"]')!.getAttribute('class')).toContain('hard');
    // a soft requirement not met: a hint on the box, a dashed arrow in the colour of an open one
    expect(box(page, 'lib/frei')!.querySelector('.hint')).not.toBeNull();
    expect(page.querySelector('[data-edge="p:lib/ohm>p:lib/frei"]')!.getAttribute('class')).toMatch(/soft.*warn/);
  });

  it('names a box by its stage, progress, what it needs and what it is a requirement for', async () => {
    const { page } = await show();
    expect(box(page, 'lib/ohm')!.getAttribute('aria-label')).toBe(
      'Ohm, läuft, 1 von 2 gelernt; braucht: Grundlagen (weich, erfüllt); Voraussetzung für: Frei (weich)',
    );
    // waiting through its project: on the requirement (Basis), not on its own project (Oben, the `via`)
    const gatter = box(page, 'lib/gatter')!.getAttribute('aria-label')!;
    expect(gatter).toContain('wartet auf Basis');
    expect(gatter).not.toContain('Oben');
  });

  it('draws an id of another vault and a broken entry as ghosts with their own words and a red arrow', async () => {
    const odd = entry('odd', 'Seltsam', {
      requires: [
        { id: 'work:lib/x', gate: 'hard', kind: 'foreign', met: false },
        { id: 'kein id', gate: 'soft', kind: 'bad', met: false },
      ],
    });
    const { page } = await show({ items: [...ITEMS, odd] });
    expect(box(page, 'work:lib/x')!.getAttribute('aria-label')).toBe('work:lib/x, aus einem anderen Vault');
    expect(box(page, 'kein id')!.getAttribute('aria-label')).toBe('kein id, kaputter Eintrag');
    expect(box(page, 'kein id')!.textContent).toContain('kaputter Eintrag');
    expect(page.querySelector('[data-edge="g:work:lib/x>p:lib/odd"]')!.getAttribute('class')).toContain('bad');
    // a broken soft entry is a fault, not a hint on the box
    expect(box(page, 'lib/odd')!.querySelector('.hint')).toBeNull();
  });

  it('an engine without requires: the plain paths, no arrows, and a note that says why', async () => {
    const { m, page } = await show({ requires: false });
    expect(m.hub.pathCalls).toContain('paths');
    expect(m.hub.pathCalls).not.toContain('paths include_done');
    expect(page.textContent).toContain('kennt keine Voraussetzungen');
  });

  it('the keys walk the chain; Space holds it, Esc lets go; f shows only the chain', async () => {
    const { page } = await show();
    const grund = box(page, 'lib/grund')!;
    // one stop of the Tab key: the first box in reading order
    expect([...page.querySelectorAll('button.box')].filter((b) => b.getAttribute('tabindex') === '0')).toHaveLength(1);
    grund.focus();
    await settle();
    await key(grund, 'ArrowRight');
    expect(document.activeElement).toBe(box(page, 'lib/ohm'));
    await key(document.activeElement!, 'ArrowLeft');
    expect(document.activeElement).toBe(box(page, 'lib/grund'));
    // Gatter builds on Grundlagen through its project (Oben needs Basis, which holds Ohm): one chain
    expect(box(page, 'lib/gatter')!.classList.contains('dim')).toBe(false);
    // the chain of Frei is Ohm and Grundlagen; Gatter is not in it and goes dim
    const frei = box(page, 'lib/frei')!;
    frei.focus();
    await settle();
    expect(box(page, 'lib/gatter')!.classList.contains('dim')).toBe(true);
    expect(box(page, 'lib/grund')!.classList.contains('dim')).toBe(false);
    grund.focus();
    await settle();
    await key(grund, ' ');
    expect(grund.getAttribute('aria-pressed')).toBe('true');
    await key(grund, 'Escape');
    expect(grund.getAttribute('aria-pressed')).toBeNull();
    await key(frei, 'f');
    expect(box(page, 'lib/gatter')).toBeNull();
    expect(box(page, 'lib/grund')).not.toBeNull();
    expect(document.activeElement).toBe(box(page, 'lib/frei'));
    await key(box(page, 'lib/frei')!, 'Escape');
    expect(box(page, 'lib/gatter')).not.toBeNull();
  });

  it('a box opens its path; a middle click opens it in a new tab', async () => {
    const opened: string[] = [];
    const { m, page } = await show({ openWindow: (r) => (opened.push(r), true) });
    box(page, 'lib/ohm')!.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }));
    expect(opened).toEqual(['#view=paths&path=lib%2Fohm']);
    expect(m.app.view).not.toBe('paths');
    box(page, 'lib/ohm')!.click();
    expect([m.app.view, m.app.pathChoice]).toEqual(['paths', 'lib/ohm']);
  });

  it('hides the finished ones and shows the list, and keeps both on the device', async () => {
    const prefs = new Map<string, string>();
    const { page } = await show({ prefs });
    const hide = page.querySelector<HTMLInputElement>('[data-pathmap-hide-done]')!;
    hide.click();
    await settle();
    expect(box(page, 'lib/grund')).toBeNull();
    // the arrow to a hidden one goes with it, no ghost comes in its place
    expect(page.querySelector('[data-edge="p:lib/grund>p:lib/ohm"]')).toBeNull();
    expect(page.querySelector('.box.ghost')).toBeNull();
    expect(prefs.get('tasks-desktop.pathmap-hide-done')).toBe('1');
    page.querySelector<HTMLInputElement>('input[value="list"]')!.click();
    await settle();
    expect(prefs.get('tasks-desktop.pathmap-mode')).toBe('list');
    const rows = [...page.querySelectorAll('[data-row]')].map((r) => r.getAttribute('data-row'));
    expect(rows.sort()).toEqual(['lib/frei', 'lib/gatter', 'lib/ohm']);
    expect(page.querySelector('[data-row="lib/ohm"]')!.textContent).toContain('Frei (weich)');
  });
  it('follows the area filter of the page: a filter of another area hides the map, said with a button that clears it', async () => {
    const { m, page } = await show();
    m.app.filter = { ...m.app.filter, areas: ['elsewhere'] };
    await settle();
    await vi.waitFor(() => expect(page.querySelector('.scope-note p')?.textContent).toBe('Der Bereichs-Filter (elsewhere) blendet die Lernpfade hier aus.'));
    const clear = page.querySelector<HTMLButtonElement>('.scope-note button')!;
    expect(clear.textContent).toBe('Filter aufheben');
    clear.click();
    await settle();
    expect(m.app.filter.areas).toEqual([]);
    await vi.waitFor(() => expect(page.querySelector('.scope-note')).toBeNull());
  });
});
