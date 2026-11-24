import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { violations, watchViolations } from './a11y';
import { STATE } from './global';

// WCAG 2.4.11 (rule ACC-05): the keyboard focus is never hidden by content of the page itself. The sticky bars of the
// list (area heads), the inbox (area heads) and the timeline (header row, task column) sit over the scrolled content;
// without `scroll-padding` on their container, Tab to an element below a bar scrolls it just under the bar.
// After every Tab the element at the centre of the focused element must be the element itself or a descendant of it.

test.use({ locale: 'en-US', viewport: { width: 1100, height: 700 } });

const state = (): { token: string; vault: string } => JSON.parse(readFileSync(STATE, 'utf8')) as { token: string; vault: string };

/** The day `days` from today, as the engine writes a date. */
const day = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Tasks with a start and a due date around today, so that the timeline has rows of its own: the fixture vault has none,
 * and a test must not rely on the tasks of another one (the fixture takes these away after the test).
 */
function datedTasks(count: number): void {
  const dir = join(state().vault, 'lib.nvim', 'ROADMAP', 'tasks');
  for (let n = 0; n < count; n++) {
    const slug = `focus-timeline-e2e-${String(n).padStart(3, '0')}`;
    const text = `---
title: Focus timeline e2e ${String(n).padStart(3, '0')}
status: open
start: ${day(n - 3)}
due: ${day(n + 2)}
created: ${day(0)}
updated: ${day(0)}
---

A dated task of the timeline case of focus-not-covered.
`;
    writeFileSync(join(dir, `${slug}.md`), text);
  }
}

async function pair(page: Page, path: string): Promise<void> {
  await watchViolations(page);
  await page.addInitScript((token) => sessionStorage.setItem('tasks-desktop.session', token), state().token);
  await page.goto(path);
  await expect(page.getByRole('menubar')).toBeVisible();
}

interface Covered {
  tab: number;
  focus: string;
  top: string;
}

/** Tab through the page `steps` times; the focused elements that another element covers at their centre. */
async function tabAndCollect(page: Page, steps: number): Promise<{ visited: number; covered: Covered[] }> {
  const covered: Covered[] = [];
  let visited = 0;
  for (let tab = 1; tab <= steps; tab++) {
    await page.keyboard.press('Tab');
    const found = await page.evaluate(() => {
      const describe = (el: Element): string => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`;
      const focus = document.activeElement;
      if (!focus || focus === document.body) return null;
      const box = focus.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return null;
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      // A point outside the window is not covered by the page: it is not seen at all, which is another test's matter.
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return { focus: describe(focus), top: 'outside the window', covered: true };
      const top = document.elementsFromPoint(x, y)[0];
      const ok = !!top && (top === focus || focus.contains(top));
      return { focus: describe(focus), top: top ? describe(top) : 'nothing', covered: !ok };
    });
    if (!found) continue;
    visited++;
    if (found.covered) covered.push({ tab, focus: found.focus, top: found.top });
  }
  return { visited, covered };
}

test.afterEach(async ({ page }) => {
  expect(await violations(page)).toEqual([]);
});

for (const [name, path, ready] of [
  ['the inbox', '/#view=inbox', 'h3.area'],
  ['the timeline', '/#view=timeline', '.scroll .row.top'],
] as const) {
  test(`Tab through ${name} never leaves the focus under a sticky bar`, async ({ page }) => {
    if (name === 'the timeline') datedTasks(12);
    await pair(page, path);
    await expect(page.locator(ready).first()).toBeVisible({ timeout: 15_000 });
    // Enough steps to run past the menu bar and through the rows of the fixture (the hostile ones of other tests too).
    const { visited, covered } = await tabAndCollect(page, 80);
    expect(visited).toBeGreaterThan(20);
    expect(covered).toEqual([]);
  });
}

test('Tab through the list by area never leaves the focus under an area head', async ({ page }) => {
  await pair(page, '/#view=list');
  await page.getByRole('checkbox', { name: 'By area' }).check();
  const rows = page.locator('.rows[data-areas="groups"]');
  await expect(rows).toBeVisible();
  // A short window makes the rows scroll under the heads.
  await page.setViewportSize({ width: 1100, height: 420 });
  const { visited, covered } = await tabAndCollect(page, 80);
  expect(visited).toBeGreaterThan(20);
  expect(covered).toEqual([]);
});

test('Tab through the matrix of the marked tasks never leaves the focus covered', async ({ page }) => {
  await pair(page, '/#view=list');
  const row = page.locator('button.row').first();
  await expect(row).toBeVisible();
  const menu = page.getByRole('menu', { name: 'Context menu' });
  // The list may draw again (the engine's fields arrive) and take the focus from the row: ask again until it opens.
  await expect(async () => {
    await row.focus();
    await page.keyboard.press('Shift+F10');
    await expect(menu).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 10_000 });
  await menu.getByRole('menuitem', { name: 'Matrix', exact: true }).click();
  await expect(page.locator('section.open table')).toBeVisible();
  const { visited, covered } = await tabAndCollect(page, 60);
  expect(visited).toBeGreaterThan(10);
  expect(covered).toEqual([]);
});

test('Tab through the finished task never leaves the dialog and never covers the focus', async ({ page }) => {
  await pair(page, '/#view=list');
  await page.getByText('More filters', { exact: false }).first().click();
  await page.getByLabel('Show finished tasks under the list').check();
  const finished = page.getByRole('region', { name: 'Finished' });
  await finished.getByLabel('Period').selectOption('all');
  await finished.getByRole('button', { name: /Shipped bug/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Finished task' });
  await expect(dialog).toBeVisible();
  const { visited, covered } = await tabAndCollect(page, 25);
  expect(visited).toBeGreaterThan(2);
  expect(covered).toEqual([]);
  // A modal is the only thing the keys reach: an element of the page behind it never has the focus (the focus leaves
  // the page for the browser, which shows as the body, and comes back into the dialog).
  for (let tab = 0; tab < 8; tab++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((d) => document.activeElement === document.body || d.contains(document.activeElement))).toBe(true);
  }
});
