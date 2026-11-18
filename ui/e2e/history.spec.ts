import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, isMachineFault, test } from './fixtures';
import { expectAccessible, watchViolations } from './a11y';
import { STATE } from './global';

// The history of a figure (`StatsHistory`): a number of the overview opens the statistics with its figure chosen, the
// period is the person's and is remembered, and the way back ends where it began. The series is the engine's
// (`tasks.history`); a vault that keeps none says so and offers to start it.

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

test('a number of the overview opens the history of its figure; the period is remembered and the way back ends at the number', async ({
  page,
}) => {
  test.slow();
  const problems = await pair(page, '/#view=today');
  const trend = page.locator('[data-history="estimated"]');
  await expect(trend).toBeVisible();
  await expect(trend).toHaveAccessibleName('History of with value');
  await trend.click();

  const section = page.getByRole('region', { name: 'History' });
  await expect(section).toBeVisible();
  await expect(section).toBeInViewport();
  const figure = section.locator('[data-history-metric]');
  await expect(figure).toHaveValue('withValue');

  // The vault of the tests keeps no series until one is started (another run of this test may have started it).
  const chart = section.getByRole('img');
  const none = section.locator('[data-history-empty="no-series"]');
  await expect(chart.or(none)).toBeVisible();
  if (await none.isVisible()) {
    await expect(none).toContainText('keeps no history');
    const answered = page.waitForResponse((r) => r.url().includes('/api/tasks/ops') && r.request().method() === 'POST');
    await none.getByRole('button', { name: 'Start the history today' }).click();
    expect((await answered).status()).toBe(200);
  }
  await expect(chart).toBeVisible();
  await expect(chart).toHaveAccessibleName(/^With a value from \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}$/);
  // the same numbers as a table, for the keyboard and a screen reader
  await section.getByText('The numbers', { exact: true }).click();
  await expect(section.getByRole('table')).toBeVisible();
  await expect(section.getByRole('rowheader').last()).toHaveText(/^\d{4}-\d{2}-\d{2}$/);

  // another figure and another period: asked of the engine, and remembered
  const asked = page.waitForRequest((r) => r.url().includes('/api/tasks/history') && r.url().includes('resolution=day'));
  await section.locator('[data-history-period]').selectOption('7d');
  await asked;
  await figure.selectOption('ready');
  await expect(chart).toHaveAccessibleName(/^Ready from /);
  await expectAccessible(page, 'statistics with the history of a figure');

  // back to the overview: the number it was opened from is there again
  await section.getByRole('button', { name: 'Back to the overview' }).click();
  await expect(trend).toBeVisible();
  await expect(page.getByRole('region', { name: 'History' })).toHaveCount(0);

  await page.reload();
  await page.goto('/#view=stats');
  await expect(section.locator('[data-history-period]')).toHaveValue('7d');
  await expect(section.locator('[data-history-metric]')).toHaveValue('ready');
  // opened by the address, not from a number: there is no way back to offer
  await expect(section.getByRole('button', { name: 'Back to the overview' })).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('the key h on a number of the overview opens its history; a custom period asks for the days that were typed', async ({ page }) => {
  const problems = await pair(page, '/#view=today');
  const tile = page.locator('.tile[data-count="ready"]');
  await tile.focus();
  await page.keyboard.press('h');
  const section = page.getByRole('region', { name: 'History' });
  await expect(section).toBeVisible();
  await expect(section.locator('[data-history-metric]')).toHaveValue('ready');

  await section.locator('[data-history-period]').selectOption('custom');
  const from = section.getByLabel('From', { exact: true });
  const to = section.getByLabel('To', { exact: true });
  const asked = page.waitForRequest((r) => r.url().includes('since=2026-01-05') && r.url().includes('until=2026-01-20'));
  await from.fill('2026-01-05');
  await to.fill('2026-01-20');
  await asked;
  // what the files say about every day needs no series: a line even for a window before it
  await section.locator('[data-history-metric]').selectOption('created');
  await expect(section.getByRole('img')).toHaveAccessibleName('Created per day from 2026-01-05 to 2026-01-20');
  expect(problems).toEqual([]);
});
