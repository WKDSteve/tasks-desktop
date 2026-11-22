// @vitest-environment jsdom
// The rewards in a DOM, with its effects running: the open ones with "Granted" (path_reward on the version read, without
// asking), the granted ones latest first with their day and "Not granted after all" in a row's detail, the coming ones
// with where they come; the focus stays in the view when a row leaves its part; a reward is shown as text. Reached,
// granted and missing come from the fixtures (the engine).
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import type { PathEntry, PathEntryLevel } from '../lib/contract';
import RewardsView from './RewardsView.svelte';

type Made = ReturnType<typeof make>;

const level = (over: Partial<PathEntryLevel> & { ref: string }): PathEntryLevel => ({ line: 1, kind: 'xp', given: false, reached: false, ...over });

function entry(slug: string, title: string, levels: PathEntryLevel[]): PathEntry {
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
    etag: `e-${slug}`,
    valid: true,
    problems: [],
    stage: 'doing',
    levels,
  };
}

const ITEMS: PathEntry[] = [
  entry('cli', 'CLI', [
    level({ ref: '1', number: 1, name: 'Start', reached: true, reached_on: '2026-11-03', reward: '<b>Eis</b>' }),
    level({ ref: '2', number: 2, reached: true, reward: 'Kino', given: true, given_on: '2026-11-04' }),
    level({ ref: '3', number: 3, threshold: 100, missing_xp: 40, reward: 'Buch' }),
  ]),
  entry('ohm', 'Ohm', [
    level({ ref: '1', number: 1, reached: true, reward: 'Kuchen' }),
    level({ ref: 'done', kind: 'done', missing_percent: 30, reward: 'See' }),
  ]),
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

async function show(opts: { items?: PathEntry[]; caps?: string[] } = {}) {
  const m = make({ token: 't' });
  made = m;
  m.hub.capabilities = opts.caps ?? ['paths', 'path', 'xp', 'requires', 'paths_levels', 'path_reward'];
  m.hub.doc = snapshot([], 'rev:1');
  m.hub.pathsDoc = { kind: 'tasks.paths', rev: 'p1', digest: 'd', items: opts.items ?? ITEMS, incomplete: [] };
  await m.app.start(null);
  m.app.setLang('en');
  const page = document.createElement('div');
  document.body.append(page);
  mounted = mount(RewardsView, { target: page, props: { app: m.app } });
  await settle();
  return { m, page };
}

const row = (page: HTMLElement, key: string) => page.querySelector<HTMLElement>(`[data-reward="${key}"]`);
const keys = (page: HTMLElement, part: string) => [...page.querySelectorAll<HTMLElement>(`[data-rewards-part="${part}"] [data-reward]`)].map((r) => r.dataset.reward);
const sentOps = (m: Made) => m.hub.sent.flatMap((r) => r.ops);

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

describe('RewardsView', () => {
  it('sorts the rewards into open, granted and coming, each with symbol and word', async () => {
    const { m, page } = await show();
    await vi.waitFor(() => expect(row(page, 'lib/cli#1')).not.toBeNull());
    expect(m.hub.pathCalls).toContain('paths include_done levels');
    expect(keys(page, 'open')).toEqual(['lib/cli#1', 'lib/ohm#1']);
    expect(keys(page, 'given')).toEqual(['lib/cli#2']);
    expect(keys(page, 'coming')).toEqual(['lib/ohm#done', 'lib/cli#3']);
    expect(page.querySelector('[data-rewards-open-count]')!.textContent).toBe('(2)');
    // a reward is text, never markup
    expect(row(page, 'lib/cli#1')!.querySelector('b')).toBeNull();
    expect(row(page, 'lib/cli#1')!.textContent).toContain('<b>Eis</b>');
    expect(row(page, 'lib/cli#1')!.textContent).toContain('Start · CLI');
    expect(row(page, 'lib/cli#1')!.textContent).toContain('open');
    expect(row(page, 'lib/cli#2')!.textContent).toContain('granted on 04/11/2026');
    expect(row(page, 'lib/cli#3')!.textContent).toContain('comes at 100 XP (40 XP to go)');
    expect(row(page, 'lib/ohm#done')!.textContent).toContain('comes when the path is finished');
  });

  it('grants an open reward on the version read, without asking, and keeps the focus in the open part', async () => {
    const { m, page } = await show();
    await vi.waitFor(() => expect(row(page, 'lib/cli#1')).not.toBeNull());
    const grant = row(page, 'lib/cli#1')!.querySelector<HTMLButtonElement>('[data-reward-grant]')!;
    expect(grant.getAttribute('aria-label')).toBe('Mark the reward "<b>Eis</b>" as granted');
    // the engine grants it: the next read has it granted
    m.hub.pathsDoc = {
      kind: 'tasks.paths',
      rev: 'p2',
      digest: 'd',
      items: [entry('cli', 'CLI', [{ ...ITEMS[0]!.levels![0]!, given: true }, ...ITEMS[0]!.levels!.slice(1)]), ITEMS[1]!],
      incomplete: [],
    };
    grant.click();
    await vi.waitFor(() => expect(sentOps(m)).toEqual([{ op: 'path_reward', id: 'lib/cli', level: '1', given: true, if_match: 'e-cli' }]));
    await vi.waitFor(() => expect(keys(page, 'open')).toEqual(['lib/ohm#1']));
    expect(keys(page, 'given')).toContain('lib/cli#1');
    expect(document.activeElement).toBe(row(page, 'lib/ohm#1')!.querySelector('[data-reward-grant]'));
  });

  it('takes a granted reward back from its detail', async () => {
    const { m, page } = await show();
    await vi.waitFor(() => expect(row(page, 'lib/cli#2')).not.toBeNull());
    const detail = row(page, 'lib/cli#2')!.querySelector<HTMLDetailsElement>('details')!;
    detail.open = true;
    detail.querySelector<HTMLButtonElement>('[data-reward-ungrant]')!.click();
    await vi.waitFor(() => expect(sentOps(m)).toEqual([{ op: 'path_reward', id: 'lib/cli', level: '2', given: false, if_match: 'e-cli' }]));
  });

  it('refuses a grant while a write is on its way, and says so', async () => {
    const { m, page } = await show();
    await vi.waitFor(() => expect(row(page, 'lib/cli#1')).not.toBeNull());
    let release = () => {};
    m.hub.holdOps = new Promise<void>((r) => (release = r));
    row(page, 'lib/cli#1')!.querySelector<HTMLButtonElement>('[data-reward-grant]')!.click();
    await settle();
    row(page, 'lib/ohm#1')!.querySelector<HTMLButtonElement>('[data-reward-grant]')!.click();
    await settle();
    expect(sentOps(m)).toHaveLength(1);
    expect(m.app.toast?.text).toContain('Still saving');
    release();
    await settle();
  });

  it('shows how to begin without rewards, and says why with an older engine', async () => {
    const empty = await show({ items: [entry('leer', 'Leer', [level({ ref: '1', reached: true })])] });
    await vi.waitFor(() => expect(empty.page.querySelector('[data-rewards-empty]')).not.toBeNull());
    expect(empty.page.textContent).toContain('Reward:');
    void unmount(mounted!);
    mounted = undefined;
    made!.app.stop();
    document.body.replaceChildren();

    const old = await show({ caps: ['paths', 'path', 'xp', 'paths_levels'] });
    expect(old.page.textContent).toContain('path_reward');
    expect(old.m.hub.pathCalls).toEqual([]);
  });
  it('follows the area filter of the page: a filter of another area hides the rewards, said with a button that clears it', async () => {
    const { m, page } = await show();
    m.app.filter = { ...m.app.filter, areas: ['elsewhere'] };
    await settle();
    await vi.waitFor(() => expect(page.querySelector('.scope-note p')?.textContent).toBe('The area filter (elsewhere) hides the learning paths here.'));
    expect(row(page, 'lib/cli#1')).toBeNull();
    const clear = page.querySelector<HTMLButtonElement>('.scope-note button')!;
    expect(clear.textContent).toBe('Clear filter');
    clear.click();
    await settle();
    expect(m.app.filter.areas).toEqual([]);
    await vi.waitFor(() => expect(page.querySelector('.scope-note')).toBeNull());
    expect(row(page, 'lib/cli#1')).not.toBeNull();
  });
});
