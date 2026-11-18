// @vitest-environment jsdom
// The overview with learning tasks hidden: the next tasks for an agent and the alternatives leave them out, and the
// next task itself (the engine's answer) stays, with a note when it is one of them.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
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

async function overview(): Promise<{ m: Made; text: () => string; note: () => Element | null }> {
  const m = make({ token: 't' });
  made = m;
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
  m.app.next = {
    task: brief('pub/learn', 'Learn the protocol'),
    alternatives: [brief('pub/learn2', 'Learn the terminal'), brief('pub/need', 'Needed work')],
    cdx: [brief('pub/learn2', 'Learn the terminal'), brief('pub/agent', 'Agent work')],
  } as unknown as Next;
  const target = document.createElement('div');
  document.body.append(target);
  mounted = mount(Today, { target, props: { app: m.app } });
  await tick();
  flushSync();
  return { m, text: () => target.textContent ?? '', note: () => target.querySelector('[data-learning-note]') };
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
  });
});
