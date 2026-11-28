import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, isMachineFault, test } from './fixtures';
import { expectAccessible, watchViolations } from './a11y';
import { STATE } from './global';
import { removeFile } from './hub';

// Three views of the tab Lernpläne against the real hub and the real engine (capabilities learn_next, path_hours,
// learn_notes): the next learning step (a card per running path, a {safety} point that asks first, the keys of a card),
// the learning time (planned against done hours, an overrun in words, the sessions of a path) and the notes and sources
// (the engine searches, a hit opens its point in the path). Which point is next, the hours and the hits are the
// engine's; the test reads what the page draws from them, with axe in both themes.

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
const head = (title: string) => `---\ntitle: ${title}\nstatus: doing\ncreated: 2026-11-20\nupdated: 2026-11-20\n---\n\n`;
const OS = `${A}/ROADMAP/paths/lv-e2e-os.md`;
const SHELL = `${A}/ROADMAP/paths/lv-e2e-shell.md`;

/** The files of the vault of this test, by their path under the vault. */
function files(): Record<string, string> {
  return {
    [OS]:
      head('LV e2e OS') +
      [
        '## Lernpunkte',
        '',
        '- [ ] LV stage one {#s1}',
        '  - [x] LV processes {#proc}',
        '  - [ ] LV week 1 {h=4-6} {done_h=2} {#w1}',
        '    - [ ] [LV man fork](https://man7.org/linux/man-pages/man2/fork.2.html) {#fork}',
        '      > LV note: check the return value of lvforkneedle.',
        '    - [ ] LV exec family {#exec}',
        '  - [ ] LV load a driver {safety} {#drv}',
        '- [ ] LV stage two {#s2}',
        '  - [ ] LV page tables {h=2} {#pt}',
        '',
      ].join('\n'),
    [SHELL]:
      head('LV e2e Shell') +
      ['## Lernpunkte', '', '- [ ] LV basics {h=2} {done_h=5} {#basics}', '  - [x] LV pipes {#pipes}', '  - [ ] LV quoting {safety} {#quoting}', ''].join('\n'),
  };
}

function write(): string[] {
  const made: string[] = [];
  for (const [path, text] of Object.entries(files())) {
    const file = join(state().vault, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    made.push(file);
  }
  return made;
}
const read = (path: string) => readFileSync(join(state().vault, path), 'utf8');

test('next learning step: a card per running path, the safety question, the keys of a card, a mark written to the file', async ({ page }) => {
  const made = write();
  try {
    const problems = await pair(page, '/#view=learnnext');
    await expect(page.getByRole('heading', { name: 'Next learning step', level: 2 })).toBeVisible();
    const os = page.locator(`article[data-path="${A}/lv-e2e-os"]`);
    const shell = page.locator(`article[data-path="${A}/lv-e2e-shell"]`);
    await expect(os).toHaveAttribute('data-point', 'fork');
    await expect(os.locator('.label')).toHaveText('LV man fork');
    await expect(os.getByRole('link', { name: 'Source: man7.org' })).toHaveAttribute('rel', /noreferrer/);
    await expect(shell.locator('.badge')).toContainText('Safety');
    await expectAccessible(page, 'next learning step, light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectAccessible(page, 'next learning step, dark');
    await page.emulateMedia({ colorScheme: 'light' });

    // The safety point asks first; cancel writes nothing.
    await shell.getByRole('button', { name: 'Learned: LV quoting' }).click();
    await expect(shell.getByRole('group')).toContainText('This point concerns safety.');
    await expect(shell.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await shell.getByRole('button', { name: 'Cancel' }).click();
    expect(read(SHELL)).toContain('- [ ] LV quoting');

    // l on the focused card marks its point learned; the engine then names the next one.
    await os.focus();
    await page.keyboard.press('l');
    await expect.poll(() => read(OS)).toContain('- [x] [LV man fork]');
    await expect(os).toHaveAttribute('data-point', 'exec', { timeout: 15_000 });
    // Enter opens the point in the path, focused.
    await os.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'LV e2e OS' })).toBeVisible();
    await expect(page.locator('li[data-point="exec"]')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('li[data-point]')?.getAttribute('data-point'))).toBe('exec');
    expect(problems).toEqual([]);
  } finally {
    for (const file of made) removeFile(file);
  }
});

test('learning time: planned against done hours, an overrun in words, the sessions of a path; a narrow window', async ({ page }) => {
  const made = write();
  try {
    const problems = await pair(page, '/#view=learntime');
    await expect(page.getByRole('heading', { name: 'Learning time', level: 2 })).toBeVisible();
    const os = page.locator(`tr[data-path="${A}/lv-e2e-os"]`);
    const shell = page.locator(`tr[data-path="${A}/lv-e2e-shell"]`);
    await expect(os.locator('td').nth(0)).toHaveText('6–8 h');
    await expect(os.locator('td').nth(1)).toHaveText('2 h');
    await expect(shell.locator('.overrun')).toContainText('+3 h');
    await expect(shell.locator('.overrun .sr-only')).toHaveText('+3 h over the plan');
    await os.getByRole('button', { name: 'Sessions of LV e2e OS' }).click();
    const sessions = page.locator('table.sessions');
    await expect(sessions.locator('tbody tr')).toHaveCount(2);
    await expect(sessions.locator('tbody tr').first()).toContainText('LV week 1');
    await expectAccessible(page, 'learning time, light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectAccessible(page, 'learning time, dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 420, height: 900 });
    await expect(os.locator('td').nth(0)).toBeVisible();
    await expectAccessible(page, 'learning time, narrow');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    expect(problems).toEqual([]);
  } finally {
    for (const file of made) removeFile(file);
  }
});

test('notes and sources: the engine searches, the hits are marked, Enter opens the point in its path', async ({ page }) => {
  const made = write();
  try {
    const problems = await pair(page, '/#view=learnnotes');
    await expect(page.getByRole('heading', { name: 'Notes & sources', level: 2 })).toBeVisible();
    // / puts the focus into the search.
    await page.locator('body').click();
    await page.keyboard.press('/');
    const search = page.getByRole('searchbox');
    await expect(search).toBeFocused();
    await search.fill('lvforkneedle');
    await search.press('Enter');
    const hits = page.locator('ul.hits > li');
    await expect(hits).toHaveCount(1);
    await expect(hits.first().locator('mark')).toHaveText('lvforkneedle');
    await expect(hits.first().locator('.source a')).toContainText('man7.org — LV man fork');
    await expectAccessible(page, 'notes and sources, light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectAccessible(page, 'notes and sources, dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await hits.first().getByRole('button', { name: /^Open in the path: LV e2e OS › LV stage one › LV man fork/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'LV e2e OS' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('li[data-point]')?.getAttribute('data-point'))).toBe('fork');
    expect(problems).toEqual([]);
  } finally {
    for (const file of made) removeFile(file);
  }
});
