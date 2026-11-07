// The picture of a view, in the web variant only: one long PNG of what the printer would get. An area that may not leave
// is not in it, the policy of the page (CSP) is unbroken and nothing leaves the page.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { openVault, vaultFiles, violations, watchPage } from './page';

test.use({ locale: 'en-US' });

const classes = JSON.stringify({ schema: 1, areas: { 'lib.nvim': { class: 'internal' }, 'cascade.nvim': { class: 'private' } } });

test('the view is saved as a PNG without the private areas, and the rules of the page hold', async ({ page }) => {
  const seen = await watchPage(page);
  await openVault(page, { ...vaultFiles(), 'areas.json': classes });
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'List', exact: true }).click();
  const rows = page.locator('button.row');
  await expect(rows.first()).toBeVisible();
  const shown = await rows.count();

  // The classes may still be on their way: the first answer is then "not read yet", and it is asked again.
  const summary = page.locator('.filters details.export summary');
  const button = page.getByRole('group', { name: 'Ways to export' }).getByRole('button', { name: 'Save as PNG ...' });
  let file;
  await expect(async () => {
    if (!(await button.isVisible())) await summary.click();
    const download = page.waitForEvent('download', { timeout: 4000 });
    await button.click();
    file = await download;
  }).toPass({ timeout: 30_000 });

  expect(file!.suggestedFilename()).toMatch(/^tasks-list-\d{4}-\d{2}-\d{2}\.png$/);
  const bytes = readFileSync(await file!.path());
  expect(bytes.subarray(0, 8).toString('latin1')).toBe('\x89PNG\r\n\x1a\n');
  expect(bytes.length).toBeGreaterThan(2000);
  // The header of a PNG: as wide as the sheet at twice the scale, and as long as its rows.
  expect(bytes.readUInt32BE(16)).toBe(2200);
  expect(bytes.readUInt32BE(20)).toBeGreaterThan(200);
  const said = page.getByRole('status').getByText(/Picture of \d+ tasks saved/);
  await expect(said).toBeVisible();
  const counted = Number(/(\d+) tasks/.exec((await said.textContent()) ?? '')?.[1]);
  expect(counted).toBeGreaterThan(0);
  expect(counted).toBeLessThan(shown);
  await expect(page.locator('#view-png')).toHaveCount(0);
  expect(seen.requests).toEqual([]);
  expect(await violations(page)).toEqual([]);
  expect(seen.errors).toEqual([]);
});
