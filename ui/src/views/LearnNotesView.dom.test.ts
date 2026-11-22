// @vitest-environment jsdom
// The view "Notes & sources" in a DOM: it asks the engine with the search text once typing pauses (and at once on
// Enter), with the kind and the path; narrows by competence and state itself; marks the hits; draws a note as text
// and whole through the Markdown reader (no markup of the note runs); opens a hit in the path; `/` finds the search.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import type { LearnNotes } from '../lib/contract';
import LearnNotesView from './LearnNotesView.svelte';

type Made = ReturnType<typeof make>;

const hit = (path: string, index: number, p: Partial<LearnNotes['items'][number]>) => ({
  path,
  area: path.split('/')[0],
  title: path === 'lib/lua' ? 'Lua lernen' : 'Shell',
  index,
  label: `point ${index}`,
  stage_index: 1,
  stage_label: 'Basics',
  state: 'open',
  ...p,
});

const ITEMS = [
  hit('lib/lua', 3, { key: 'meta', label: 'Metatables', note: 'Use __index for **inheritance**.\n\n<img src=x onerror="window.pwned=1">', state: 'learned' }),
  hit('lib/lua', 5, { label: '[Manual](https://www.lua.org/manual/5.4/)', link: 'https://www.lua.org/manual/5.4/' }),
  hit('ops/shell', 2, { label: 'Diagram', image: 'assets/images/pipes.png' }),
];

function notes(items = ITEMS): LearnNotes {
  return { kind: 'tasks.learn_notes', rev: 'r', digest: 'd', items, total: items.length, truncated: false, incomplete: [] } as unknown as LearnNotes;
}

const ENTRY = (id: string, title: string, competence?: string[]) => ({
  id,
  area: id.split('/')[0],
  title,
  progress: { learned: 0, seen: 0, dropped: 0, open: 1, blocked: 0, total: 1 },
  ...(competence ? { competence } : {}),
});

let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await tick();
    await Promise.resolve();
  }
  flushSync();
}

async function show(doc: LearnNotes | ((q: unknown) => LearnNotes) = notes()): Promise<{ m: Made; page: HTMLElement }> {
  const m = make({ token: 't' });
  made = m;
  m.hub.capabilities = null;
  m.hub.doc = snapshot([], 'rev:1');
  m.hub.learnDocs.learn_notes = doc;
  m.hub.learnDocs.competences = { kind: 'tasks.competences', items: [{ id: 'ALL/os', title: 'Betriebssysteme' }, { id: 'ALL/none', title: 'Unused' }] };
  m.hub.pathsDoc = { kind: 'tasks.paths', rev: 'p1', digest: 'd', items: [ENTRY('lib/lua', 'Lua lernen'), ENTRY('ops/shell', 'Shell', ['ALL/os'])], incomplete: [] };
  await m.app.start(null);
  await m.app.setLang('en');
  const page = document.createElement('div');
  document.body.append(page);
  mounted = mount(LearnNotesView, { target: page, props: { app: m.app } });
  await settle();
  return { m, page };
}

const hitsShown = (page: HTMLElement) => [...page.querySelectorAll<HTMLElement>('ul.hits > li')].map((li) => `${li.dataset['path']}${li.dataset['point']}`);
const notesAsked = (m: Made) => m.hub.learnQueries.filter(([name]) => name === 'learn_notes').map(([, q]) => q);
const select = (page: HTMLElement, label: string) =>
  [...page.querySelectorAll('label')].find((l) => l.textContent?.startsWith(label))!.querySelector<HTMLSelectElement>('select')!;
function choose(el: HTMLSelectElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

afterEach(() => {
  vi.useRealTimers();
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

describe('LearnNotesView', () => {
  it('lists every hit with path › stage › point, the link as domain and title, an image by its name', async () => {
    const { m, page } = await show();
    expect(notesAsked(m)).toEqual([{}]);
    expect(hitsShown(page)).toEqual(['lib/luameta', 'lib/lua#5', 'ops/shell#2']);
    const first = page.querySelector<HTMLElement>('ul.hits > li')!;
    expect(first.querySelector('button.open')?.getAttribute('aria-label')).toBe('Open in the path: Lua lernen › Basics › Metatables');
    const link = page.querySelectorAll<HTMLElement>('ul.hits > li')[1]!.querySelector<HTMLAnchorElement>('.source a')!;
    expect(link.textContent).toBe('www.lua.org — Manual');
    expect(link.rel).toContain('noreferrer');
    expect(page.querySelectorAll<HTMLElement>('ul.hits > li')[2]!.textContent).toContain('Image: pipes.png');
    expect(page.querySelector('.count')?.textContent?.trim()).toBe('3 hits');
  });

  it('draws a note as text, and whole through the Markdown reader, never its markup', async () => {
    const { page } = await show();
    const first = page.querySelector<HTMLElement>('ul.hits > li')!;
    expect(first.querySelector('.snippet')?.textContent).toContain('Use __index for **inheritance**.');
    expect(first.querySelector('img')).toBeNull();
    const more = [...first.querySelectorAll('button')].find((b) => b.textContent === 'more')!;
    expect(more.getAttribute('aria-expanded')).toBe('false');
    more.click();
    await settle();
    expect(first.querySelector('.whole strong')?.textContent).toBe('inheritance');
    expect(first.querySelector('.whole img')).toBeNull();
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
    expect(more.getAttribute('aria-expanded')).toBe('true');
  });

  it('asks the engine with the search once typing pauses, at once on Enter, and marks the hits', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { m, page } = await show((q) => notes((q as { q?: string }).q ? [ITEMS[0]!] : ITEMS));
    const input = page.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.value = 'met';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(notesAsked(m)).toEqual([{}]);
    vi.advanceTimersByTime(300);
    await settle();
    expect(notesAsked(m).at(-1)).toEqual({ q: 'met' });
    expect([...page.querySelectorAll('ul.hits mark')].map((x) => x.textContent)).toEqual(['Met']);
    input.value = 'Metatables';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    expect(notesAsked(m).at(-1)).toEqual({ q: 'Metatables' });
  });

  it('asks the engine for a kind, a path and the finished paths, as chosen', async () => {
    const { m, page } = await show();
    const link = [...page.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((r) => r.value === 'link')!;
    link.click();
    await settle();
    expect(notesAsked(m).at(-1)).toEqual({ kind: 'link' });
    choose(select(page, 'Path'), 'lib/lua');
    await settle();
    expect(notesAsked(m).at(-1)).toEqual({ kind: 'link', path: 'lib/lua' });
    page.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    await settle();
    expect(notesAsked(m).at(-1)).toEqual({ kind: 'link', path: 'lib/lua', include_done: true });
  });

  it('narrows by competence (the paths that serve it) and by state itself, offering only competences of a path', async () => {
    const { m, page } = await show();
    const competence = select(page, 'Competence');
    expect([...competence.options].map((o) => o.textContent)).toEqual(['All competences', 'Betriebssysteme']);
    const before = notesAsked(m).length;
    choose(competence, 'ALL/os');
    await settle();
    expect(hitsShown(page)).toEqual(['ops/shell#2']);
    choose(competence, '');
    choose(select(page, 'State'), 'learned');
    await settle();
    expect(hitsShown(page)).toEqual(['lib/luameta']);
    expect(notesAsked(m)).toHaveLength(before);
  });

  it('opens a hit at its point in the path', async () => {
    const { m, page } = await show();
    page.querySelectorAll<HTMLButtonElement>('button.open')[1]!.click();
    expect(m.app.view).toBe('paths');
    expect(m.app.pathChoice).toBe('lib/lua');
    expect(m.app.pathPoint).toBe('#5');
  });

  it('puts the focus into the search on /, but not while a field has the keys', async () => {
    const { page } = await show();
    const input = page.querySelector<HTMLInputElement>('input[type="search"]')!;
    const path = select(page, 'Path');
    path.focus();
    path.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(path);
    document.body.focus();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(input);
  });

  it('says when nothing matches, and how to begin when there are no notes at all', async () => {
    const { page } = await show((q) => notes((q as { q?: string }).q ? [] : []));
    expect(page.textContent).toContain('No notes yet.');
    const input = page.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.value = 'zzz';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    expect(page.textContent).toContain('Nothing matches "zzz".');
  });

  it('shows a small preview of an image hit, read from its path only as an image, larger on a click', async () => {
    vi.stubGlobal(
      'URL',
      Object.assign(globalThis.URL, { createObjectURL: () => 'blob:http://localhost/i1', revokeObjectURL: () => undefined }),
    );
    try {
      const m = make({ token: 't' });
      m.hub.assetAnswers.set('assets/images/pipes.png', new Blob(['png'], { type: 'image/png' }));
      made = m;
      m.hub.capabilities = null;
      m.hub.doc = snapshot([], 'rev:1');
      m.hub.learnDocs.learn_notes = notes();
      await m.app.start(null);
      await m.app.setLang('en');
      const page = document.createElement('div');
      document.body.append(page);
      mounted = mount(LearnNotesView, { target: page, props: { app: m.app } });
      await settle();
      await vi.waitFor(() => expect(page.querySelector('ul.hits img')).not.toBeNull());
      expect(m.hub.assetReads).toEqual(['path ops/shell assets/images/pipes.png']);
      const img = page.querySelector<HTMLImageElement>('ul.hits img')!;
      expect(img.getAttribute('src')).toBe('blob:http://localhost/i1');
      expect(img.alt).toBe('Diagram');
      img.closest('button')!.click();
      await settle();
      expect(document.querySelector('dialog img')?.getAttribute('src')).toBe('blob:http://localhost/i1');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not offer to open a hit of a finished path (the view of the paths has the open ones only)', async () => {
    const { m, page } = await show(notes([hit('lib/old', 1, { label: 'Done note', note: 'x', path_done: true })]));
    const li = page.querySelector<HTMLElement>('ul.hits > li')!;
    expect(li.querySelector('button.open')).toBeNull();
    expect(li.querySelector('.open.done')?.textContent).toContain('Done note');
    expect(li.textContent).toContain('finished path');
    expect(m.app.view).not.toBe('paths');
  });

  it('says a search that is too long for the engine instead of asking, counted in bytes', async () => {
    const { m, page } = await show();
    const input = page.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.value = 'ü'.repeat(101);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    expect(page.querySelector('[role="alert"]')?.textContent).toContain('The search is too long');
    expect(notesAsked(m).some((q) => (q as { q?: string }).q !== undefined)).toBe(false);
  });

  it('says a failed read once the hits were shown, and keeps them', async () => {
    const { m, page } = await show();
    m.hub.learnDocs.learn_notes = undefined;
    m.hub.doc = snapshot([], 'rev:2');
    await m.app.refresh();
    await settle();
    await vi.waitFor(() => expect(page.querySelector('.note[role="alert"]')?.textContent).toContain('The notes could not be read.'));
    expect(hitsShown(page)).toHaveLength(3);
  });

  it('says when the engine cut the list', async () => {
    const doc = { ...notes(), total: 345, truncated: true };
    const { page } = await show(doc as LearnNotes);
    expect(page.textContent).toContain('Showing 3 of 345: narrow the search to see the rest.');
  });
  it('keeps the filter lists of the newer read when an older answer comes late', async () => {
    const { m, page } = await show();
    const paths = (id: string, title: string) => ({ kind: 'tasks.paths', rev: 'p2', digest: 'd', items: [ENTRY(id, title, ['ALL/os'])], incomplete: [] });
    const competences = (title: string) => ({ kind: 'tasks.competences', items: [{ id: 'ALL/os', title }] });
    const optionTexts = (label: string) => [...select(page, label).querySelectorAll('option')].map((o) => o.textContent);
    // The lists are read again after a write; the answers to that read are held while a second write reads them anew.
    const held: (() => void)[] = [];
    m.hub.pathsGates.push(new Promise<void>((resolve) => held.push(resolve)));
    // the gates of the tab's reads go in the order asked: the notes first, then the competences
    m.hub.learnGates.push(new Promise<void>((resolve) => held.push(resolve)), new Promise<void>((resolve) => held.push(resolve)));
    m.hub.pathsDoc = paths('old/one', 'Old path');
    m.hub.learnDocs.competences = competences('Old competence');
    m.app.writes += 1;
    await settle();
    m.hub.pathsDoc = paths('new/one', 'New path');
    m.hub.learnDocs.competences = competences('New competence');
    m.app.writes += 1;
    await settle();
    await vi.waitFor(() => expect(optionTexts('Path')).toContain('New path'));
    expect(optionTexts('Competence')).toContain('New competence');
    // The answers to the first read come last: dropped, not drawn over the newer lists.
    for (const open of held) open();
    await settle();
    await settle();
    expect(optionTexts('Path')).toContain('New path');
    expect(optionTexts('Path')).not.toContain('Old path');
    expect(optionTexts('Competence')).toContain('New competence');
    expect(optionTexts('Competence')).not.toContain('Old competence');
  });
});
