// @vitest-environment jsdom
// The overview of the tab Learning plans in a DOM: the tile "My learning" with its period (kept on the device), the
// figures of the series against the period before in words with a mark, the bars as a table; today's state without
// the series; the next steps, the running paths by their last day, the levels within reach and the open rewards, and
// a guide when there is no path.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import LearnView from './LearnView.svelte';

type Made = ReturnType<typeof make>;

const progress = (learned: number, total: number, seen = 0) => ({ learned, seen, dropped: 0, open: total - learned - seen, blocked: 0, total });
const entry = (id: string, title: string, more: Record<string, unknown> = {}) => ({
  id,
  area: id.split('/')[0],
  slug: id.split('/')[1],
  title,
  areas: [],
  summary: '',
  has_tree: true,
  points: 4,
  progress: progress(0, 4),
  file: `${id}.md`,
  etag: 'e',
  valid: true,
  problems: [],
  ...more,
});

const LUA = entry('lib/lua', 'Lua lernen', {
  stage: 'doing',
  progress: progress(2, 4),
  updated: '2026-11-01',
  xp: { earned: 60, possible: 100, open: 40, points: 4, missing: 0 },
  level: { level: 2, name: 'Halbzeit', percent: 50, finished: false, next: { number: 3, missing_xp: 40 }, open_rewards: [] },
  levels: [
    { ref: 'l1', number: 1, line: 1, kind: 'xp', threshold: 20, name: 'Start', reward: 'Kaffee', given: false, reached: true },
    { ref: 'l2', number: 2, line: 2, kind: 'xp', threshold: 50, name: 'Halbzeit', given: false, reached: true },
    { ref: 'l3', number: 3, line: 3, kind: 'xp', threshold: 100, name: 'Endspurt', reward: 'Kinoabend', given: false, reached: false, missing_xp: 40 },
  ],
});
const SHELL = entry('ops/shell', 'Shell', { stage: 'doing', progress: progress(1, 4), updated: '2026-11-17' });
const IDLE = entry('ops/idle', 'Noch nicht', { stage: 'idle' });

const day = (date: string, paths: { id: string; learned?: number; seen?: number; xp?: number; done_h?: number }[]) => {
  const full = paths.map((p) => ({ id: p.id, learned: p.learned ?? 0, seen: p.seen ?? 0, dropped: 0, xp: p.xp ?? 0, done_h: p.done_h ?? 0 }));
  const sum = (k: 'learned' | 'seen' | 'xp' | 'done_h') => full.reduce((a, p) => a + p[k], 0);
  return { date, learned: sum('learned'), seen: sum('seen'), dropped: 0, xp: sum('xp'), done_h: sum('done_h'), days: sum('learned') + sum('seen') > 0 ? 1 : 0, paths: full };
};
// Wednesday 2026-11-18; the week before: 2 learned, 20 XP, 1 h on one day. This week: 3 learned, 1 seen, 35 XP, 1.5 h on two days.
const HISTORY = {
  kind: 'tasks.learn_history',
  first: '2026-11-09',
  streak: { current: 2, longest: 3, last_day: '2026-11-17' },
  points: [
    day('2026-11-10', [{ id: 'lib/lua', learned: 2, xp: 20, done_h: 1 }]),
    day('2026-11-16', [{ id: 'lib/lua', learned: 3, xp: 30, done_h: 1.5 }]),
    day('2026-11-17', [{ id: 'ops/shell', seen: 1, xp: 5 }]),
  ],
  paths: [
    { id: 'lib/lua', area: 'lib', first: '2026-11-09', last_active: '2026-11-16', levels: [], rewards: [] },
    { id: 'ops/shell', area: 'ops', first: '2026-11-09', last_active: '2026-11-17', levels: [], rewards: [] },
  ],
  incomplete: [],
};
const NEXT = {
  kind: 'tasks.learn_next',
  items: [
    { path: 'lib/lua', area: 'lib', title: 'Lua lernen', stage: 'doing', points: [{ index: 3, key: 'k3', label: 'Metatables', stage_index: 1, stage_label: 'Stufe 2', h_min: 1, xp: 20 }] },
    { path: 'ops/shell', area: 'ops', title: 'Shell', stage: 'doing', points: [{ index: 1, label: 'Pipes', stage_index: 0, stage_label: 'Stufe 1' }] },
  ],
  incomplete: [],
};

const ALL = ['paths', 'path', 'requires', 'xp', 'paths_levels', 'path_reward', 'learn_history', 'learn_next'];
let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await tick();
    await Promise.resolve();
  }
  flushSync();
}

async function show(opts: { items?: unknown[]; caps?: string[]; game?: boolean; period?: string } = {}): Promise<{ m: Made; page: HTMLElement }> {
  const m = make({ token: 't', now: Date.UTC(2026, 10, 18, 11) });
  made = m;
  m.hub.capabilities = opts.caps ?? ALL;
  m.hub.doc = snapshot([], 'rev:1');
  m.hub.pathsDoc = { kind: 'tasks.paths', rev: 'p1', digest: 'd', items: opts.items ?? [LUA, SHELL, IDLE], incomplete: [] };
  m.hub.learnDocs.learn_history = HISTORY;
  m.hub.learnDocs.learn_next = NEXT;
  if (opts.period) m.prefs.set('tasks-desktop.view.learn-period', opts.period);
  await m.app.start(null);
  await m.app.setLang('en');
  if (opts.game === false) m.app.setGamification(false);
  const page = document.createElement('div');
  document.body.append(page);
  mounted = mount(LearnView, { target: page, props: { app: m.app } });
  await settle();
  return { m, page };
}

const fig = (page: HTMLElement, name: string) => page.querySelector<HTMLElement>(`[data-fig="${name}"]`);
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

describe('LearnView, the tile My learning', () => {
  it('asks the series by day from the week before, and shows the week against it in words and a mark', async () => {
    const { m, page } = await show();
    expect(m.hub.learnQueries).toContainEqual(['learn_history', { since: '2026-11-09', until: '2026-11-18', step: 'day' }]);
    expect(page.querySelector<HTMLInputElement>('input[value="week"]')!.checked).toBe(true);
    expect(text(fig(page, 'learned'))).toBe('Points learned 3 ▲ +1 vs last week to Wednesday');
    expect(fig(page, 'learned')!.querySelector('[aria-hidden="true"]')?.textContent).toBe('▲');
    expect(text(fig(page, 'xp'))).toBe('XP 35 ▲ +15 vs last week to Wednesday');
    expect(text(fig(page, 'hours'))).toBe('Learning time 1.5 h ▲ +0.5 h vs last week to Wednesday');
    expect(text(fig(page, 'days'))).toBe('Learning days 2 of 3 ▲ +1 vs last week to Wednesday');
    expect(text(fig(page, 'streak'))).toBe('Streak 🔥 2 days in a row longest: 3 days');
  });

  it('draws a bar per day of the week, its figures as a table, the days not begun said', async () => {
    const { page } = await show();
    expect(page.querySelector('.chart')?.getAttribute('aria-hidden')).toBe('true');
    expect(page.querySelector('[data-bars]')?.getAttribute('data-bars')).toBe('7');
    const rows = [...page.querySelectorAll<HTMLElement>('tr[data-bar]')];
    expect(rows.map((r) => r.dataset['bar'])).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
    expect([...rows[0]!.querySelectorAll('td')].map(text)).toEqual(['3', '0', '30', '1.5']);
    expect(text(rows[3]!.querySelector('td'))).toBe('not yet');
    // the table is there for a screen reader, and shown instead of the drawing on asking
    const toggle = [...page.querySelectorAll('button')].find((b) => b.textContent === 'As table')!;
    expect(page.querySelector('#learn-bars-table')!.classList.contains('sr-only')).toBe(true);
    toggle.click();
    flushSync();
    expect(page.querySelector('.chart')).toBeNull();
    expect(page.querySelector('#learn-bars-table')!.classList.contains('sr-only')).toBe(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('compares as many days of the period before: a month to the same day of the month before', async () => {
    const { page } = await show({ period: 'month' });
    // 1st to 18th November against 1st to 18th October: the series begins on 9 November, so October is not known
    expect(text(fig(page, 'learned'))).toBe('Points learned 5 no comparison: the series begins on 9 November 2026');
  });

  it('switches the period by a radio, asks again and keeps it on the device', async () => {
    const { m, page } = await show();
    const year = page.querySelector<HTMLInputElement>('input[value="year"]')!;
    year.click();
    await settle();
    expect(m.prefs.get('tasks-desktop.view.learn-period')).toBe('year');
    expect(m.hub.learnQueries.at(-1)).toEqual(['learn_history', { since: '2025-01-01', until: '2026-11-18', step: 'day' }]);
    // the year before is not in the series: no comparison, said with its first day
    expect(text(fig(page, 'learned'))).toBe('Points learned 5 no comparison: the series begins on 9 November 2026');
    expect(page.querySelector('[data-bars]')?.getAttribute('data-bars')).toBe('12');
    expect(page.querySelector('[role="note"]')?.textContent).toContain('9 November 2026');
  });

  it('draws no figures of the old period under the new one while the new one is read', async () => {
    const { m, page } = await show();
    let open: () => void = () => undefined;
    m.hub.learnGates.push(new Promise<void>((r) => (open = r)));
    page.querySelector<HTMLInputElement>('input[value="year"]')!.click();
    await settle();
    expect(fig(page, 'learned')).toBeNull();
    expect(text(page.querySelector('[role="note"]'))).toBe('Reading the history …');
    open();
    await settle();
    expect(text(fig(page, 'learned'))).toContain('Points learned 5');
  });

  it('starts with the period kept on the device; the radios are one group with a name', async () => {
    const { page } = await show({ period: 'day' });
    expect(page.querySelector<HTMLInputElement>('input[value="day"]')!.checked).toBe(true);
    expect(text(page.querySelector('fieldset legend'))).toBe('Period');
    expect(text(fig(page, 'learned'))).toBe('Points learned 0 = same as yesterday');
    expect(text(fig(page, 'xp'))).toBe('XP 0 ▼ −5 vs yesterday');
  });

  it('counts points instead of XP without gamification', async () => {
    const { page } = await show({ game: false });
    expect(fig(page, 'xp')).toBeNull();
    expect(page.querySelector('th')?.textContent).toBeTruthy();
    expect([...page.querySelectorAll('#learn-bars-table th[scope="col"]')].map(text)).toEqual(['Day', 'Learned', 'Seen', 'Hours']);
  });

  it('without the series: today’s state and why', async () => {
    const { m, page } = await show({ caps: ['paths', 'path', 'requires', 'xp'] });
    expect(m.hub.learnQueries.filter(([name]) => name === 'learn_history')).toEqual([]);
    expect(text(fig(page, 'today'))).toBe('State today 3 of 12 points learned');
    expect(text(page.querySelector('[role="note"]'))).toContain('learn_history');
    expect(fig(page, 'learned')).toBeNull();
  });

  it('with a series that has no day yet: today’s state and when it begins', async () => {
    const { m, page } = await show();
    m.hub.learnDocs.learn_history = { ...HISTORY, first: undefined, streak: undefined, points: [], paths: [] };
    m.app.setView('learn');
    // a change of the vault reads again
    m.hub.doc = snapshot([], 'rev:2');
    await m.app.focused();
    await settle();
    expect(text(fig(page, 'today'))).toBe('State today 3 of 12 points learned');
    expect(text(page.querySelector('[role="note"]'))).toContain('tasks index');
  });
});

describe('LearnView, the other tiles', () => {
  it('lists the first next steps, each opening its point in the path', async () => {
    const { m, page } = await show();
    expect(m.hub.learnQueries).toContainEqual(['learn_next', { n: 1 }]);
    const steps = [...page.querySelectorAll<HTMLElement>('li[data-step]')];
    expect(steps.map((s) => s.dataset['step'])).toEqual(['lib/lua', 'ops/shell']);
    expect(text(steps[0]!.querySelector('.what'))).toBe('Lua lernen Stufe 2 · Metatables 1 h · 20 XP');
    const open = steps[0]!.querySelector('button')!;
    expect(open.getAttribute('aria-label')).toBe('Open Metatables in Lua lernen');
    open.click();
    expect(m.app.view).toBe('paths');
    expect(m.app.pathChoice).toBe('lib/lua');
    expect(m.app.pathPoint).toBe('k3');
  });

  it('lists the running paths by their last day in the series, with progress and level', async () => {
    const { page } = await show();
    const running = [...page.querySelectorAll<HTMLElement>('ul.running li')];
    expect(running.map((r) => r.dataset['path'])).toEqual(['ops/shell', 'lib/lua']);
    const lua = running[1]!;
    expect(lua.querySelector('progress')?.getAttribute('aria-label')).toBe('50 % done');
    expect(text(lua.querySelector('.name'))).toContain('running:');
    expect(text(lua)).toContain('Lv 2 · Halbzeit · 40 XP to Lv 3');
  });

  it('shows the next level within reach with its reward, and the open rewards', async () => {
    const { m, page } = await show();
    const reach = [...page.querySelectorAll<HTMLElement>('li[data-reach]')];
    expect(reach.map((r) => r.dataset['reach'])).toEqual(['lib/lua#l3']);
    expect(text(reach[0])).toBe('3 Lv 3 · Endspurt · Lua lernen 40 XP to go Reward: Kinoabend');
    // l1 is reached and its reward Kaffee not given: one open
    expect(text(page.querySelector('[data-rewards]'))).toBe('🎁 1 open');
    expect(m.hub.pathCalls).toContain('paths include_done levels');
  });

  it('leaves out the rewards and the XP without gamification, and the steps without learn_next', async () => {
    const { page } = await show({ game: false, caps: ['paths', 'path', 'requires', 'xp', 'paths_levels', 'learn_history'] });
    expect(page.querySelector('[data-rewards]')).toBeNull();
    expect(page.querySelector('#learn-next')).toBeNull();
    expect(text(page.querySelector('li[data-reach]'))).not.toContain('Kinoabend');
    expect(text(page.querySelector('ul.running'))).not.toContain('Lv 2');
  });

  it('guides to the learning paths when there is none', async () => {
    const { m, page } = await show({ items: [] });
    expect(text(page.querySelector('.empty'))).toContain('No learning path yet.');
    [...page.querySelectorAll('button')].find((b) => b.textContent === 'To the learning paths')!.click();
    expect(m.app.view).toBe('paths');
  });
  it('follows the area filter of the page: the figures and paths of its areas, an area without paths said with a button that clears it', async () => {
    const { m, page } = await show();
    m.app.hubAreas = ['lib', 'ops'].map((name) => ({ name }) as never);
    m.app.filter = { ...m.app.filter, areas: ['ops'] };
    await settle();
    // the series is asked for the area, so that its streak and first day are those of ops
    expect(m.hub.learnQueries.filter(([name]) => name === 'learn_history').at(-1)).toEqual(['learn_history', { since: '2026-11-09', until: '2026-11-18', step: 'day', area: 'ops' }]);
    // the week of ops alone: the 17th, one point seen with 5 XP; the week before had nothing of ops
    expect(text(fig(page, 'xp'))).toBe('XP 5 ▲ +5 vs last week to Wednesday');
    expect(text(page.querySelector('[aria-labelledby="learn-next"]'))).not.toContain('Metatables');
    expect(text(page.querySelector('[aria-labelledby="learn-next"]'))).toContain('Pipes');
    m.app.filter = { ...m.app.filter, areas: ['elsewhere'] };
    await settle();
    expect(page.querySelector('.scope-note p')?.textContent).toBe('The area filter (elsewhere) hides the learning paths here.');
    page.querySelector<HTMLButtonElement>('.scope-note button')!.click();
    await settle();
    expect(m.app.filter.areas).toEqual([]);
    expect(text(fig(page, 'xp'))).toBe('XP 35 ▲ +15 vs last week to Wednesday');
  });

  it('names the streak of all paths when the filter cannot be asked of the hub (a name with a blank)', async () => {
    const { m, page } = await show();
    expect(text(fig(page, 'streak'))).toMatch(/^Streak 🔥/);
    m.app.hubAreas = ['lib', 'ops', 'my area'].map((name) => ({ name }) as never);
    m.app.filter = { ...m.app.filter, areas: ['my area'] };
    await settle();
    // asked for all areas: the streak is of all paths, and the figure says so
    expect(m.hub.learnQueries.filter(([name]) => name === 'learn_history').at(-1)?.[1]).not.toHaveProperty('area');
    m.app.filter = { ...m.app.filter, areas: ['lib', 'my area'] };
    await settle();
    await vi.waitFor(() => expect(text(fig(page, 'streak'))).toMatch(/^Streak of all paths 🔥/));
    // a filter the hub takes: the streak is of its areas
    m.app.filter = { ...m.app.filter, areas: ['ops'] };
    await settle();
    await vi.waitFor(() => expect(text(fig(page, 'streak'))).toMatch(/^Streak 🔥/));
  });
});
