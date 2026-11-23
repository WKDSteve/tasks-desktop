// Switching vaults in the web variant: two folders used before, the menu "Project" lists them with the one read marked,
// one click reads the other (the page loads again with it), each comes back with its own view, and after a restart the
// browser is asked for a folder once, inside the click. Without a request and without a violation of the page's policy.

import { expect, test, type Page } from '@playwright/test';
import { askedFor, closeFloat, dropAccess, fakeFolders, pageUrl, pickNext, vaultFiles, violations, watchPage } from './page';
import { chooseFromMenu } from '../e2e/menu';

test.use({ locale: 'en-US' });

const A = 'tasks-vault';
const B = 'tricentis-vault';

/** The fixture vault, and a second one that differs in one title (so that the page shows which one it read). */
function twoVaults(): Record<string, Record<string, string>> {
  const a = vaultFiles();
  const b = { ...a };
  const eta = 'cascade.nvim/ROADMAP/tasks/eta.md';
  b[eta] = (b[eta] as string).replace('title: Eta tests', 'title: Zeta in the other vault');
  return { [A]: a, [B]: b };
}

async function projectMenu(page: Page): Promise<void> {
  await closeFloat(page);
  await page.getByRole('menuitem', { name: 'Project', exact: true }).click();
}

async function chooseView(page: Page, item: string): Promise<void> {
  await closeFloat(page);
  await chooseFromMenu(page, 'View', item);
}

/** Read `name` through the menu: the page loads again and shows the vault. */
async function switchTo(page: Page, name: string, shows: string): Promise<void> {
  await projectMenu(page);
  await page.getByRole('menuitemradio', { name, exact: true }).click();
  await expect(page.getByText(shows).first()).toBeVisible({ timeout: 30_000 });
}

/** Open A with the picker, then B through "Open another vault ...": both are folders used before. */
async function openBoth(page: Page): Promise<void> {
  await fakeFolders(page, twoVaults(), A);
  await page.goto(pageUrl());
  await page.getByRole('button', { name: 'Choose folder ...' }).click();
  await expect(page.getByText('Eta tests').first()).toBeVisible({ timeout: 30_000 });
  await chooseView(page, 'Board');
  await expect(page.getByRole('group', { name: 'Board' })).toBeVisible();

  await projectMenu(page);
  await page.getByRole('menuitem', { name: 'Open another vault ...' }).click();
  await pickNext(page, B);
  await page.getByRole('button', { name: 'Choose folder ...' }).click();
  await expect(page.getByText('Zeta in the other vault').first()).toBeVisible({ timeout: 30_000 });
}

test('the menu lists the vaults used before, marks the one read, and one click switches there and back, each with its view', async ({ page }) => {
  const seen = await watchPage(page);
  await openBoth(page);
  // The second vault starts in its own view, not in the board of the first.
  await expect(page.getByRole('group', { name: 'Board' })).toHaveCount(0);
  await chooseView(page, 'List');
  await expect(page.locator('button.row').first()).toBeVisible();

  await projectMenu(page);
  await expect(page.getByText(`Vault: ${B}`)).toBeVisible();
  await expect(page.getByRole('menuitemradio', { name: B, exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('menuitemradio', { name: A, exact: true })).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');

  await switchTo(page, A, 'Eta tests');
  await expect(page.getByText('Zeta in the other vault')).toHaveCount(0);
  // The first vault is back in its board, the address names no place of the other one.
  await expect(page.getByRole('group', { name: 'Board' })).toBeVisible();
  // The id the page before handed over was taken out: a reload does not switch again.
  expect(await page.evaluate(() => sessionStorage.getItem('tasks-web.switch-to'))).toBeNull();

  await switchTo(page, B, 'Zeta in the other vault');
  await expect(page.locator('button.row').first()).toBeVisible();
  await expect(page.getByRole('group', { name: 'Board' })).toHaveCount(0);

  expect(seen.errors).toEqual([]);
  expect(seen.requests).toEqual([]);
  expect(await violations(page)).toEqual([]);
});

test('after a restart the browser is asked for a folder once, inside the click that switches to it', async ({ page }) => {
  const seen = await watchPage(page);
  await openBoth(page);

  // The browser was started again: both folders lost their permission. The way in asks for the one to open.
  await dropAccess(page, [A, B]);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Open a vault' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('listitem').filter({ hasText: B }).getByRole('button', { name: 'Allow access' }).click();
  await expect(page.getByText('Zeta in the other vault').first()).toBeVisible({ timeout: 30_000 });
  expect(await askedFor(page, B)).toBe(1);

  // The other one is asked for in the click on it in the menu, not on the page that loads after it.
  await switchTo(page, A, 'Eta tests');
  expect(await askedFor(page, A)).toBe(1);
  // Back again: the access was kept, nobody is asked.
  await switchTo(page, B, 'Zeta in the other vault');
  expect(await askedFor(page, B)).toBe(1);
  expect(await askedFor(page, A)).toBe(1);

  expect(seen.errors).toEqual([]);
  expect(seen.requests).toEqual([]);
  expect(await violations(page)).toEqual([]);
});

test('a vault forgotten on the start page leaves the menu and takes its view with it', async ({ page }) => {
  const seen = await watchPage(page);
  await openBoth(page);
  /** The folders the page keeps a preference for (`<key>@<folder id>`). */
  const prefFolders = () =>
    page.evaluate(() => [...new Set(Object.keys(localStorage).filter((k) => k.startsWith('tasks-desktop.') && k.includes('@')).map((k) => k.split('@')[1]))].length);
  await chooseView(page, 'List');
  expect(await prefFolders()).toBe(2);

  await projectMenu(page);
  await page.getByRole('menuitem', { name: 'Open another vault ...' }).click();
  await page.getByRole('listitem').filter({ hasText: B }).getByRole('button', { name: 'Forget' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: B })).toHaveCount(0);
  expect(await prefFolders()).toBe(1);
  await page.getByRole('listitem').filter({ hasText: A }).getByRole('button', { name: 'Open' }).click();
  await expect(page.getByText('Eta tests').first()).toBeVisible({ timeout: 30_000 });

  await projectMenu(page);
  await expect(page.getByRole('menuitemradio', { name: A, exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('menuitemradio', { name: B, exact: true })).toHaveCount(0);

  expect(seen.errors).toEqual([]);
  expect(seen.requests).toEqual([]);
  expect(await violations(page)).toEqual([]);
});
