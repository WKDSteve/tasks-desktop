// @vitest-environment jsdom
// The repo status in a DOM: a row for each repo of the tiles with the light the hub told, what needs a look first; a
// commit that waits for approval is not red and shows the command to copy; the run opens on github.com in a new tab;
// a hub without gh, a repo the hub did not answer for and the web variant are said in words.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { make } from '../lib/appDouble';
import type { HubRepos } from '../lib/repos';
import type { RepoStatus } from '../lib/repoStatus';
import RepoStatusView from './RepoStatusView.svelte';

type Made = ReturnType<typeof make>;

let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await tick();
    await Promise.resolve();
    flushSync();
  }
}

const TILES: HubRepos = {
  kind: 'hub.repos',
  rev: 'r1',
  repos: {
    aaaa0001: { name: 'alpha', label: 'alpha', image: false, area: null },
    bbbb0002: { name: 'beta', label: 'beta', image: false, area: null },
    cccc0003: { name: 'streamtap', label: 'streamtap', image: false, area: null },
    dddd0004: { name: 'delta', label: 'delta', image: false, area: null },
  },
  groups: [{ id: 'gggg0001', title: 'All', tiles: ['aaaa0001', 'bbbb0002', 'cccc0003', 'dddd0004'] }],
};

const clean = { state: 'clean', branch: 'main', changed: 0, ahead: 0, behind: 0, gone: false } as const;
const STATES: Record<string, RepoStatus> = {
  aaaa0001: { local: clean, ci: { state: 'green', url: 'https://github.com/o/alpha/actions/runs/1', sha: 'aaaaaaa1111' } },
  bbbb0002: { local: { ...clean, state: 'dirty', changed: 3, ahead: 1 }, ci: { state: 'red', url: 'https://github.com/o/beta/actions/runs/2', sha: 'bbbbbbb2222' } },
  cccc0003: {
    local: clean,
    ci: { state: 'approval', url: 'https://github.com/o/streamtap/actions/runs/5', sha: 'abc1234', trust: 'testing ci trust o/streamtap abc1234' },
  },
};

async function show(overrides: Parameters<typeof make>[0] = {}, tiles: HubRepos = TILES) {
  const m = make({ token: 't', ...overrides });
  made = m;
  (m.hub as unknown as { repos: () => Promise<HubRepos> }).repos = async () => tiles;
  m.hub.statuses = { ...STATES };
  await m.app.start(null);
  const root = document.createElement('div');
  document.body.append(root);
  mounted = mount(RepoStatusView, { target: root, props: { app: m.app } });
  flushSync();
  await settle();
  return { m, root };
}

const rowsOf = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('tr[data-repo]')];
const row = (root: HTMLElement, id: string): HTMLElement => rowsOf(root).find((r) => r.dataset.repo === id)!;

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('RepoStatusView', () => {
  it('asks the hub once for each repo and shows what needs a look first', async () => {
    const { m, root } = await show();
    expect([...m.hub.statusAsked].sort()).toEqual(['aaaa0001', 'bbbb0002', 'cccc0003', 'dddd0004']);
    // Red, then waiting for approval, then green; the repo the hub did not answer for last.
    expect(rowsOf(root).map((r) => r.dataset.repo)).toEqual(['bbbb0002', 'cccc0003', 'aaaa0001', 'dddd0004']);
    expect(row(root, 'bbbb0002').dataset).toMatchObject({ ci: 'red', local: 'dirty' });
    expect(row(root, 'bbbb0002').textContent).toContain('3 geändert, 1 voraus');
    expect(row(root, 'bbbb0002').textContent).toContain('ROT');
    expect(row(root, 'bbbb0002').textContent).toContain('bbbbbbb');
    expect(row(root, 'aaaa0001').textContent).toContain('sauber');
    expect(row(root, 'dddd0004').textContent).toContain('nicht geantwortet');
  });

  it('gives every state a sign and a word: a light is not a colour alone', async () => {
    const { root } = await show();
    for (const id of ['aaaa0001', 'bbbb0002', 'cccc0003']) {
      const lights = row(root, id).querySelectorAll('.light');
      expect(lights).toHaveLength(2);
      for (const light of lights) {
        expect(light.getAttribute('aria-hidden')).toBe('true');
        expect(light.nextElementSibling?.textContent?.trim()).not.toBe('');
      }
    }
    const signs = ['aaaa0001', 'bbbb0002', 'cccc0003'].map((id) => row(root, id).querySelectorAll('.light')[1]!.textContent);
    expect(new Set(signs).size).toBe(3);
  });

  it('shows a commit that waits for approval as its own state, with the command to copy', async () => {
    const { m, root } = await show();
    const waiting = row(root, 'cccc0003');
    expect(waiting.dataset.ci).toBe('approval');
    expect(waiting.textContent).toContain('wartet auf Freigabe');
    expect(waiting.textContent).not.toContain('ROT');
    expect(waiting.querySelector('code')?.textContent).toBe('testing ci trust o/streamtap abc1234');
    waiting.querySelector<HTMLButtonElement>('[data-copy]')!.click();
    await settle();
    expect(m.copied).toEqual(['testing ci trust o/streamtap abc1234']);
    expect(root.querySelector('[data-copied]')?.textContent).toContain('streamtap');
    // No other row offers a command.
    expect(root.querySelectorAll('[data-copy]')).toHaveLength(1);
  });

  it('opens the run on github.com in a new tab, without handing the page over', async () => {
    const { root } = await show();
    const link = row(root, 'bbbb0002').querySelector('a')!;
    expect(link.getAttribute('href')).toBe('https://github.com/o/beta/actions/runs/2');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('aria-label')).toContain('beta');
  });

  it('says in words that gh is missing or GitHub cannot be reached, and still shows the checkout', async () => {
    const m = make({ token: 't' });
    made = m;
    (m.hub as unknown as { repos: () => Promise<HubRepos> }).repos = async () => TILES;
    m.hub.statuses = {
      aaaa0001: { local: { ...clean, state: 'unpushed', ahead: 2 }, ci: { state: 'unavailable', reason: 'no_gh' } },
      bbbb0002: { local: { state: 'unavailable', changed: 0, ahead: 0, behind: 0, gone: false, reason: 'not_a_repo' }, ci: { state: 'unavailable', reason: 'offline' } },
    };
    await m.app.start(null);
    const root = document.createElement('div');
    document.body.append(root);
    mounted = mount(RepoStatusView, { target: root, props: { app: m.app } });
    flushSync();
    await settle();
    expect(row(root, 'aaaa0001').textContent).toContain('2 voraus');
    expect(row(root, 'aaaa0001').textContent).toContain('gh ist nicht installiert');
    expect(row(root, 'bbbb0002').textContent).toContain('kein git-Checkout');
    expect(row(root, 'bbbb0002').textContent).toContain('GitHub ist nicht erreichbar');
    expect(row(root, 'aaaa0001').querySelector('a')).toBeNull();
  });

  it('asks again by the button (fresh) and by itself every quarter of a minute, never two rounds at once', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { m, root } = await show();
    m.hub.statusAsked.length = 0;
    root.querySelector<HTMLButtonElement>('[data-ask]')!.click();
    await settle();
    expect([...m.hub.statusAsked].sort()).toEqual(['aaaa0001 fresh', 'bbbb0002 fresh', 'cccc0003 fresh', 'dddd0004 fresh']);
    m.hub.statusAsked.length = 0;
    vi.advanceTimersByTime(15_000);
    await settle();
    expect([...m.hub.statusAsked].sort()).toEqual(['aaaa0001', 'bbbb0002', 'cccc0003', 'dddd0004']);
    // The view gone: nothing is asked any more.
    void unmount(mounted!);
    mounted = undefined;
    m.hub.statusAsked.length = 0;
    vi.advanceTimersByTime(60_000);
    await settle();
    expect(m.hub.statusAsked).toEqual([]);
  });

  it('asks nothing in the web variant and says that it needs the desktop app', async () => {
    const { m, root } = await show({ mode: 'web' });
    expect(root.querySelector('[data-repostatus-web]')).not.toBeNull();
    expect(root.querySelector('table')).toBeNull();
    expect(m.hub.statusAsked).toEqual([]);
  });

  it('leads to the tiles when there are none', async () => {
    const { m, root } = await show({}, { kind: 'hub.repos', rev: 'r0', repos: {}, groups: [] });
    expect(root.querySelector('table')).toBeNull();
    root.querySelector<HTMLButtonElement>('button.link')!.click();
    expect(m.app.view).toBe('repos');
    expect(m.hub.statusAsked).toEqual([]);
  });
});
