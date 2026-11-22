import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, isMachineFault, test } from './fixtures';
import { expectAccessible, violations, watchViolations } from './a11y';
import { STATE } from './global';

// The tab Learning plans of the menu bar against the real hub and the real engine: its place after View, the learning
// paths in it (and no more in View), the dot and the name of the view shown, the keys of the bar, a link to a view not
// built yet, and the palette. axe on the open tab. Which views it offers is learnViews.ts (unit tests).

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

const bar = (page: Page) => page.getByRole('menubar');

test('the tab Learning plans: after View, the learning paths with the dot of the view shown, by keys, axe', async ({ page }) => {
  const problems = await pair(page, '/#view=list');
  const triggers = bar(page).locator('button.mb-trigger');
  await expect(triggers).toHaveText(['Work', 'Project', 'View', 'Learning plans', 'Options', 'Help']);
  const tab = bar(page).getByRole('menuitem', { name: 'Learning plans', exact: true });
  // The list is shown: no dot on the tab.
  await expect(tab.locator('.mb-current')).toHaveCount(0);

  // View has no learning paths any more.
  await bar(page).getByRole('menuitem', { name: 'View', exact: true }).click();
  await expect(page.getByRole('menu', { name: 'View' })).toBeVisible();
  await expect(page.getByRole('menuitemradio', { name: 'Learning paths' })).toHaveCount(0);
  await expect(page.getByRole('menuitemradio', { name: 'Competence map' })).toHaveCount(0);

  // The pointer moves over to the tab while View is open (as in the other menus).
  await tab.hover();
  const menu = page.getByRole('menu', { name: 'Learning plans' });
  await expect(menu).toBeVisible();
  const paths = menu.getByRole('menuitemradio', { name: 'Learning paths' });
  await expect(paths).toHaveAttribute('aria-checked', 'false');
  await expect(paths).toHaveAttribute('href', /#view=paths/);
  await expect(menu.getByRole('group', { name: 'Paths' })).toBeVisible();
  // In the order of the concept: what is next, the paths, the progress, the knowledge; only what the engine serves.
  await expect(menu.getByRole('menuitemradio')).toHaveText([
    'Next learning step',
    'Learning paths',
    'Competence map',
    'Competence catalogue',
    'Learning time',
    'Badges',
    'Rewards',
    'Evidence',
    'Notes & sources',
  ]);
  await expect(menu.getByRole('menuitemradio', { name: 'Competence map' })).toHaveAttribute('href', /#view=pathmap/);
  await expectAccessible(page, 'the open tab Learning plans');
  await paths.click();

  await expect(page.getByRole('menuitem', { name: 'Learning plans, current: Learning paths' })).toBeVisible();
  await expect(bar(page).locator('button.mb-trigger[data-for="learn"] .mb-current')).toHaveText('●');
  await expect(page).toHaveURL(/#view=paths/);

  // By keys: from View, Right goes to the tab; Down opens it on its first item; the view shown is checked.
  await bar(page).getByRole('menuitem', { name: 'View', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('menuitem', { name: 'Learning plans, current: Learning paths' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitemradio', { name: 'Next learning step' })).toBeFocused();
  await expect(menu.getByRole('menuitemradio', { name: 'Learning paths' })).toHaveAttribute('aria-checked', 'true');
  await expectAccessible(page, 'the tab with the view shown');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  // Back to the list: the dot goes.
  await bar(page).getByRole('menuitem', { name: 'View', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'List' }).click();
  await expect(tab).toBeVisible();
  await expect(tab.locator('.mb-current')).toHaveCount(0);

  expect(problems).toEqual([]);
  expect(await violations(page)).toEqual([]);
});

test('a link to a view of the tab not built yet shows the learning paths and says so; the palette goes there', async ({ page }) => {
  const problems = await pair(page, '/#view=learn');
  await expect(page.getByText('The learning view “learn” is not in this version yet; showing Learning paths.')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Learning plans, current: Learning paths' })).toBeVisible();
  await expect(page).toHaveURL(/#view=paths/);

  // The palette: "Go to Learning paths" from another view.
  await bar(page).getByRole('menuitem', { name: 'View', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'List' }).click();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog');
  await expect(palette).toBeVisible();
  await page.keyboard.type('Go to Learning paths');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Learning plans, current: Learning paths' })).toBeVisible();

  // The same link pasted into the open page (only the fragment changes): the same landing and words.
  await bar(page).getByRole('menuitem', { name: 'View', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'List' }).click();
  await page.evaluate(() => {
    location.hash = '#view=learnstats';
  });
  await expect(page.getByText('The learning view “learnstats” is not in this version yet; showing Learning paths.')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Learning plans, current: Learning paths' })).toBeVisible();

  expect(problems).toEqual([]);
  expect(await violations(page)).toEqual([]);
});
