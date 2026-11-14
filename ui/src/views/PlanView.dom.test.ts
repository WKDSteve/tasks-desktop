// @vitest-environment jsdom
// The plan view in a DOM, with its effects running: what `svelte/server` never shows. A plan chosen by a link is not
// dropped while the page shows the list kept in the browser (it may be older than the plan), and is dropped once the
// vault, read as it is now, has no such plan.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import type { CachedList } from '../lib/cache';
import type { Snapshot } from '../lib/contract';
import { task } from '../lib/fixtures';
import PlanView from './PlanView.svelte';

type Made = ReturnType<typeof make>;

const ESTIMATE = {
  tasks: 2,
  days: 0,
  n_with_effort: 0,
  n_without_effort: 2,
  value: 0,
  n_with_value: 0,
  quick_wins: [],
  unestimated: [],
};

/** A snapshot the plan view can draw: the plans, and the figures of the plan the engine gives with every list. */
function withPlans(ids: readonly string[], rev: string): Snapshot {
  const tasks = [task('pub/a', { plan: 'pub/app', etag: 'e1' }), task('pub/b', { etag: 'e1' })];
  return {
    ...snapshot(tasks, rev),
    plans: ids.map((id) => ({ id, title: `Plan ${id}`, areas: ['pub'], phase_order: [], valid: true, etag: `sha256:${id}` })),
    projects: [],
    plan: {
      summary: { tasks: 2, ready: 2, decision: 0, waiting: 0, stuck: 0, freed: 0, parked: 0 },
      critical_path: { days: 0, path: [], unknown_effort: 0 },
      stage_sizes: [],
      cycles: [],
      conflict_groups: [],
      warnings: [],
    },
    estimate: ESTIMATE,
  } as unknown as Snapshot;
}

const cached: CachedList = { vault: 'v', rev: 'rev:0', etag: 'old', savedAt: 5, tasks: [task('pub/a', { plan: 'pub/app' })] };

let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;

/** The effects that are due have run, and what they changed is drawn. */
async function settle(): Promise<void> {
  await tick();
  flushSync();
}

function show(m: Made): HTMLElement {
  made = m;
  const target = document.createElement('div');
  document.body.append(target);
  mounted = mount(PlanView, { target, props: { app: m.app } });
  flushSync();
  return target;
}

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

describe('PlanView, the chosen plan', () => {
  it('keeps a plan the list of the cache does not know, and still has it when the vault is read and holds it', async () => {
    const m = make({ token: 't', cached });
    // The hub does not answer yet: the page shows the list it kept, as after a reload.
    let answer: () => void = () => undefined;
    m.hub.holdSnapshot = new Promise<void>((resolve) => (answer = resolve));
    m.hub.doc = withPlans(['pub/app'], 'rev:1');
    const started = m.app.start(null);
    await vi.waitFor(() => expect(m.app.cachedAt).toBe(5));
    // A link named the plan (the route sets the choice before the view is drawn).
    m.app.planChoice = 'pub/app';
    const page = show(m);
    await settle();
    expect(m.app.snapshot).toBeNull();
    expect(m.app.planChoice).toBe('pub/app');

    // The vault as it is now: the plan is there, and the choice of the view shows it.
    answer();
    await started;
    await settle();
    expect(m.app.cachedAt).toBeNull();
    expect(m.app.planChoice).toBe('pub/app');
    const select = page.querySelector<HTMLSelectElement>('label.plan-select select');
    expect(select?.value).toBe('pub/app');
  });

  it('drops a plan that the vault, read as it is now, does not have', async () => {
    const m = make({ token: 't' });
    m.hub.doc = withPlans(['pub/other'], 'rev:1');
    await m.app.start(null);
    m.app.planChoice = 'pub/gone';
    const page = show(m);
    await settle();
    expect(m.app.planChoice).toBe('');
    expect(page.querySelector<HTMLSelectElement>('label.plan-select select')?.value).toBe('');

    // A plan that is there stays chosen; when a later read of the vault has lost it, it goes.
    m.app.planChoice = 'pub/other';
    await settle();
    expect(m.app.planChoice).toBe('pub/other');
    m.hub.doc = withPlans([], 'rev:2');
    await m.app.refresh();
    await settle();
    expect(m.app.planChoice).toBe('');
  });

  it('drops a project that is gone the same way, and not from the list of the cache', async () => {
    const m = make({ token: 't', cached });
    let answer: () => void = () => undefined;
    m.hub.holdSnapshot = new Promise<void>((resolve) => (answer = resolve));
    m.hub.doc = withPlans([], 'rev:1');
    const started = m.app.start(null);
    await vi.waitFor(() => expect(m.app.cachedAt).toBe(5));
    m.app.projectChoice = 'ALL/gone';
    show(m);
    await settle();
    expect(m.app.projectChoice).toBe('ALL/gone');
    answer();
    await started;
    await settle();
    expect(m.app.projectChoice).toBe('');
  });
});
