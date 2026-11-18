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
