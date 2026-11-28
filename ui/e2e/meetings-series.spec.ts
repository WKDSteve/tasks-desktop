import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, isMachineFault, test } from './fixtures';
import { expectAccessible, violations, watchViolations } from './a11y';
import { STATE } from './global';
import { removeFile } from './hub';

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
    for (const file of [seriesFile, occurrenceFile]) if (existsSync(file)) removeFile(file);
  }
});

/** A weekly series beginning today at 10:00, written as a file of the vault; its file and that of today's occurrence. */
function series(slug: string): { seriesFile: string; occurrenceFile: string; id: string; today: string } {
  const dir = join(state().vault, 'lib.nvim', 'MEETINGS');
  mkdirSync(dir, { recursive: true });
  const seriesFile = join(dir, `${slug}.md`);
  writeFileSync(seriesFile, `---\ntitle: ${slug}\nstatus: planned\ndate: ${day()}\ntime: "10:00"\nduration: 30m\nrepeat: weekly\n---\n\nA series of one browser test.\n`);
  return { seriesFile, occurrenceFile: join(dir, `${slug}-${day()}.md`), id: `lib.nvim/${slug}`, today: `lib.nvim/${slug}-${day()}` };
}

test('an occurrence without a file moved in the hour grid gets its file at the new time, the series stays', async ({ page }) => {
  const s = series('ser-e2e-s02');
  try {
    const problems = await pair(page, '/#view=calendar');
    await page.getByRole('combobox', { name: 'Show' }).selectOption('week');
    const grid = page.locator('[data-timegrid="week"]');
    const block = grid.locator(`.block[data-meeting="${s.today}"]`);
    await expect(block).toHaveAttribute('data-series', s.id);
    await expect(block).toHaveClass(/virtual/);
    await block.locator('.open').focus();
    const answer = nextAnswer(page);
    await page.keyboard.press('Shift+ArrowDown');
    await answer;
    await expect.poll(() => existsSync(s.occurrenceFile), { timeout: WRITE_BUDGET }).toBe(true);
    const made = readFileSync(s.occurrenceFile, 'utf8');
    expect(made).toMatch(/time: "?10:15/);
    expect(made).toMatch(new RegExp(`series: "?${s.id}`));
    expect(readFileSync(s.seriesFile, 'utf8')).toMatch(/time: "?10:00/);
    // Read again from its file: no longer dotted, at 10:15 (615 minutes).
    await expect(block).not.toHaveClass(/virtual/, { timeout: WRITE_BUDGET });
    await expect(block).toHaveCSS('top', `${615 * 0.8}px`);
    expect(problems).toEqual([]);
  } finally {
    for (const file of [s.seriesFile, s.occurrenceFile]) if (existsSync(file)) removeFile(file);
  }
});

test('the day of an occurrence without a file is skipped as an exception of its series: no file, no chip', async ({ page }) => {
  const s = series('ser-e2e-s03');
  try {
    const problems = await pair(page, '/#view=calendar');
    const chip = page.locator(`.chip[data-meeting="${s.today}"]`);
    await chip.click();
    const bar = page.locator(`dialog.meeting-page [data-occurrence="${day()}"]`);
    const answer = nextAnswer(page);
    await bar.getByRole('button', { name: 'Skip as exception' }).click();
    await answer;
    await expect.poll(() => readFileSync(s.seriesFile, 'utf8'), { timeout: WRITE_BUDGET }).toMatch(new RegExp(`except:[\\s\\S]*${day()}`));
    expect(existsSync(s.occurrenceFile)).toBe(false);
    // The day has no occurrence any more: its page closed, its chip gone.
    await expect(page.locator('dialog.meeting-page')).not.toBeVisible();
    await expect(chip).toHaveCount(0, { timeout: WRITE_BUDGET });
    // The skip is the write that takes the day's occurrence away, and the open page reads it again when the hub tells it
    // that the vault changed: on a busy runner that read comes after the write and is answered with 404, which the browser
    // reports as an error of the console (trace of CI run 45582140227: `GET meeting?id=...` 404 right after `POST ops`). The
    // page handles it (it closes, the chip goes, both checked above); the 404 itself is the noise of the deleted file.
    expect(problems.filter((p) => !p.includes('404'))).toEqual([]);
  } finally {
    for (const file of [s.seriesFile, s.occurrenceFile]) if (existsSync(file)) removeFile(file);
  }
});
