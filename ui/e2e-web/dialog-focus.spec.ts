// The two dialogs only the web variant has (Options > Create a shortcut ..., Update the page ...): the focus goes into
// the dialog when it opens, Escape closes it (an open hint takes the first one), and the focus is on the page afterwards,
// never lost on the body. The dialogs of the hub variant are in `e2e/dialog-focus.spec.ts` and `e2e/dialog-focus-data.spec.ts`.

import { expect, test } from '@playwright/test';
import { openVault, vaultFiles, violations, watchPage } from './page';

for (const [name, entry] of [
  ['Shortcut to this page', 'Create a shortcut ...'],
  ['Update the page', 'Update the page ...'],
] as const) {
  test(`the dialog "${name}": the focus goes in, Escape closes it, the focus is not lost`, async ({ page }) => {
    await watchPage(page);
    await openVault(page, vaultFiles());
    await page.getByRole('menuitem', { name: 'Options', exact: true }).click();
    await page.getByRole('menuitem', { name: entry, exact: true }).click();
    const dialog = page.getByRole('dialog', { name });
    await expect(dialog).toBeVisible();
    await expect.poll(() => dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    expect(await violations(page)).toEqual([]);
    await page.keyboard.press('Escape');
    if (await dialog.count()) await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.activeElement !== null && document.activeElement !== document.body)).toBe(true);
  });
}
