// @vitest-environment jsdom
// The view "Next learning step" in a DOM, with its effects running: it asks the engine for the next steps (the machine
// as asked), draws a card per path with the two after it folded, marks the point the way the view of the paths writes
// (a reason for seen and does-not-apply, the safety question before closing a {safety} point, then `ack`), refuses
// while a write is on its way, answers the keys l, s, n and Enter only on a focused card, and opens a point in the path.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import type { LearnNext, LearnPoint } from '../lib/contract';
import LearnNextView from './LearnNextView.svelte';

type Made = ReturnType<typeof make>;

const pt = (index: number, p: Partial<LearnPoint> = {}): LearnPoint => ({
  index,
  label: `point ${index}`,
  stage_index: 1,
  stage_label: 'Basics',
  ...p,
});

function next(items: LearnNext['items']): LearnNext {
  return { kind: 'tasks.learn_next', rev: 'r', digest: 'd', items, incomplete: [] } as unknown as LearnNext;
}

const LUA: LearnNext['items'][number] = {
  path: 'lib/lua',
  area: 'lib',
  title: 'Lua lernen',
  stage: 'doing',
  project: 'lib/tools',
  points: [
    pt(3, { key: 'meta', label: '[Metatables](https://www.lua.org/pil/13.html)', link: 'https://www.lua.org/pil/13.html', h_min: 2, h_max: 3, xp: 20 }),
    pt(4, { key: 'gc', label: 'Garbage collector' }),
    pt(5, { label: 'Coroutines' }),
  ],
};
const SHELL: LearnNext['items'][number] = {
  path: 'ops/shell',
  area: 'ops',
  title: 'Shell',
  stage: 'idle',
  points: [pt(2, { key: 'rm', label: 'rm -rf safely', safety: true, stage_label: 'Danger' })],
};

let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await tick();
    await Promise.resolve();
  }
  flushSync();
}

async function show(items = [LUA, SHELL], lang: 'en' | 'de' = 'en'): Promise<{ m: Made; page: HTMLElement }> {
  const m = make({ token: 't' });
  made = m;
  m.hub.capabilities = null;
  m.hub.doc = snapshot([], 'rev:1');
  m.hub.learnDocs.learn_next = next(items);
  await m.app.start(null);
  await m.app.setLang(lang);
  const page = document.createElement('div');
  document.body.append(page);
  mounted = mount(LearnNextView, { target: page, props: { app: m.app } });
  await settle();
  return { m, page };
}

const card = (page: HTMLElement, path: string) => [...page.querySelectorAll<HTMLElement>('article[data-path]')].find((a) => a.dataset['path'] === path)!;
const button = (el: HTMLElement, text: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(text))!;
const sentOps = (m: Made) => m.hub.sent.flatMap((r) => r.ops);
const press = (el: HTMLElement, key: string, mods: KeyboardEventInit = {}) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods }));

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

describe('LearnNextView', () => {
  it('asks for three points per path and draws a card each, the label as text, the next two folded', async () => {
    const { m, page } = await show();
    expect(m.hub.learnQueries).toEqual([['learn_next', { n: 3 }]]);
    const lua = card(page, 'lib/lua');
    expect(lua.querySelector('h3')?.textContent).toBe('Lua lernen');
    expect(lua.querySelector('.label')?.textContent).toBe('Metatables');
    expect(lua.getAttribute('aria-label')).toBe('Lua lernen: Metatables');
    const source = lua.querySelector<HTMLAnchorElement>('.meta a')!;
    expect(source.textContent).toBe('Source: www.lua.org');
    expect(source.rel).toContain('noreferrer');
    expect(lua.textContent).toContain('2–3 h planned');
    expect(lua.querySelector('details.after summary')?.textContent).toBe('After that (2)');
    expect(lua.querySelector('details.after')?.hasAttribute('open')).toBe(false);
    // The safety point says so in a word, not only in colour.
    expect(card(page, 'ops/shell').querySelector('.badge')?.textContent).toContain('Safety');
  });

  it('marks a point learned by its key, without a version, and reads the steps again', async () => {
    const { m, page } = await show();
    button(card(page, 'lib/lua'), 'Learned').click();
    await settle();
    expect(sentOps(m)).toEqual([{ op: 'node_set', id: 'lib/lua', point: 'meta', state: 'learned' }]);
    await vi.waitFor(() => expect(m.hub.learnQueries.length).toBeGreaterThan(1));
  });

  it('asks a reason for seen before it sends, and says when it is missing', async () => {
    const { m, page } = await show();
    const lua = card(page, 'lib/lua');
    button(lua, 'Seen').click();
    await settle();
    const input = lua.querySelector<HTMLInputElement>('input.reason')!;
    expect(document.activeElement).toBe(input);
    button(lua, 'Save').click();
    await settle();
    expect(lua.querySelector('.missing')?.textContent).toBe('A reason is needed.');
    expect(sentOps(m)).toEqual([]);
    input.value = '  skimmed   it ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    button(lua, 'Save').click();
    await settle();
    expect(sentOps(m)).toEqual([{ op: 'node_set', id: 'lib/lua', point: 'meta', state: 'seen', reason: 'skimmed it' }]);
  });

  it('asks before a safety point is closed and sends ack only after yes; cancel sends nothing', async () => {
    const { m, page } = await show();
    const shell = card(page, 'ops/shell');
    button(shell, 'Learned').click();
    await settle();
    expect(shell.querySelector('.ask')?.textContent).toContain('This point concerns safety. Mark it as learned?');
    expect(document.activeElement?.classList.contains('confirm-no')).toBe(true);
    button(shell, 'Cancel').click();
    await settle();
    expect(sentOps(m)).toEqual([]);
    expect(shell.querySelector('.ask')).toBeNull();
    button(shell, 'Learned').click();
    await settle();
    button(shell, 'Yes, mark it').click();
    await settle();
    expect(sentOps(m)).toEqual([{ op: 'node_set', id: 'ops/shell', point: 'rm', state: 'learned', ack: true }]);
  });

  it('asks the reason, then the safety question, for seen on a safety point, and sends both with ack', async () => {
    const { m, page } = await show();
    const shell = card(page, 'ops/shell');
    button(shell, 'Seen').click();
    await settle();
    const input = shell.querySelector<HTMLInputElement>('input.reason')!;
    input.value = 'read the man page';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    button(shell, 'Save').click();
    await settle();
    expect(sentOps(m)).toEqual([]);
    expect(shell.querySelector('.ask')?.textContent).toContain('Mark it as seen?');
    button(shell, 'Yes, mark it').click();
    await settle();
    expect(sentOps(m)).toEqual([{ op: 'node_set', id: 'ops/shell', point: 'rm', state: 'seen', reason: 'read the man page', ack: true }]);
  });

  it('sends does-not-apply of a safety point with its reason and without a question', async () => {
    const { m, page } = await show();
    const shell = card(page, 'ops/shell');
    button(shell, 'Does not apply').click();
    await settle();
    const input = shell.querySelector<HTMLInputElement>('input.reason')!;
    input.value = 'no shell here';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    button(shell, 'Save').click();
    await settle();
    expect(sentOps(m)).toEqual([{ op: 'node_set', id: 'ops/shell', point: 'rm', state: 'dropped', reason: 'no shell here' }]);
  });

  it('refuses a mark while a write is on its way, with write.busy', async () => {
    const { m, page } = await show();
    let release = (): void => undefined;
    m.hub.holdOps = new Promise<void>((r) => (release = r));
    button(card(page, 'lib/lua'), 'Learned').click();
    await settle();
    button(card(page, 'lib/lua'), 'Learned').click();
    await settle();
    expect(sentOps(m)).toHaveLength(1);
    expect(m.app.toast?.text).toBe('Still saving - try again in a moment.');
    release();
    await settle();
  });

  it('answers l, s, n and Enter only on a focused card, never with a modifier or in a field', async () => {
    const { m, page } = await show();
    const lua = card(page, 'lib/lua');
    // The page itself: nothing.
    press(page, 'l');
    await settle();
    expect(sentOps(m)).toEqual([]);
    lua.focus();
    press(lua, 'l', { ctrlKey: true });
    await settle();
    expect(sentOps(m)).toEqual([]);
    press(lua, 's');
    await settle();
    const input = lua.querySelector<HTMLInputElement>('input.reason')!;
    expect(document.activeElement).toBe(input);
    // Typing an l into the reason is typing, not a mark.
    press(input, 'l');
    await settle();
    expect(sentOps(m)).toEqual([]);
    press(input, 'Escape');
    await settle();
    expect(lua.querySelector('input.reason')).toBeNull();
    expect(document.activeElement).toBe(lua);
    press(lua, 'l');
    await settle();
    expect(sentOps(m)).toEqual([{ op: 'node_set', id: 'lib/lua', point: 'meta', state: 'learned' }]);
    await settle();
    press(card(page, 'lib/lua'), 'Enter');
    await settle();
    expect(m.app.view).toBe('paths');
    expect(m.app.pathChoice).toBe('lib/lua');
    expect(m.app.pathPoint).toBe('meta');
  });

  it('opens a later point in the path by its index where it has no key', async () => {
    const { m, page } = await show();
    const lua = card(page, 'lib/lua');
    lua.querySelector<HTMLElement>('details.after summary')!.click();
    button(lua, 'Coroutines').click();
    expect(m.app.pathChoice).toBe('lib/lua');
    expect(m.app.pathPoint).toBe('#5');
  });

  it('filters by project and asks the engine again for another machine', async () => {
    const { m, page } = await show();
    const [projectSelect, machineSelect] = [...page.querySelectorAll<HTMLSelectElement>('select')];
    projectSelect!.value = 'lib/tools';
    projectSelect!.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(page.querySelectorAll('article[data-path]')).toHaveLength(1);
    machineSelect!.value = 'wsl';
    machineSelect!.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(m.hub.learnQueries.at(-1)).toEqual(['learn_next', { n: 3, machine: 'wsl' }]);
  });

  it('says how to begin when no path runs, with a button to the paths', async () => {
    const { m, page } = await show([], 'de');
    expect(page.textContent).toContain('Alles gelernt oder nichts begonnen.');
    button(page, 'Lernpfad beginnen').click();
    expect(m.app.view).toBe('paths');
  });

  it('says when the steps could not be read, and reads again on request', async () => {
    const m = make({ token: 't' });
    made = m;
    m.hub.capabilities = null;
    m.hub.doc = snapshot([], 'rev:1');
    await m.app.start(null);
    await m.app.setLang('en');
    const page = document.createElement('div');
    document.body.append(page);
    mounted = mount(LearnNextView, { target: page, props: { app: m.app } });
    await settle();
    expect(page.querySelector('[role="alert"]')?.textContent).toContain('The next steps could not be read.');
    m.hub.learnDocs.learn_next = next([LUA]);
    button(page, 'Read again').click();
    await settle();
    expect(card(page, 'lib/lua')).toBeDefined();
  });
});
