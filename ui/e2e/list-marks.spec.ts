import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';
import { STATE } from './global';

// The marks of a row in the list have a width of their own (TaskRow.svelte, `--col-meta`): the mark "touches n areas"
// (`↔ n`) comes from its own request (`/api/tasks/links`), later than the rows, and must not move the title when it
// arrives (tasks-desktop/liste-die-spalte-der-marken-springt-um-40-px-wenn-die; it narrowed the title by about 40 px).

test.use({ locale: 'en-US', viewport: { width: 1400, height: 900 } });

const state = (): { token: string } => JSON.parse(readFileSync(STATE, 'utf8')) as { token: string };

test('the cross-area mark that comes later does not move the title of its row', async ({ page }) => {
  // The links are held until the rows are measured: their late arrival is the rule of this test.
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
  const rows = page.locator('button.row');
  await expect(rows.nth(2)).toBeVisible();
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
