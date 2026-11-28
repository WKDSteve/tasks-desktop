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
  // the same numbers as a table for a screen reader only: nothing of it is seen, no fold to open
  await expect(section.getByText('The numbers', { exact: true })).toHaveCount(0);
  const numbers = section.locator('table[data-history-numbers]');
  await expect(numbers).toBeAttached();
  const box = numbers.locator('xpath=..');
  await expect(box).toHaveClass(/sr-only/);
  expect(await box.evaluate((el) => el.getBoundingClientRect().width * el.getBoundingClientRect().height)).toBeLessThanOrEqual(1);
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

  // The address first, then the reload: the page starts with #view=stats. A change of the hash alone right after a
  // reload can come while the page still starts, and a slow start (CI run 46141689290) then left it on its last view.
  await page.goto('/#view=stats');
  await page.reload();
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

  // the context menu of a number offers the same way (the click on the number itself opens its tasks, as before)
  await page.goto('/#view=today');
  await page.locator('.tile[data-count="blocked"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'History of blocked' }).click();
  await expect(section).toBeVisible();
  await expect(section.locator('[data-history-metric]')).toHaveValue('blocked');

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

test('the numbers of the statistics open their history too: the sum of the effort by its button, a count by h and by its menu', async ({
  page,
}) => {
  const problems = await pair(page, '/#view=stats');
  const section = page.getByRole('region', { name: 'History' });
  const effort = page.locator('[data-tile="n:effort"]');
  await expect(effort).toBeVisible();
  const trend = effort.locator('[data-history="effort"]');
  await expect(trend).toHaveAccessibleName('History of Effort');
  // A number the series does not keep offers none.
  await expect(page.locator('[data-tile="n:noEffort"] [data-history]')).toHaveCount(0);
  await expectAccessible(page, 'the numbers of the statistics with their history buttons');
  await trend.click();
  await expect(section.locator('[data-history-metric]')).toHaveValue('effortDays');
  await expect(section).toBeInViewport();
  // Opened inside the statistics: no way back to another view.
  await expect(section.locator('.back')).toHaveCount(0);

  await page.locator('button[data-figure="doing"]').focus();
  await page.keyboard.press('h');
  await expect(section.locator('[data-history-metric]')).toHaveValue('doing');

  await page.locator('[data-tile="n:open"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'History of Open' }).click();
  await expect(section.locator('[data-history-metric]')).toHaveValue('open');
  expect(problems).toEqual([]);
});

test('the button of the history covers no text of its number, on a phone and on a wide window', async ({ page }) => {
  const problems = await pair(page, '/#view=stats');
  await expect(page.locator('[data-tile="n:effort"] [data-history]')).toBeVisible();
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    // Every text of every number that has the button, against the box of the button.
    const covered = await page.locator('.figures .tile:has([data-history])').evaluateAll((tiles) =>
      tiles.flatMap((tile) => {
        const button = tile.querySelector('[data-history]')!.getBoundingClientRect();
        return [...tile.querySelectorAll('.label, .n, .sub')].flatMap((text) => {
          const range = document.createRange();
          range.selectNodeContents(text);
          const box = range.getBoundingClientRect();
          const apart = box.right <= button.left || box.left >= button.right || box.bottom <= button.top || box.top >= button.bottom;
          return apart ? [] : [`${tile.getAttribute('data-tile')}: "${text.textContent?.trim()}"`];
        });
      }),
    );
    expect(covered, `covered at ${width} px`).toEqual([]);
  }
  expect(problems).toEqual([]);
});

test('the history follows "Cut up by": the open tasks as bands per status, a value taken out by the legend, a field without a series says so', async ({
  page,
}) => {
  test.slow();
  const problems = await pair(page, '/#view=stats');
  const section = page.getByRole('region', { name: 'History' });
  await expect(section).toBeVisible();
  const chart = section.getByRole('img');
  const none = section.locator('[data-history-empty="no-series"]');
  await expect(chart.or(none)).toBeVisible();
  if (await none.isVisible()) {
    const answered = page.waitForResponse((r) => r.url().includes('/api/tasks/ops') && r.request().method() === 'POST');
    await none.getByRole('button', { name: 'Start the history today' }).click();
    expect((await answered).status()).toBe(200);
  }
  const dims = page.getByRole('group', { name: 'Cut up by' });
  await dims.getByRole('button', { name: 'Status' }).click();
  await section.locator('[data-history-metric]').selectOption('ready');
  // by status the series counts the open tasks only: one line, and the way to the bands
  const offer = section.locator('[data-history-split="metric"]');
  await expect(offer).toContainText('counts the open tasks only');
  await offer.getByRole('button', { name: 'Show the open tasks by Status' }).click();
  await expect(section.locator('[data-history-metric]')).toHaveValue('open');
  await expect(chart).toHaveAccessibleName(/^Open tasks by Status from /);
  const layers = section.locator('path.layer');
  await expect(layers.first()).toBeVisible();
  const before = await layers.count();
  // a band is coloured as its value in the bars
  const first = (await layers.first().getAttribute('data-layer')) ?? '';
  const fill = await layers.first().evaluate((el) => getComputedStyle(el).fill);
  const bar = page.locator(`.legend [data-bucket="${first}"] .swatch`).first();
  expect(await bar.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(fill);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `the history cut up by status, ${scheme}`);
  }
  await page.emulateMedia({ colorScheme: 'light' });
  const entry = section.locator(`[data-history-legend] [data-bucket="${first}"]`);
  await entry.click();
  await expect(entry).toHaveAttribute('aria-pressed', 'false');
  await expect(layers).toHaveCount(before - 1);

  // a field the series does not count per value: one line and a word
  await dims.getByRole('button', { name: 'Priority' }).click();
  await expect(section.locator('[data-history-split="none"]')).toContainText('no figures per Priority');
  await expect(layers).toHaveCount(0);
  // (a vault of the tests may have one day only: a line of one point is not drawn wide)
  await expect(section.locator('path.line')).toHaveCount(1);
  await page.evaluate(() => {
    localStorage.removeItem('tasks-desktop.stats');
    localStorage.removeItem('tasks-desktop.stats-history');
  });
  expect(problems).toEqual([]);
});
