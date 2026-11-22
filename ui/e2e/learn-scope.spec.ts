import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, isMachineFault, test } from './fixtures';
import { expectAccessible, watchViolations } from './a11y';
import { STATE } from './global';

// The views of the tab Lernpläne follow the area filter of the page (lib/learnScope.ts) against the real hub and the
// real engine: the notes are asked for the area of the filter (`area`), an area without notes leaves the view a note
// that the filter hides the paths, with a button that takes the areas out of the filter; axe in both themes.

test.use({ locale: 'en-US' });

const state = (): { token: string; vault: string } => JSON.parse(readFileSync(STATE, 'utf8')) as { token: string; vault: string };

async function pair(page: Page, path: string, areas: string[]): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !isMachineFault(m.text())) problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await watchViolations(page);
  await page.addInitScript(
    ([token, filter]) => {
      sessionStorage.setItem('tasks-desktop.session', token);
      // The remembered filter, as the page keeps it: only on the first load, so that a reload keeps what the test did.
      if (sessionStorage.getItem('ls-e2e-filter') === null) {
        localStorage.setItem('tasks-desktop.filter', filter);
        sessionStorage.setItem('ls-e2e-filter', '1');
      }
    },
    [state().token, JSON.stringify({ areas })] as const,
  );
  await page.goto(path);
  await expect(page.getByRole('menubar')).toBeVisible();
  return problems;
}

const A = 'lib.nvim';
const PATH = `${A}/ROADMAP/paths/ls-e2e-scope.md`;
const TEXT = [
  '---',
  'title: LS e2e scope',
  'status: doing',
  'created: 2026-11-22',
  'updated: 2026-11-22',
  '---',
  '',
  '## Lernpunkte',
  '',
  '- [ ] LS stage {#s1}',
  '  - [ ] LS point with a note {#n1}',
  '    > LS note: lsscopeneedle.',
  '',
].join('\n');

test('notes and sources follow the area filter: asked for its area, an empty one said with a button that clears it', async ({ page }) => {
  const file = join(state().vault, PATH);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, TEXT);
  try {
    const asked: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/tasks/learn_notes')) asked.push(new URL(r.url()).search);
    });
    const problems = await pair(page, '/#view=learnnotes', ['cascade.nvim']);
    await expect(page.getByRole('heading', { name: 'Notes & sources', level: 2 })).toBeVisible();
    const note = page.getByText('The area filter (cascade.nvim) hides the learning paths here.');
    await expect(note).toBeVisible();
    expect(asked.at(-1)).toBe('?area=cascade.nvim');
    await expectAccessible(page, 'scope note, light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectAccessible(page, 'scope note, dark');
    await page.emulateMedia({ colorScheme: 'light' });

    // The button by the keyboard: the areas go out of the filter, the notes of every area come back.
    await page.getByRole('button', { name: 'Clear filter' }).focus();
    await page.keyboard.press('Enter');
    await expect(note).toBeHidden();
    await expect(page.getByText('lsscopeneedle', { exact: false })).toBeVisible();
    expect(asked.at(-1)).toBe('');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tasks-desktop.filter') ?? '{}').areas)).toEqual([]);
    expect(problems).toEqual([]);
  } finally {
    rmSync(file, { force: true });
  }
});
