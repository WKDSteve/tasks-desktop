// @vitest-environment jsdom
// The view of the learning paths in a DOM, with its effects running: it reads the paths and the chosen path, sends what
// the person chose as the engine's operation (on the version read), asks for a reason before it sends one that needs it,
// says a conflict and reads the path again after every write. The rules (states, progress, promote) are the engine's.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import type { PathDocument, PathNode, PathProgress, Result } from '../lib/contract';
import { task } from '../lib/fixtures';
import PathsView from './PathsView.svelte';

type Made = ReturnType<typeof make>;

const progress = (p: Partial<PathProgress> = {}): PathProgress => ({ learned: 0, seen: 0, dropped: 0, open: 0, blocked: 0, total: 0, ...p });

function node(index: number, n: Partial<PathNode>): PathNode {
  return {
    index,
    line: index + 10,
    depth: 0,
    children: 0,
    mark: '[ ]',
    state: 'open',
    derived: 'open',
    closed: false,
    label: `point ${index}`,
    progress: progress({ open: 1, total: 1 }),
    ...n,
  };
}

const ENTRY = {
  id: 'lib/lua',
  area: 'lib',
  slug: 'lua',
  title: 'Lua lernen',
  areas: [],
  summary: '',
  has_tree: true,
  points: 5,
  progress: progress({ learned: 1, seen: 0, dropped: 0, open: 2, total: 3 }),
  file: 'lib/ROADMAP/paths/lua.md',
  etag: 'e1',
  valid: true,
  problems: [],
};

function doc(etag = 'e1', nodes?: PathNode[]): PathDocument {
  return {
    kind: 'tasks.path',
    rev: 'r',
    digest: 'd',
    path: { ...ENTRY, etag },
    body: '',
    body_truncated: false,
    nodes: nodes ?? [
      node(1, { key: 'lua', children: 3, state: undefined, mark: '', derived: 'partial', progress: progress({ learned: 1, open: 2, total: 3 }) }),
      node(2, { key: 'manual', parent: 1, depth: 1, mark: '[x]', state: 'learned', derived: 'learned', closed: true, label: '[Manual](https://www.lua.org/manual/5.4/)', link: 'https://www.lua.org/manual/5.4/', note: 'Rangfolge merken' }),
      node(3, { key: 'meta', parent: 1, depth: 1 }),
      node(4, { key: 'cc', parent: 1, depth: 1, state: undefined, derived: 'open', promoted: 'lib/c-compiler' }),
    ],
    progress: progress({ learned: 1, open: 2, total: 3 }),
    tree_problems: [],
  } as unknown as PathDocument;
}

/** The path after another program added a parent with one point above everything: every index moves by two. */
function shifted(): PathDocument {
  const moved = doc().nodes.map((n) => ({ ...n, index: n.index + 2, line: n.line + 2, ...(n.parent !== undefined ? { parent: n.parent + 2 } : {}) }));
  return doc('e2', [
    node(1, { key: 'intro2', children: 1, state: undefined, mark: '', derived: 'open' }),
    node(2, { key: 'under', parent: 1, depth: 1 }),
    ...moved,
  ]);
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

async function show(): Promise<{ m: Made; page: HTMLElement }> {
  const m = make({ token: 't' });
  made = m;
  m.hub.capabilities = null;
  m.hub.doc = snapshot([task('lib/c-compiler', { status: 'doing' })], 'rev:1');
  m.hub.pathsDoc = { kind: 'tasks.paths', rev: 'p1', digest: 'd', items: [ENTRY], incomplete: [] };
  m.hub.pathDocs.set('lib/lua', doc());
  await m.app.start(null);
  const page = document.createElement('div');
  document.body.append(page);
  mounted = mount(PathsView, { target: page, props: { app: m.app } });
  await settle();
  await vi.waitFor(() => expect(page.querySelector('[data-point="manual"]')).not.toBeNull());
  return { m, page };
}

const point = (page: HTMLElement, key: string) => page.querySelector<HTMLElement>(`[data-point="${key}"]`)!;
const sentOps = (m: Made) => m.hub.sent.flatMap((r) => r.ops);

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

describe('PathsView', () => {
  it('chooses the first path, draws the tree, and the parent and the promoted point have no mark to click', async () => {
    const { m, page } = await show();
    expect(m.app.pathChoice).toBe('lib/lua');
    expect(m.hub.pathCalls).toContain('path lib/lua');
    expect(point(page, 'lua').querySelector('button.mark')).toBeNull();
    expect(point(page, 'cc').querySelector('button.mark')).toBeNull();
    expect(point(page, 'meta').querySelector('button.mark')).not.toBeNull();
    // The link opens in a new tab without a referrer; its text is the link's text, not the Markdown.
    const link = point(page, 'manual').querySelector<HTMLAnchorElement>('a')!;
    expect(link.textContent).toBe('Manual');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noreferrer');
    expect(point(page, 'manual').querySelector('.note')?.textContent).toBe('Rangfolge merken');
    // The promoted point shows its task and the task's status from the list.
    expect(point(page, 'cc').querySelector('.promoted')?.textContent).toContain('lib/c-compiler');
  });

  it('shows a point another view asks for: its parent unfolds, it takes the focus, and the wish is forgotten', async () => {
    // jsdom has no layout: the scroll is only counted.
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    const { m, page } = await show();
    point(page, 'lua').querySelector<HTMLButtonElement>('button.fold')!.click();
    await settle();
    expect(page.querySelector('[data-point="meta"]')).toBeNull();
    m.app.openPath('lib/lua', 'meta');
    await settle();
    await vi.waitFor(() => expect(document.activeElement?.closest('[data-point]')?.getAttribute('data-point')).toBe('meta'));
    expect(m.app.pathPoint).toBeNull();
    expect(scrolled).toHaveBeenCalledWith({ block: 'center' });
    // A point the path does not have is forgotten all the same, nothing else moves.
    m.app.openPath('lib/lua', 'gone');
    await settle();
    expect(m.app.pathPoint).toBeNull();
  });

  it('focuses the asked point also when the path is read before the list of the paths (the tree waits for that list)', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const m = make({ token: 't' });
    made = m;
    m.hub.capabilities = null;
    m.hub.doc = snapshot([task('lib/c-compiler', { status: 'doing' })], 'rev:1');
    m.hub.pathsDoc = { kind: 'tasks.paths', rev: 'p1', digest: 'd', items: [ENTRY], incomplete: [] };
    m.hub.pathDocs.set('lib/lua', doc());
    // Under load the answer of the list came after the path's (seen in e2e/learn-steps.spec.ts, "Enter opens the point").
    let listGo!: () => void;
    m.hub.pathsGates.push(new Promise<void>((resolve) => (listGo = resolve)));
    await m.app.start(null);
    m.app.openPath('lib/lua', 'meta');
    const page = document.createElement('div');
    document.body.append(page);
    mounted = mount(PathsView, { target: page, props: { app: m.app } });
    await settle();
    expect(m.hub.pathCalls).toContain('path lib/lua');
    expect(page.querySelector('[data-point="meta"]')).toBeNull();
    listGo();
    await settle();
    await vi.waitFor(() => expect(document.activeElement?.closest('[data-point]')?.getAttribute('data-point')).toBe('meta'));
    expect(m.app.pathPoint).toBeNull();
  });

  it('asks before it closes a point under {safety}, sends ack only after yes, and cancel sends nothing', async () => {
    const { m, page } = await show();
    const safe = doc('e1', [
      node(1, { key: 'lua', children: 2, state: undefined, mark: '', derived: 'open', progress: progress({ open: 2, total: 2 }) }),
      node(2, { key: 'drv', parent: 1, depth: 1, safety: true, label: 'Load a driver' }),
      node(3, { key: 'plain', parent: 1, depth: 1 }),
    ]);
    m.hub.pathDocs.set('lib/lua', safe);
    m.app.writes += 1;
    await settle();
    await vi.waitFor(() => expect(page.querySelector('[data-point="drv"]')).not.toBeNull());
    expect(point(page, 'drv').querySelector('.safety-point')?.textContent).toContain('Sicherheit');
    point(page, 'drv').querySelector<HTMLButtonElement>('button.mark')!.click();
    await settle();
    const ask = point(page, 'drv').querySelector<HTMLElement>('.safety-ask')!;
    expect(ask.textContent).toContain('Load a driver betrifft die Sicherheit. Als gelernt markieren?');
    await vi.waitFor(() => expect(document.activeElement?.id).toBe('safety-no-2'));
    expect(sentOps(m)).toEqual([]);
    [...ask.querySelectorAll('button')].find((b) => b.textContent === 'Abbrechen')!.click();
    await settle();
    expect(point(page, 'drv').querySelector('.safety-ask')).toBeNull();
    expect(sentOps(m)).toEqual([]);
    point(page, 'drv').querySelector<HTMLButtonElement>('button.mark')!.click();
    await settle();
    [...point(page, 'drv').querySelectorAll('.safety-ask button')].find((b) => b.textContent === 'Ja, markieren')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(sentOps(m)).toEqual([{ op: 'node_set', id: 'lib/lua', point: 'drv', state: 'learned', ack: true, if_match: 'e1' }]);
    // A point without the mark is ticked at once, without ack.
    point(page, 'plain').querySelector<HTMLButtonElement>('button.mark')!.click();
    await settle();
    expect(sentOps(m).at(-1)).toEqual({ op: 'node_set', id: 'lib/lua', point: 'plain', state: 'learned', if_match: 'e1' });
  });

  it('folds a parent: its points go, and come back', async () => {
    const { page } = await show();
    const fold = point(page, 'lua').querySelector<HTMLButtonElement>('button.fold')!;
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    fold.click();
    await settle();
    expect(page.querySelector('[data-point="manual"]')).toBeNull();
    expect(point(page, 'lua').querySelector('button.fold')?.getAttribute('aria-expanded')).toBe('false');
    point(page, 'lua').querySelector<HTMLButtonElement>('button.fold')!.click();
    await settle();
    expect(page.querySelector('[data-point="manual"]')).not.toBeNull();
  });

  it('a click on the mark ticks the point learned on the version read, and the path is read again', async () => {
    const { m, page } = await show();
    const before = m.hub.pathCalls.length;
    point(page, 'meta').querySelector<HTMLButtonElement>('button.mark')!.click();
    await vi.waitFor(() => expect(sentOps(m)).toEqual([{ op: 'node_set', id: 'lib/lua', point: 'meta', state: 'learned', if_match: 'e1' }]));
    await vi.waitFor(() => expect(m.hub.pathCalls.length).toBeGreaterThan(before));
  });

  it('seen asks for a reason first: without one nothing is sent, with one it is', async () => {
    const { m, page } = await show();
    const menu = point(page, 'meta').querySelector<HTMLElement>('[data-choice="point"]')!;
    menu.querySelector<HTMLElement>('summary')!.click();
    await settle();
    const seen = [...menu.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Angeschaut'))!;
    seen.click();
    await settle();
    const form = point(page, 'meta').querySelector<HTMLFormElement>('form.edit')!;
    expect(form).not.toBeNull();
    form.requestSubmit();
    await settle();
    expect(sentOps(m)).toEqual([]);
    expect(point(page, 'meta').querySelector('[role="alert"]')?.textContent).toBe('Ein Grund ist nötig.');
    const input = form.querySelector<HTMLInputElement>('input')!;
    input.value = '  nur Kap. 1 ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    form.requestSubmit();
    await vi.waitFor(() =>
      expect(sentOps(m)).toEqual([{ op: 'node_set', id: 'lib/lua', point: 'meta', state: 'seen', reason: 'nur Kap. 1', if_match: 'e1' }]),
    );
  });

  it('a note is written with node_set on the version read', async () => {
    const { m, page } = await show();
    const menu = point(page, 'manual').querySelector<HTMLElement>('[data-choice="point"]')!;
    menu.querySelector<HTMLElement>('summary')!.click();
    await settle();
    [...menu.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Notiz bearbeiten'))!.click();
    await settle();
    const form = point(page, 'manual').querySelector<HTMLFormElement>('form.edit')!;
    const area = form.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(area.value).toBe('Rangfolge merken');
    area.value = 'Rangfolge merken\r\nund ^';
    area.dispatchEvent(new Event('input', { bubbles: true }));
    form.requestSubmit();
    await vi.waitFor(() =>
      expect(sentOps(m)).toEqual([{ op: 'node_set', id: 'lib/lua', point: 'manual', note: 'Rangfolge merken\nund ^', if_match: 'e1' }]),
    );
  });

  it('a conflict is said under the tree, and the path is read again', async () => {
    const { m, page } = await show();
    m.hub.next_ops = {
      kind: 'tasks.result',
      ok: false,
      dry_run: false,
      results: [{ n: 1, op: 'failed', ok: false, error: { code: 'conflict', message: 'etag' } }],
    } as unknown as Result;
    m.hub.pathDocs.set('lib/lua', doc('e2'));
    point(page, 'meta').querySelector<HTMLButtonElement>('button.mark')!.click();
    await vi.waitFor(() => expect(page.querySelector('p.conflict')).not.toBeNull());
    // The next change goes on the version read after the conflict.
    await vi.waitFor(() => expect(m.app.saving).toBe(false));
    await settle();
    point(page, 'meta').querySelector<HTMLButtonElement>('button.mark')!.click();
    await vi.waitFor(() => expect(sentOps(m).at(-1)).toMatchObject({ op: 'node_set', point: 'meta', if_match: 'e2' }));
  });

  it('promote makes a task of the point and opens it', async () => {
    const { m, page } = await show();
    m.hub.next_ops = {
      kind: 'tasks.result',
      ok: true,
      dry_run: false,
      results: [{ n: 1, op: 'new', ok: true, id: 'lib/c-compiler', outcome: 'created' }],
    } as unknown as Result;
    const menu = point(page, 'meta').querySelector<HTMLElement>('[data-choice="point"]')!;
    menu.querySelector<HTMLElement>('summary')!.click();
    await settle();
    [...menu.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('eigene Task'))!.click();
    await vi.waitFor(() => expect(sentOps(m)).toEqual([{ op: 'promote', container: 'lib/lua', point: 'meta', if_match: 'e1' }]));
    await vi.waitFor(() => expect(m.app.selectedId).toBe('lib/c-compiler'));
    expect(m.app.view).toBe('list');
  });

  it('a tick while the path is read again after a write is refused and said, not sent on the old version', async () => {
    const { m, page } = await show();
    let release!: () => void;
    m.hub.pathGates.push(new Promise<void>((resolve) => (release = resolve)));
    m.hub.pathDocs.set('lib/lua', doc('e2'));
    point(page, 'meta').querySelector<HTMLButtonElement>('button.mark')!.click();
    await vi.waitFor(() => expect(sentOps(m)).toHaveLength(1));
    // The write is answered, the path is still being read: the tree on screen is the one from before the write.
    await vi.waitFor(() => expect(m.app.saving).toBe(false));
    await settle();
    const mark = point(page, 'manual').querySelector<HTMLButtonElement>('button.mark')!;
    expect(mark.getAttribute('aria-disabled')).toBe('true');
    mark.click();
    await settle();
    expect(sentOps(m)).toHaveLength(1);
    // Said as what it is: the write is done, the path is being read again.
    expect(m.app.toast).toMatchObject({ kind: 'error', text: 'Der Pfad wird noch gelesen - gleich noch einmal versuchen.' });
    release();
    await vi.waitFor(() => expect(point(page, 'manual').querySelector('button.mark')?.getAttribute('aria-disabled')).toBeNull());
    point(page, 'manual').querySelector<HTMLButtonElement>('button.mark')!.click();
    await vi.waitFor(() => expect(sentOps(m).at(-1)).toMatchObject({ op: 'node_set', point: 'manual', state: 'open', if_match: 'e2' }));
  });

  it('the mark is never disabled while a write is on its way, so it keeps the focus', async () => {
    const { m, page } = await show();
    let release!: () => void;
    m.hub.holdOps = new Promise<void>((resolve) => (release = resolve));
    const mark = point(page, 'meta').querySelector<HTMLButtonElement>('button.mark')!;
    mark.focus();
    mark.click();
    await vi.waitFor(() => expect(m.app.saving).toBe(true));
    await settle();
    expect(mark.disabled).toBe(false);
    expect(mark.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(mark);
    // A second click while the write is on its way is refused as such.
    mark.click();
    await settle();
    expect(m.hub.sent).toHaveLength(1);
    expect(m.app.toast).toMatchObject({ kind: 'error', text: 'Speichert noch - gleich noch einmal versuchen.' });
    release();
    m.hub.holdOps = null;
    await vi.waitFor(() => expect(m.app.saving).toBe(false));
  });

  it('a note being written stays open with what is typed when the path is read again after a change elsewhere', async () => {
    const { m, page } = await show();
    const menu = point(page, 'manual').querySelector<HTMLElement>('[data-choice="point"]')!;
    menu.querySelector<HTMLElement>('summary')!.click();
    await settle();
    [...menu.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Notiz bearbeiten'))!.click();
    await settle();
    const area = point(page, 'manual').querySelector<HTMLTextAreaElement>('textarea')!;
    area.value = 'halb getippt';
    area.dispatchEvent(new Event('input', { bubbles: true }));
    // Another program adds a point above: every index moves by one.
    m.hub.pathDocs.set('lib/lua', shifted());
    const before = m.hub.pathCalls.length;
    m.app.writes += 1;
    await vi.waitFor(() => expect(m.hub.pathCalls.length).toBeGreaterThan(before));
    await vi.waitFor(() => expect(page.querySelector('[data-point="intro2"]')).not.toBeNull());
    expect(point(page, 'manual').querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('halb getippt');
    // The point is gone after the next change: the field closes and that is said.
    m.hub.pathDocs.set('lib/lua', doc('e3', doc().nodes.filter((n) => n.key !== 'manual').map((n) => (n.key === 'lua' ? { ...n, children: 2 } : n))));
    m.app.writes += 1;
    await vi.waitFor(() => expect(page.querySelector('[data-point="manual"]')).toBeNull());
    expect(page.querySelector('textarea')).toBeNull();
    expect(m.app.toast).toMatchObject({ kind: 'error' });
    expect(m.app.toast?.text).toContain('Der Pfad hat sich inzwischen geändert');
  });

  it('closing the field (Escape, cancel, save) gives the focus back to the menu of its point', async () => {
    const { m, page } = await show();
    const openNote = async (): Promise<HTMLTextAreaElement> => {
      const menu = point(page, 'manual').querySelector<HTMLElement>('[data-choice="point"]')!;
      menu.querySelector<HTMLElement>('summary')!.click();
      await settle();
      [...menu.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Notiz bearbeiten'))!.click();
      await settle();
      return point(page, 'manual').querySelector<HTMLTextAreaElement>('textarea')!;
    };
    const summary = () => point(page, 'manual').querySelector<HTMLElement>('[data-choice="point"] summary');
    let area = await openNote();
    area.focus();
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(page.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(summary());
    area = await openNote();
    [...point(page, 'manual').querySelectorAll<HTMLButtonElement>('form button')].find((b) => b.type === 'button')!.click();
    await settle();
    expect(document.activeElement).toBe(summary());
    area = await openNote();
    area.value = 'neu';
    area.dispatchEvent(new Event('input', { bubbles: true }));
    point(page, 'manual').querySelector<HTMLFormElement>('form.edit')!.requestSubmit();
    await settle();
    expect(document.activeElement).toBe(summary());
    await vi.waitFor(() => expect(sentOps(m)).toHaveLength(1));
  });

  it('text of the vault shows the characters that hide or reorder text, and a link names its host', async () => {
    const m = make({ token: 't' });
    made = m;
    const rlo = String.fromCodePoint(0x202e);
    m.hub.capabilities = null;
    m.hub.doc = snapshot([], 'rev:1');
    m.hub.pathsDoc = { kind: 'tasks.paths', rev: 'p1', digest: 'd', items: [{ ...ENTRY, title: `Lua${rlo}txt` }], incomplete: [] };
    const nodes = doc().nodes.map((n) =>
      n.key === 'meta' ? { ...n, label: `meta${rlo}fdp.exe`, reason: `weil${rlo}x`, state: 'seen' as const, derived: 'seen' as const } : n.key === 'manual' ? { ...n, note: `Notiz${rlo}` } : n,
    );
    m.hub.pathDocs.set('lib/lua', { ...doc('e1', nodes), path: { ...ENTRY, title: `Lua${rlo}txt`, summary: `kurz${rlo}` } });
    await m.app.start(null);
    const page = document.createElement('div');
    document.body.append(page);
    mounted = mount(PathsView, { target: page, props: { app: m.app } });
    await settle();
    await vi.waitFor(() => expect(page.querySelector('[data-point="meta"]')).not.toBeNull());
    const shown = page.textContent ?? '';
    expect(shown).not.toContain(rlo);
    expect(shown).toContain('meta⟦U+202E⟧fdp.exe');
    expect(shown).toContain('Lua⟦U+202E⟧txt');
    expect(shown).toContain('kurz⟦U+202E⟧');
    expect(shown).toContain('weil⟦U+202E⟧x');
    expect(shown).toContain('Notiz⟦U+202E⟧');
    const labels = [...page.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label') ?? '');
    expect(labels.some((l) => l.includes(rlo))).toBe(false);
    expect(point(page, 'manual').querySelector('.host')?.textContent).toBe(' (www.lua.org)');
  });

  it('a folded point stays folded when a point is added above it, and no other point is folded instead', async () => {
    const { m, page } = await show();
    point(page, 'lua').querySelector<HTMLButtonElement>('button.fold')!.click();
    await settle();
    expect(page.querySelector('[data-point="manual"]')).toBeNull();
    m.hub.pathDocs.set('lib/lua', shifted());
    m.app.writes += 1;
    await vi.waitFor(() => expect(page.querySelector('[data-point="intro2"]')).not.toBeNull());
    expect(point(page, 'lua').querySelector('button.fold')?.getAttribute('aria-expanded')).toBe('false');
    expect(page.querySelector('[data-point="manual"]')).toBeNull();
    expect(point(page, 'intro2').querySelector('button.fold')?.getAttribute('aria-expanded')).toBe('true');
    expect(page.querySelector('[data-point="under"]')).not.toBeNull();
  });

  it('a path that cannot be read says so and offers to try again', async () => {
    const { m, page } = await show();
    m.hub.pathDocs.delete('lib/lua');
    await m.app.refresh();
    m.app.writes += 1;
    await vi.waitFor(() => expect(page.querySelector('[role="alert"]')?.textContent).toContain('Dieser Pfad ließ sich nicht lesen.'));
  });
  it('follows the area filter of the page: a filter of another area hides the paths, said with a button that clears it', async () => {
    const { m, page } = await show();
    m.app.filter = { ...m.app.filter, areas: ['elsewhere'] };
    await settle();
    await vi.waitFor(() => expect(page.querySelector('.scope-note p')?.textContent).toBe('Der Bereichs-Filter (elsewhere) blendet die Lernpfade hier aus.'));
    expect(page.querySelector('button.pick')).toBeNull();
    const clear = page.querySelector<HTMLButtonElement>('.scope-note button')!;
    expect(clear.textContent).toBe('Filter aufheben');
    clear.click();
    await settle();
    expect(m.app.filter.areas).toEqual([]);
    await vi.waitFor(() => expect(page.querySelector('.scope-note')).toBeNull());
    expect(page.querySelector('button.pick[data-path="lib/lua"]')).not.toBeNull();
  });
  it('keeps a path opened on purpose that the area filter hides, and shows the paths of the filter beside it', async () => {
    const { m, page } = await show();
    const shell = { ...ENTRY, id: 'ops/sh', area: 'ops', slug: 'sh', title: 'Shell', file: 'ops/ROADMAP/paths/sh.md' };
    m.hub.pathsDoc = { kind: 'tasks.paths', rev: 'p2', digest: 'd', items: [ENTRY, shell], incomplete: [] };
    m.hub.pathDocs.set('ops/sh', { ...doc(), path: shell });
    m.app.filter = { ...m.app.filter, areas: ['ops'] };
    m.hub.doc = snapshot([task('lib/c-compiler', { status: 'doing' })], 'rev:2');
    await m.app.refresh();
    await settle();
    // the path chosen before, of another area, is not taken away
    expect(m.app.pathChoice).toBe('lib/lua');
    expect([...page.querySelectorAll<HTMLElement>('button.pick')].map((b) => b.dataset['path'])).toEqual(['ops/sh']);
    m.app.openPath('lib/lua');
    await settle();
    expect(m.app.pathChoice).toBe('lib/lua');
  });
});
