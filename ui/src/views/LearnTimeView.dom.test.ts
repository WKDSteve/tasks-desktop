// @vitest-environment jsdom
// The view "Learning time" in a DOM: a row per path that plans or records hours (the engine's figures), the overrun
// said in words beside the bar, the forecast of the series, the sessions of a path read when its row is unfolded, and
// a guide when no path plans hours.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import type { PathDocument } from '../lib/contract';
import LearnTimeView from './LearnTimeView.svelte';

type Made = ReturnType<typeof make>;

const hours = (planned_min: number, planned_max: number, done: number, open_min = 0, open_max = 0) => ({ planned_min, planned_max, done, open_min, open_max });
const entry = (id: string, title: string, h?: ReturnType<typeof hours>, project?: string) => ({
  id,
  area: id.split('/')[0],
  slug: id.split('/')[1],
  title,
  areas: [],
  summary: '',
  has_tree: true,
  points: 3,
  progress: { learned: 0, seen: 0, dropped: 0, open: 3, blocked: 0, total: 3 },
  file: `${id}.md`,
  etag: 'e',
  valid: true,
  problems: [],
  ...(h ? { hours: h } : {}),
  ...(project ? { project } : {}),
});

const LUA = entry('lib/lua', 'Lua lernen', hours(8, 10, 5, 3, 5), 'lib/tools');
const SHELL = entry('ops/shell', 'Shell', hours(4, 4, 7));
const BARE = entry('ops/bare', 'Ohne Stunden');

let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await tick();
    await Promise.resolve();
  }
  flushSync();
}

async function show(items: unknown[] = [LUA, SHELL, BARE], withHistory = true): Promise<{ m: Made; page: HTMLElement }> {
  const m = make({ token: 't' });
  made = m;
  m.hub.capabilities = withHistory ? null : ['paths', 'path', 'path_hours'];
  m.hub.doc = snapshot([], 'rev:1');
  m.hub.pathsDoc = { kind: 'tasks.paths', rev: 'p1', digest: 'd', items, incomplete: [] };
  m.hub.learnDocs.learn_history = {
    kind: 'tasks.learn_history',
    paths: [{ id: 'lib/lua', area: 'lib', first: '2026-10-01', levels: [], rewards: [], forecast_weeks: { hours_min: 1.5, hours_max: 2.5 } }],
    points: [],
    incomplete: [],
  };
  await m.app.start(null);
  await m.app.setLang('en');
  const page = document.createElement('div');
  document.body.append(page);
  mounted = mount(LearnTimeView, { target: page, props: { app: m.app } });
  await settle();
  return { m, page };
}

const row = (page: HTMLElement, id: string) => [...page.querySelectorAll<HTMLElement>('tr[data-path]')].find((r) => r.dataset['path'] === id)!;
const cells = (tr: HTMLElement) => [...tr.querySelectorAll('td')].map((td) => td.textContent?.replace(/\s+/g, ' ').trim());

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

describe('LearnTimeView', () => {
  it('draws a row per path with hours: planned span, done, left, the share of the plan and the forecast', async () => {
    const { m, page } = await show();
    expect(page.querySelectorAll('tr[data-path]')).toHaveLength(2);
    expect(cells(row(page, 'lib/lua'))).toEqual(['8–10 h', '5 h', '3–5 h', '50 % of the plan', '~2–3 weeks']);
    expect(m.hub.learnQueries).toEqual([['learn_history', { step: 'week' }]]);
  });

  it('says an overrun in words beside the bar, never by colour alone', async () => {
    const { page } = await show();
    const shell = row(page, 'ops/shell');
    expect(shell.classList.contains('over')).toBe(true);
    expect(shell.querySelector('.overrun .sr-only')?.textContent).toBe('+3 h over the plan');
    expect(shell.querySelector('.overrun')?.textContent).toContain('+3 h');
    // No pace for this path: said as such.
    expect(cells(shell).at(-1)).toBe('no pace yet');
  });

  it('works without the series: no forecast is asked for', async () => {
    const { m, page } = await show([LUA], false);
    expect(m.hub.learnQueries).toEqual([]);
    expect(cells(row(page, 'lib/lua')).at(-1)).toBe('no pace yet');
  });

  it('unfolds the sessions of a path, read once, with their state in a word', async () => {
    const { m, page } = await show();
    m.hub.pathDocs.set('lib/lua', {
      kind: 'tasks.path',
      path: LUA,
      nodes: [],
      schedule: [
        { index: 1, label: 'Grundlagen', state: 'done', closed: 3, total: 3, result: 'Notizen', ...hours(2, 2, 2) },
        { index: 5, label: '[Coroutines](https://x.test)', state: 'partial', closed: 1, total: 2, ...hours(3, 4, 1) },
      ],
    } as unknown as PathDocument);
    const fold = row(page, 'lib/lua').querySelector<HTMLButtonElement>('button.fold')!;
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    fold.click();
    await settle();
    await vi.waitFor(() => expect(page.querySelector('#learntime-sessions-lib\\/lua table.sessions')).not.toBeNull());
    const sessionRows = [...page.querySelectorAll<HTMLElement>('table.sessions tbody tr')];
    expect(sessionRows.map((r) => r.querySelector('th')?.textContent)).toEqual(['Grundlagen', 'Coroutines']);
    expect(sessionRows[0]!.textContent).toContain('done');
    expect(sessionRows[1]!.textContent).toContain('partly');
    expect(sessionRows[1]!.textContent).toContain('(1 of 2 closed)');
    expect(m.hub.pathCalls.filter((c) => c === 'path lib/lua')).toHaveLength(1);
    fold.click();
    await settle();
    expect(page.querySelector('table.sessions')).toBeNull();
  });

  it('opens a path by its title', async () => {
    const { m, page } = await show();
    row(page, 'lib/lua').querySelector<HTMLButtonElement>('button.link')!.click();
    expect(m.app.view).toBe('paths');
    expect(m.app.pathChoice).toBe('lib/lua');
  });

  it('filters by project', async () => {
    const { page } = await show();
    const select = page.querySelector<HTMLSelectElement>('select')!;
    select.value = 'lib/tools';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect([...page.querySelectorAll<HTMLElement>('tr[data-path]')].map((r) => r.dataset['path'])).toEqual(['lib/lua']);
  });

  it('says how to plan hours when no path has any, with a button to the paths', async () => {
    const { m, page } = await show([BARE]);
    expect(page.textContent).toContain('No hours planned.');
    expect(page.textContent).toContain('{h=N} on a point plans it');
    [...page.querySelectorAll('button')].find((b) => b.textContent === 'To the learning paths')!.click();
    expect(m.app.view).toBe('paths');
  });
});
