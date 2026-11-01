// Updating the web variant (Options > Update the page ...): the page cannot fetch a newer file (no request) nor start
// git, so it says which build it is and gives the lines that pull in its folder, a clone of tasks-web: the start
// script (pull and check) and git itself. That the pull brings the newer file is the hand run.

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { expectAccessible } from '../e2e/a11y';
import { openVault, pageUrl, vaultFiles, violations, watchPage } from './page';

test('the update dialog names the build and gives the lines that pull in the folder of the page', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const seen = await watchPage(page);
  await openVault(page, vaultFiles());
  await page.evaluate(() => {
    const w = window as unknown as { __copied: string[] };
    w.__copied = [];
    const write = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = async (text: string) => {
      w.__copied.push(text);
      return write(text);
    };
  });
  await page.getByRole('menuitem', { name: 'Options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Update the page ...', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Update the page' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('update-build')).toContainText(/This page: version \S+, build \S+/);

  // The folder of the file, as Windows writes it (the test machine is Windows; the CI runner too).
  const folder = dirname(fileURLToPath(pageUrl()));
  const script = dialog.getByRole('region', { name: 'With the start script' });
  const git = dialog.getByRole('region', { name: 'With git' });
  await expect(script.getByRole('textbox')).toHaveValue(`"${folder}\\start-tasks.cmd" /update`);
  await expect(git.getByRole('textbox')).toHaveValue(`git -C "${folder}" pull --ff-only`);
  await expectAccessible(page, 'the update dialog');

  await script.getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByText('Copied: run it in a terminal, then reload the page.')).toBeVisible();
  const copied = await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
  expect(copied).toEqual([`"${folder}\\start-tasks.cmd" /update`]);

  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  expect(seen.errors).toEqual([]);
  expect(seen.requests).toEqual([]);
  expect(await violations(page)).toEqual([]);
});
