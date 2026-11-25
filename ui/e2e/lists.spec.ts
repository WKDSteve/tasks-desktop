import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, isMachineFault, test } from './fixtures';
import { expectAccessible, watchViolations } from './a11y';
import { STATE } from './global';
import { menuTab } from './menu';

// The tab Lists against the real hub and engine: a list made from the tab, a line typed with a #tag, the filter, a
// tick, a picture pasted into the line (an entry with that picture in its folder), the entry made a task with its
// picture, and the export as Markdown. Each test makes its own lists (names only this file uses) and removes them.

test.use({ locale: 'en-US' });
test.describe.configure({ mode: 'serial' });

const state = (): { token: string; vault: string } => JSON.parse(readFileSync(STATE, 'utf8')) as { token: string; vault: string };
const LIST = '_list-e2e-lists';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test.afterEach(() => {
  const vault = state().vault;
  for (const name of readdirSync(vault)) {
    if (name.startsWith('_list-e2e')) rmSync(join(vault, name), { force: true, recursive: true });
  }
  const tasks = join(vault, 'lib.nvim', 'ROADMAP', 'tasks');
  for (const name of existsSync(tasks) ? readdirSync(tasks) : []) {
    if (name.startsWith('e2e-lists-')) rmSync(join(tasks, name), { force: true, recursive: true });
  }
});

function writeList(): void {
  const dir = join(state().vault, LIST);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'list.md'), '---\ntitle: E2e Lists\ncreated: 2026-01-01T08:00:00Z\n---\n');
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

/** The entries of the list on disk: their file names (plain and folder form). */
const onDisk = (): string[] => readdirSync(join(state().vault, LIST)).filter((n) => n !== 'list.md');

test('Lists: the tab holds the view and New list, which makes a list', async ({ page }) => {
  const problems = await pair(page, '/#view=list');
  await menuTab(page, 'Lists').click();
  const menu = page.getByRole('menu', { name: /^Lists/ });
  await expect(menu.getByRole('menuitemradio', { name: 'Lists' })).toHaveAttribute('href', /#view=lists/);
  await menu.getByRole('menuitem', { name: 'New list' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lists');
  const form = page.locator('[data-lists-form="new"]');
  await expect(form.getByRole('textbox')).toBeFocused();
  await form.getByRole('textbox').fill('E2e Lists');
  await form.getByRole('button', { name: 'Make the list' }).click();
  await expect(page.locator('[data-lists-choose]')).toHaveValue(LIST);
  expect(readFileSync(join(state().vault, LIST, 'list.md'), 'utf8')).toMatch(/title: E2e Lists/);
  expect(problems).toEqual([]);
});

test('Lists: a line with a #tag, the filter, a tick and the export', async ({ page }) => {
  writeList();
  const problems = await pair(page, '/#view=lists');
  await page.locator('[data-lists-choose]').selectOption(LIST);
  const line = page.locator('[data-lists-line]');
  await line.fill('E2e first #e2etag');
  await line.press('Enter');
  await expect(page.locator('[data-entry] [data-entry-open]').first()).toHaveText('E2e first');
  await line.fill('E2e second');
  await line.press('Enter');
  await expect(page.locator('[data-entry] [data-entry-open]')).toHaveText(['E2e second', 'E2e first']);
  await expect(page.locator('[data-entry-tag="e2etag"]')).toHaveCount(1);
  await expectAccessible(page, 'the tab Lists');

  await page.locator('[data-lists-tag]').selectOption('e2etag');
  await expect(page.locator('[data-entry] [data-entry-open]')).toHaveText(['E2e first']);
  await page.locator('[data-lists-reset]').click();
  await expect(page.locator('[data-entry]')).toHaveCount(2);

  const second = page.locator('[data-entry]').filter({ hasText: 'E2e second' });
  await second.locator('[data-entry-done]').check();
  await expect(second).toHaveClass(/done/);
  await page.locator('[data-lists-state]').selectOption('open');
  await expect(page.locator('[data-entry] [data-entry-open]')).toHaveText(['E2e first']);

  await page.locator('[data-lists-export] summary').click();
  const download = page.waitForEvent('download');
  await page.locator('[data-export="markdown"]').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^list-e2e-lists-\d{4}-\d{2}-\d{2}\.md$/);
  const text = readFileSync(await file.path(), 'utf8');
  expect(text).toContain('# E2e Lists');
  expect(text).toContain('## E2e first');
  expect(text).not.toContain('E2e second');
  expect(problems).toEqual([]);
});

test('Lists: a picture pasted into the line is an entry with it, and the entry becomes a task with its picture', async ({ page }) => {
  writeList();
  const problems = await pair(page, '/#view=lists');
  await page.locator('[data-lists-choose]').selectOption(LIST);
  const line = page.locator('[data-lists-line]');
  await line.fill('E2e Lists picture');
  await line.evaluate((input, bytes) => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' }));
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, [...PNG]);
  const entry = page.locator('[data-entry]').filter({ hasText: 'E2e Lists picture' });
  await expect(entry.locator('[data-entry-files]')).toBeVisible();
  const folder = onDisk().find((n) => !n.endsWith('.md'));
  expect(folder, onDisk().join(', ')).toBeDefined();
  const images = join(state().vault, LIST, folder as string, 'assets', 'images');
  expect(readdirSync(images).some((n) => /^pasted-\d{8}-\d{6}\.png$/.test(n))).toBe(true);

  await entry.locator('[data-entry-open]').click();
  await expect(entry.locator('[data-entry-file]')).toHaveCount(1);
  await entry.locator('[data-entry-area]').selectOption('lib.nvim');
  await entry.locator('[data-entry-promote]').click();
  await expect(page.locator('[data-entry]')).toHaveCount(0);
  const task = join(state().vault, 'lib.nvim', 'ROADMAP', 'tasks', 'e2e-lists-picture');
  await expect.poll(() => existsSync(join(task, 'e2e-lists-picture.md'))).toBe(true);
  expect(readdirSync(join(task, 'assets', 'images')).some((n) => n.endsWith('.png'))).toBe(true);
  expect(onDisk()).toEqual([]);
  expect(problems).toEqual([]);
});
