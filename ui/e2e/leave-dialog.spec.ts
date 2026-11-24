// A dialog with something typed in it does not lose it to a stray Escape: it asks (discard or keep editing); an empty
// one closes at once.

import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';
import { STATE } from './global';

test.use({ locale: 'en-US' });

const state = (): { token: string } => JSON.parse(readFileSync(STATE, 'utf8')) as { token: string };

test('Escape in New task asks while there is a title, keeps it on "Keep editing", closes on "Discard"', async ({ page }) => {
  await page.addInitScript((token) => sessionStorage.setItem('tasks-desktop.session', token), state().token);
  await page.goto('/#view=list');
  await expect(page.getByRole('menubar')).toBeVisible();
  await page.getByRole('menuitem', { name: 'Work', exact: true }).click();
  await page.getByRole('menuitem', { name: /^New task/ }).click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('closedby', 'none');

  // Nothing typed: Escape closes at once.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await page.getByRole('menuitem', { name: 'Work', exact: true }).click();
  await page.getByRole('menuitem', { name: /^New task/ }).click();
  await expect(dialog).toBeVisible();
  const title = dialog.getByLabel('Title', { exact: true });
  await title.fill('Something I would not like to lose');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  const ask = dialog.getByRole('alert').filter({ hasText: 'Discard what you entered?' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Keep editing' }).click();
  await expect(ask).toBeHidden();
  await expect(title).toHaveValue('Something I would not like to lose');

  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: 'Discard' }).click();
  await expect(dialog).toBeHidden();
});
