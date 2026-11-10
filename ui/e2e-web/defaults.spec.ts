// The defaults in the web variant: the same dialog as on the hub's page (Options > Defaults ...), kept in this
// browser; the page opened again starts on the default view.

import { expect, test } from '@playwright/test';
import { expectAccessible } from '../e2e/a11y';
import { openVault, pageUrl, vaultFiles, watchPage } from './page';

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
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tasks-desktop.defaults') ?? '{}').startView)).toBe('stats');
  // The page opened again starts on the default view (the address names none). The picker of `openVault` stays in the
  // page; its wait for a task title does not fit a start on the statistics.
  await page.goto(pageUrl());
  await page.getByRole('button', { name: /Choose folder|Ordner wählen/ }).click();
  await expect(page.getByRole('menubar')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Statistics', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  expect(seen.errors).toEqual([]);
  expect(seen.requests).toEqual([]);
});
