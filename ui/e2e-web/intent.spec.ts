// "Paste an intent" in the web variant: the page opened from disk, the engine in its worker, the folder a fake one.
// The same flow as beside a hub (ui/e2e/intent.spec.ts): a finding becomes the new-task form filled in, Create writes
// the task into the folder, the same finding again names it, and what breaks a rule is refused by the engine in the
// page. No request leaves the page, and no rule of its policy is broken.

import { expect, test } from '@playwright/test';
import { closeFloat, disk, openVault, vaultFiles, violations, watchPage } from './page';

test.use({ locale: 'en-US' });

test('an intent pasted into the page from disk fills the new-task form; the task is written only by Create', async ({ page }) => {
  test.slow();
  const fp = 'fedcba9876543210';
  const title = 'Finding of the web variant: an empty line ends the list';
  const intent = (klass = 'internal'): string =>
    JSON.stringify({
      schema: 'wkd-intent/1',
      action: 'tasks.new',
      mode: 'form',
      source: { app: 'testing', finding: fp },
      finding: {
        schema: 'testing-finding/1',
        fp,
        kind: 'case',
        repo: 'lib.nvim',
        area: 'lib.nvim',
        sha: '0123456789abcdef0123456789abcdef01234567',
        class: klass,
        where: { file: 'TESTS/parse_spec.lua', line: 12 },
        run: { source: 'ci', id: '1', os: 'linux', url: 'https://github.com/example/lib.nvim/actions/runs/1' },
        title,
        excerpt: 'expected 2 items, got 1',
        repro: 'scripts/test.sh --file parse_spec',
        rule: null,
      },
      target: null,
    });
  const seen = await watchPage(page);
  await openVault(page, vaultFiles(), 'Next task');
  const open = async (): Promise<void> => {
    await page.getByRole('menuitem', { name: 'Work', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Paste an intent ...' }).click();
  };
  const dialog = page.getByRole('dialog', { name: 'Paste an intent' });
  const field = dialog.getByLabel(/^The intent/);
  const before = Object.keys(await disk(page)).length;

  // A class that may not leave is the engine's refusal, here as beside a hub.
  await open();
  await field.fill(intent('private'));
  await dialog.getByRole('button', { name: 'Check' }).click();
  await expect(dialog.getByRole('alert')).toContainText('The intent was not taken');

  await field.fill(intent());
  await dialog.getByRole('button', { name: 'Check' }).click();
  const capture = page.getByRole('dialog', { name: 'New task' });
  await expect(capture.getByLabel('Title')).toHaveValue(title);
  await expect(capture.locator('select').first()).toHaveValue('lib.nvim');
  expect(Object.keys(await disk(page)).length, 'nothing is written before Create').toBe(before);
  await capture.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('status').getByText('Saved.')).toBeVisible({ timeout: 15_000 });
  const files = await disk(page);
  const made = Object.entries(files).find(([, text]) => text.includes(`testing-finding:${fp}`));
  expect(made?.[0]).toMatch(/^lib\.nvim\/ROADMAP\/tasks\/.+\.md$/);

  // The same finding again: the task that holds it, no second form.
  // (The new task opens in its float a moment after "Saved.": it is there before it is closed.)
  await expect(page.locator('dialog.peek[open]')).toContainText(title);
  await closeFloat(page);
  await open();
  await field.fill(intent());
  await dialog.getByRole('button', { name: 'Check' }).click();
  await expect(dialog.getByRole('status')).toContainText('A task holds this finding already: lib.nvim/', { timeout: 15_000 });
  await expect(page.getByRole('dialog', { name: 'New task' })).toHaveCount(0);
  expect(Object.keys(await disk(page)).length).toBe(Object.keys(files).length);
  // The two rules of the web variant: no request left the page, and no rule of its own policy was broken.
  expect(seen.requests).toEqual([]);
  expect(await violations(page)).toEqual([]);
  expect(seen.errors).toEqual([]);
});
