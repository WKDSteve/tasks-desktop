import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, isMachineFault, test } from './fixtures';
import { expectAccessible, watchViolations } from './a11y';
import { STATE } from './global';
import { menuTab, openExportMenu, submenu } from './menu';

// The tab View of the menu bar against the real hub and engine: only views, with the submenus Time, Review and Repos,
// the saved views under their own name, the export as a submenu, and the theme and the tiles in Options. Which view
// is offered where is viewTabMenu.ts (unit tests).

test.use({ locale: 'en-US' });

const state = (): { token: string } => JSON.parse(readFileSync(STATE, 'utf8')) as { token: string };

async function pair(page: Page, path: string): Promise<string[]> {
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

test('View: sections, the submenus Time, Review and Repos, a view chosen from one, its link and its dot', async ({ page }) => {
  const problems = await pair(page, '/#view=list');
  await expect(menuTab(page, 'View')).toHaveAccessibleName('View, current: List');
  await menuTab(page, 'View').click();
  const menu = page.getByRole('menu', { name: /^View/ });
  // Views only: no export entry, no tiles, no theme beside them.
  await expect(menu.getByRole('group', { name: 'Daily' })).toBeVisible();
  for (const name of ['Today', 'List', 'Board', 'Inbox', 'Plan', 'Connections', 'Acceptance']) {
    await expect(menu.getByRole('menuitemradio', { name, exact: true })).toBeVisible();
  }
  // Time, Review and Repos hold their views: they are not in the tab itself.
  await expect(menu.getByRole('menuitemradio', { name: 'Calendar', exact: true })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Save tasks as CSV file ...' })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: /tiles/ })).toHaveCount(0);
  await expect(menu.getByRole('menuitemradio', { name: 'Dark' })).toHaveCount(0);
  for (const name of ['Time', 'Review', 'Repos', 'Export']) await expect(submenu(page, name)).toBeVisible();
  // The saved views are named so, and are a plain entry of the tab.
  await expect(menu.getByRole('menuitemradio', { name: 'Saved views', exact: true })).toHaveAttribute('href', /#view=views/);

  // The pointer opens the submenu beside its item; its views are links to their places.
  await submenu(page, 'Time').hover();
  const time = page.getByRole('menu', { name: 'Time' });
  await expect(time.getByRole('menuitemradio')).toHaveText(['Calendar', 'Timeline', 'Reminders']);
  await expect(time.getByRole('menuitemradio', { name: 'Timeline' })).toHaveAttribute('href', /#view=timeline/);
  await time.getByRole('menuitemradio', { name: 'Calendar' }).click();
  await expect(page).toHaveURL(/#view=calendar/);
  // The view shown is named by the tab and by its submenu.
  await expect(menuTab(page, 'View')).toHaveAccessibleName('View, current: Calendar');
  await menuTab(page, 'View').click();
  await expect(submenu(page, 'Time')).toHaveAccessibleName('Time, current: Calendar');
  await page.keyboard.press('Escape');
  expect(problems).toEqual([]);
});

test('View: a submenu opens with the keys and the view is chosen with Enter', async ({ page }) => {
  await pair(page, '/#view=list');
  await menuTab(page, 'View').focus();
  await page.keyboard.press('ArrowDown');
  await submenu(page, 'Review').focus();
  await page.keyboard.press('ArrowRight');
  const review = page.getByRole('menu', { name: 'Review' });
  await expect(review.getByRole('menuitemradio', { name: 'Statistics' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#view=stats/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Statistics');
});

test('View: the export is a submenu that names the view it takes', async ({ page }) => {
  await pair(page, '/#view=list');
  await openExportMenu(page);
  const menu = page.getByRole('menu', { name: 'Export' });
  await expect(menu.getByText('Exporting: List')).toBeVisible();
  await expect(menu.getByRole('group', { name: 'Save' })).toBeVisible();
  const [csv] = await Promise.all([
    page.waitForEvent('download'),
    menu.getByRole('menuitem', { name: 'Save tasks as CSV file ...', exact: true }).click(),
  ]);
  expect(csv.suggestedFilename()).toMatch(/^tasks-list-\d{4}-\d{2}-\d{2}\.csv$/);
});

test('Options: the theme and the display switches are there, the tiles only on Today', async ({ page }) => {
  await pair(page, '/#view=list');
  await page.getByRole('menuitem', { name: 'Options', exact: true }).click();
  const options = page.getByRole('menu', { name: 'Options' });
  await expect(options.getByRole('menuitemradio', { name: 'Dark' })).toBeVisible();
  await expect(options.getByRole('menuitemcheckbox', { name: /Zebra|zebra/ })).toBeVisible();
  await expect(options.getByRole('group', { name: 'Overview “Today”' })).toHaveCount(0);
  await expect(options.getByRole('menuitem', { name: /Reset the order of the tiles/ })).toHaveCount(0);
  await options.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expectAccessible(page, 'the page in the dark theme');
  await page.getByRole('menuitem', { name: 'Options', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await menuTab(page, 'View').click();
  await page.getByRole('menuitemradio', { name: 'Today', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Options', exact: true }).click();
  await expect(page.getByRole('menu', { name: 'Options' }).getByRole('menuitem', { name: /Reset the order of the tiles/ })).toBeVisible();
  await expect(page.getByRole('menu', { name: 'Options' }).getByRole('menuitem', { name: /Show hidden tiles/ })).toBeVisible();
});

test('View: in a narrow window the submenu folds open inside the menu, in the light and the dark theme', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 760 });
  await pair(page, '/#view=list');
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await menuTab(page, 'View').click();
    await submenu(page, 'Time').click();
    const time = page.getByRole('menu', { name: 'Time' });
    await expect(time).toBeVisible();
    await expect(time).toHaveClass(/mb-fold/);
    const box = await time.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(380);
    await expectAccessible(page, `the folded submenu (${scheme})`);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  }
});
