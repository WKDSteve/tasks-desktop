// @vitest-environment jsdom
// The learning statistics in a DOM: the series asked by day over the period (kept on the device) or two days of one's
// own, for one path through the engine and for a project as a filter; the points and XP per bar with their running
// sum, the hours per week stacked by path, the calendar of the learning days with the streak, a row per path with the
// level reached; before the series the finished tasks of the points, marked incomplete; without the series today's
// state; the tables in the menu View, without the name of a path of a private area.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import LearnStatsView from './LearnStatsView.svelte';

type Made = ReturnType<typeof make>;

const entry = (id: string, title: string, more: Record<string, unknown> = {}) => ({
  id,
  area: id.split('/')[0],
  slug: id.split('/')[1],
  title,
  areas: [],
  summary: '',
  has_tree: true,
  points: 4,
  progress: { learned: 1, seen: 0, dropped: 0, open: 3, blocked: 0, total: 4 },
  file: `${id}.md`,
  etag: 'e',
  valid: true,
  problems: [],
  ...more,
});
const LUA = entry('lib/lua', 'Lua lernen', {
  project: 'lib/tools',
  stage: 'doing',
  xp: { earned: 40, possible: 100, open: 60, points: 4, missing: 0 },
  levels: [{ ref: 'l2', number: 2, line: 2, kind: 'xp', threshold: 30, given: false, reached: true }],
});
const SHELL = entry('lib/shell', 'Shell', { stage: 'doing', hours: { planned_min: 2, planned_max: 2, done: 1.5, open_min: 0.5, open_max: 0.5 } });
const SECRET = entry('priv/diary', 'Tagebuch', { stage: 'doing' });

const day = (date: string, paths: { id: string; learned?: number; seen?: number; xp?: number; done_h?: number }[]) => {
  const full = paths.map((p) => ({ id: p.id, learned: p.learned ?? 0, seen: p.seen ?? 0, dropped: 0, xp: p.xp ?? 0, done_h: p.done_h ?? 0 }));
  const sum = (k: 'learned' | 'seen' | 'xp' | 'done_h') => full.reduce((a, p) => a + p[k], 0);
  return { date, learned: sum('learned'), seen: sum('seen'), dropped: 0, xp: sum('xp'), done_h: sum('done_h'), days: sum('learned') + sum('seen') > 0 ? 1 : 0, paths: full };
};
// Wednesday 2026-11-18, the month from the 1st; the series begins on the 9th.
const HISTORY = {
  kind: 'tasks.learn_history',
  first: '2026-11-09',
  streak: { current: 2, longest: 4, last_day: '2026-11-17' },
  points: [
    day('2026-11-10', [{ id: 'lib/lua', learned: 2, xp: 20, done_h: 1 }]),
    day('2026-11-16', [
      { id: 'lib/lua', learned: 1, xp: 10, done_h: 2 },
      { id: 'lib/shell', seen: 1, xp: 5, done_h: 0.5 },
      { id: 'priv/diary', learned: 1, done_h: 0.25 },
      { id: 'gone/ghost', done_h: 0.1 },
    ]),
    day('2026-11-17', [{ id: 'lib/shell', learned: 3, xp: 30 }]),
  ],
  paths: [
    { id: 'lib/lua', area: 'lib', title: 'Lua lernen', first: '2026-11-09', levels: [{ ref: 'l2', reached_on: '2026-11-16' }], rewards: [] },
    { id: 'lib/shell', area: 'lib', title: 'Shell', first: '2026-11-09', levels: [], rewards: [] },
    { id: 'priv/diary', area: 'priv', title: 'Tagebuch', first: '2026-11-09', levels: [], rewards: [] },
  ],
  incomplete: [],
};
// Before the series: a task promoted from a point of Lua, finished learned on the 3rd; one of no point.
const FINISHED = {
  kind: 'tasks.finished',
  total: 2,
  offset: 0,
  limit: 500,
  items: [
    { id: 'lib/t1', area: 'lib', slug: 't1', title: 'T1', tags: [], file: 'f', done: '2026-11-03', outcome: 'learned', point: 'lib/lua#k1', xp: 15 },
    { id: 'lib/t2', area: 'lib', slug: 't2', title: 'T2', tags: [], file: 'f', done: '2026-11-03' },
  ],
};

const ALL = ['paths', 'path', 'requires', 'xp', 'paths_levels', 'learn_history', 'outcome'];
let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await tick();
    await new Promise((r) => setTimeout(r, 0));
  }
  flushSync();
}

async function show(opts: { caps?: string[]; game?: boolean; prefs?: Record<string, string> } = {}): Promise<{ m: Made; page: HTMLElement }> {
  const m = make({ token: 't', now: Date.UTC(2026, 10, 18, 11) });
  made = m;
  m.hub.capabilities = opts.caps ?? ALL;
  m.hub.doc = snapshot([], 'rev:1');
  m.hub.areaList = [
    { name: 'lib', data_class: 'public' },
    { name: 'priv', data_class: 'private' },
  ];
  m.hub.pathsDoc = { kind: 'tasks.paths', rev: 'p1', digest: 'd', items: [LUA, SHELL, SECRET], incomplete: [] };
  m.hub.learnDocs.learn_history = HISTORY;
  m.hub.finishedDoc = FINISHED;
  for (const [k, v] of Object.entries(opts.prefs ?? {})) m.prefs.set(`tasks-desktop.view.${k}`, v);
  await m.app.start(null);
  await m.app.setLang('en');
  if (opts.game === false) m.app.setGamification(false);
  m.app.setView('learnstats');
  const page = document.createElement('div');
  document.body.append(page);
  mounted = mount(LearnStatsView, { target: page, props: { app: m.app } });
  await settle();
  return { m, page };
}

const page_ = (): HTMLElement => document.body.lastElementChild as HTMLElement;
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const cells = (tr: Element | null | undefined) => [...(tr?.querySelectorAll('th, td') ?? [])].map(text);
const pathRow = (page: HTMLElement, id: string) => page.querySelector(`section[aria-labelledby="learnstats-paths"] tr[data-path="${id}"]`);

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

describe('LearnStatsView', () => {
  it('asks the series by day over the month, and says from when it runs', async () => {
    const { m, page } = await show();
    expect(m.hub.learnQueries).toEqual([['learn_history', { since: '2026-11-01', until: '2026-11-18', step: 'day' }]]);
    expect(page.querySelector<HTMLInputElement>('input[value="month"]')!.checked).toBe(true);
    expect(text(page.querySelector('.since'))).toBe('History since 9 November 2026');
  });

  it('draws XP per day of the month with their running sum, as a table too', async () => {
    const { page } = await show();
    expect(text(page.querySelector('#learnstats-points'))).toBe('XP over time');
    const rows = [...page.querySelectorAll('#learnstats-bars-table tr[data-bar]')];
    expect(rows).toHaveLength(30);
    expect(cells(page.querySelector('#learnstats-bars-table tr[data-bar="2026-11-16"]'))).toEqual(['Mon, 16 Nov 2026', '2', '1', '15', '2.85', '50']);
    expect(cells(page.querySelector('#learnstats-bars-table tr[data-bar="2026-11-17"]'))).toEqual(['Tue, 17 Nov 2026', '3', '0', '30', '0', '80']);
    expect(text(page.querySelector('#learnstats-bars-table tr[data-bar="2026-11-20"] td'))).toBe('not yet');
  });

  it('before the series: the tasks finished from a point, marked incomplete, and a word why', async () => {
    const { m, page } = await show();
    expect(m.hub.finishedQueries).toEqual([{ since: '2026-11-01', until: '2026-11-08', limit: 100, offset: 0 }]);
    expect(cells(page.querySelector('#learnstats-bars-table tr[data-bar="2026-11-03"]'))).toEqual(['Tue, 3 Nov 2026 (incomplete)', '1', '0', '15', '–', '15']);
    expect(text(page.querySelector('#learnstats-bars-table tr[data-bar="2026-11-02"] td'))).toBe('not known');
    expect(text(page.querySelector('[role="note"]'))).toContain('Before 9 November 2026 there is no series');
  });

  it('reads the finished tasks page by page, as long as a page is full', async () => {
    const { m } = await show();
    const many = Array.from({ length: 150 }, (_, i) => ({ ...FINISHED.items[0], id: `lib/m${i}`, slug: `m${i}` }));
    m.hub.finishedDoc = (q: { limit?: number; offset?: number }) => ({ ...FINISHED, total: 150, items: many.slice(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? 100)) });
    m.hub.finishedQueries.length = 0;
    m.hub.doc = snapshot([], 'rev:2');
    await m.app.focused();
    await settle();
    expect(m.hub.finishedQueries.map((q) => q.offset)).toEqual([0, 100]);
    // the 150 tasks on the 3rd, one point each: learned 150, the XP of each
    expect(text(page_().querySelector('#learnstats-bars-table tr[data-bar="2026-11-03"] td'))).toBe('150');
  });

  it('stacks the hours of each week by path, the paths named in the legend and the table', async () => {
    const { page } = await show();
    const heads = [...page.querySelectorAll('#learnstats-hours-table thead th')].map(text);
    expect(heads).toEqual(['Week', 'Lua lernen', 'Shell', 'Tagebuch', 'gone/ghost', 'Total']);
    expect(cells(page.querySelector('#learnstats-hours-table tr[data-week="2026-11-16"]'))).toEqual(['Wk 47 (16/11)', '2 h', '0.5 h', '0.25 h', '0.1 h', '2.85 h']);
    expect(text(page.querySelector('#learnstats-hours-table tr[data-week="2026-10-26"]'))).toBe('');
    expect([...page.querySelectorAll('.legend li')].map(text)).toEqual(['Lua lernen', 'Shell', 'Tagebuch', 'gone/ghost']);
  });

  it('a calendar of the learning days with the streak in words; the days as a table', async () => {
    const { page } = await show();
    expect(text(page.querySelector('[data-streak]'))).toBe('🔥 Streak: 2 days · longest: 4 days');
    expect(page.querySelector('.calendar [data-day="2026-11-17"]')!.className).toContain('lv-2');
    expect(page.querySelector('.calendar [data-day="2026-11-17"]')!.getAttribute('title')).toBe('Tue, 17 Nov 2026: 3 points');
    expect(page.querySelector('.calendar [data-day="2026-11-05"]')!.classList.contains('unk')).toBe(true);
    const days = [...page.querySelectorAll('#learnstats-days-table tr[data-day]')].map((tr) => tr.getAttribute('data-day'));
    expect(days[0]).toBe('2026-11-09');
    expect(days.at(-1)).toBe('2026-11-18');
    const toggle = page.querySelector<HTMLButtonElement>('button[aria-controls="learnstats-days-table"]')!;
    toggle.click();
    flushSync();
    expect(page.querySelector('.calendar')).toBeNull();
    expect(page.querySelector('#learnstats-days-table')!.classList.contains('sr-only')).toBe(false);
  });

  it('a row per path with what it learned, its XP, hours and the level it reached', async () => {
    const { page } = await show();
    expect(cells(pathRow(page, 'lib/lua'))).toEqual(['Lua lernen', '3', '30', '3 h', 'Lv 2 on 16/11']);
    expect(cells(pathRow(page, 'lib/shell'))).toEqual(['Shell', '3', '35', '0.5 h', '–']);
  });

  it('one path is asked of the engine; a project filters the paths and the streak is said to be of all', async () => {
    const { m, page } = await show();
    const selects = page.querySelectorAll('select');
    const project = selects[0]!;
    project.value = 'lib/tools';
    project.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(page.querySelectorAll('section[aria-labelledby="learnstats-paths"] tr[data-path]')).toHaveLength(1);
    expect(text(page.querySelector('[data-streak]'))).toContain('Streak of all paths');
    const path = page.querySelectorAll('select')[1]!;
    path.value = 'lib/lua';
    path.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(m.hub.learnQueries.at(-1)).toEqual(['learn_history', { since: '2026-11-01', until: '2026-11-18', step: 'day', path: 'lib/lua' }]);
  });

  it('with one path chosen the bars before the series count the tasks of that path alone', async () => {
    const { m, page } = await show();
    const path = page.querySelectorAll('select')[1]!;
    path.value = 'lib/shell';
    path.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(m.hub.learnQueries.at(-1)![1]).toMatchObject({ path: 'lib/shell' });
    // the task of Lua finished on the 3rd is not Shell's
    expect(text(page.querySelector('#learnstats-bars-table tr[data-bar="2026-11-03"] td'))).toBe('not known');
  });

  it('draws nothing of the old window under the new one while the new one is read', async () => {
    const { m, page } = await show();
    let open: () => void = () => undefined;
    m.hub.learnGates.push(new Promise<void>((r) => (open = r)));
    page.querySelector<HTMLInputElement>('input[value="year"]')!.click();
    await settle();
    expect(page.querySelector('#learnstats-bars-table')).toBeNull();
    expect(text(page.querySelector('[role="status"].none'))).toBe('Reading the history …');
    open();
    await settle();
    expect(page.querySelectorAll('#learnstats-bars-table tr[data-bar]')).toHaveLength(12);
  });

  it('a window not begun yet asks nothing and says so', async () => {
    const { m, page } = await show({ prefs: { 'learnstats-period': 'custom', 'learnstats-span': '2026-12-01..2026-12-31' } });
    expect(m.hub.learnQueries).toEqual([]);
    expect(text(page.querySelector('[role="note"]'))).toBe('This period has not begun yet.');
    expect(page.querySelector('[role="alert"]')).toBeNull();
  });

  it('a window longer than 800 days shows its last 800 and says so', async () => {
    const { m, page } = await show({ prefs: { 'learnstats-period': 'custom', 'learnstats-span': '2023-01-01..2026-11-18' } });
    expect(m.hub.learnQueries[0]).toEqual(['learn_history', { since: '2024-09-10', until: '2026-11-18', step: 'day' }]);
    expect(text(page.querySelector('[role="note"]'))).toContain('At most 800 days at once: shown from 10 September 2024.');
  });

  it('a window in the past shows no streak: the engine’s ends on its last day, not today', async () => {
    const { page } = await show({ prefs: { 'learnstats-period': 'custom', 'learnstats-span': '2026-11-09..2026-11-17' } });
    expect(page.querySelector('#learnstats-days')).not.toBeNull();
    expect(page.querySelector('[data-streak]')).toBeNull();
  });

  it('an older answer of the paths that comes late does not cover a newer one', async () => {
    const { m, page } = await show();
    let open: () => void = () => undefined;
    const gate = new Promise<void>((r) => (open = r));
    const old = { kind: 'tasks.paths', rev: 'p1', digest: 'd', items: [LUA, SHELL, SECRET], incomplete: [] };
    const fresh = { ...old, rev: 'p2', items: [LUA, SHELL, SECRET, entry('lib/new', 'Neu')] };
    let calls = 0;
    m.hub.pathsWithLevels = async () => {
      calls += 1;
      if (calls === 1) {
        await gate;
        return old as never;
      }
      return fresh as never;
    };
    m.hub.doc = snapshot([], 'rev:2');
    await m.app.focused();
    await settle();
    m.hub.doc = snapshot([], 'rev:3');
    await m.app.focused();
    await settle();
    open();
    await settle();
    expect([...page.querySelectorAll('select')[1]!.querySelectorAll('option')].map((o) => o.value)).toContain('lib/new');
  });

  it('a period of its own asks for its days and is kept', async () => {
    const { m, page } = await show({ prefs: { 'learnstats-period': 'custom', 'learnstats-span': '2026-10-01..2026-10-31' } });
    expect(m.hub.learnQueries[0]).toEqual(['learn_history', { since: '2026-10-01', until: '2026-10-31', step: 'day' }]);
    const since = page.querySelector<HTMLInputElement>('input[type="date"]')!;
    since.value = '2026-10-15';
    since.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(m.prefs.get('tasks-desktop.view.learnstats-span')).toBe('2026-10-15..2026-10-31');
    expect(m.hub.learnQueries.at(-1)).toEqual(['learn_history', { since: '2026-10-15', until: '2026-10-31', step: 'day' }]);
    page.querySelector<HTMLInputElement>('input[value="year"]')!.click();
    await settle();
    expect(m.prefs.get('tasks-desktop.view.learnstats-period')).toBe('year');
  });

  it('counts points instead of XP without gamification', async () => {
    const { page } = await show({ game: false });
    expect(text(page.querySelector('#learnstats-points'))).toBe('Points over time');
    expect(cells(page.querySelector('#learnstats-bars-table tr[data-bar="2026-11-16"]'))).toEqual(['Mon, 16 Nov 2026', '2', '1', '2.85', '5']);
    expect(cells(pathRow(page, 'lib/lua'))).toEqual(['Lua lernen', '3', '3 h', 'Lv 2 on 16/11']);
  });

  it('without the series: today’s state of each path and why', async () => {
    const { m, page } = await show({ caps: ['paths', 'path', 'requires', 'xp'] });
    expect(m.hub.learnQueries).toEqual([]);
    expect(text(page.querySelector('[role="note"]'))).toContain('learn_history');
    expect(cells(page.querySelector('tr[data-path="lib/shell"]'))).toEqual(['Shell', '1 / 4', '–', '1.5 h']);
    expect(m.app.exportable).toBe(false);
  });

  it('gives its tables to the menu View, without naming a path of a private area', async () => {
    const { m } = await show();
    expect(m.app.exportable).toBe(true);
    await m.app.exportView('markdown', 'copy');
    expect(m.app.toast).toMatchObject({ kind: 'ok', text: expect.stringMatching(/^\d+ rows copied\.$/) });
    const md = m.copied[0]!;
    expect(md).toContain('# Learning statistics');
    expect(md).toContain('## Per path');
    expect(md).toContain('| Lua lernen | 3 | 30 | 3 | Lv 2 on 16/11 |');
    expect(md).toContain('a path of a private area');
    expect(md).not.toContain('Tagebuch');
    // a path the vault no longer names (no area known) is held back as well
    expect(md).not.toContain('gone/ghost');
    // gone with the view
    unmount(mounted!);
    mounted = undefined;
    expect(m.app.viewTables).toBeNull();
  });
  it('follows the area filter of the page: a filter of another area hides the figures, said with a button that clears it', async () => {
    const { m, page } = await show();
    m.app.filter = { ...m.app.filter, areas: ['elsewhere'] };
    await settle();
    await vi.waitFor(() => expect(page.querySelector('.scope-note p')?.textContent).toBe('The area filter (elsewhere) hides the learning paths here.'));
    const clear = page.querySelector<HTMLButtonElement>('.scope-note button')!;
    expect(clear.textContent).toBe('Clear filter');
    clear.click();
    await settle();
    expect(m.app.filter.areas).toEqual([]);
    await vi.waitFor(() => expect(page.querySelector('.scope-note')).toBeNull());
  });

  it('counts the figures of the paths of the areas of the filter only', async () => {
    const { page, m } = await show();
    m.app.filter = { ...m.app.filter, areas: ['priv'] };
    await settle();
    // the 16th without the two paths of lib: one point of the diary, a quarter of an hour
    expect(cells(page.querySelector('#learnstats-bars-table tr[data-bar="2026-11-16"]')).slice(0, 5)).toEqual(['Mon, 16 Nov 2026', '1', '0', '0', '0.25']);
    expect([...page.querySelectorAll<HTMLElement>('section[aria-labelledby="learnstats-paths"] tr[data-path]')].map((r) => r.dataset['path'])).toEqual(['priv/diary']);
  });
});
