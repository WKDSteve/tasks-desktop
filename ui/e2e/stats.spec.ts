import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { expect, isMachineFault, test } from './fixtures';
import { expectAccessible, violations, watchViolations } from './a11y';
import { STATE } from './global';

// The statistics view (`StatsView`): what the pointer and the keyboard do in it. The counting itself and the way from a
// number into the list are in app.spec.ts ("the statistics count the open tasks per area ...").

test.use({ locale: 'en-US' });

const state = (): { token: string } => JSON.parse(readFileSync(STATE, 'utf8')) as { token: string };

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
  expect(await overflow()).toBeLessThanOrEqual(0);
  await expectAccessible(page, 'statistics cut up by tag, narrow');
  await page.evaluate(() => localStorage.removeItem('tasks-desktop.stats'));
  expect(await violations(page)).toEqual([]);
  expect(problems).toEqual([]);
});
