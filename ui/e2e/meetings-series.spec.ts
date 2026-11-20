import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, isMachineFault, test } from './fixtures';
import { expectAccessible, violations, watchViolations } from './a11y';
import { STATE } from './global';

// A series of meetings against the real hub and the real engine (capability `meeting_series`): the calendar shows its
// occurrences (a sign, the one without a file dotted), the page of an occurrence names its day and its series, and the
// first entry into an occurrence (here its cancellation) makes its file with `series:`; the series itself is edited on
// its own page. Every rule is the engine's: the test reads what it wrote into the files.

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

/** A day on the wall of this machine, `YYYY-MM-DD`, `plus` days from today. */
function day(plus = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + plus);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test('a series in the calendar: its occurrences marked, the first entry into one makes its file, the series edited on its page', async ({ page }) => {
  const slug = 'ser-e2e-s01';
  const dir = join(state().vault, 'lib.nvim', 'MEETINGS');
  mkdirSync(dir, { recursive: true });
  const seriesFile = join(dir, `${slug}.md`);
  const occurrenceFile = join(dir, `${slug}-${day()}.md`);
  const series = `lib.nvim/${slug}`;
  const today = `${series}-${day()}`;
  writeFileSync(seriesFile, `---\ntitle: Ser e2e s01\nstatus: planned\ndate: ${day()}\ntime: "10:00"\nduration: 30m\nrepeat: weekly\n---\n\nA series of one browser test.\n`);
  try {
    const problems = await pair(page, '/#view=calendar');
    // The occurrence of today, not the series: computed, so dotted and named a series without a file.
    const chip = page.locator(`.chip[data-meeting="${today}"]`);
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute('data-series', series);
    await expect(chip).toHaveClass(/virtual/);
    await expect(chip).toContainText('Series, no file yet');
    await expect(page.locator(`.chip[data-meeting="${series}"]`)).toHaveCount(0);

    await chip.click();
    const dialog = page.locator('dialog.meeting-page');
    const bar = dialog.locator(`[data-occurrence="${day()}"]`);
    await expect(bar).toContainText(`Occurrence on ${day()} (no file yet)`);
    await expectAccessible(page, 'the page of an occurrence of a series');
    expect(existsSync(occurrenceFile)).toBe(false);

    // The first entry: cancelling this occurrence makes its file, the series stays as it was.
    const answer = nextAnswer(page);
    await bar.getByRole('button', { name: 'Cancel this occurrence' }).click();
    await answer;
    await expect.poll(() => existsSync(occurrenceFile), { timeout: WRITE_BUDGET }).toBe(true);
    const made = readFileSync(occurrenceFile, 'utf8');
    expect(made).toMatch(/status: cancelled/);
    expect(made).toMatch(new RegExp(`series: "?${series}`));
    expect(readFileSync(seriesFile, 'utf8')).toMatch(/status: planned/);
    // The page reads the occurrence again, now from its file.
    await expect(bar).not.toContainText('no file yet', { timeout: WRITE_BUDGET });
    await expect(bar.getByRole('button', { name: 'Cancel this occurrence' })).toHaveCount(0);

    // The series on its own page: its interval, its end and its days without one.
    await bar.getByRole('button', { name: 'Open series' }).click();
    const edit = dialog.locator('[data-series-edit]');
    await expect(edit.getByRole('combobox', { name: 'Repeat' })).toHaveValue('1w');
    await edit.getByRole('textbox', { name: 'Exceptions' }).fill(day(14));
    const saved = nextAnswer(page);
    await edit.getByRole('button', { name: 'Save series' }).click();
    await saved;
    await expect.poll(() => readFileSync(seriesFile, 'utf8'), { timeout: WRITE_BUDGET }).toMatch(new RegExp(`except:[\\s\\S]*${day(14)}`));
    await expectAccessible(page, 'the page of a series');

    expect(await violations(page)).toEqual([]);
    expect(problems).toEqual([]);
  } finally {
    for (const file of [seriesFile, occurrenceFile]) if (existsSync(file)) rmSync(file, { force: true });
  }
});
