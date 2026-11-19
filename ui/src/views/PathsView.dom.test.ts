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

  it('a path that cannot be read says so and offers to try again', async () => {
    const { m, page } = await show();
    m.hub.pathDocs.delete('lib/lua');
    await m.app.refresh();
    m.app.writes += 1;
    await vi.waitFor(() => expect(page.querySelector('[role="alert"]')?.textContent).toContain('Dieser Pfad ließ sich nicht lesen.'));
  });
});
