import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { STATE } from './global';

// The marks of a row in the list have a width of their own (TaskRow.svelte, `--col-meta`): the mark "touches n areas"
// (`↔ n`) comes from its own request (`/api/tasks/links`), later than the rows, and must not move the title when it
// arrives (tasks-desktop/liste-die-spalte-der-marken-springt-um-40-px-wenn-die; it narrowed the title by about 40 px).
// The width is at most 18rem and at most 30 % of the row, so that a window of middle width keeps its titles, and it
// gives way in a narrow one, where the list does not scroll sideways.

test.use({ locale: 'en-US' });

const state = (): { token: string } => JSON.parse(readFileSync(STATE, 'utf8')) as { token: string };

/** The list, with the links held until `letGo` is called. */
async function listWithLinksHeld(page: Page): Promise<() => void> {
  let letGo: () => void = () => undefined;
  const gate = new Promise<void>((open) => (letGo = open));
  await page.route(
    (url) => url.pathname === '/api/tasks/links',
    async (route) => {
      await gate;
      await route.continue().catch(() => undefined);
    },
  );
  await page.addInitScript((token) => sessionStorage.setItem('tasks-desktop.session', token), state().token);
  await page.goto('/#view=list');
  await expect(page.locator('button.row').nth(2)).toBeVisible();
  return letGo;
}

for (const width of [1400, 700]) {
  test.describe(`a window ${width} px wide`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('the cross-area mark that comes later does not move the title of its row', async ({ page }) => {
      const letGo = await listWithLinksHeld(page);
      const rows = page.locator('button.row');
      await expect(page.locator('button.row .meta', { hasText: '↔' })).toHaveCount(0);
      const titles = () => rows.locator('.title').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
      const before = await titles();

      letGo();
      await expect(page.locator('button.row .meta', { hasText: '↔' }).first()).toBeVisible();
      const marked = await rows.evaluateAll((els) => els.findIndex((e) => (e.querySelector('.meta')?.textContent ?? '').includes('↔')));
      expect(marked).toBeGreaterThanOrEqual(0);
      const after = await titles();
      expect(after.length).toBe(before.length);
      // The row that got the mark keeps its title box, and so does every other row.
      expect(after[marked]).toBeCloseTo(before[marked]!, 1);
      expect(after).toEqual(before);
    });

    test('the marks take at most 30 % of a row, and never more than 18rem', async ({ page }) => {
      const letGo = await listWithLinksHeld(page);
      letGo();
      await expect(page.locator('button.row .meta', { hasText: '↔' }).first()).toBeVisible();
      const shares = await page.locator('button.row').evaluateAll((els) =>
        els.map((row) => {
          const columns = getComputedStyle(row).gridTemplateColumns.split(' ').map((w) => Number.parseFloat(w));
          return { row: row.getBoundingClientRect().width, marks: columns[2] ?? 0 };
        }),
      );
      expect(shares.length).toBeGreaterThan(2);
      for (const { row, marks } of shares) {
        expect(marks).toBeLessThanOrEqual(Math.min(row * 0.3, 18 * 16) + 0.5);
      }
    });
  });
}

test.describe('a window as narrow as a phone', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test('the list does not scroll sideways', async ({ page }) => {
    const letGo = await listWithLinksHeld(page);
    letGo();
    await expect(page.locator('button.row .meta', { hasText: '↔' }).first()).toBeVisible();
    const sideways = await page.locator('.rows').evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(sideways).toBeLessThanOrEqual(1);
  });
});
