// @vitest-environment jsdom
// XP, levels and rewards in the view of the learning paths: the XP of each point and of the path, the level reached
// with what is missing to the next one, an open reward granted with path_reward, the XP of a point set with node_set
// (filled in with its own or the engine's suggestion), the switch that hides all of it, and a level reached said once.
// Every figure is the engine's (`tasks.path`); the view shows them and sends what was chosen.
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

async function show(prefs?: Map<string, string>): Promise<{ m: Made; page: HTMLElement }> {
  const m = make({ token: 't', ...(prefs ? { prefs } : {}) });
  made = m;
  m.hub.capabilities = null;
  m.hub.doc = snapshot([task('lib/c-compiler', { status: 'doing' })], 'rev:1');
  m.hub.pathsDoc = { kind: 'tasks.paths', rev: 'p1', digest: 'd', items: [entry(LEVEL1)], incomplete: [] };
  m.hub.pathDocs.set('lib/lua', doc());
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

describe('PathsView: XP, levels and rewards', () => {
  it('shows the XP of the points and of the path, the level with what is missing, and the open reward', async () => {
    const { page } = await show();
    expect(page.querySelector('[data-xp]')?.getAttribute('aria-label')).toBe('XP von Lua lernen: 20 von 90');
    expect(page.textContent).toContain('20 / 90 XP · 1 Punkt(e) ohne XP');
    expect(page.querySelector('.level')?.textContent).toBe('Level 1 (Einsteiger) · noch 40 XP bis Level 2');
    expect(page.querySelector('[data-reward="1"]')?.textContent).toContain('Gönn dir: Eis');
    expect(point(page, 'syntax').querySelector('.xp-point')?.textContent).toBe('20 XP');
    expect(point(page, 'cc').querySelector('.xp-point')?.textContent).toBe('40 XP, aus der Task');
    expect(point(page, 'none').querySelector('.xp-point')).toBeNull();
    expect(point(page, 'lua').querySelector('.xp-point')).toBeNull();
    // the list beside it names the XP and the level too
    expect(page.querySelector('[data-path="lib/lua"]')?.textContent).toContain('20 / 90 XP · Level 1');
  });

  it('grants an open reward with path_reward on the version read', async () => {
    const { m, page } = await show();
    page.querySelector<HTMLButtonElement>('[data-reward="1"] button')!.click();
    await vi.waitFor(() => expect(sentOps(m)).toEqual([{ op: 'path_reward', id: 'lib/lua', level: '1', given: true, if_match: 'e1' }]));
  });

  it('sets the XP of a point: filled in with its own, refused when it is no number, cleared when empty', async () => {
    const { m, page } = await show();
    choice(await openMenu(page, 'tables'), 'XP')!.click();
    await settle();
    const input = point(page, 'tables').querySelector<HTMLInputElement>('form.edit input')!;
    expect(input.value).toBe('30');
    type(input, 'viel');
    input.form!.requestSubmit();
    await settle();
    expect(sentOps(m)).toEqual([]);
    expect(point(page, 'tables').querySelector('[role="alert"]')?.textContent).toContain('ganze Zahl');
    type(input, '35');
    input.form!.requestSubmit();
    await vi.waitFor(() => expect(sentOps(m)).toEqual([{ op: 'node_set', id: 'lib/lua', point: 'tables', xp: 35, if_match: 'e1' }]));

    await vi.waitFor(() => expect(m.app.saving).toBe(false));
    choice(await openMenu(page, 'syntax'), 'XP')!.click();
    await settle();
    const own = point(page, 'syntax').querySelector<HTMLInputElement>('form.edit input')!;
    type(own, '');
    own.form!.requestSubmit();
    await vi.waitFor(() => expect(sentOps(m).at(-1)).toEqual({ op: 'node_set', id: 'lib/lua', point: 'syntax', xp_clear: true, if_match: 'e1' }));
  });

  it('fills a point without XP with the suggestion, and a point whose task carries XP has no field', async () => {
    const { m, page } = await show();
    choice(await openMenu(page, 'none'), 'XP')!.click();
    await settle();
    const input = point(page, 'none').querySelector<HTMLInputElement>('form.edit input')!;
    expect(input.value).toBe('15');
    // the suggestion taken as it is: written, it was never in the file
    input.form!.requestSubmit();
    await vi.waitFor(() => expect(sentOps(m)).toEqual([{ op: 'node_set', id: 'lib/lua', point: 'none', xp: 15, if_match: 'e1' }]));
    const cc = point(page, 'cc').querySelector<HTMLElement>('[data-choice="point"]');
    if (cc) {
      cc.querySelector<HTMLElement>('summary')!.click();
      await settle();
      // no XP of the point itself; the task's XP are set as the task's (PathsViewLevels.dom.test.ts)
      expect([...cc.querySelectorAll('button')].map((b) => b.textContent)).not.toContain('XP …');
      expect(choice(cc, 'XP der Task')).toBeDefined();
    }
  });

  it('the switch off hides XP, level and rewards; the progress stays', async () => {
    const { m, page } = await show();
    m.app.setGamification(false);
    await settle();
    expect(page.querySelector('[data-xp]')).toBeNull();
    expect(page.querySelector('.level')).toBeNull();
    expect(page.querySelector('[data-reward]')).toBeNull();
    expect(page.querySelector('.xp-point')).toBeNull();
    expect(page.querySelector('[data-progress]')).not.toBeNull();
    expect(page.querySelector('[data-path="lib/lua"]')?.textContent).not.toContain('XP');
    expect(choice(await openMenu(page, 'tables'), 'XP')).toBeUndefined();
  });

  it('says a level reached once, with its reward; never the level a path is first seen with', async () => {
    const { m, page } = await show();
    expect(m.app.toast).toBeNull();
    // the next read shows level 2 (another program ticked a point): said once, with the reward of level 2
    m.hub.pathDocs.set('lib/lua', doc(LEVEL2, 'e2'));
    page.querySelector<HTMLButtonElement>('[data-reward="1"] button')!.click();
    await vi.waitFor(() => expect(m.app.toast?.text).toBe('Level 2 erreicht in Lua lernen. Gönn dir: Kino'));
    m.app.dismissToast();
    await vi.waitFor(() => expect(m.app.saving).toBe(false));
    // read again at the same level: no second notice
    const reads = m.hub.pathCalls.length;
    point(page, 'tables').querySelector<HTMLButtonElement>('button.mark')!.click();
    await vi.waitFor(() => expect(m.hub.pathCalls.length).toBeGreaterThan(reads));
    await settle();
    expect(m.app.toast?.text ?? '').not.toContain('erreicht');
  });
});
