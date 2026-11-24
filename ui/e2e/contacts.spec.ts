import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, isMachineFault, test } from './fixtures';
import { expectAccessible, watchViolations } from './a11y';
import { STATE } from './global';
import { menuTab } from './menu';

// The contacts against the real hub and engine: the view in the tab Office with its search and filters, the page with
// its links, the form (a dry run, Esc that does not throw a changed form away), the change and the delete with their way
// back, and a change that is refused because the file moved on. A contact is a person of a third party: no message of
// the page names an address or a number. Each test makes its own contacts (names only this file uses) and removes them.

test.use({ locale: 'en-US' });
test.describe.configure({ mode: 'serial' });

const state = (): { token: string; vault: string } => JSON.parse(readFileSync(STATE, 'utf8')) as { token: string; vault: string };
const dir = (): string => join(state().vault, 'lib.nvim', 'CONTACTS');
const MAIL = 'e2e.contact.secret@example.org';
const PHONE = '+43 1 5550199';

test.afterEach(() => {
  for (const slug of ['e2e-rick', 'e2e-anna', 'e2e-made', 'e2e-conflict']) {
    rmSync(join(dir(), `${slug}.md`), { force: true });
    rmSync(join(dir(), slug), { force: true, recursive: true });
  }
});

function write(slug: string, name: string, extra = ''): void {
  mkdirSync(dir(), { recursive: true });
  writeFileSync(
    join(dir(), `${slug}.md`),
    `---\nname: "${name}"\norg: "E2e GmbH"\nrole: Support\nemails: [${MAIL}]\nphones: ["${PHONE}"]\ntags: [e2e]\n${extra}---\n\nKnows the old setup.\n\n## Notes\nLikes tea.\n`,
  );
}

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

/** What the page says as a status (a toast): never an address or a number of a contact. */
async function statusText(page: Page): Promise<string> {
  return (await page.locator('[role="status"], [role="alert"]').allTextContents()).join(' | ');
}

test('Office: People holds Contacts and Create holds New contact', async ({ page }) => {
  await pair(page, '/#view=list');
  await menuTab(page, 'Office').click();
  const menu = page.getByRole('menu', { name: /^Office/ });
  await expect(menu.getByRole('group', { name: 'People' })).toBeVisible();
  await expect(menu.getByRole('menuitemradio', { name: 'Contacts' })).toHaveAttribute('href', /#view=contacts/);
  await expect(menu.getByRole('menuitem', { name: 'New contact ...' })).toBeVisible();
});

test('Contacts: the list shows what a person is, searches, filters and opens the page with its links', async ({ page }) => {
  write('e2e-rick', 'E2e Rick Contact');
  write('e2e-anna', 'E2e Anna Contact', '');
  const problems = await pair(page, '/#view=contacts');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Contacts');
  const rick = page.locator('[data-contact="lib.nvim/e2e-rick"]');
  await expect(rick).toBeVisible();
  await expect(rick).toContainText('E2e GmbH · Support');
  // the list names no address and no number
  await expect(page.locator('section.contacts')).not.toContainText('example.org');
  await expect(page.locator('section.contacts')).not.toContainText('5550199');
  await expectAccessible(page, 'the list of the contacts');

  await page.locator('[data-contacts-search]').fill('e2e rick');
  await expect(page.locator('[data-contact="lib.nvim/e2e-anna"]')).toHaveCount(0);
  await page.locator('[data-contacts-search]').fill('zzz-no-such-person-zzz');
  await expect(page.locator('[data-contacts-empty]')).toBeVisible();
  await page.locator('[data-contacts-search]').fill('');
  await page.locator('[data-contacts-tag]').selectOption('e2e');
  await expect(page.locator('[data-contact="lib.nvim/e2e-anna"]')).toBeVisible();

  await rick.click();
  const dialog = page.getByRole('dialog', { name: 'E2e Rick Contact' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-contact-mail]')).toHaveAttribute('href', `mailto:${MAIL}`);
  await expect(dialog.locator('[data-contact-phone]')).toHaveAttribute('href', 'tel:+43' + '15550199');
  await expect(dialog.locator('[data-contact-notes]')).toHaveText('Likes tea.');
  await expectAccessible(page, 'the page of a contact');
  expect(problems).toEqual([]);
});

test('Contacts: n and the menu make a contact; the page opens, the status names nothing of it, Undo takes it back', async ({ page }) => {
  const problems = await pair(page, '/#view=contacts');
  await page.locator('section.contacts h2').click();
  await page.keyboard.press('n');
  const form = page.getByRole('dialog', { name: 'New contact' });
  await expect(form).toBeVisible();
  await expectAccessible(page, 'the form of a contact');
  await form.locator('[data-contact-area]').selectOption('lib.nvim');
  await form.locator('[data-contact-name]').fill('E2e Made');
  await form.locator('[data-contact-emails]').fill(MAIL);
  await form.locator('[data-contact-phones]').fill(PHONE);
  // the engine says what the file would be
  await expect(form.getByRole('status')).toContainText('lib.nvim/e2e-made');
  await form.locator('[data-contact-save]').click();
  // the dialogs are closed so that the toast with its way back is not covered; the list shows the contact
  await expect(form).toBeHidden();
  await expect(page.locator('[data-contact="lib.nvim/e2e-made"]')).toBeVisible();
  await expect.poll(() => existsSync(join(dir(), 'e2e-made.md'))).toBe(true);
  expect(readFileSync(join(dir(), 'e2e-made.md'), 'utf8')).toContain(MAIL);
  const said = await statusText(page);
  expect(said).not.toContain('example.org');
  expect(said).not.toContain('5550199');
  // Undo: the file is gone again
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => existsSync(join(dir(), 'e2e-made.md'))).toBe(false);
  await expect(page.locator('[data-contact="lib.nvim/e2e-made"]')).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('Contacts: Esc does not throw a changed form away; an untouched form closes', async ({ page }) => {
  await pair(page, '/#view=contacts');
  await menuTab(page, 'Office').click();
  await page.getByRole('menuitem', { name: 'New contact ...' }).click();
  const form = page.getByRole('dialog', { name: 'New contact' });
  await expect(form).toBeVisible();
  await form.locator('[data-contact-name]').fill('E2e Typed');
  await page.keyboard.press('Escape');
  await expect(form.locator('[data-contact-discard-ask]')).toBeVisible();
  await expect(form).toBeVisible();
  await form.locator('[data-contact-keep]').click();
  await expect(form.locator('[data-contact-discard-ask]')).toHaveCount(0);
  await expect(form.locator('[data-contact-name]')).toHaveValue('E2e Typed');
  await page.keyboard.press('Escape');
  await form.locator('[data-contact-discard]').click();
  await expect(form).toBeHidden();
  // nothing was written
  expect(existsSync(join(dir(), 'e2e-typed.md'))).toBe(false);
  // an untouched form closes at once
  await menuTab(page, 'Office').click();
  await page.getByRole('menuitem', { name: 'New contact ...' }).click();
  await expect(form).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(form).toBeHidden();
});

test('Contacts: a change writes only what changed, Undo brings the old value back; a delete asks and Undo makes the file again', async ({ page }) => {
  write('e2e-rick', 'E2e Rick Contact');
  const problems = await pair(page, '/#view=contacts');
  await page.locator('[data-contact="lib.nvim/e2e-rick"]').click();
  await page.locator('[data-contact-edit]').click();
  const form = page.getByRole('dialog', { name: 'Change the contact' });
  await expect(form.locator('[data-contact-name]')).toHaveValue('E2e Rick Contact');
  await form.locator('[data-contact-role]').fill('Lead');
  await expect(form.getByRole('status')).toContainText('lib.nvim/e2e-rick');
  await form.locator('[data-contact-save]').click();
  await expect(form).toBeHidden();
  await expect.poll(() => readFileSync(join(dir(), 'e2e-rick.md'), 'utf8')).toContain('role: Lead');
  expect(readFileSync(join(dir(), 'e2e-rick.md'), 'utf8')).toContain(MAIL);
  expect(await statusText(page)).not.toContain('example.org');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => readFileSync(join(dir(), 'e2e-rick.md'), 'utf8')).toContain('role: Support');

  // delete: asked first, then removed on the version shown
  await page.locator('[data-contact="lib.nvim/e2e-rick"]').click();
  const page1 = page.getByRole('dialog', { name: 'E2e Rick Contact' });
  await expect(page1).toBeVisible();
  await page1.locator('[data-contact-delete]').click();
  await expect(page1.locator('[data-contact-ask]')).toContainText('E2e Rick Contact');
  expect(existsSync(join(dir(), 'e2e-rick.md'))).toBe(true);
  await page1.locator('[data-contact-delete-yes]').click();
  await expect.poll(() => existsSync(join(dir(), 'e2e-rick.md'))).toBe(false);
  expect(await statusText(page)).not.toContain('example.org');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => existsSync(join(dir(), 'e2e-rick.md'))).toBe(true);
  // the way back brought the data and the notes with it
  const back = readFileSync(join(dir(), 'e2e-rick.md'), 'utf8');
  expect(back).toContain(MAIL);
  expect(back).toContain('Likes tea.');
  expect(problems).toEqual([]);
});

test('Contacts: a change of a contact that moved on waits in the conflict center and is tried again on the new version', async ({ page }) => {
  write('e2e-conflict', 'E2e Conflict');
  await pair(page, '/#view=contacts');
  await page.locator('[data-contact="lib.nvim/e2e-conflict"]').click();
  await page.locator('[data-contact-edit]').click();
  const form = page.getByRole('dialog', { name: 'Change the contact' });
  await form.locator('[data-contact-role]').fill('Lead');
  // somebody else changes the file after the form was opened
  const file = join(dir(), 'e2e-conflict.md');
  writeFileSync(file, readFileSync(file, 'utf8').replace('role: Support', 'role: Manager'));
  await form.locator('[data-contact-save]').click();
  await expect(page.getByRole('button', { name: /Refused changes: 1/ })).toBeVisible();
  expect(readFileSync(file, 'utf8')).toContain('role: Manager');
  await page.getByRole('button', { name: /Refused changes: 1/ }).click();
  const center = page.getByRole('dialog', { name: 'Refused changes' });
  await expect(center).toContainText('E2e Conflict');
  await expect(center).toContainText('Lead');
  await expect(center).toContainText('Manager');
  await center.getByRole('button', { name: 'Try again' }).click();
  await expect.poll(() => readFileSync(file, 'utf8')).toContain('role: Lead');
});
