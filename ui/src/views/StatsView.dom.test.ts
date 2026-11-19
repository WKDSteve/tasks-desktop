// @vitest-environment jsdom
// The statistics in a DOM, with their effects running: the effort is the engine's figure, asked once when the view
// comes and once after the person stopped typing in the search of the filter bar, not for every letter.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import { task } from '../lib/fixtures';
import { withTile } from '../lib/statsTiles';
import StatsView from './StatsView.svelte';

type Made = ReturnType<typeof make>;

let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;

async function settle(): Promise<void> {
  await tick();
  flushSync();
}

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

describe('StatsView, the effort of the tasks the filter keeps', () => {
  it('is asked at once when the view comes, and once for a word typed into the search, with the tasks the word keeps', async () => {
    const m = make({ token: 't' });
    made = m;
    m.hub.doc = snapshot([task('pub/alpha', { status: 'open' }), task('pub/alphabet', { status: 'open' }), task('lib/beta', { status: 'open' })]);
    await m.app.start(null);
    m.app.setLang('en');
    expect(m.app.can('estimate')).toBe(true);
    const target = document.createElement('div');
    document.body.append(target);
    mounted = mount(StatsView, { target, props: { app: m.app } });
    flushSync();
    await settle();
    // The view came: one question, at once, for every open task.
    expect(m.hub.estimates.length).toBe(1);
    expect(m.hub.estimates[0]?.ids).toHaveLength(3);
    await vi.waitFor(() => expect(target.querySelector('[data-figure="effort"]')).not.toBeNull());

    // A word typed letter by letter: the tasks change with every letter, the engine is not asked for each.
    for (const word of ['a', 'al', 'alp', 'alph', 'alpha']) {
      m.app.setQuery(word);
      await settle();
    }
    expect(m.app.shown.map((t) => t.id).sort()).toEqual(['pub/alpha', 'pub/alphabet']);
    expect(m.hub.estimates.length).toBe(1);
    // The tile stays while the answer is awaited, with the figure of before marked as waiting: nothing jumps.
    expect(target.querySelector('[data-figure="effort"]')?.getAttribute('aria-busy')).toBe('true');
    // Once the typing stopped: one question, for the tasks the whole word keeps.
    await vi.waitFor(() => expect(m.hub.estimates.length).toBe(2), { timeout: 2000 });
    expect([...(m.hub.estimates[1]?.ids ?? [])].sort()).toEqual(['pub/alpha', 'pub/alphabet']);
    await vi.waitFor(() => expect(target.querySelector('[data-figure="effort"]')?.getAttribute('aria-busy')).toBeNull());
    // And no late one after it.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(m.hub.estimates.length).toBe(2);
  });

  it('is not asked while its tile is hidden, and is asked when the tile comes back', async () => {
    const m = make({ token: 't' });
    made = m;
    m.hub.doc = snapshot([task('pub/alpha', { status: 'open' }), task('lib/beta', { status: 'open' })]);
    await m.app.start(null);
    m.app.setStatsTiles(withTile(m.app.statsTiles, 'n:effort', false));
    const target = document.createElement('div');
    document.body.append(target);
    mounted = mount(StatsView, { target, props: { app: m.app } });
    flushSync();
    await settle();
    m.app.setQuery('alpha');
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(m.hub.estimates.length).toBe(0);
    expect(target.querySelector('[data-figure="effort"]')).toBeNull();

    m.app.setStatsTiles(withTile(m.app.statsTiles, 'n:effort', true));
    await settle();
    await vi.waitFor(() => expect(m.hub.estimates.length).toBe(1));
    await vi.waitFor(() => expect(target.querySelector('[data-figure="effort"]')).not.toBeNull());
  });
});

describe('StatsView, the cards', () => {
  async function shown(opened: string[] = []): Promise<{ m: Made; page: HTMLElement }> {
    const m = make({ token: 't', openWindow: (route) => (opened.push(route), true) });
    made = m;
    m.hub.capabilities = [...(m.hub.capabilities ?? []), 'history'];
    m.hub.doc = snapshot([task('pub/alpha', { status: 'open' }), task('pub/beta', { status: 'doing' })]);
    await m.app.start(null);
    m.app.setLang('en');
    const page = document.createElement('div');
    document.body.append(page);
    mounted = mount(StatsView, { target: page, props: { app: m.app } });
    flushSync();
    await settle();
    return { m, page };
  }
  const cards = (page: HTMLElement): string[] => [...page.querySelectorAll('[data-card]')].map((el) => el.getAttribute('data-card') ?? '');

  it('stand below the filter in their order, and "Cut up by" stands in the card of the bars, over them', async () => {
    const { page } = await shown();
    expect(cards(page)).toEqual(['chart', 'figures', 'history', 'table']);
    const chart = page.querySelector('[data-card="chart"]');
    const dims = chart?.querySelector('[role="group"][aria-label="Cut up by"]');
    expect(dims).not.toBeNull();
    // the choice of the field comes before the bars it cuts up
    const bars = chart?.querySelector('.chart');
    expect(dims && bars && dims.compareDocumentPosition(bars) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(page.querySelector('[data-card="figures"] [role="group"][aria-label="Cut up by"]')).toBeNull();
  });

  it('fold by their head, remembered per card and part of the layout of the view', async () => {
    const { m, page } = await shown();
    const head = page.querySelector<HTMLButtonElement>('#stats-table');
    expect(head?.getAttribute('aria-expanded')).toBe('true');
    expect(page.querySelector('#stats-table-body table')).not.toBeNull();
    head?.click();
    await settle();
    expect(page.querySelector('#stats-table')?.getAttribute('aria-expanded')).toBe('false');
    expect(page.querySelector('#stats-table-body')).toBeNull();
    expect(m.prefs.get('tasks-desktop.stats-folds')).toBe('["table"]');
    expect(m.app.layoutChanged('stats')).toBe(true);
    m.app.resetLayout('stats');
    await settle();
    expect(page.querySelector('#stats-table')?.getAttribute('aria-expanded')).toBe('true');
    expect(m.app.layoutChanged('stats')).toBe(false);
  });

  it('open alone in a window with the field and the filter; a window of one card shows only it, until all are asked for', async () => {
    const opened: string[] = [];
    const { m, page } = await shown(opened);
    m.app.setStats('state', 'name');
    await settle();
    page.querySelector<HTMLButtonElement>('[data-card="history"] [data-tool="window"]')?.click();
    expect(opened).toEqual(['#view=stats&card=history&stats=state%3Aname']);

    m.app.openCardRoute({ card: 'table', dim: 'kind' });
    await settle();
    expect(cards(page)).toEqual(['table']);
    expect(m.app.statsDim).toBe('kind');
    // alone it cannot be folded or opened apart again
    expect(page.querySelector('[data-card="table"] [data-tool="window"]')).toBeNull();
    expect(page.querySelector('#stats-table')?.tagName).toBe('SPAN');
    [...page.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Show all statistics')?.click();
    await settle();
    expect(cards(page)).toEqual(['chart', 'figures', 'history', 'table']);
  });

  it('have no window button where the page cannot open a window', async () => {
    const m = make({ token: 't' });
    made = m;
    m.hub.doc = snapshot([task('pub/alpha', { status: 'open' })]);
    await m.app.start(null);
    const page = document.createElement('div');
    document.body.append(page);
    mounted = mount(StatsView, { target: page, props: { app: m.app } });
    flushSync();
    await settle();
    expect(page.querySelector('[data-card="chart"] [data-tool="menu"]')).not.toBeNull();
    expect(page.querySelector('[data-tool="window"]')).toBeNull();
  });

  it('export their numbers: the table of the bars as CSV, the headline numbers as Markdown', async () => {
    const { m, page } = await shown();
    const out = async (card: string, what: string): Promise<void> => {
      page.querySelector<HTMLElement>(`[data-card="${card}"] [data-tool="menu"]`)?.click();
      await settle();
      page.querySelector<HTMLButtonElement>(`[data-card="${card}"] [data-out="${what}"]`)?.click();
      await settle();
    };
    await out('table', 'csv');
    const csv = m.files.at(-1);
    expect(csv?.name).toMatch(/^tasks-stats-table-\d{4}-\d{2}-\d{2}\.csv$/);
    const sep = m.app.csvSeparator;
    expect(csv?.text.split('\r\n').slice(0, 3)).toEqual(['Area|Total|doing|open', 'pub|2|1|1', 'All areas|2|1|1'].map((l) => l.replaceAll('|', sep)));
    await out('figures', 'copy');
    const md = m.copied.at(-1) ?? '';
    expect(md.startsWith('# The vault in numbers\n')).toBe(true);
    expect(md).toContain('| Open | 2 |');
    expect(md).toContain('| By Status | doing | 1 |');
  });

  it('folded, offer no print of the head alone and no export of numbers read from a body not drawn', async () => {
    const { m, page } = await shown();
    m.app.setStatsCardOpen('figures', false);
    m.app.setStatsCardOpen('table', false);
    await settle();
    // the headline numbers are read from the drawn tiles: folded, the card has nothing to put out
    expect(page.querySelector('[data-card="figures"] [data-tool="menu"]')).toBeNull();
    // the table of the bars is counted, not read: it is still exported, but a print would show the head alone
    page.querySelector<HTMLElement>('[data-card="table"] [data-tool="menu"]')?.click();
    await settle();
    expect(page.querySelector('[data-card="table"] [data-out="csv"]')).not.toBeNull();
    expect(page.querySelector('[data-card="table"] [data-out="print"]')).toBeNull();
    m.app.setStatsCardOpen('figures', true);
    await settle();
    page.querySelector<HTMLElement>('[data-card="figures"] [data-tool="menu"]')?.click();
    await settle();
    expect(page.querySelector('[data-card="figures"] [data-out="print"]')).not.toBeNull();
    page.querySelector<HTMLButtonElement>('[data-card="figures"] [data-out="copy"]')?.click();
    await settle();
    expect(m.copied.at(-1)).toContain('| Open | 2 |');
  });

  it('offer no drawing to save while they draw none (no bars without a task)', async () => {
    const m = make({ token: 't' });
    made = m;
    m.hub.doc = snapshot([]);
    await m.app.start(null);
    const page = document.createElement('div');
    document.body.append(page);
    mounted = mount(StatsView, { target: page, props: { app: m.app } });
    flushSync();
    await settle();
    expect(page.querySelector('[data-card="chart"] .chart')).toBeNull();
    page.querySelector<HTMLElement>('[data-card="chart"] [data-tool="menu"]')?.click();
    await settle();
    expect(page.querySelector('[data-card="chart"] [data-out="csv"]')).not.toBeNull();
    expect(page.querySelector('[data-card="chart"] [data-out="svg"]')).toBeNull();
  });
});

describe('StatsView, the bars as SVG', () => {
  it('do not name an area whose class keeps it in the app, as the table does not', async () => {
    const m = make({ token: 't' });
    made = m;
    m.hub.doc = snapshot([task('pub/alpha', { status: 'open' }), task('secret/beta', { status: 'doing' })]);
    m.hub.areaList = [
      { name: 'pub', data_class: 'public' },
      { name: 'secret', data_class: 'private' },
    ];
    await m.app.start(null);
    m.app.setLang('en');
    const page = document.createElement('div');
    document.body.append(page);
    mounted = mount(StatsView, { target: page, props: { app: m.app } });
    flushSync();
    await settle();
    expect(page.querySelector('[data-card="chart"] .area[data-area="secret"]')).not.toBeNull();
    page.querySelector<HTMLElement>('[data-card="chart"] [data-tool="menu"]')?.click();
    await settle();
    page.querySelector<HTMLButtonElement>('[data-card="chart"] [data-out="svg"]')?.click();
    await settle();
    const svg = m.files.at(-1);
    expect(svg?.name).toMatch(/^tasks-stats-chart-.*\.svg$/);
    expect(svg?.text).toContain('>pub</text>');
    expect(svg?.text).toContain('(area not exported)');
    expect(svg?.text).not.toContain('secret');
  });
});

describe('StatsView, the numbers that have a history', () => {
  async function shown(history: boolean) {
    const m = make({ token: 't' });
    made = m;
    if (history) m.hub.capabilities = [...(m.hub.capabilities ?? []), 'history'];
    m.hub.doc = snapshot([task('pub/alpha', { status: 'open' }), task('pub/beta', { status: 'doing' })]);
    await m.app.start(null);
    m.app.setLang('en');
    m.app.setView('stats');
    // jsdom has no layout: the history is brought into view by this, which the test watches.
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    const target = document.createElement('div');
    document.body.append(target);
    mounted = mount(StatsView, { target, props: { app: m.app } });
    flushSync();
    await settle();
    await vi.waitFor(() => expect(target.querySelector('[data-figure="effort"]')).not.toBeNull());
    return { m, target, scrolled };
  }
  const offered = (target: HTMLElement): string[] =>
    [...target.querySelectorAll<HTMLElement>('.figures [data-history]')].map((el) => el.dataset['history'] ?? '');

  it('offer it by the button in their corner, for the figures the series keeps: the effort opens the effort in days', async () => {
    const { m, target, scrolled } = await shown(true);
    expect(offered(target)).toEqual(expect.arrayContaining(['open', 'ready', 'doing', 'blocked', 'effort']));
    expect(offered(target)).not.toContain('noEffort');
    target.querySelector<HTMLButtonElement>('.figures [data-history="effort"]')?.click();
    await settle();
    expect(m.app.statsHistory.metric).toBe('effortDays');
    expect(m.app.view).toBe('stats');
    // Opened inside the statistics: there is no way back to another view to name.
    expect(m.app.historyFrom).toBeNull();
    // The card of the history further down comes into view.
    await vi.waitFor(() => expect(scrolled).toHaveBeenCalled());
  });

  it('open it with the key h on the number', async () => {
    const { m, target } = await shown(true);
    const doing = target.querySelector<HTMLButtonElement>('button[data-figure="doing"]')!;
    expect(doing.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true, cancelable: true }))).toBe(false);
    expect(m.app.statsHistory.metric).toBe('doing');
  });

  it('offer none where the engine keeps no series', async () => {
    const { target } = await shown(false);
    expect(offered(target)).toEqual([]);
  });
});
