// The tab Lists in the single-file page, opened from disk in Chrome, over a fake folder the test also reads: the first
// line of a vault without a list makes the list, a #word is a tag, a picture pasted into the line is written into the
// entry's folder, and the entry made a task takes the picture along (moved on the disk, never a placeholder written).

import { expect, test } from '@playwright/test';
import { disk, openVault, vaultFiles, watchPage } from './page';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('a list in the page: a line with a #tag, a pasted picture, the entry made a task with it', async ({ page }) => {
  await watchPage(page);
  await openVault(page, vaultFiles());
  await page.getByRole('menuitem', { name: /^(Lists|Listen)(,|$)/ }).click();
  await page.getByRole('menuitemradio', { name: /^(Lists|Listen)$/ }).click();

  const line = page.locator('[data-lists-line]');
  await line.fill('Web list #webtag');
  await line.press('Enter');
  await expect(page.locator('[data-entry] [data-entry-open]').first()).toHaveText('Web list');
  await expect(page.locator('[data-entry-tag="webtag"]')).toHaveCount(1);
  const list = await disk(page);
  const listId = Object.keys(list).find((p) => /^_list-[^/]+\/list\.md$/.test(p));
  expect(listId, Object.keys(list).filter((p) => p.startsWith('_list')).join(', ')).toBeDefined();
  const folder = (listId as string).split('/')[0] as string;
  const entryFile = Object.keys(list).find((p) => p.startsWith(`${folder}/`) && p.endsWith('-web-list.md'));
  expect(list[entryFile as string]).toMatch(/title: Web list\n/);
  expect(list[entryFile as string]).toMatch(/tags: \[webtag\]/);

  // a picture pasted into the line: a second entry, the picture in its folder
  await line.fill('Web picture');
  await line.evaluate((input, base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, PNG);
  const entry = page.locator('[data-entry]').filter({ hasText: 'Web picture' });
  await expect(entry.locator('[data-entry-files]')).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => Object.keys(await disk(page)).some((p) => p.startsWith(`${folder}/`) && /\/assets\/images\/pasted-\d{8}-\d{6}\.png$/.test(p)))
    .toBe(true);

  // made a task: the picture moves along
  await entry.locator('[data-entry-open]').click();
  await entry.locator('[data-entry-area]').selectOption('lib.nvim');
  await entry.locator('[data-entry-promote]').click();
  await expect(entry).toHaveCount(0, { timeout: 30_000 });
  await expect
    .poll(async () => Object.keys(await disk(page)).some((p) => /^lib\.nvim\/ROADMAP\/tasks\/web-picture\/assets\/images\/pasted-.*\.png$/.test(p)))
    .toBe(true);
  const after = await disk(page);
  expect(Object.keys(after).filter((p) => p.includes('-web-picture'))).toEqual([]);
  expect(Object.values(after).some((text) => text.includes('tasks-web-asset'))).toBe(false);
});
