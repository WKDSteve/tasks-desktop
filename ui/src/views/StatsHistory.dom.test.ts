// @vitest-environment jsdom
// The history of a figure in a DOM, with its effects running: when the engine is asked, and what a vault without a
// series shows. `svelte/server` never runs the effect that asks.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { make } from '../lib/appDouble';
import { translate } from '../lib/i18n';
import StatsHistory from './StatsHistory.svelte';

type Made = ReturnType<typeof make>;

let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;

async function settle(): Promise<void> {
  await tick();
  flushSync();
}

async function show(): Promise<{ m: Made; page: HTMLElement }> {
  const m = make({ token: 't' });
  m.hub.capabilities = [...(m.hub.capabilities ?? []), 'history'];
  await m.app.start(null);
  made = m;
  const target = document.createElement('div');
  document.body.append(target);
  mounted = mount(StatsHistory, { target, props: { app: m.app } });
  flushSync();
  await vi.waitFor(() => expect(target.querySelector('svg')).not.toBeNull());
  return { m, page: target };
}

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

describe('StatsHistory', () => {
  it('asks the engine once for a window, and not again for another figure or a key in the search', async () => {
    const { m, page } = await show();
    expect(m.hub.historyCalls).toHaveLength(1);
    expect(m.hub.historyCalls[0]).toMatchObject({ resolution: 'day' });

    // another figure of the same window: drawn from the answer that is there
    m.app.setStatsHistory({ ...m.app.statsHistory, metric: 'open' });
    await settle();
    // the filter changes without its areas changing (a key in the search box above the statistics)
    m.app.filter = { ...m.app.filter, query: 'a' };
    await settle();
    m.app.filter = { ...m.app.filter, query: 'ab' };
    await settle();
    expect(m.hub.historyCalls).toHaveLength(1);
    expect(page.querySelector('svg')?.getAttribute('aria-label')).toContain(translate(m.app.lang, 'stats.history.metric.open'));

    // another period is another window: asked
    m.app.setStatsHistory({ ...m.app.statsHistory, period: '7d' });
    await settle();
    await vi.waitFor(() => expect(m.hub.historyCalls).toHaveLength(2));
    // and so are other areas
    m.app.filter = { ...m.app.filter, areas: ['pub'] };
    await settle();
    await vi.waitFor(() => expect(m.hub.historyCalls).toHaveLength(3));
    expect(m.hub.historyCalls[2]).toMatchObject({ area: 'pub' });
  });

  it('comes into view once when it was opened from a number, not at every later visit', async () => {
    const m = make({ token: 't' });
    m.hub.capabilities = [...(m.hub.capabilities ?? []), 'history'];
    await m.app.start(null);
    made = m;
    m.app.setView('today');
    m.app.openHistory('ready', 0);
    expect(m.app.historyShown).toBe(1);
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    const target = document.createElement('div');
    document.body.append(target);
    mounted = mount(StatsHistory, { target, props: { app: m.app } });
    flushSync();
    await settle();
    await vi.waitFor(() => expect(scrolled).toHaveBeenCalledTimes(1));
    expect(m.app.historyShown).toBe(0);
  });
});
