import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, isMachineFault, test } from './fixtures';
import { expectAccessible, violations, watchViolations } from './a11y';
import { STATE } from './global';

// The statistics view (`StatsView`): what the pointer and the keyboard do in it. The counting itself and the way from a
// number into the list are in app.spec.ts ("the statistics count the open tasks per area ...").

test.use({ locale: 'en-US' });

const state = (): { token: string; vault: string } => JSON.parse(readFileSync(STATE, 'utf8')) as { token: string; vault: string };

async function pair(page: Page, path = '/'): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !isMachineFault(m.text())) problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await watchViolations(page);
  await page.addInitScript((token) => sessionStorage.setItem('tasks-desktop.session', token), state().token);
  await page.goto(path);
  await expect(page.getByRole('menubar')).toBeVisible();
  return problems;
}

const background = (row: Locator): Promise<string> => row.evaluate((el) => getComputedStyle(el).backgroundColor);

test('the numbers per area: the row under the pointer and the row with the focus stand out, the head and the sums do not', async ({
  page,
}) => {
  const problems = await pair(page, '/#view=stats');
  const table = page.getByRole('table', { name: 'The numbers per area' });
  await expect(table).toBeVisible();
  const rows = table.locator('tbody tr');
  expect(await rows.count()).toBeGreaterThan(1);
  const first = rows.nth(0);
  const second = rows.nth(1);
  const head = table.locator('thead tr');
  const sums = table.locator('tfoot tr');
  // Somewhere the pointer rests off the table (the heading of the page is for screen readers only).
  const away = page.locator('#stats-figures');

  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    // Away from the table: no row stands out.
    await away.hover();
    const plain = await background(first);
    expect(await background(second), scheme).toBe(plain);

    await first.locator('th').hover();
    await expect.poll(() => background(first), { message: `${scheme}: the row under the pointer` }).not.toBe(plain);
    expect(await background(second), scheme).toBe(plain);
    const marked = await background(first);
    // The numbers of the highlighted row keep their contrast.
    await expectAccessible(page, `statistics with a row under the pointer, ${scheme}`);

    // The head and the sums are not rows to read along.
    const headPlain = await background(head);
    const sumsPlain = await background(sums);
    await head.locator('th').first().hover();
    expect(await background(head), scheme).toBe(headPlain);
    await sums.locator('th').hover();
    expect(await background(sums), scheme).toBe(sumsPlain);

    // The keyboard: the row a cell of which has the focus stands out, with the pointer elsewhere.
    await away.hover();
    await second.getByRole('button').first().focus();
    await expect.poll(() => background(second), { message: `${scheme}: the row with the focus` }).not.toBe(plain);
    expect(await background(first), scheme).toBe(plain);
    // The same ground as under the pointer, which axe has read above: one pass per scheme keeps the test short.
    expect(await background(second), scheme).toBe(marked);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  }
  expect(await violations(page)).toEqual([]);
  expect(problems).toEqual([]);
});

test('cut up by who: the stacks are the people, a number opens exactly those tasks in the list, and the choice outlives a reload', async ({
  page,
}) => {
  const problems = await pair(page, '/#view=stats');
  const table = page.getByRole('table', { name: 'The numbers per area' });
  await expect(table).toBeVisible();
  const dims = page.getByRole('group', { name: 'Cut up by' });
  // Every field explains itself, and a field the tasks name freely says how many values it names.
  expect(await dims.getByRole('button').count()).toBe(14);
  await expect(dims.getByRole('button', { name: 'Who' })).toHaveAttribute('data-hint', /by Who: one stack per value\.$/);
  await expect(dims.getByRole('button', { name: 'Tag' })).toHaveAttribute('data-hint', /counts in each of them\. The 10 most frequent/);

  const who = dims.getByRole('button', { name: 'Who' });
  await who.click();
  await expect(who).toHaveAttribute('aria-pressed', 'true');
  // The stacks carry the words of the page for who does a task, not the engine's.
  const heads = (await table.locator('thead th').allTextContents()).slice(2);
  expect(heads.length).toBeGreaterThan(0);
  for (const head of heads) expect(['Me', 'Together', 'AI', 'Unassigned', 'Finished (30 days)']).toContain(head);
  // Every task has one who: the stacks add up to the open tasks, and no note says otherwise.
  await expect(page.locator('[data-note="multi"]')).toHaveCount(0);
  await expectAccessible(page, 'statistics cut up by who');

  // The sum of a stack over all areas opens the list with that who chosen, and the list counts as many.
  const sum = table.locator('tfoot').getByRole('button', { name: /^All areas, [^:]+: \d+ - show in the list$/ }).first();
  const label = (await sum.getAttribute('aria-label')) ?? '';
  const [, name = '', n = ''] = /^All areas, ([^:]+): (\d+) /.exec(label) ?? [];
  const word = { Me: 'me', Together: 'pair', AI: 'cdx', Unassigned: 'none' }[name];
  expect(word, label).toBeDefined();
  await sum.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('List');
  const filter = await page.evaluate(() => JSON.parse(localStorage.getItem('tasks-desktop.filter') ?? '{}') as { actors?: string[] });
  expect(filter.actors).toEqual([word]);
  await expect(page.locator('.count [role="status"]')).toHaveText(new RegExp(`^${n} of \\d+$`));

  // Back in the statistics the field is still the one chosen, and after a reload too.
  await page.goto('/#view=stats');
  await expect(page.getByRole('group', { name: 'Cut up by' }).getByRole('button', { name: 'Who' })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.getByRole('group', { name: 'Cut up by' }).getByRole('button', { name: 'Who' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Clear all filters' }).click();
  await page.evaluate(() => localStorage.removeItem('tasks-desktop.stats'));
  expect(await violations(page)).toEqual([]);
  expect(problems).toEqual([]);
});

test('cut up by a list field: a task counts in each of its values and the view says so; the fields fit a narrow window', async ({ page }) => {
  // One task with two tags of its own (the fixture takes the file away again): it must count in both of them.
  const [tagA, tagB] = ['e2e-stats-two-tags-a', 'e2e-stats-two-tags-b'];
  const file = join(state().vault, 'lib.nvim', 'ROADMAP', 'tasks', 'e2e-stats-two-tags.md');
  writeFileSync(
    file,
    `---
title: Stats two tags
status: open
kind: task
tags: [${tagA}, ${tagB}]
---

Counted in both of its tags.
`,
  );
  await page.setViewportSize({ width: 380, height: 800 });
  const problems = await pair(page, '/#view=stats');
  const table = page.getByRole('table', { name: 'The numbers per area' });
  await expect(table).toBeVisible();
  const dims = page.getByRole('group', { name: 'Cut up by' });
  // Fourteen fields wrap: the page does not scroll sideways for them.
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);

  await dims.getByRole('button', { name: 'Tag' }).click();
  await expect(dims.getByRole('button', { name: 'Tag' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-note="multi"]')).toContainText('counts in each of them');
  // The total of the table stays the number of tasks, whatever the stacks add up to.
  const open = page.locator('button.figure[data-figure="open"] .n');
  await expect(table.locator('tfoot td').first()).toHaveText((await open.textContent()) ?? '');
  // Both stacks of the task count it once, and the total counts it once: the stacks add up to more than the total.
  for (const tag of [tagA, tagB]) await expect(table.locator('tfoot').getByRole('button', { name: new RegExp(`^All areas, ${tag}: 1 `) })).toBeVisible();
  const total = Number(await table.locator('tfoot td').first().textContent());
  const stacks = (await table.locator('tfoot td.num button.link').allTextContents()).map(Number).reduce((a, b) => a + b, 0);
  expect(stacks).toBeGreaterThan(total);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await expectAccessible(page, 'statistics cut up by tag, narrow');
  await page.evaluate(() => localStorage.removeItem('tasks-desktop.stats'));
  expect(await violations(page)).toEqual([]);
  expect(problems).toEqual([]);
  // Take the task away and wait until the hub no longer lists it: the next test would otherwise get a snapshot with a
  // task that is gone, and the page would ask the engine about it (400).
  rmSync(file);
  await expect
    .poll(
      async () => {
        const response = await page.request.get('/api/tasks/snapshot', { headers: { authorization: `Bearer ${state().token}` } });
        const doc = (await response.json()) as { tasks?: { id: string }[] };
        return (doc.tasks ?? []).some((t) => t.id === 'lib.nvim/e2e-stats-two-tags');
      },
      { timeout: 15_000 },
    )
    .toBe(false);
});

test('the tiles of the vault in numbers: one is hidden with its x, the choice brings it and a field back, and it holds after a reload', async ({
  page,
}) => {
  const problems = await pair(page, '/#view=stats');
  await expect(page.getByRole('table', { name: 'The numbers per area' })).toBeVisible();
  const tile = (id: string) => page.locator(`[data-tile="${id}"]`);
  const hiddenNote = page.getByTestId('tiles-hidden');
  // As it comes: every number, the fields most looked at, and the rest there to be added.
  await expect(tile('n:ready')).toBeVisible();
  await expect(tile('d:status')).toBeVisible();
  await expect(tile('d:actor')).toBeVisible();
  await expect(tile('d:tag')).toHaveCount(0);
  await expect(hiddenNote).toHaveText('8 hidden');
  // The tile of a field counts what "Cut up by" counts: its numbers add up to the open tasks.
  const open = Number(await page.locator('button.figure[data-figure="open"] .n').textContent());
  const counts = await tile('d:status').locator('.count').allTextContents();
  expect(counts.map(Number).reduce((a, b) => a + b, 0)).toBe(open);

  // The x is there for the pointer over the tile and for the focus in it, not otherwise.
  const hide = tile('n:ready').getByRole('button', { name: 'Hide Ready' });
  const opacity = () => hide.evaluate((el) => getComputedStyle(el).opacity);
  await page.locator('#stats-figures').hover();
  expect(await opacity()).toBe('0');
  await hide.focus();
  expect(await opacity()).toBe('1');
  await hide.evaluate((el) => (el as HTMLElement).blur());
  await tile('n:ready').hover();
  expect(await opacity()).toBe('1');
  await expectAccessible(page, 'statistics with the x of a tile shown');
  await hide.click();
  await expect(tile('n:ready')).toHaveCount(0);
  await expect(hiddenNote).toHaveText('9 hidden');
  // The focus is not lost with the x: it is on the x of the tile that took the place, so the next can go at once.
  await expect(tile('n:doing').getByRole('button', { name: 'Hide Doing' })).toBeFocused();
  const pick = page.locator('.pick').getByRole('button', { name: /^Tiles: \d+$/ });

  await page.reload();
  await expect(tile('d:status')).toBeVisible();
  await expect(tile('n:ready')).toHaveCount(0);
  await expect(hiddenNote).toHaveText('9 hidden');

  // The choice lists every tile, the shown ones ticked; a tick brings a tile back, another adds a field.
  await pick.click();
  const popup = page.getByRole('group', { name: 'Tiles' });
  await expect(popup.getByRole('checkbox', { name: 'Ready', exact: true })).not.toBeChecked();
  await expect(popup.getByRole('checkbox', { name: 'Open', exact: true })).toBeChecked();
  await expectAccessible(page, 'statistics with the choice of the tiles open');
  await popup.getByRole('checkbox', { name: 'Ready', exact: true }).check();
  await expect(tile('n:ready')).toBeVisible();
  await popup.getByRole('checkbox', { name: 'By Tag', exact: true }).check();
  await expect(tile('d:tag')).toBeVisible();
  await expect(hiddenNote).toHaveText('7 hidden');
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tasks-desktop.stats-tiles') ?? '{}'))).toEqual({ on: ['d:tag'], off: [] });

  // A value of a tile opens its tasks in the list, like a number.
  const value = tile('d:status').getByRole('button', { name: /^Status [^:]+: \d+ - show in the list$/ }).first();
  const n = /: (\d+) /.exec((await value.getAttribute('aria-label')) ?? '')?.[1] ?? '';
  await value.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('List');
  await expect(page.locator('.count [role="status"]')).toHaveText(new RegExp(`^${n} of \\d+$`));
  const filter = await page.evaluate(() => JSON.parse(localStorage.getItem('tasks-desktop.filter') ?? '{}') as { statuses?: string[] });
  expect(filter.statuses).toHaveLength(1);

  // The reset of the choice shows the tiles as they came.
  await page.goto('/#view=stats');
  await page.getByRole('button', { name: 'Clear all filters' }).click();
  await expect(tile('d:tag')).toBeVisible();
  await page.locator('.pick').getByRole('button', { name: /^Tiles: \d+$/ }).click();
  await page.locator('.pick .reset').click();
  await expect(tile('d:tag')).toHaveCount(0);
  await expect(hiddenNote).toHaveText('8 hidden');
  await page.keyboard.press('Escape');
  await page.evaluate(() => localStorage.removeItem('tasks-desktop.stats-tiles'));
  expect(await violations(page)).toEqual([]);
  expect(problems).toEqual([]);
});

test('the tiles on a narrow touch screen: the x is always there and nothing scrolls sideways', async ({ newContext }) => {
  const context = await newContext({ viewport: { width: 380, height: 800 }, hasTouch: true, isMobile: true, locale: 'en-US' });
  const page = await context.newPage();
  const problems = await pair(page, '/#view=stats');
  await expect(page.getByRole('table', { name: 'The numbers per area' })).toBeVisible();
  const hide = page.locator('[data-tile="d:status"]').getByRole('button', { name: 'Hide By Status' });
  expect(await hide.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await hide.tap();
  await expect(page.locator('[data-tile="d:status"]')).toHaveCount(0);
  await expectAccessible(page, 'statistics on a narrow touch screen');
  await page.evaluate(() => localStorage.removeItem('tasks-desktop.stats-tiles'));
  expect(await violations(page)).toEqual([]);
  expect(problems).toEqual([]);
});

test('the filter bar of the list stands over the statistics: a status chosen there narrows the numbers and the list alike, and the bar folds away and stays so', async ({
  page,
}) => {
  const problems = await pair(page, '/#view=stats');
  await expect(page.getByRole('table', { name: 'The numbers per area' })).toBeVisible();
  const bar = page.getByRole('region', { name: 'Filter', exact: true });
  const counted = page.getByTestId('stats-filter-count');
  const open = page.locator('button.figure[data-figure="open"] .n');
  // Unfolded at first: the search, the quick filters and "More filters", and what only the list needs is not there.
  await expect(bar.getByRole('searchbox')).toBeVisible();
  await expect(bar.locator('summary', { hasText: 'More filters' })).toBeVisible();
  await expect(bar.locator('select[data-sort]')).toHaveCount(0);
  await expect(bar.locator('select[data-lists]')).toHaveCount(0);
  const all = Number(await open.textContent());
  await expect(counted).toHaveText(`${all} of ${all} open tasks are counted`);
  await expectAccessible(page, 'statistics with the filter bar');

  // A status chosen in the bar: the numbers follow at once.
  await bar.getByRole('button', { name: 'Status', exact: true }).click();
  const popup = bar.getByRole('group', { name: 'Status' });
  const box = popup.getByRole('checkbox').first();
  await box.check();
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  const kept = Number(/^(\d+) of/.exec((await counted.textContent()) ?? '')?.[1]);
  expect(kept).toBeGreaterThan(0);
  expect(kept).toBeLessThan(all);
  await expect(open).toHaveText(String(kept));
  await expect(page.getByRole('table', { name: 'The numbers per area' }).locator('tfoot td').first()).toHaveText(String(kept));
  // The bar names what is on, once (the strip of the other views is for the folded bar).
  await expect(bar.getByRole('list', { name: 'Filters that are on' })).toBeVisible();
  await expect(page.getByTestId('filter-note')).toHaveCount(0);
  const status = await page.evaluate(() => (JSON.parse(localStorage.getItem('tasks-desktop.filter') ?? '{}') as { statuses?: string[] }).statuses);
  expect(status).toHaveLength(1);

  // It is the filter of the list: the list shows as many, with the same status chosen.
  await page.goto('/#view=list');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('List');
  await expect(page.locator('.count [role="status"]')).toHaveText(`${kept} of ${all}`);
  await expect(page.getByRole('list', { name: 'Filters that are on' })).toBeVisible();

  // Folded: one line and the strip that names the filter; it stays folded over a reload.
  await page.goto('/#view=stats');
  const fold = bar.getByRole('button', { name: 'Filter', exact: true });
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await expect(bar.getByRole('searchbox')).toHaveCount(0);
  await expect(counted).toHaveText(`${kept} of ${all} open tasks are counted`);
  await expect(page.getByTestId('filter-note')).toBeVisible();
  await expectAccessible(page, 'statistics with the filter bar folded');
  await page.reload();
  await expect(page.getByRole('table', { name: 'The numbers per area' })).toBeVisible();
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await expect(bar.getByRole('searchbox')).toHaveCount(0);
  // The keyboard unfolds it again, and the reset of the bar takes the filter away.
  await fold.focus();
  await page.keyboard.press('Enter');
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  await bar.getByRole('button', { name: 'Clear all filters' }).click();
  await expect(open).toHaveText(String(all));
  await page.evaluate(() => localStorage.removeItem('tasks-desktop.stats-filter'));
  expect(await violations(page)).toEqual([]);
  expect(problems).toEqual([]);
});

test('the effort tile keeps its figure readable while the next one is asked: marked as waiting, with its contrast', async ({ page }) => {
  // The answer of the engine is held, the tile is looked at twice in two themes: more than a few steps.
  test.slow();
  const problems = await pair(page, '/#view=stats');
  await expect(page.getByRole('table', { name: 'The numbers per area' })).toBeVisible();
  const tile = page.locator('[data-figure="effort"]');
  await expect(tile).toBeVisible();
  await expect(tile).not.toHaveAttribute('aria-busy', 'true');

  // The next question of the effort does not come back until the test lets it.
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/tasks/estimate', async (route) => {
    await held;
    await route.continue().catch(() => undefined);
  });
  try {
    // An entry of the legend narrows what is counted: the figure of before stays, marked as waiting.
    await page.locator('.legend .entry').first().click();
    await expect(tile).toHaveAttribute('aria-busy', 'true');
    await expect(tile.locator('.n')).toHaveText(/^[\d.,]+ d$/);
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectAccessible(page, `statistics with the effort tile waiting, ${scheme}`);
    }
  } finally {
    release();
  }
  await expect(tile).not.toHaveAttribute('aria-busy', 'true');
  await page.unroute('**/api/tasks/estimate');
  await page.getByRole('button', { name: 'Clear all filters' }).click();
  expect(await violations(page)).toEqual([]);
  expect(problems).toEqual([]);
});

test('the cards of the statistics: their order, "Cut up by" over the bars, a fold that holds, and buttons that come with the pointer', async ({
  page,
}) => {
  const problems = await pair(page, '/#view=stats');
  await expect(page.getByRole('table', { name: 'The numbers per area' })).toBeVisible();
  const cards = page.locator('[data-card]');
  await expect.poll(() => cards.evaluateAll((els) => els.map((el) => el.getAttribute('data-card')))).toEqual([
    'chart',
    'figures',
    'history',
    'table',
  ]);
  // The choice of the field stands in the card of the bars, above them.
  const chart = page.getByRole('region', { name: 'Open tasks per area' });
  await expect(chart.getByRole('group', { name: 'Cut up by' })).toBeVisible();
  const above = await chart.evaluate((card) => {
    const dims = card.querySelector('[role="group"][aria-label="Cut up by"]');
    const bars = card.querySelector('.chart');
    return dims !== null && bars !== null && dims.getBoundingClientRect().bottom <= bars.getBoundingClientRect().top;
  });
  expect(above).toBe(true);

  // The buttons of a card are there for the pointer over it and the focus in it, not otherwise.
  const table = page.getByRole('region', { name: 'The numbers per area' });
  const tools = table.locator('.tools');
  const opacity = (): Promise<string> => tools.evaluate((el) => getComputedStyle(el).opacity);
  await page.mouse.move(1, 1);
  await expect.poll(opacity).toBe('0');
  await table.hover();
  await expect.poll(opacity).toBe('1');
  await expect(table.getByRole('button', { name: 'Open "The numbers per area" in a window of its own' })).toHaveAttribute('data-hint', /new window/);

  // The head folds the card, by the pointer and by Enter and Space; it stays folded after a reload.
  const head = page.getByRole('button', { name: 'The numbers per area', exact: true });
  await expect(head).toHaveAttribute('aria-expanded', 'true');
  await head.click();
  await expect(head).toHaveAttribute('aria-expanded', 'false');
  await expect(table.getByRole('table')).toHaveCount(0);
  await head.press('Enter');
  await expect(head).toHaveAttribute('aria-expanded', 'true');
  await head.press('Space');
  await expect(head).toHaveAttribute('aria-expanded', 'false');
  await page.mouse.move(1, 1);
  await head.focus();
  await expect.poll(opacity).toBe('1');
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `statistics with a folded card, ${scheme}`);
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.reload();
  await expect(page.getByRole('button', { name: 'The numbers per area', exact: true })).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => localStorage.getItem('tasks-desktop.stats-folds'))).toBe('["table"]');
  await page.getByRole('button', { name: 'The numbers per area', exact: true }).click();
  await expect(page.getByRole('table', { name: 'The numbers per area' })).toBeVisible();
  expect(await violations(page)).toEqual([]);
  expect(problems).toEqual([]);
});

test('a card alone: in a window of its own with the same field, on paper without the others, and as files', async ({ page, context }) => {
  const problems = await pair(page, '/#view=stats');
  const dims = page.getByRole('group', { name: 'Cut up by' });
  await dims.getByRole('button', { name: 'Kind' }).click();
  const chart = page.getByRole('region', { name: 'Open tasks per area' });
  await chart.hover();

  // A window of its own: only this card, cut up by the same field; the whole statistics are one press away.
  const [tab] = await Promise.all([
    context.waitForEvent('page'),
    chart.getByRole('button', { name: 'Open "Open tasks per area" in a window of its own' }).click(),
  ]);
  await expect(tab.locator('[data-card]')).toHaveCount(1);
  await expect(tab.getByRole('region', { name: 'Open tasks per area' })).toBeVisible();
  await expect(tab.getByRole('group', { name: 'Cut up by' }).getByRole('button', { name: 'Kind' })).toHaveAttribute('aria-pressed', 'true');
  expect(new URL(tab.url()).hash).toMatch(/^#view=stats&card=chart&stats=kind%3A/);
  await expectAccessible(tab, 'one card of the statistics in a window of its own');
  await tab.getByRole('button', { name: 'Show all statistics' }).click();
  await expect(tab.locator('[data-card]')).toHaveCount(4);
  await tab.close();

  // The menu of the card: print leaves the other cards off the paper.
  await page.evaluate(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => void ((window as unknown as { printed: number }).printed += 1);
  });
  // the menu opens from a summary (a disclosure, not a button)
  const menu = chart.locator('[data-tool="menu"]');
  await expect(menu).toHaveAccessibleName('Print or export "Open tasks per area"');
  await menu.click();
  const ways = chart.getByRole('group', { name: 'Print or export "Open tasks per area"' });
  await expect(ways).toBeVisible();
  await expectAccessible(page, 'the menu of a card of the statistics');
  await page.keyboard.press('Escape');
  await expect(ways).toBeHidden();
  await expect(menu).toBeFocused();
  await menu.click();
  await ways.getByRole('button', { name: 'Print' }).click();
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  await page.emulateMedia({ media: 'print' });
  await expect(chart).toBeVisible();
  await expect(page.getByRole('region', { name: 'The numbers per area' })).toBeHidden();
  await expect(chart.locator('.tools')).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.emulateMedia({ media: 'screen' });
  await expect(page.getByRole('region', { name: 'The numbers per area' })).toBeVisible();

  // Its numbers as CSV and its drawing as SVG.
  await menu.click();
  const [csv] = await Promise.all([page.waitForEvent('download'), ways.getByRole('button', { name: 'Save as CSV ...' }).click()]);
  expect(csv.suggestedFilename()).toMatch(/^tasks-stats-chart-\d{4}-\d{2}-\d{2}\.csv$/);
  // a byte order mark first, for the umlauts in a spreadsheet
  expect(readFileSync((await csv.path())!, 'utf8')).toMatch(new RegExp(`^${String.fromCharCode(0xfeff)}Area,Total,`));
  await menu.click();
  const [svg] = await Promise.all([page.waitForEvent('download'), ways.getByRole('button', { name: 'Save as SVG ...' }).click()]);
  const drawing = readFileSync((await svg.path())!, 'utf8');
  expect(drawing).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
  expect(drawing).toMatch(/<rect [^>]*fill="rgb/);
  await page.evaluate(() => localStorage.removeItem('tasks-desktop.stats'));
  expect(await violations(page)).toEqual([]);
  expect(problems).toEqual([]);
});
