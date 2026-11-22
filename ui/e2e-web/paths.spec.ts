// The learning paths in the single-file page, opened from disk in Chrome: the same view as in the app, over the engine
// that runs in the page. A point is ticked and given a note, and the engine writes both into the path's file on the
// (fake) disk; no hub is involved.

import { expect, test } from '@playwright/test';
import { disk, openVault, vaultFiles, violations, watchPage } from './page';

test('a learning path in the web variant: a point ticked and a note written into the file on the disk', async ({ page }) => {
  const seen = await watchPage(page);
  await openVault(page, vaultFiles());
  // The learning paths are in the tab Learning plans of the menu bar.
  await page.getByRole('menuitem', { name: /^(Learning plans|Lernpläne)$/ }).click();
  await page.getByRole('menuitemradio', { name: /^(Learning paths|Lernpfade)$/ }).click();
  const tree = page.getByRole('list', { name: /^(Learning points of|Lernpunkte von) Lua lernen$/ });
  await expect(tree).toBeVisible({ timeout: 30_000 });
  const point = (key: string) => tree.locator(`li[data-point="${key}"]`);
  const file = 'lib.nvim/ROADMAP/paths/lua-lernen.md';

  await point('meta').locator('button.mark').click();
  await expect(point('meta')).toHaveAttribute('data-state', 'learned', { timeout: 30_000 });
  await expect.poll(async () => (await disk(page))[file]).toContain('- [x] Metatables {#meta}');

  await point('meta').locator('[data-choice="point"] summary').click();
  await point('meta').locator('[data-choice-id="note"]').click();
  await point('meta').locator('textarea').fill('__index first');
  await point('meta').locator('form.edit button[type="submit"]').click();
  await expect(point('meta').locator('.note')).toHaveText('__index first', { timeout: 30_000 });
  await expect.poll(async () => (await disk(page))[file]).toContain('__index first');

  expect(seen.errors).toEqual([]);
  expect(await violations(page)).toEqual([]);
});
