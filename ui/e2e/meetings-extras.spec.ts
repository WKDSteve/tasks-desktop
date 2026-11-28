import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, isMachineFault, test } from './fixtures';
import { expectAccessible, violations, watchViolations } from './a11y';
import { STATE } from './global';
import { localWall } from '../src/lib/zones';
import { addDays, startOfWeek } from '../src/lib/calendar';

// The extras of meetings against the real hub and the real engine (concept 4.4, 7.3): the agenda takes the chosen
// proposals of the meeting's open tasks and questions (`agenda_proposals`, written with `add_steps`); the form names a
// meeting at the same time before anything is saved, and makes the meeting with its preparation task (`prep`, due the
// day before) and `overlap: ok`. Every rule is the engine's: the test reads what it wrote into the files.

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
  const answer = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/tasks/ops' && !(r.request().postData() ?? '').includes('"dry_run":true'),
    { timeout: WRITE_BUDGET },
  );
  answer.catch(() => undefined);
  return answer;
}

/** A day on the wall of this machine, `YYYY-MM-DD`, `plus` days from today. */
function day(plus = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + plus);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test('the agenda takes the chosen proposals of the open tasks and their questions', async ({ page }) => {
  // The page's today is fixed in the middle of a month: the month view shows only the weeks of its month, so a
  // meeting three days ahead would leave it on the last days of some months.
  const today = '2026-11-11';
  await page.clock.setFixedTime(new Date(`${today}T10:00:00Z`));
  const vault = state().vault;
  const taskFile = join(vault, 'lib.nvim', 'ROADMAP', 'tasks', 'ext-e2e-t01.md');
  const dir = join(vault, 'lib.nvim', 'MEETINGS');
  mkdirSync(dir, { recursive: true });
  const meetingFile = join(dir, 'ext-e2e-m01.md');
  writeFileSync(
    taskFile,
    '---\ntitle: Ext e2e t01\nstatus: open\ncreated: 2026-11-01\n---\n\n## Offene Fragen\n\n### Ext e2e which version? [q1]\n- [ ] 2025.1 (empfohlen)\n- [ ] 2024.2\n',
  );
  writeFileSync(
    meetingFile,
    `---\ntitle: Ext e2e m01\nstatus: planned\ndate: ${addDays(today, 3)}\ntime: "10:00"\nduration: 30m\ntasks: [lib.nvim/ext-e2e-t01]\n---\n\n## Agenda\n\n- [ ] Ext e2e opening\n`,
  );
  try {
    const problems = await pair(page, '/#view=calendar');
    await page.locator('.chip[data-meeting="lib.nvim/ext-e2e-m01"]').click();
    const dialog = page.locator('dialog.meeting-page');
    const proposals = dialog.locator('[data-agenda-proposals]');
    await expect(proposals).toBeVisible();
    await proposals.locator('summary').click();
    const boxes = proposals.locator('[data-proposal]');
    await expect(boxes).toHaveCount(2);
    await expectAccessible(page, 'the proposals of the agenda');
    // the question is left out: only the task goes into the agenda
    await proposals.getByRole('checkbox', { name: 'Ext e2e which version? (Ext e2e t01)' }).uncheck();
    const answer = nextAnswer(page);
    await proposals.getByRole('button', { name: 'Add 1 to the agenda' }).click();
    await answer;
    await expect.poll(() => readFileSync(meetingFile, 'utf8'), { timeout: WRITE_BUDGET }).toMatch(/- \[ \] Ext e2e opening\n- \[ \] Ext e2e t01\n/);
    expect(readFileSync(meetingFile, 'utf8')).not.toContain('which version');
    // read again: the task is on the agenda, the question is still offered
    await expect(boxes).toHaveCount(1, { timeout: WRITE_BUDGET });
    expect(await violations(page)).toEqual([]);
    expect(problems).toEqual([]);
  } finally {
    for (const file of [taskFile, meetingFile]) if (existsSync(file)) rmSync(file, { force: true });
  }
});

test.describe('a meeting of another zone', () => {
  // the browser in Vienna: the expected times come from the same reckoning as the page (zones.ts), so the test holds
  // on every day of the year, summer time or not
  test.use({ timezoneId: 'Europe/Vienna' });

  // The page's today is fixed, once on a weekday and once on a Saturday: the meeting must stand in the week the view
  // shows, whatever day the test runs on.
  for (const { on, today } of [
    { on: 'a Wednesday', today: '2026-11-25' },
    { on: 'a Saturday', today: '2026-11-28' },
  ]) {
    test(`stands at the time of this machine with its own time beside it, and a move keeps its zone (on ${on})`, async ({ page }) => {
      await page.clock.setFixedTime(new Date(`${today}T10:00:00Z`));
      const dir = join(state().vault, 'lib.nvim', 'MEETINGS');
      mkdirSync(dir, { recursive: true });
      const file = join(dir, 'ext-e2e-m04.md');
      // The Wednesday of the week the view shows (it begins on Monday, as the page reckons it): a day a fixed number of
      // days ahead leaves that week from Thursday or later on.
      const date = addDays(startOfWeek(today), 2);
      writeFileSync(file, `---\ntitle: Ext e2e m04\nstatus: planned\ndate: ${date}\ntime: "08:00"\nduration: 30m\ntz: America/New_York\n---\n\nAcross the ocean.\n`);
      const here = localWall(`${date}T08:00`, 'America/New_York', 'Europe/Vienna');
      try {
        const problems = await pair(page, '/#view=calendar');
        await page.getByRole('combobox', { name: 'Show' }).selectOption('week');
        const block = page.locator('[data-timegrid="week"]').locator('.block[data-meeting="lib.nvim/ext-e2e-m04"]');
        await expect(block).toBeVisible();
        await expect(block.locator('.time')).toContainText(here.slice(11, 16));
        await expect(block.locator('.open')).toHaveAttribute('aria-label', /\(08:00 New York\)/);
        // a quarter later here is a quarter later in New York: the file keeps its zone
        await block.locator('.open').focus();
        const answer = nextAnswer(page);
        await page.keyboard.press('Shift+ArrowDown');
        await answer;
        await expect.poll(() => readFileSync(file, 'utf8'), { timeout: WRITE_BUDGET }).toMatch(/time: "?08:15/);
        expect(readFileSync(file, 'utf8')).toMatch(/tz: "?America\/New_York/);
        expect(problems).toEqual([]);
      } finally {
        if (existsSync(file)) rmSync(file, { force: true });
      }
    });
  }
});

test('the form names a meeting at the same time, and makes the meeting with its preparation task and overlap: ok', async ({ page }) => {
  const vault = state().vault;
  const dir = join(vault, 'lib.nvim', 'MEETINGS');
  mkdirSync(dir, { recursive: true });
  const busyFile = join(dir, 'ext-e2e-m02.md');
  writeFileSync(busyFile, `---\ntitle: Ext e2e m02\nstatus: planned\ndate: ${day(4)}\ntime: "11:00"\nduration: 1h\n---\n\nBusy.\n`);
  const madeFile = join(dir, `ext-e2e-m03-${day(4)}.md`);
  const prepFile = join(vault, 'lib.nvim', 'ROADMAP', 'tasks', 'prepare-ext-e2e-m03.md');
  try {
    const problems = await pair(page, '/#view=meetings');
    await page.locator('[data-meetings-new]').click();
    const form = page.getByRole('dialog', { name: 'New meeting' });
    await expect(form).toBeVisible();
    await form.getByRole('textbox', { name: 'Title' }).fill('Ext e2e m03');
    await form.getByRole('combobox', { name: 'Area' }).selectOption('lib.nvim');
    await form.getByLabel('Date').fill(day(4));
    await form.getByLabel('Begins').fill('11:30');
    await form.getByRole('textbox', { name: 'Duration' }).fill('30m');
    const conflicts = form.locator('[data-meeting-conflicts]');
    await expect(conflicts.locator('[data-conflict-id="lib.nvim/ext-e2e-m02"]')).toBeVisible();
    await expectAccessible(page, 'the form with a conflict');
    await form.locator('[data-meeting-overlap-ok]').check();
    await expect(conflicts).toHaveCount(0);
    await form.locator('[data-meeting-prep]').check();
    const answer = nextAnswer(page);
    await form.locator('[data-meeting-create]').click();
    await answer;
    await expect.poll(() => existsSync(madeFile), { timeout: WRITE_BUDGET }).toBe(true);
    const made = readFileSync(madeFile, 'utf8');
    expect(made).toMatch(/overlap: "?ok/);
    expect(made).toContain('lib.nvim/prepare-ext-e2e-m03');
    expect(existsSync(prepFile)).toBe(true);
    const prep = readFileSync(prepFile, 'utf8');
    expect(prep).toMatch(/title: "?Prepare: Ext e2e m03/);
    expect(prep).toMatch(new RegExp(`due: "?${day(3)}`));
    expect(await violations(page)).toEqual([]);
    expect(problems).toEqual([]);
  } finally {
    for (const file of [busyFile, madeFile, prepFile]) if (existsSync(file)) rmSync(file, { force: true });
    // a folder the meeting may have got (attachments): nothing of this test is left
    for (const name of readdirSync(dir)) if (name.startsWith('ext-e2e-m03')) rmSync(join(dir, name), { recursive: true, force: true });
  }
});
