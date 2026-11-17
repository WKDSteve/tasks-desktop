// The fields of a form explain themselves: the pointer resting on a label, or the keyboard focus on its field, shows
// the hint popup with what the field is and what it does (`ui/src/formHints.test.ts` makes sure every field has one).

import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { watchViolations } from './a11y';
import { STATE } from './global';

test.use({ locale: 'en-US' });

const state = (): { token: string } => JSON.parse(readFileSync(STATE, 'utf8')) as { token: string };

async function pair(page: Page): Promise<void> {
  await watchViolations(page);
  await page.addInitScript((token) => sessionStorage.setItem('tasks-desktop.session', token), state().token);
  await page.goto('/#view=list');
  await expect(page.getByRole('menubar')).toBeVisible();
  await expect(page.locator('button.row').first()).toBeVisible();
}

const TARGET = /^The ID of an existing task whose finishing means the goal is reached/;
const TARGET_NEW = /^The title of the target task made together with the plan/;

test('the target task of the plan wizard explains itself on hover and on focus', async ({ page }) => {
  await pair(page);
  await page.getByRole('menuitem', { name: 'Project', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Create a plan' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a plan' });
  await expect(dialog).toBeVisible();
  const tip = page.locator('#hint-tip');

  // The pointer on the label: the popup shows after its short pause.
  await dialog.getByText('Target task (the last task)', { exact: true }).hover();
  await expect(tip).toBeVisible();
  await expect(tip).toHaveText(TARGET);

  // The keyboard on the field: the same text at once, and the field is described by it for a screen reader.
  await page.mouse.move(0, 0);
  await expect(tip).toBeHidden();
  const field = dialog.locator('#plan-target');
  await field.focus();
  await expect(tip).toHaveText(TARGET);
  await expect(field).toHaveAttribute('aria-describedby', /hint-tip/);

  // A new target task to make has a hint of its own.
  await dialog.getByRole('button', { name: 'Create target task' }).click();
  await dialog.getByText('Target task (the last task)', { exact: true }).hover();
  await expect(tip).toHaveText(TARGET_NEW);
});

test('a field of New task shows its hint while it has the focus, and typing keeps it', async ({ page }) => {
  await pair(page);
  await page.getByRole('menuitem', { name: 'Work', exact: true }).click();
  await page.getByRole('menuitem', { name: /^New task/ }).click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await expect(dialog).toBeVisible();
  const tip = page.locator('#hint-tip');

  const title = dialog.getByLabel('Title', { exact: true });
  await title.focus();
  await expect(tip).toHaveText(/^What is to be done, in a few words/);
  await page.keyboard.type('abc');
  await expect(title).toHaveValue('abc');
  await expect(tip).toHaveText(/^What is to be done, in a few words/);
  // Tab to the next field: its own hint replaces the first one.
  await page.keyboard.press('Tab');
  await expect(tip).toHaveText(/^The area \(a folder of the vault/);
});
