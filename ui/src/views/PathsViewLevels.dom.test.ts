// @vitest-environment jsdom
// The levels of a path set in the view (capability `path_levels`): the form, loaded when opened, filled with the levels
// the engine read, sent as one `path_levels` on the version read and closed when written; a threshold that is no whole
// number said and not sent; the badges offered from the path's `assets/badges/`; the XP of a promoted task set with
// `set` on the task (not `node_set`); and none of it with the switch off.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import type { PathDocument, PathEntry, PathNode, PathProgress } from '../lib/contract';
import { task } from '../lib/fixtures';
import PathsView from './PathsView.svelte';

type Made = ReturnType<typeof make>;

const progress = (p: Partial<PathProgress> = {}): PathProgress => ({ learned: 0, seen: 0, dropped: 0, open: 0, blocked: 0, total: 0, ...p });

function node(index: number, n: Partial<PathNode>): PathNode {
  return {
    index,
    line: index + 10,
    depth: 1,
    parent: 1,
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

type Level = NonNullable<PathEntry['level']>;
const LEVEL1: Level = { level: 1, name: 'Einsteiger', percent: 22, finished: false, next: { number: 2, missing_xp: 40 }, open_rewards: [{ ref: '1', reward: 'Eis' }] };
const LEVEL2: Level = { level: 2, name: 'Profi', percent: 77, finished: false, open_rewards: [{ ref: '1', reward: 'Eis' }, { ref: '2', reward: 'Kino' }] };

function entry(level: Level): PathEntry {
  return {
    id: 'lib/lua',
    area: 'lib',
    slug: 'lua',
    title: 'Lua lernen',
    areas: [],
    summary: '',
    has_tree: true,
    points: 5,
    progress: progress({ learned: 1, open: 3, total: 4 }),
    xp: { earned: 20, possible: 90, open: 70, points: 3, missing: 1 },
    level,
    file: 'lib/ROADMAP/paths/lua.md',
    etag: 'e1',
    valid: true,
    problems: [],
  };
}

function doc(level: Level = LEVEL1, etag = 'e1'): PathDocument {
  return {
    kind: 'tasks.path',
    rev: 'r',
    digest: 'd',
    path: { ...entry(level), etag },
    body: '',
    body_truncated: false,
    nodes: [
      node(1, { key: 'lua', depth: 0, parent: undefined, children: 4, state: undefined, mark: '', derived: 'partial', progress: progress({ learned: 1, open: 3, total: 4 }) }),
      node(2, { key: 'syntax', mark: '[x]', state: 'learned', derived: 'learned', closed: true, xp: 20, xp_from: 'point' }),
      node(3, { key: 'tables', xp: 30, xp_from: 'point' }),
      node(4, { key: 'cc', state: undefined, promoted: 'lib/c-compiler', xp: 40, xp_from: 'task' }),
      node(5, { key: 'none', xp_suggest: 15 }),
    ],
    progress: progress({ learned: 1, open: 3, total: 4 }),
    xp: { earned: 20, possible: 90, open: 70, points: 3, missing: 1 },
    levels: [
      { ref: '1', number: 1, line: 20, kind: 'xp', threshold: 20, name: 'Einsteiger', reward: 'Eis', given: false, reached: true },
      { ref: '2', number: 2, line: 21, kind: 'xp', threshold: 60, name: 'Profi', reward: 'Kino', given: false, reached: level.level >= 2 },
    ],
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

async function show(prefs?: Map<string, string>, d: PathDocument = doc()): Promise<{ m: Made; page: HTMLElement }> {
  const m = make({ token: 't', ...(prefs ? { prefs } : {}) });
  made = m;
  m.hub.capabilities = null;
  m.hub.doc = snapshot([task('lib/c-compiler', { status: 'doing', xp: 40, etag: 'tc1' })], 'rev:1');
  m.hub.pathsDoc = { kind: 'tasks.paths', rev: 'p1', digest: 'd', items: [entry(LEVEL1)], incomplete: [] };
  m.hub.pathDocs.set('lib/lua', d);
  await m.app.start(null);
  const page = document.createElement('div');
  document.body.append(page);
  mounted = mount(PathsView, { target: page, props: { app: m.app } });
  await settle();
  await vi.waitFor(() => expect(page.querySelector('[data-point="syntax"]')).not.toBeNull());
  return { m, page };
}

const point = (page: HTMLElement, key: string) => page.querySelector<HTMLElement>(`[data-point="${key}"]`)!;
const sentOps = (m: Made) => m.hub.sent.flatMap((r) => r.ops);
async function openMenu(page: HTMLElement, key: string): Promise<HTMLElement> {
  const menu = point(page, key).querySelector<HTMLElement>('[data-choice="point"]')!;
  menu.querySelector<HTMLElement>('summary')!.click();
  await settle();
  return menu;
}
const choice = (menu: HTMLElement, text: string) => [...menu.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(text));
function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

async function openForm(page: HTMLElement): Promise<HTMLFormElement> {
  page.querySelector<HTMLButtonElement>('[data-levels-open]')!.click();
  await vi.waitFor(() => expect(page.querySelector('[data-levels-form]')).not.toBeNull());
  await settle();
  return page.querySelector<HTMLFormElement>('[data-levels-form]')!;
}
const field = (form: HTMLElement, id: string) => form.querySelector<HTMLInputElement>(`#${id}`)!;

describe('PathsView: setting the levels', () => {
  it('fills the form with the levels read, sends them as one path_levels on the version read, and closes', async () => {
    const { m, page } = await show();
    expect(page.querySelector('[data-levels-open]')?.textContent).toBe('Level und Belohnungen bearbeiten …');
    const form = await openForm(page);
    expect(field(form, 'level-threshold-0').value).toBe('20');
    expect(field(form, 'level-name-1').value).toBe('Profi');
    expect(field(form, 'level-reward-1').value).toBe('Kino');
    type(field(form, 'level-name-1'), 'Meister');
    [...form.querySelectorAll('button')].find((b) => b.textContent === 'Level hinzufügen')!.click();
    await settle();
    expect(field(form, 'level-threshold-2').value).toBe('110');
    type(field(form, 'level-reward-2'), 'Buch');
    form.requestSubmit();
    await vi.waitFor(() =>
      expect(sentOps(m)).toEqual([
        {
          op: 'path_levels',
          id: 'lib/lua',
          levels: {
            list: [
              { threshold: 20, unit: 'xp', name: 'Einsteiger', reward: 'Eis' },
              { threshold: 60, unit: 'xp', name: 'Meister', reward: 'Kino' },
              { threshold: 110, unit: 'xp', reward: 'Buch' },
            ],
          },
          if_match: 'e1',
        },
      ]),
    );
    await vi.waitFor(() => expect(page.querySelector('[data-levels-form]')).toBeNull());
    // the focus goes back to the button that opened the form, not to the page
    await vi.waitFor(() => expect(document.activeElement?.matches('[data-levels-open]')).toBe(true));
  });

  it('gives the focus back to the button that opened the form on Cancel', async () => {
    const { page } = await show();
    const form = await openForm(page);
    [...form.querySelectorAll('button')].find((b) => b.textContent === 'Abbrechen')!.click();
    await vi.waitFor(() => expect(page.querySelector('[data-levels-form]')).toBeNull());
    await vi.waitFor(() => expect(document.activeElement?.matches('[data-levels-open]')).toBe(true));
  });

  it('sends the version the form was filled from: a path changed meanwhile is a conflict, not overwritten', async () => {
    const { m, page } = await show();
    const form = await openForm(page);
    // a reward granted while the form is open: the path is read again with a new version
    m.hub.pathDocs.set('lib/lua', doc(LEVEL1, 'e2'));
    page.querySelector<HTMLButtonElement>('[data-reward="1"] button')!.click();
    await vi.waitFor(() => expect(m.hub.pathCalls.length).toBeGreaterThan(1));
    await vi.waitFor(() => expect(m.app.saving).toBe(false));
    await settle();
    form.requestSubmit();
    await vi.waitFor(() => expect(sentOps(m).at(-1)).toMatchObject({ op: 'path_levels', if_match: 'e1' }));
  });

  it('says a threshold that is no whole number and sends nothing', async () => {
    const { m, page } = await show();
    const form = await openForm(page);
    type(field(form, 'level-threshold-1'), 'viel');
    form.requestSubmit();
    await settle();
    expect(sentOps(m)).toEqual([]);
    expect(form.querySelector('[role="alert"]')?.textContent).toBe('Eine ganze Zahl ab 1.');
    expect(field(form, 'level-threshold-1').getAttribute('aria-invalid')).toBe('true');
  });

  it('offers the pictures below assets/badges/ of the path as badges, and the path line with its reward', async () => {
    const d = doc();
    d.path.assets = ['assets/badges/stern.png', 'assets/cover.png', 'assets/badges/mond.svg'];
    const { m, page } = await show(undefined, d);
    const form = await openForm(page);
    const select = form.querySelector<HTMLSelectElement>('#level-badge-0')!;
    expect([...select.options].map((o) => o.value)).toEqual(['', 'assets/badges/mond.svg', 'assets/badges/stern.png']);
    select.value = 'assets/badges/mond.svg';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const done = form.querySelector<HTMLInputElement>('[data-levels-done]')!;
    done.click();
    await settle();
    type(field(form, 'level-done-reward'), 'Wochenende');
    form.requestSubmit();
    await vi.waitFor(() => expect(sentOps(m)).toHaveLength(1));
    const op = sentOps(m)[0] as { levels: { list: { badge?: string }[]; done?: unknown } };
    expect(op.levels.list[0]!.badge).toBe('assets/badges/mond.svg');
    expect(op.levels.done).toEqual({ reward: 'Wochenende' });
  });

  it('sets the XP of a promoted task with set on the task, filled in with its XP', async () => {
    const { m, page } = await show();
    choice(await openMenu(page, 'cc'), 'XP der Task')!.click();
    await settle();
    const input = point(page, 'cc').querySelector<HTMLInputElement>('form.edit input')!;
    expect(input.value).toBe('40');
    type(input, 'x');
    input.form!.requestSubmit();
    await settle();
    expect(sentOps(m)).toEqual([]);
    type(input, '55');
    input.form!.requestSubmit();
    await vi.waitFor(() => expect(sentOps(m)).toEqual([{ op: 'set', id: 'lib/c-compiler', patch: { xp: 55 }, if_match: 'tc1' }]));
  });

  it('the switch off: no levels to set and no XP of the task', async () => {
    const { m, page } = await show();
    m.app.setGamification(false);
    await settle();
    expect(page.querySelector('[data-levels-open]')).toBeNull();
    // a promoted point has nothing else in its menu: with the switch off it has none
    expect(point(page, 'cc').querySelector('[data-choice="point"]')).toBeNull();
  });
});
