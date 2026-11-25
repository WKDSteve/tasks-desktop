// The forms of the repo tiles, of the vaults and of the documents of a meeting can be sent without what they need: each
// says what is missing at the field (`aria-invalid`, `aria-describedby`, a text beside it) and puts the focus on the first
// field that is wrong. The button is not locked for an empty field. The first form of the kind is in `form-errors.spec.ts`.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { STATE } from './global';
import { chooseFromMenu, menuTab } from './menu';

test.use({ locale: 'en-US', viewport: { width: 1100, height: 800 } });

const state = (): { token: string; vault: string } => JSON.parse(readFileSync(STATE, 'utf8')) as { token: string; vault: string };

async function pair(page: Page, start = '/#view=list'): Promise<void> {
  await page.addInitScript((token) => sessionStorage.setItem('tasks-desktop.session', token), state().token);
  await page.goto(start);
  await expect(page.getByRole('menubar')).toBeVisible();
}

/** The field says it is wrong, names its message, and has the focus; the message is the text beside it. */
async function expectFieldError(field: Locator, message: string | RegExp): Promise<void> {
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toBeFocused();
  // The hint of a focused field is added to the ids it names (`hint-desc`): the message is the first.
  const id = ((await field.getAttribute('aria-describedby')) ?? '').split(' ')[0] ?? '';
  expect(id).not.toBe('');
  await expect(field.page().locator(`[id="${id}"]`)).toHaveText(message);
}

test('Repos: a group without a name and a repo without a folder say so at the field, with the focus on it', async ({ page }) => {
  const tag = `fe${Date.now()}`;
  await pair(page);
  await chooseFromMenu(page, 'View', 'Repos');
  const tab = page.getByRole('region', { name: 'Repos', exact: true });
  await expect(tab).toBeVisible();

  const group = tab.getByLabel('New group', { exact: true });
  const make = tab.getByRole('button', { name: 'Make the group' });
  await expect(make).toBeEnabled();
  await make.click();
  await expectFieldError(group, 'Enter a name.');
  await expect(make).toBeEnabled();
  await group.fill('x');
  await expect(group).not.toHaveAttribute('aria-invalid', 'true');
  await group.fill(`Form errors ${tag}`);
  await make.click();
  const heading = tab.getByRole('heading', { name: `Form errors ${tag}` });
  await expect(heading).toBeVisible();
  try {
    // A group is there: the form of the repo is shown, and sent empty it asks for the folder.
    const folder = tab.getByLabel('Folder of the repo');
    await tab.getByRole('button', { name: 'Add the repo' }).click();
    await expectFieldError(folder, 'Enter a folder.');
    await folder.fill('relative/folder');
    await expect(folder).not.toHaveAttribute('aria-invalid', 'true');
  } finally {
    // The group of this test goes again: the file of the device is shared by the tests of the run.
    const section = tab.locator('section.group').filter({ has: page.getByRole('heading', { name: `Form errors ${tag}` }) });
    await section.getByRole('button', { name: 'Delete the group' }).click();
    await section.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(heading).toHaveCount(0);
  }
});

test('Vaults: the form to add one says what is missing at each field, first the name, then the folder, then the area', async ({ page }) => {
  await pair(page);
  await menuTab(page, 'Project').click();
  await page.getByRole('menuitem', { name: 'Manage vaults ...', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Vaults' });
  await expect(dialog).toBeVisible();
  const name = dialog.getByLabel(/^Name/);
  const folder = dialog.getByLabel(/^Folder/);
  const area = dialog.getByLabel(/^First area/);
  const add = dialog.getByRole('button', { name: 'Add', exact: true });
  await expect(add).toBeEnabled();

  await add.click();
  await expectFieldError(name, 'Enter a name.');
  await name.fill('Nothing e2e');
  await add.click();
  await expect(folder).toHaveAttribute('aria-invalid', 'true');
  await expect(folder).toBeFocused();
  await expect(name).not.toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.locator('#vaults-path-error')).toHaveText('Enter a folder.');

  // A new vault needs the name of its first area as well.
  await folder.fill('relative-only');
  await dialog.getByRole('checkbox', { name: /^Make this folder a new vault/ }).check();
  await dialog.getByRole('button', { name: 'Make and add' }).click();
  await expectFieldError(area, 'Enter the name of the area.');
  // Nothing was added: the dialog still lists the vaults it had, and the request was never sent.
  await expect(dialog).toBeVisible();
});

test('A meeting: a document sent without text says so at the field, with the focus on it', async ({ page }) => {
  const slug = 'form-errors-m006';
  const meetings = join(state().vault, 'lib.nvim', 'MEETINGS');
  mkdirSync(meetings, { recursive: true });
  const file = join(meetings, `${slug}.md`);
  const next = new Date(Date.now() + 3 * 24 * 3600_000);
  const two = (n: number) => String(n).padStart(2, '0');
  const day = `${next.getFullYear()}-${two(next.getMonth() + 1)}-${two(next.getDate())}`;
  writeFileSync(file, `---\ntitle: Form errors m006\nstatus: planned\ndate: ${day}\ntime: "10:00"\nduration: 1h\ntasks: [lib.nvim/alpha]\n---\n\nA meeting of one browser test.\n`);
  try {
    await pair(page);
    await page.locator('button.row', { hasText: 'lib.nvim/alpha' }).first().click();
    await page.locator('aside.detail').getByRole('button', { name: 'Form errors m006' }).click();
    const meeting = page.getByRole('dialog', { name: /Form errors m006/ });
    await expect(meeting).toBeVisible();
    await meeting.getByRole('tab', { name: 'Preparation' }).click();
    const form = meeting.locator('form[data-document-add]');
    const text = form.getByLabel('A link or a path');
    const add = form.getByRole('button', { name: 'Add', exact: true });
    await expect(add).toBeEnabled();
    await add.click();
    await expectFieldError(text, 'Enter the text or the address of the document.');
    await expect(add).toBeEnabled();
    await text.fill('https://example.org/doc');
    await expect(text).not.toHaveAttribute('aria-invalid', 'true');
  } finally {
    rmSync(file, { force: true });
    rmSync(join(meetings, slug), { force: true, recursive: true });
  }
});
