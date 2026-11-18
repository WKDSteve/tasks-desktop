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

  it('shows no numbers below the line, only a table for a screen reader', async () => {
    const { page } = await show();
    // the one fold left is the menu of the card
    expect(page.querySelector('details:not(.menu)')).toBeNull();
    const table = page.querySelector('table[data-history-numbers]');
    expect(table?.parentElement?.classList.contains('sr-only')).toBe(true);
    expect(table?.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
  });

  it('follows the field of the bars: the open tasks per status as bands, a value taken out by its legend entry', async () => {
    const { m, page } = await show();
    m.app.setLang('en');
    m.app.setStats('status', 'count');
    // the default figure is not the open tasks: one line, and the way to the split is offered
    await settle();
    expect(page.querySelector('[data-history-split="metric"]')).not.toBeNull();
    expect(page.querySelectorAll('path.layer')).toHaveLength(0);
    page.querySelector<HTMLButtonElement>('[data-history-split="metric"] button')?.click();
    await settle();
    expect(m.app.statsHistory.metric).toBe('open');
    // the series counts open and doing on these days: two bands, in the order of the bars, coloured as they are
    const layers = (): string[] => [...page.querySelectorAll('path.layer')].map((p) => p.getAttribute('data-layer') ?? '');
    expect(layers()).toEqual(['doing', 'open']);
    expect(page.querySelector('path.layer[data-layer="doing"]')?.classList.contains('v-doing')).toBe(true);
    expect(page.querySelector('svg')?.getAttribute('aria-label')).toMatch(/^Open tasks by Status from /);
    // the table for the screen reader has a column per value
    expect([...page.querySelectorAll('table[data-history-numbers] thead th')].map((th) => th.textContent)).toEqual(['Day', 'doing', 'open', 'Total']);
    const entry = page.querySelector<HTMLButtonElement>('[data-history-legend] [data-bucket="doing"]');
    expect(entry?.getAttribute('aria-pressed')).toBe('true');
    entry?.click();
    await settle();
    expect(layers()).toEqual(['open']);
    expect(entry?.getAttribute('aria-pressed')).toBe('false');

    // a field the series does not count per value: one line, and a word why
    m.app.setStats('kind', 'count');
    await settle();
    expect(layers()).toEqual([]);
    expect(page.querySelector('[data-history-split="none"]')?.textContent).toContain('Kind');
    expect(page.querySelector('path.line')).not.toBeNull();
  });

  it('is unfolded when it is opened from a number of the overview', async () => {
    const m = make({ token: 't' });
    m.hub.capabilities = [...(m.hub.capabilities ?? []), 'history'];
    await m.app.start(null);
    made = m;
    m.app.setStatsCardOpen('history', false);
    m.app.setView('today');
    m.app.openHistory('ready', 0);
    Element.prototype.scrollIntoView = vi.fn();
    const target = document.createElement('div');
    document.body.append(target);
    mounted = mount(StatsHistory, { target, props: { app: m.app } });
    flushSync();
    await settle();
    await vi.waitFor(() => expect(m.app.statsFolded).toEqual([]));
  });
});
