import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { violations, watchViolations } from './a11y';
import { STATE } from './global';
import { menuTab } from './menu';

// APG modal dialog: the focus goes into the dialog when it opens, Escape closes it, and the focus is back on the page
// afterwards (never lost on the body). One case per dialog that a menu, a key or a button opens without more set-up;
// the rest of the dialogs are held by `dialogs.guard.test.ts` (their shape) and by the cases of their own features.

test.use({ locale: 'en-US', viewport: { width: 1100, height: 700 } });

const state = (): { token: string } => JSON.parse(readFileSync(STATE, 'utf8')) as { token: string };

async function pair(page: Page, start = '/#view=list'): Promise<void> {
  await watchViolations(page);
  await page.addInitScript((token) => sessionStorage.setItem('tasks-desktop.session', token), state().token);
  await page.goto(start);
  await expect(page.getByRole('menubar')).toBeVisible();
  if (start.includes('view=list')) await expect(page.locator('button.row').first()).toBeVisible();
}

const menu = async (page: Page, top: string, entry: string): Promise<void> => {
  await menuTab(page, top).click();
  await page.getByRole('menuitem', { name: entry, exact: true }).click();
};

/** How each dialog is opened: its name (as the page gives it), the steps, and where the focus is expected afterwards:
 * `same` (the element that had it before: a key opened the dialog), a locator (the button that opened it) or `page`
 * (a menu opened it: its own item is gone, the focus must still be on the page and not on the body). */
const OPENERS: [string, (page: Page) => Promise<void>, 'same' | 'page' | ((page: Page) => Locator)][] = [
  ['New task', (p) => p.locator('body').press('c'), 'same'],
  ['Command palette', (p) => p.keyboard.press('Control+k'), 'same'],
  ['About tasks-desktop', (p) => menu(p, 'Help', 'About ...'), 'page'],
  ['Vaults', (p) => menu(p, 'Project', 'Manage vaults ...'), 'page'],
  ['Paste an intent', (p) => menu(p, 'Work', 'Paste an intent ...'), 'page'],
  ['Check the vault', (p) => p.getByRole('button', { name: 'Check ...' }).click(), (p) => p.getByRole('button', { name: 'Check ...' })],
  ['Documentation', (p) => menu(p, 'Help', 'Releasing'), 'page'],
  ['Create a plan', (p) => menu(p, 'Project', 'Create a plan'), 'page'],
  ['Defaults', (p) => menu(p, 'Options', 'Defaults ...'), 'page'],
];

type Back = 'same' | 'page' | ((page: Page) => Locator);

/** The case of one dialog: opened by `open` on the page at `start`, the focus goes in, Escape closes it, the focus is back. */
async function checkDialog(page: Page, name: string | RegExp, open: (page: Page) => Promise<void>, back: Back, start = '/#view=list'): Promise<void> {
  await pair(page, start);
  await page.evaluate(() => {
    (window as unknown as { before: Element | null }).before = document.activeElement;
  });
  await open(page);
  const dialog = page.getByRole('dialog', { name });
  await expect(dialog).toBeVisible();
  // In: the focused element is the dialog or inside it.
  await expect.poll(() => dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  expect(await violations(page)).toEqual([]);
  // A hint that is open on the focused element takes the first Escape (WCAG 1.4.13); the dialog the next.
  await page.keyboard.press('Escape');
  if (await dialog.count()) await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  if (typeof back === 'function') {
    // A button opened it: the focus is on that button again.
    await expect(back(page)).toBeFocused();
  } else if (back === 'same') {
    // A dialog that a key opened gives the focus back to where it was (the body when nothing had it).
    await expect.poll(() => page.evaluate(() => document.activeElement === (window as unknown as { before: Element | null }).before)).toBe(true);
  } else {
    await expect.poll(() => page.evaluate(() => document.activeElement !== null && document.activeElement !== document.body)).toBe(true);
  }
}

for (const [name, open, back] of OPENERS) {
  test(`the dialog "${name}": the focus goes in, Escape closes it, the focus is not lost`, async ({ page }) => {
    await checkDialog(page, name, open, back);
  });
}

/** The dialogs that need a little set-up on the page: a row, a mark, a view. Name, page, steps, where the focus goes back. */
const SETUP: [string | RegExp, string, (page: Page) => Promise<void>, Back][] = [
  ['Task', '/#view=list', (p) => p.locator('button.row').first().click(), (p) => p.locator('button.row').first()],
  [
    'Finished task',
    '/#view=list',
    async (p) => {
      await p.getByText('More filters', { exact: false }).first().click();
      await p.getByLabel('Show finished tasks under the list').check();
      const finished = p.getByRole('region', { name: 'Finished' });
      await finished.getByLabel('Period').selectOption('all');
      await finished.getByRole('button', { name: /Shipped bug/ }).click();
    },
    (p) => p.getByRole('region', { name: 'Finished' }).getByRole('button', { name: /Shipped bug/ }),
  ],
  [
    'Move to another area',
    '/#view=list',
    async (p) => {
      await p.locator('.rows .row-host').first().locator('button.row').focus();
      await p.keyboard.press('Tab');
      await p.keyboard.press('Enter');
    },
    (p) => p.getByRole('button', { name: /^Move .* to another area$/ }),
  ],
  [
    'Estimate',
    '/#view=list',
    async (p) => {
      await p.getByRole('button', { name: 'Mark all shown' }).click();
      await p.keyboard.press('e');
    },
    (p) => p.getByRole('button', { name: 'Mark all shown' }),
  ],
  [
    /^Add tags to/,
    '/#view=list',
    async (p) => {
      await p.locator('button.row').first().focus();
      await p.keyboard.press('Shift+F10');
      await p.getByRole('menu', { name: 'Context menu' }).getByRole('menuitem', { name: 'Add tag ...' }).click();
    },
    (p) => p.locator('button.row').first(),
  ],
  ['New contact', '/#view=contacts', (p) => menu(p, 'Office', 'New contact ...'), 'page'],
  ['New meeting', '/#view=list', (p) => menu(p, 'Office', 'New meeting ...'), 'page'],
  [/Today/, '/#view=today', (p) => p.locator('section[data-tile="daily"]').getByRole('heading', { name: /Today/ }).getByRole('button').click(), (p) => p.locator('section[data-tile="daily"]').getByRole('heading', { name: /Today/ }).getByRole('button')],
];

for (const [name, start, open, back] of SETUP) {
  test(`the dialog ${String(name)} (with set-up): the focus goes in, Escape closes it, the focus is not lost`, async ({ page }) => {
    await checkDialog(page, name, open, back, start);
  });
}

test('the dialogs that change a task have Cancel as their first button, and the focus is on it', async ({ page }) => {
  await pair(page);
  await page.locator('button.row').first().click();
  const float = page.locator('aside.detail');
  await expect(float).toBeVisible();
  await float.getByRole('button', { name: 'Done', exact: true }).click();
  const done = page.getByRole('dialog', { name: 'Finish this task?' });
  await expect(done).toBeVisible();
  // The focus a modal takes is the safe answer: Cancel, not the choice of a reminder above it.
  await expect(done.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(done).toHaveCount(0);
});
