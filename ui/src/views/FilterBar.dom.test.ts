// @vitest-environment jsdom
// The filter bar the list and the statistics share, in a DOM: it changes the one filter of the page, names what is on,
// and gives the focus a place when a filter goes. And the fold the statistics put it in: folded it is one line and
// the strip of the other views, and the state is remembered.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import { task } from '../lib/fixtures';
import FilterBar from './FilterBar.svelte';
import StatsFilter from './StatsFilter.svelte';

type Made = ReturnType<typeof make>;

let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;

async function settle(): Promise<void> {
  await tick();
  flushSync();
}

async function started(prefs?: Map<string, string>): Promise<Made> {
  const m = make({ token: 't', ...(prefs ? { prefs } : {}) });
  m.hub.doc = snapshot([
    task('pub/a', { status: 'open', actor: 'me', tags: ['ui'], scope: ['docs'] }),
    task('pub/b', { status: 'doing', actor: 'cdx' }),
    task('lib/c', { status: 'open' }),
  ]);
  await m.app.start(null);
  // The words are asked for in English, whatever the machine speaks.
  m.app.setLang('en');
  made = m;
  return m;
}

function show(component: typeof FilterBar | typeof StatsFilter, m: Made, props: Record<string, unknown> = {}): HTMLElement {
  const target = document.createElement('div');
  document.body.append(target);
  mounted = mount(component, { target, props: { app: m.app, ...props } });
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

describe('FilterBar', () => {
  it('shows the search words of the filter and writes what is typed into it', async () => {
    const m = await started();
    m.app.setQuery('alpha');
    const page = show(FilterBar, m);
    const search = page.querySelector<HTMLInputElement>('input[type="search"]');
    expect(search?.value).toBe('alpha');
    expect(search?.dataset['hint']).toBeTruthy();
    search!.value = 'beta';
    search!.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(m.app.filter.query).toBe('beta');
    // The x beside the field empties the words and gives the field the focus.
    page.querySelector<HTMLButtonElement>('.search-clear')!.click();
    await settle();
    expect(m.app.filter.query).toBe('');
    expect(document.activeElement).toBe(search);
  });

  it('names every filter that is on as a chip, and "Clear all filters" takes them away with the focus on the fold', async () => {
    const m = await started();
    const page = show(FilterBar, m);
    expect(page.querySelector('ul.active')).toBeNull();
    m.app.filter = { ...m.app.filter, statuses: ['open'], fields: { scope: ['docs'] } };
    await settle();
    const chips = [...page.querySelectorAll('ul.active li')].map((li) => li.textContent?.replace(/\s+/g, ' ').trim());
    expect(chips.length).toBe(3);
    expect(chips[0]).toContain('Status');
    expect(chips[1]).toContain('Scope: docs');
    // A filter beyond the quick ones is counted on the fold.
    const fold = page.querySelector<HTMLElement>('details.more summary');
    expect(fold?.textContent).toBe('More filters (1)');
    // One chip switched off: the focus stays in the chips.
    page.querySelector<HTMLButtonElement>('ul.active li button')!.click();
    await settle();
    expect(m.app.filter.statuses).toEqual([]);
    expect(page.querySelector('ul.active')?.contains(document.activeElement)).toBe(true);
    const clear = [...page.querySelectorAll<HTMLButtonElement>('ul.active button')].find((b) => b.textContent === 'Clear all filters');
    clear!.click();
    await settle();
    expect(m.app.filter.fields).toEqual({});
    expect(page.querySelector('ul.active')).toBeNull();
    expect(document.activeElement).toBe(fold);
  });

  it('counts the choices a view adds to the fold with the filters, and offers a field only when a task has a value for it', async () => {
    const m = await started();
    const page = show(FilterBar, m, { moreOn: 1 });
    expect(page.querySelector('details.more summary')?.textContent).toBe('More filters (1)');
    const names = [...page.querySelectorAll('details.more .more-body .trigger .summary')].map((el) => el.textContent);
    expect(names).toContain('Tag');
    expect(names).toContain('Scope');
    // No task has a severity: nothing to choose.
    expect(names).not.toContain('Severity');
  });
});

describe('StatsFilter', () => {
  it('shows the bar unfolded at first and says how many tasks are counted', async () => {
    const m = await started();
    const page = show(StatsFilter, m);
    const fold = page.querySelector<HTMLButtonElement>('button.fold');
    expect(fold?.getAttribute('aria-expanded')).toBe('true');
    expect(fold?.dataset['hint']).toBeTruthy();
    expect(page.querySelector('input[type="search"]')).not.toBeNull();
    expect(page.querySelector('[data-testid="stats-filter-count"]')?.textContent).toBe('3 of 3 open tasks are counted');
    m.app.filter = { ...m.app.filter, statuses: ['doing'] };
    await settle();
    expect(page.querySelector('[data-testid="stats-filter-count"]')?.textContent).toBe('1 of 3 open tasks are counted');
    // Unfolded, the chips are the bar's: the strip of the other views would name them twice.
    expect(page.querySelector('[data-testid="filter-note"]')).toBeNull();
    expect(page.querySelectorAll('ul.active').length).toBe(1);
  });

  it('folded is one line and the strip that names what is on; the state is remembered and belongs to the layout', async () => {
    const m = await started();
    m.app.filter = { ...m.app.filter, statuses: ['doing'] };
    const page = show(StatsFilter, m);
    page.querySelector<HTMLButtonElement>('button.fold')!.click();
    await settle();
    expect(page.querySelector('button.fold')?.getAttribute('aria-expanded')).toBe('false');
    expect(page.querySelector('input[type="search"]')).toBeNull();
    expect(page.querySelector('[data-testid="stats-filter-count"]')?.textContent).toBe('1 of 3 open tasks are counted');
    expect(page.querySelector('[data-testid="filter-note"]')).not.toBeNull();
    expect(m.prefs.get('tasks-desktop.stats-filter')).toBe('closed');
    expect(m.app.layoutChanged('stats')).toBe(true);

    // The next start of the page reads it back.
    const next = make({ token: 't', prefs: m.prefs });
    expect(next.app.statsFilterOpen).toBe(false);
    next.app.stop();

    m.app.resetLayout('stats');
    await settle();
    expect(m.app.statsFilterOpen).toBe(true);
    expect(page.querySelector('input[type="search"]')).not.toBeNull();
    expect(m.app.layoutChanged('stats')).toBe(false);
  });
});
