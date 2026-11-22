import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, isMachineFault, test } from './fixtures';
import { expectAccessible, watchViolations } from './a11y';
import { STATE } from './global';

// The figures of the tab Lernpläne against the real hub and the real engine (capability learn_history): the overview
// with its period (kept on the device), the figures of a period against the one before in words and a mark, the bars
// as a table, the running paths. The series of the learning figures is written here as the engine writes it
// (`_Telemetry/history/learn-YYYY-MM.jsonl`, absolute figures per day and path) for a path of this test only, around
// today; what the series says is the engine's, the test reads what the page draws from it, with axe in both themes
// and a narrow window. The vault is shared with the other tests: only the rows of this path are checked by number.

test.use({ locale: 'en-US' });

const state = (): { token: string; vault: string } => JSON.parse(readFileSync(STATE, 'utf8')) as { token: string; vault: string };

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

const A = 'lib.nvim';
const ID = `${A}/lv3-e2e-figures`;
const FILE = `${A}/ROADMAP/paths/lv3-e2e-figures.md`;

/** A day of this machine `n` days from today, as the hub and the engine count days. */
function dayFrom(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A row of the series as the engine writes it: the absolute figures of the path on a day. */
const row = (day: string, learned: number) =>
  JSON.stringify({ v: 1, day, path: ID, area: A, at: `${day}T08:00:00Z`, done_h: learned / 2, learned, seen: 0, dropped: 0, open: 8 - learned, total: 8, xp: learned * 10 });

/** The path (5 of 8 learned) and its rows: where it started eight days ago, 2 learned a week ago, 5 today. */
function write(): () => void {
  const file = join(state().vault, FILE);
  mkdirSync(dirname(file), { recursive: true });
  // 10 XP a point, half an hour on each one learned: the file says what the rows say (the hub may write today's row anew).
  const leaves = Array.from({ length: 8 }, (_, i) => `  - [${i < 5 ? 'x' : ' '}] LV3 figure ${i + 1} {xp=10}${i < 5 ? ' {done_h=0.5}' : ''} {#f${i + 1}}`);
  writeFileSync(file, `---\ntitle: LV3 e2e Figures\nstatus: doing\ncreated: 2026-11-01\nupdated: 2026-11-20\n---\n\n## Lernpunkte\n\n- [ ] LV3 stage {#s}\n${leaves.join('\n')}\n`);
  const rows: [string, number][] = [
    [dayFrom(-8), 0],
    [dayFrom(-7), 2],
    [dayFrom(0), 5],
  ];
  const months = new Set<string>();
  for (const [day, learned] of rows) {
    const month = join(state().vault, '_Telemetry', 'history', `learn-${day.slice(0, 7)}.jsonl`);
    mkdirSync(dirname(month), { recursive: true });
    appendFileSync(month, `${row(day, learned)}\n`);
    months.add(month);
  }
  return () => {
    rmSync(file, { force: true });
    for (const month of months) {
      if (!existsSync(month)) continue;
      const kept = readFileSync(month, 'utf8')
        .split('\n')
        .filter((line) => line !== '' && !line.includes(`"path":"${ID}"`));
      if (kept.length === 0) rmSync(month, { force: true });
      else writeFileSync(month, `${kept.join('\n')}\n`);
    }
  };
}

test('the overview: the period by radios and kept, the figures against the period before in words, the bars as a table, axe', async ({ page }) => {
  const clean = write();
  try {
    const problems = await pair(page, '/#view=learn');
    await expect(page.getByRole('heading', { name: 'Learning plans · Overview', level: 2 })).toBeVisible();
    const mine = page.getByRole('region', { name: 'My learning' });
    await expect(mine.getByRole('group', { name: 'Period' })).toBeVisible();

    // Today: the figures of today against yesterday, each in words; the mark is a picture only.
    await mine.getByRole('radio', { name: 'Today' }).check();
    const learned = mine.locator('[data-fig="learned"]');
    await expect(learned.locator('dd.cmp')).toContainText(/vs yesterday/);
    await expect(learned.locator('dd.cmp [aria-hidden="true"]')).toHaveText(/^[▲▼=]$/);
    await expect(mine.locator('[data-fig="streak"]')).toContainText(/in a row|no streak/);
    // The bars of the week up to today, as a table on asking; today's bar holds at least the three of this path.
    await mine.getByRole('button', { name: 'As table' }).click();
    const table = mine.getByRole('region', { name: 'Points learned per day' });
    await expect(table).toBeVisible();
    await expect(table.locator('tbody tr')).toHaveCount(7);
    const todayRow = table.locator(`tr[data-bar="${dayFrom(0)}"] td`).first();
    expect(Number(await todayRow.textContent())).toBeGreaterThanOrEqual(3);
    await expect(mine.getByRole('button', { name: 'As chart' })).toHaveAttribute('aria-pressed', 'true');

    // The period is kept on this device.
    await mine.getByRole('radio', { name: 'Month' }).check();
    await page.reload();
    await expect(page.getByRole('region', { name: 'My learning' }).getByRole('radio', { name: 'Month' })).toBeChecked();

    // The running path, opened from its tile.
    const running = page.getByRole('region', { name: 'Running paths' });
    const item = running.locator(`li[data-path="${ID}"]`);
    await expect(item.getByRole('progressbar')).toHaveAccessibleName('63 % done');

    await expectAccessible(page, 'learning overview, light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectAccessible(page, 'learning overview, dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 420, height: 900 });
    // One column: the tiles stand one below the other.
    const boxes = await Promise.all(['My learning', 'Running paths'].map((name) => page.getByRole('region', { name }).boundingBox()));
    expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height - 1);
    await expectAccessible(page, 'learning overview, narrow');

    await item.getByRole('button', { name: 'LV3 e2e Figures' }).click();
    await expect(page).toHaveURL(/#view=paths/);
    expect(problems).toEqual([]);
  } finally {
    clean();
  }
});
