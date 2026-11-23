// The defaults in the web variant: the same dialog as on the hub's page (Options > Defaults ...), kept in this
// browser; the page opened again starts on the default view.

import { expect, test } from '@playwright/test';
import { expectAccessible } from '../e2e/a11y';
import { openVault, pageUrl, vaultFiles, watchPage } from './page';
import { menuTab, submenu } from '../e2e/menu';

test('the defaults dialog of the web variant: a start view that holds when the page is opened again', async ({ page }) => {
  const seen = await watchPage(page);
  await openVault(page, vaultFiles());
  await page.getByRole('menuitem', { name: 'Options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Defaults ...', exact: true }).click();
  const dialog = page.getByTestId('defaults-dialog');
  await expect(dialog).toBeVisible();
  await expectAccessible(page, 'the defaults dialog of the web variant');
  await dialog.getByLabel('Open on').selectOption('stats');
  await dialog.getByRole('button', { name: 'Close' }).click();
  // Kept for this vault (under the id of its folder, web/vault-switch.ts), not for every vault of the browser.
  const kept = await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith('tasks-desktop.defaults'));
    return { keys, startView: keys.length === 1 ? JSON.parse(localStorage.getItem(keys[0] as string) ?? '{}').startView : null };
  });
  expect(kept.keys).toHaveLength(1);
  expect(kept.keys[0]).toMatch(/^tasks-desktop\.defaults@.+/);
  expect(kept.startView).toBe('stats');
  // The page opened again starts on the default view (the address names none). The picker of `openVault` stays in the
  // page; its wait for a task title does not fit a start on the statistics.
  await page.goto(pageUrl());
  await page.getByRole('button', { name: /Choose folder|Ordner wählen/ }).click();
  await expect(page.getByRole('menubar')).toBeVisible({ timeout: 30_000 });
  await menuTab(page, 'View').click();
  await submenu(page, 'Review').click();
  await expect(page.getByRole('menuitemradio', { name: 'Statistics', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  expect(seen.errors).toEqual([]);
  expect(seen.requests).toEqual([]);
});

test('the icons of the categories in the web variant: chosen in the defaults, kept for every vault of the browser', async ({ page }) => {
  const seen = await watchPage(page);
  const files = vaultFiles();
  files['lib.nvim/ROADMAP/tasks/webicons-e2e-c01.md'] =
    '---\ntitle: Webicons e2e c01\nstatus: open\nprio: 1\ncategory: [bug]\ncreated: 2026-11-21\nupdated: 2026-11-21\n---\n\nA task with the icon of its category.\n';
  await openVault(page, files, 'Webicons e2e c01');
  await page.getByRole('menuitem', { name: /^View(,|$)/ }).click();
  await page.getByRole('menuitemradio', { name: 'List', exact: true }).click();
  const icon = page.locator('button.row', { hasText: 'Webicons e2e c01' }).locator('[data-icon="category"]');
  await expect(icon).toHaveText('🐞');
  await page.getByRole('menuitem', { name: 'Options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Defaults ...', exact: true }).click();
  const dialog = page.getByTestId('defaults-dialog');
  const section = dialog.getByRole('group', { name: 'Icons of the categories' });
  await section.getByLabel('bug', { exact: true }).fill('🪲');
  await expectAccessible(page, 'the icons of the categories in the web variant');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(icon).toHaveText('🪲');
  // a preference of the person, not of the vault (web/vault-switch.ts)
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('tasks-desktop.category-icons')))).toEqual([
    'tasks-desktop.category-icons',
  ]);
  expect(seen.errors).toEqual([]);
  expect(seen.requests).toEqual([]);
});
