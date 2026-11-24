// The fields of a form explain themselves: the pointer resting on a label, or the keyboard focus on its field, shows
// the hint popup with what the field is and what it does (`ui/src/formHints.test.ts` makes sure every field has one).

import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { watchViolations } from './a11y';
import { STATE } from './global';
import { origin } from './hub';

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

  // The field focused: it is described by the same text for a screen reader; Tab to it shows the popup at once.
  await page.mouse.move(0, 0);
  await expect(tip).toBeHidden();
  const field = dialog.locator('#plan-target');
  await field.focus();
  await expect(field).toHaveAttribute('aria-describedby', /hint-desc/);
  await expect(page.locator('#hint-desc')).toHaveText(TARGET);
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(field).toBeFocused();
  await expect(tip).toBeVisible();
  await expect(tip).toHaveText(TARGET);

  // A new target task to make has a hint of its own.
  await dialog.getByRole('button', { name: 'Create target task' }).click();
  await dialog.getByText('Target task (the last task)', { exact: true }).hover();
  await expect(tip).toHaveText(TARGET_NEW);
});

test('a field of New task is described while it has the focus; Tab shows the popup, typing keeps it', async ({ page }) => {
  await pair(page);
  await page.getByRole('menuitem', { name: 'Work', exact: true }).click();
  await page.getByRole('menuitem', { name: /^New task/ }).click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await expect(dialog).toBeVisible();
  const tip = page.locator('#hint-tip');

  // The dialog put the focus into the title (autofocus): the field is described, no popup covers the dialog.
  const title = dialog.getByLabel('Title', { exact: true });
  await expect(title).toBeFocused();
  await expect(tip).toBeHidden();
  await expect(title).toHaveAttribute('aria-describedby', /hint-desc/);
  await expect(page.locator('#hint-desc')).toHaveText(/^What is to be done, in a few words/);

  // Tab to the next field: its popup shows at once; back with Shift+Tab, typing keeps the popup of the title.
  await page.keyboard.press('Tab');
  await expect(tip).toBeVisible();
  await expect(tip).toHaveText(/^The area \(a folder of the vault/);
  await page.keyboard.press('Shift+Tab');
  await expect(title).toBeFocused();
  await expect(tip).toHaveText(/^What is to be done, in a few words/);
  await page.keyboard.type('abc');
  await expect(title).toHaveValue('abc');
  await expect(tip).toBeVisible();

  // Escape takes the popup first; with no popup open the next one closes the dialog.
  await page.keyboard.press('Escape');
  await expect(tip).toBeHidden();
  await expect(dialog).toBeVisible();
  // The title holds what was typed: the next one asks before the dialog closes, and "Discard" closes it.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Discard' }).click();
  await expect(dialog).toBeHidden();
});

test('on a touch screen a tap on the label of a field shows its hint at once', async ({ newContext }) => {
  // A touch laptop or a tablet: the page of the desktop, a pointer that taps and has no hover.
  const context = await newContext({ hasTouch: true, viewport: { width: 1200, height: 900 }, locale: 'en-US', baseURL: origin() });
  const page = await context.newPage();
  await pair(page);
  await page.getByRole('menuitem', { name: 'Project', exact: true }).tap();
  await page.getByRole('menuitem', { name: 'Create a plan' }).tap();
  const dialog = page.getByRole('dialog', { name: 'Create a plan' });
  await expect(dialog).toBeVisible();
  const tip = page.locator('#hint-tip');
  await expect(tip).toBeHidden();
  await dialog.getByText('Target task (the last task)', { exact: true }).tap();
  await expect(tip).toBeVisible();
  await expect(tip).toHaveText(TARGET);
});
