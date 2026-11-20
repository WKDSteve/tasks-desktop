import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, isMachineFault, test } from './fixtures';
import { expectAccessible, violations, watchViolations } from './a11y';
import { STATE } from './global';

// The meetings in the calendar against the real hub and the real engine: the month shows a meeting as a chip, the
// week is the hour grid (a block, the line of now, the bar above), the keys move a meeting and change its length, the
// day is the same grid in one column. Every rule is the engine's: the test reads what it wrote into the file.

test.use({ locale: 'en-US' });

const state = (): { token: string; vault: string } => JSON.parse(readFileSync(STATE, 'utf8')) as { token: string; vault: string };

/** How long a write may take to be answered (the engine's 5 s for a call, and a call it may wait behind). */
const WRITE_BUDGET = 15_000;

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

function nextAnswer(page: Page): Promise<unknown> {
  const answer = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/tasks/ops', {
    timeout: WRITE_BUDGET,
  });
  answer.catch(() => undefined);
  return answer;
}

/** Today on the wall of this machine, `YYYY-MM-DD`. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test('a meeting in the calendar: a chip in the month, a block in the week, moved and lengthened with the keys, the same in the day', async ({ page }) => {
  const slug = 'cal-e2e-m01';
  const dir = join(state().vault, 'lib.nvim', 'MEETINGS');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${slug}.md`);
  const id = `lib.nvim/${slug}`;
  writeFileSync(file, `---\ntitle: Cal e2e m01\nstatus: planned\ndate: ${today()}\ntime: "10:00"\nduration: 1h\nlocation: Room 4\n---\n\nA meeting of one browser test.\n`);
  try {
    const problems = await pair(page, '/#view=calendar');
    const chip = page.locator(`.chip[data-meeting="${id}"]`);
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('10:00');

    // The week is the hour grid, loaded on the first need.
    await page.getByRole('combobox', { name: 'Show' }).selectOption('week');
    const grid = page.locator('[data-timegrid="week"]');
    await expect(grid).toBeVisible();
    await expect(grid.locator('[data-col]')).toHaveCount(7);
    await expect(grid.locator('[data-now]')).toHaveCount(1);
    const block = grid.locator(`.block[data-meeting="${id}"] .open`);
    await expect(block).toBeVisible();
    await expectAccessible(page, 'the week of the calendar with a meeting');

    // Shift with an arrow moves it by a quarter hour; Ctrl+Shift changes its length.
    await block.focus();
    let answer = nextAnswer(page);
    await page.keyboard.press('Shift+ArrowDown');
    await answer;
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: WRITE_BUDGET }).toMatch(/10:15/);
    // The grid reads the meeting again after the write: the block stands at 10:15 (492 px) before the next key is sent.
    await expect(grid.locator(`.block[data-meeting="${id}"]`)).toHaveCSS('top', '492px', { timeout: WRITE_BUDGET });
    await expect(block).toBeFocused();
    answer = nextAnswer(page);
    await page.keyboard.press('Control+Shift+ArrowDown');
    await answer;
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: WRITE_BUDGET }).toMatch(/duration: 1h15m/);

    // The day is the same grid in one column, with the place in the block.
    await page.getByRole('combobox', { name: 'Show' }).selectOption('day');
    const day = page.locator('[data-timegrid="day"]');
    await expect(day.locator('[data-col]')).toHaveCount(1);
    await expect(day.locator(`.block[data-meeting="${id}"]`)).toContainText('Room 4');
    await expectAccessible(page, 'the day of the calendar');

    expect(await violations(page)).toEqual([]);
    expect(problems).toEqual([]);
  } finally {
    if (existsSync(file)) rmSync(file, { force: true });
  }
});

test('a meeting moved in the hour grid comes back with Undo on the toast: its beginning and its end as the file had them', async ({ page }) => {
  const slug = 'cal-e2e-m02';
  const dir = join(state().vault, 'lib.nvim', 'MEETINGS');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${slug}.md`);
  const id = `lib.nvim/${slug}`;
  writeFileSync(file, `---\ntitle: Cal e2e m02\nstatus: planned\ndate: ${today()}\ntime: "13:00"\nend: "14:00"\n---\n\nA meeting of one browser test.\n`);
  try {
    const problems = await pair(page, '/#view=calendar');
    await page.getByRole('combobox', { name: 'Show' }).selectOption('week');
    const grid = page.locator('[data-timegrid="week"]');
    const block = grid.locator(`.block[data-meeting="${id}"] .open`);
    await expect(block).toBeVisible();
    await block.focus();
    let answer = nextAnswer(page);
    await page.keyboard.press('Shift+ArrowDown');
    await answer;
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: WRITE_BUDGET }).toMatch(/time: "?13:15/);
    expect(readFileSync(file, 'utf8')).toMatch(/duration: 1h/);

    answer = nextAnswer(page);
    await page.getByRole('button', { name: 'Undo' }).click();
    await answer;
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: WRITE_BUDGET }).toMatch(/time: "?13:00/);
    const text = readFileSync(file, 'utf8');
    expect(text).toMatch(/end: "?14:00/);
    expect(text).not.toMatch(/duration:/);
    // 13:00 is 780 minutes: the block stands there again
    await expect(grid.locator(`.block[data-meeting="${id}"]`)).toHaveCSS('top', `${780 * 0.8}px`, { timeout: WRITE_BUDGET });
    expect(problems).toEqual([]);
  } finally {
    if (existsSync(file)) rmSync(file, { force: true });
  }
});
