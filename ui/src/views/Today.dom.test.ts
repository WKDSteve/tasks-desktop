// @vitest-environment jsdom
// The overview with learning tasks hidden: the next tasks for an agent and the alternatives leave them out. An engine
// that can leave them out (`next_not_category`) is asked without them and its count of them is said; with an older one
// the next task itself (the engine's answer) stays, with a note when it is one of them.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import type { Next, Snapshot } from '../lib/contract';
import { task } from '../lib/fixtures';
import Today from './Today.svelte';

type Made = ReturnType<typeof make>;
let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

const brief = (id: string, title: string) => ({ id, title, status: 'open', area: 'pub' });

async function overview(
  capable = false,
  hidden = false,
): Promise<{ m: Made; text: () => string; note: () => Element | null; leftOut: () => Element | null }> {
  const m = make({ token: 't', prefs: new Map(hidden ? [['tasks-desktop.hide-learning', 'on']] : []) });
  made = m;
  if (capable) {
    m.hub.capabilities = [...(m.hub.capabilities ?? []), 'next_not_category'];
    // The engine's pick: a learning task, unless asked without them; then two of them are left out.
    m.hub.nextAnswer = (without) =>
      (without.includes('learning')
        ? { task: brief('pub/need', 'Needed work'), alternatives: [brief('pub/agent', 'Agent work')], cdx: [], left_out: 2 }
        : {
            task: brief('pub/learn', 'Learn the protocol'),
            alternatives: [brief('pub/learn2', 'Learn the terminal'), brief('pub/need', 'Needed work')],
            cdx: [brief('pub/learn2', 'Learn the terminal'), brief('pub/agent', 'Agent work')],
          }) as unknown as Partial<Next>;
  }
  m.hub.doc = {
    ...snapshot([
      task('pub/learn', { title: 'Learn the protocol', category: ['learning'] as never }),
      task('pub/learn2', { title: 'Learn the terminal', category: ['learning'] as never }),
      task('pub/need', { title: 'Needed work' }),
      task('pub/agent', { title: 'Agent work' }),
    ]),
    // What the overview draws its numbers from: the figures of the plan the engine gives with every list.
    plans: [],
    projects: [],
    plan: {
      summary: { tasks: 4, ready: 4, decision: 0, waiting: 0, stuck: 0, freed: 0, parked: 0 },
      critical_path: { days: 0, path: [], unknown_effort: 0 },
      stage_sizes: [],
      cycles: [],
      conflict_groups: [],
      warnings: [],
    },
    estimate: { tasks: 4, days: 0, n_with_effort: 0, n_without_effort: 4, value: 0, n_with_value: 0, quick_wins: [], unestimated: [] },
  } as unknown as Snapshot;
  await m.app.start(null);
  if (!capable) m.app.next = {
    task: brief('pub/learn', 'Learn the protocol'),
    alternatives: [brief('pub/learn2', 'Learn the terminal'), brief('pub/need', 'Needed work')],
    cdx: [brief('pub/learn2', 'Learn the terminal'), brief('pub/agent', 'Agent work')],
  } as unknown as Next;
  const target = document.createElement('div');
  document.body.append(target);
  mounted = mount(Today, { target, props: { app: m.app } });
  await tick();
  flushSync();
  return {
    m,
    text: () => target.textContent ?? '',
    note: () => target.querySelector('[data-learning-note]'),
    leftOut: () => target.querySelector('[data-left-out]'),
  };
}

/** Let the question of the next task be answered and drawn. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await tick();
  flushSync();
}

describe('the overview and the learning tasks', () => {
  it('shows them as the page comes, without a note', async () => {
    const o = await overview();
    expect(o.text()).toContain('Learn the terminal');
    expect(o.text()).toContain('Needed work');
    expect(o.note()).toBeNull();
  });

  it('leaves them out of the next tasks when hidden; the engine\'s next task stays and says what it is', async () => {
    const o = await overview();
    o.m.app.setLearningHidden(true);
    await tick();
    flushSync();
    expect(o.text()).not.toContain('Learn the terminal');
    expect(o.text()).toContain('Needed work');
    expect(o.text()).toContain('Agent work');
    expect(o.text()).toContain('Learn the protocol');
    expect(o.note()).not.toBeNull();
    expect(o.leftOut()).toBeNull();
  });

  it('asks an engine without the capability as before: no category left out, and not again on the switch', async () => {
    const o = await overview();
    await settle();
    const asked = o.m.hub.nextAsked.length;
    expect(asked).toBeGreaterThan(0);
    expect(o.m.hub.nextAsked.every((without) => without.length === 0)).toBe(true);
    o.m.app.setLearningHidden(true);
    await settle();
    expect(o.m.hub.nextAsked.length).toBe(asked);
  });

  it('asks an engine that can leave them out without them, and says how many it left out', async () => {
    const o = await overview(true);
    await settle();
    expect(o.m.hub.nextAsked.at(-1)).toEqual([]);
    expect(o.text()).toContain('Learn the protocol');
    o.m.app.setLearningHidden(true);
    await vi.waitFor(() => {
      flushSync();
      expect(o.text()).not.toContain('Learn the protocol');
    });
    expect(o.m.hub.nextAsked.at(-1)).toEqual(['learning']);
    expect(o.text()).toContain('Needed work');
    expect(o.note()).toBeNull();
    expect(o.leftOut()?.textContent).toContain('2 Lern-Task(s) ausgelassen');
    // Shown again: the engine is asked over all, and the count goes.
    o.m.app.setLearningHidden(false);
    await vi.waitFor(() => {
      flushSync();
      expect(o.text()).toContain('Learn the protocol');
    });
    expect(o.m.hub.nextAsked.at(-1)).toEqual([]);
    expect(o.leftOut()).toBeNull();
  });

  it('asks without them from the start when they were hidden before', async () => {
    const o = await overview(true, true);
    await settle();
    expect(o.m.hub.nextAsked).toEqual([['learning']]);
    expect(o.text()).toContain('Needed work');
    expect(o.note()).toBeNull();
    expect(o.leftOut()?.textContent).toContain('2 Lern-Task(s) ausgelassen');
  });
});
