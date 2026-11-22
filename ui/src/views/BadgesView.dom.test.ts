// @vitest-environment jsdom
// The badges in a DOM, with its effects running: it asks for the paths with all their levels (capability
// `paths_levels`), draws a tile per level, earned ones with the day of the series, open ones with what is missing, the
// next one of a path with its ring and percent; the filters and the grouping by date; a tile opens its detail below its
// group (Esc closes it, the focus back on the tile); the arrow keys walk the tiles as one stop of the Tab key. Reached,
// missing and the days come from the fixtures (the engine).
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import type { PathEntry, PathEntryLevel } from '../lib/contract';
import BadgesView from './BadgesView.svelte';

type Made = ReturnType<typeof make>;

Element.prototype.scrollIntoView ??= function () {};

const level = (over: Partial<PathEntryLevel> & { ref: string }): PathEntryLevel => ({ line: 1, kind: 'xp', given: false, reached: false, ...over });

function entry(slug: string, title: string, levels: PathEntryLevel[], extra: Partial<PathEntry> = {}): PathEntry {
  return {
    id: `lib/${slug}`,
    area: 'lib',
    slug,
    title,
    areas: ['lib'],
    summary: '',
    has_tree: true,
    points: 2,
    progress: { learned: 1, seen: 0, dropped: 0, open: 1, blocked: 0, total: 2 },
    file: `lib/ROADMAP/paths/${slug}.md`,
    valid: true,
    problems: [],
    stage: 'doing',
    levels,
    ...extra,
  };
}

const ITEMS: PathEntry[] = [
  entry('cli', 'CLI', [
    level({ ref: '1', number: 1, name: 'Erster Schritt', threshold: 10, reached: true, reached_on: '2026-11-03', reward: 'Eis', given: true, given_on: '2026-11-04' }),
    level({ ref: '2', number: 2, name: 'Halbzeit', threshold: 100, missing_xp: 40, reward: 'Kino' }),
    level({ ref: 'done', kind: 'done', missing_percent: 50 }),
  ]),
  entry('ohm', 'Ohm', [level({ ref: '1', number: 1, threshold: 5, reached: true })]),
  entry('leer', 'Ohne Level', []),
];

let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await tick();
    await Promise.resolve();
  }
  flushSync();
}

async function show(opts: { items?: PathEntry[]; caps?: string[]; game?: boolean } = {}) {
  const prefs = new Map<string, string>(opts.game === false ? [['tasks-desktop.gamification', 'off']] : []);
  const m = make({ token: 't', prefs });
  made = m;
  m.hub.capabilities = opts.caps ?? ['paths', 'path', 'xp', 'requires', 'paths_levels'];
  m.hub.doc = snapshot([], 'rev:1');
  m.hub.pathsDoc = { kind: 'tasks.paths', rev: 'p1', digest: 'd', items: opts.items ?? ITEMS, incomplete: [] };
  await m.app.start(null);
  m.app.setLang('en');
  const page = document.createElement('div');
  document.body.append(page);
  mounted = mount(BadgesView, { target: page, props: { app: m.app } });
  await settle();
  return { m, page };
}

const tile = (page: HTMLElement, key: string) => page.querySelector<HTMLButtonElement>(`[data-badge="${key}"]`);
const press = async (el: Element, k: string) => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  await settle();
};

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

describe('BadgesView', () => {
  it('asks for the levels of all paths and draws earned and open tiles with their words', async () => {
    const { m, page } = await show();
    await vi.waitFor(() => expect(tile(page, 'lib/cli#1')).not.toBeNull());
    expect(m.hub.pathCalls).toContain('paths include_done levels');
    expect(page.querySelector('[data-badges-count]')!.textContent).toBe('2 of 4 earned');
    const first = tile(page, 'lib/cli#1')!;
    expect(first.dataset.badgeState).toBe('earned');
    expect(first.textContent).toContain('Erster Schritt');
    expect(first.textContent).toContain('earned on 03/11');
    // the next one of the path: what is missing, and how far it is, in words
    const next = tile(page, 'lib/cli#2')!;
    expect(next.dataset.badgeState).toBe('open');
    expect(next.textContent).toContain('40 XP to go');
    expect(next.textContent).toContain('60 %');
    expect(next.querySelector('.ring')).not.toBeNull();
    expect(next.querySelector('.lock')).not.toBeNull();
    // only the next one has a ring; the line of the whole path says when it is reached
    expect(tile(page, 'lib/cli#done')!.querySelector('.ring')).toBeNull();
    expect(tile(page, 'lib/cli#done')!.textContent).toContain('Path finished');
    // without a day from the series: only "earned", and a note why
    expect(tile(page, 'lib/ohm#1')!.textContent).toContain('earned');
    expect(page.textContent).toContain('series of the learning figures');
    // a path without levels has no group
    expect(page.textContent).not.toContain('Ohne Level');
  });

  it('filters earned and open, and groups by date', async () => {
    const { page } = await show();
    await vi.waitFor(() => expect(tile(page, 'lib/cli#1')).not.toBeNull());
    page.querySelector<HTMLInputElement>('[data-badges-filter="open"]')!.click();
    await settle();
    expect(tile(page, 'lib/cli#1')).toBeNull();
    expect(tile(page, 'lib/cli#2')).not.toBeNull();
    page.querySelector<HTMLInputElement>('[data-badges-filter="all"]')!.click();
    page.querySelector<HTMLInputElement>('[data-badges-group="date"]')!.click();
    await settle();
    const headings = [...page.querySelectorAll('h3')].map((h) => h.textContent?.trim());
    expect(headings).toEqual(['November 2026', 'Earned, day not known', 'Open']);
    // grouped by date, a tile names its path
    expect(tile(page, 'lib/cli#1')!.textContent).toContain('CLI');
  });

  it('opens a detail with threshold and reward below its group; Esc closes it and gives the focus back', async () => {
    const { m, page } = await show();
    await vi.waitFor(() => expect(tile(page, 'lib/cli#2')).not.toBeNull());
    const next = tile(page, 'lib/cli#2')!;
    next.click();
    await settle();
    expect(next.getAttribute('aria-expanded')).toBe('true');
    const detail = page.querySelector<HTMLElement>('[data-badge-detail]')!;
    expect(next.getAttribute('aria-controls')).toBe(detail.id);
    expect(detail.textContent).toContain('Badge Halbzeit');
    expect(detail.textContent).toContain('100 XP');
    expect(detail.querySelector('[data-badge-reward]')!.textContent).toContain('Kino');
    expect(detail.querySelector('[data-badge-reward]')!.textContent).toContain('not granted yet');
    await press(detail.querySelector('button')!, 'Escape');
    expect(page.querySelector('[data-badge-detail]')).toBeNull();
    expect(document.activeElement).toBe(tile(page, 'lib/cli#2'));
    // a granted reward says the day it was granted; the path opens from the detail
    tile(page, 'lib/cli#1')!.click();
    await settle();
    expect(page.querySelector('[data-badge-reward]')!.textContent).toContain('granted on 4 November 2026');
    page.querySelector<HTMLButtonElement>('[data-badge-open-path]')!.click();
    expect([m.app.view, m.app.pathChoice]).toEqual(['paths', 'lib/cli']);
  });

  it('is one stop of the Tab key; the arrow keys, Home and End walk the tiles', async () => {
    const { page } = await show();
    await vi.waitFor(() => expect(tile(page, 'lib/cli#1')).not.toBeNull());
    const stops = [...page.querySelectorAll<HTMLButtonElement>('[data-badge]')].filter((b) => b.tabIndex === 0);
    expect(stops.map((b) => b.dataset.badge)).toEqual(['lib/cli#1']);
    tile(page, 'lib/cli#1')!.focus();
    await press(tile(page, 'lib/cli#1')!, 'ArrowRight');
    expect(document.activeElement).toBe(tile(page, 'lib/cli#2'));
    expect(tile(page, 'lib/cli#2')!.tabIndex).toBe(0);
    expect(tile(page, 'lib/cli#1')!.tabIndex).toBe(-1);
    await press(tile(page, 'lib/cli#2')!, 'End');
    expect(document.activeElement).toBe(tile(page, 'lib/ohm#1'));
    await press(tile(page, 'lib/ohm#1')!, 'Home');
    expect(document.activeElement).toBe(tile(page, 'lib/cli#1'));
  });

  it('shows how to begin without levels, and says why without the game or an engine that gives no levels', async () => {
    const empty = await show({ items: [entry('leer', 'Leer', [])] });
    await vi.waitFor(() => expect(empty.page.querySelector('[data-badges-empty]')).not.toBeNull());
    expect(empty.page.textContent).toContain('## Level');
    void unmount(mounted!);
    mounted = undefined;
    made!.app.stop();
    document.body.replaceChildren();

    const off = await show({ game: false });
    expect(off.page.textContent).toContain('switch on XP and levels');
    expect(off.m.hub.pathCalls).not.toContain('paths include_done levels');
    void unmount(mounted!);
    mounted = undefined;
    made!.app.stop();
    document.body.replaceChildren();

    const old = await show({ caps: ['paths', 'path', 'xp'] });
    expect(old.page.textContent).toContain('capability paths_levels');
    expect(old.m.hub.pathCalls).toEqual([]);
  });
  it('follows the area filter of the page: a filter of another area hides the badges, said with a button that clears it', async () => {
    const { m, page } = await show();
    m.app.filter = { ...m.app.filter, areas: ['elsewhere'] };
    await settle();
    await vi.waitFor(() => expect(page.querySelector('.scope-note p')?.textContent).toBe('The area filter (elsewhere) hides the learning paths here.'));
    expect(tile(page, 'lib/cli#1')).toBeNull();
    const clear = page.querySelector<HTMLButtonElement>('.scope-note button')!;
    expect(clear.textContent).toBe('Clear filter');
    clear.click();
    await settle();
    expect(m.app.filter.areas).toEqual([]);
    await vi.waitFor(() => expect(page.querySelector('.scope-note')).toBeNull());
    expect(tile(page, 'lib/cli#1')).not.toBeNull();
  });
});
