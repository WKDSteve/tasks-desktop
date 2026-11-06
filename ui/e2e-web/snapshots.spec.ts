// The snapshots of a test sheet in the web variant: without a hub they lie in a folder only the person can give. The page
// says so once, and shows them when the folder is chosen.
import { expect, test } from '@playwright/test';
import { openVault, vaultFiles, violations, watchPage } from './page';

test.use({ locale: 'en-US' });

const TASK = [
  '---',
  'title: Abnahme web check',
  'status: open',
  'kind: task',
  'prio: 2',
  'effort: S',
  'created: 2026-01-01',
  'updated: 2026-01-01',
  '---',
  '',
  'Check the float by eye.',
  '',
  '<!-- testing:sheets:begin -->',
  '## Test sheets',
  '',
  '- **Web sheet** (`web.sheet`, `ui.nvim/TESTS/sheets/web.sheet.lua`): automated part green, waiting for your judgement',
  '  - Judge:',
  '    - [ ] The border is drawn',
  '  - Look at: `ui.nvim/TESTS/__snapshots__/sheets/web.sheet/one.snap`',
  '<!-- testing:sheets:states web.sheet=inbox -->',
  '<!-- testing:sheets:end -->',
  '',
].join('\n');

test('the folder of the checkouts is asked for once, and the snapshots show when it is given', async ({ page }) => {
  const seen = await watchPage(page);
  await openVault(page, {
    ...vaultFiles(),
    'lib.nvim/ROADMAP/tasks/abnahme-web.md': TASK,
    'ui.nvim/TESTS/__snapshots__/sheets/web.sheet/one.snap': 'first grid of the sheet',
  });
  await page.keyboard.press('g');
  await page.keyboard.press('a');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Acceptance');

  // One sentence, not an error per snapshot.
  const choose = page.getByRole('button', { name: 'Choose the folder of the checkouts ...' });
  await expect(choose).toHaveCount(1);
  await expect(page.getByRole('alert').filter({ hasText: 'cannot be shown' })).toHaveCount(0);
  await expect(page.getByText('Shown once the folder of the checkouts is chosen.')).toHaveCount(1);

  await choose.click();
  await expect(page.locator('pre.grid').first()).toContainText('first grid of the sheet');
  await expect(choose).toHaveCount(0);

  expect(seen.requests).toEqual([]);
  expect(await violations(page)).toEqual([]);
  expect(seen.errors).toEqual([]);
});
