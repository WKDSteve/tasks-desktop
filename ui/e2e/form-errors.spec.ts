// A form that is not complete can be sent: it says what is missing at the field and puts the focus there. The button is
// not locked for an empty field.

import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';
import { STATE } from './global';

test.use({ locale: 'en-US' });

const state = (): { token: string } => JSON.parse(readFileSync(STATE, 'utf8')) as { token: string };

test('New task sent without a title says so at the field, with the focus on it', async ({ page }) => {
  await page.addInitScript((token) => sessionStorage.setItem('tasks-desktop.session', token), state().token);
  await page.goto('/#view=list');
  await expect(page.getByRole('menubar')).toBeVisible();
  await page.getByRole('menuitem', { name: 'Work', exact: true }).click();
  await page.getByRole('menuitem', { name: /^New task/ }).click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  const title = dialog.getByLabel('Title', { exact: true });
  const create = dialog.getByRole('button', { name: 'Create', exact: true });
  await expect(title).toBeVisible();
  await expect(create).toBeEnabled();

  await dialog.getByRole('heading', { name: 'New task' }).click();
  await create.click();
  await expect(dialog).toBeVisible();
  await expect(title).toHaveAttribute('aria-invalid', 'true');
  await expect(title).toBeFocused();
  const error = dialog.locator('#capture-title-error');
  await expect(error).toHaveText('Enter a title.');
  await expect(title).toHaveAttribute('aria-describedby', /capture-title-error/);
  await expect(create).toBeEnabled();

  // Typing the title takes the error away.
  await title.fill('Now it has a title');
  await expect(error).toBeHidden();
  await expect(title).not.toHaveAttribute('aria-invalid', 'true');
});
