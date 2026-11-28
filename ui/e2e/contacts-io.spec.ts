import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, isMachineFault, test } from './fixtures';
import { expectAccessible, watchViolations } from './a11y';
import { STATE } from './global';
import { menuTab } from './menu';
import { removeFile } from './hub';

// The import and the export of contacts against the real hub and engine, with the example files of the engine
// (tasks.nvim/TESTS/fixtures/contacts): the menu entry opens the dialog, a picked vCard is a trial run first (nothing
// written), its report names what would be made and never an address or a number, the import makes the files only on
// confirm, a second import of the same file reports duplicates by the holder and makes nothing; the export of the
// area as a CSV saves a file whose phone cells are text for a spreadsheet. The contacts are made in an area of their own
// test and removed afterwards.

test.use({ locale: 'en-US' });
test.describe.configure({ mode: 'serial' });

const state = (): { token: string; vault: string } => JSON.parse(readFileSync(STATE, 'utf8')) as { token: string; vault: string };
const dir = (): string => join(state().vault, 'lib.nvim', 'CONTACTS');

function fixture(name: string): string {
  const engine = process.env['TASKS_ENGINE_DIR'];
  if (!engine) throw new Error('TASKS_ENGINE_DIR is not set');
  return join(engine, 'TESTS', 'fixtures', 'contacts', name);
}

/** The contact files the import made (by the names of the example file, whatever slug the engine chose). */
function made(): string[] {
  if (!existsSync(dir())) return [];
  return readdirSync(dir()).filter((f) => /j(o|oe)rg-m|anna-a-very/i.test(f));
}

test.afterEach(() => {
  for (const f of made()) removeFile(join(dir(), f));
});

async function pair(page: Page, path: string): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !isMachineFault(m.text())) problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await watchViolations(page);
  await page.addInitScript((token) => sessionStorage.setItem('tasks-desktop.session', token), state().token);
  await page.goto(path);
  await expect(page.getByRole('menubar')).toBeVisible();
  return problems;
}

test('Contacts: a vCard is a trial run first, imported on confirm, and a second import makes only duplicates', async ({ page }) => {
  const problems = await pair(page, '/#view=contacts');
  await menuTab(page, 'Office').click();
  await page.getByRole('menuitem', { name: 'Import contacts ...' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import contacts' });
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-io-area]').selectOption('lib.nvim');
  await dialog.locator('[data-io-file]').setInputFiles(fixture('outlook-v3.vcf'));

  // the trial run: two would be made, nothing is written yet
  await expect(dialog.locator('[data-io-summary]')).toContainText('2 would be made');
  expect(made()).toEqual([]);
  await expect(dialog.locator('[data-io-created]')).toContainText('Jörg Müller');
  const said = (await dialog.textContent()) ?? '';
  expect(said).not.toContain('example.org');
  expect(said).not.toContain('1234567');
  await expectAccessible(page, 'the trial run of an import');

  // confirmed: the files are there
  await dialog.locator('[data-io-run]').click();
  await expect(dialog.locator('[data-io-summary]')).toContainText('Imported: 2 made');
  expect(made()).toHaveLength(2);
  await dialog.locator('[data-io-close]').click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('section.contacts')).toContainText('Jörg Müller');

  // again: both are duplicates, named by the holder, none is made or overwritten
  const before = made().map((f) => readFileSync(join(dir(), f), 'utf8'));
  await page.locator('[data-contacts-import]').click();
  await dialog.locator('[data-io-area]').selectOption('lib.nvim');
  await dialog.locator('[data-io-file]').setInputFiles(fixture('outlook-v3.vcf'));
  await expect(dialog.locator('[data-io-summary]')).toContainText('0 would be made, 2 duplicates');
  await expect(dialog.locator('[data-io-duplicates]')).toContainText('lib.nvim/');
  await expect(dialog.locator('[data-io-run]')).toBeDisabled();
  expect(made().map((f) => readFileSync(join(dir(), f), 'utf8'))).toEqual(before);
  expect(problems).toEqual([]);
});

test('Contacts: the export of an area as CSV saves a file, a phone that starts with + is text for a spreadsheet', async ({ page }) => {
  const problems = await pair(page, '/#view=contacts');
  // the contacts to export: the example file, imported for real through the dialog
  await page.locator('[data-contacts-import]').click();
  const importing = page.getByRole('dialog', { name: 'Import contacts' });
  await importing.locator('[data-io-area]').selectOption('lib.nvim');
  await importing.locator('[data-io-file]').setInputFiles(fixture('outlook-v3.vcf'));
  await importing.locator('[data-io-run]').click();
  await expect(importing.locator('[data-io-summary]')).toContainText('Imported');
  await importing.locator('[data-io-close]').click();

  await page.locator('[data-contacts-export]').click();
  const dialog = page.getByRole('dialog', { name: 'Export contacts' });
  await dialog.locator('[data-io-format="csv"]').check();
  await dialog.locator('[data-io-export-area]').selectOption('lib.nvim');
  await expectAccessible(page, 'the export of contacts');
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.locator('[data-io-save]').click()]);
  expect(download.suggestedFilename()).toMatch(/^contacts-lib\.nvim-\d{4}-\d{2}-\d{2}\.csv$/);
  const text = readFileSync((await download.path())!, 'utf8');
  expect(text.charCodeAt(0)).toBe(0xfeff);
  expect(text).toContain('name;org;role;emails;phones;tz;tags;notes\r\n');
  expect(text).toContain("'+43 660 1234567");
  await expect(dialog.locator('[data-io-exported]')).toContainText('Saved');
  expect(await dialog.locator('[data-io-status]').textContent()).not.toContain('example.org');
  expect(problems).toEqual([]);
});
