import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, isMachineFault, test } from './fixtures';
import { expectAccessible, watchViolations } from './a11y';
import { STATE } from './global';
import { removeFile } from './hub';

// Finished, but the CI of the commits is open or red (`ci: pending|red`): the overview names how many (the engine
// counts them, capability `finished_ci`), jumps to them in Done, and the details show the state beside the commits.
// In the light and in the dark scheme: the marks are coloured, axe checks their contrast.

test.use({ locale: 'en-US' });

const state = (): { token: string; vault: string } => JSON.parse(readFileSync(STATE, 'utf8')) as { token: string; vault: string };

async function pair(page: Page, path = '/'): Promise<string[]> {
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

test('finished tasks whose CI is open or red: counted in the overview, listed in Done, shown in their details', async ({ page }) => {
  const { vault } = state();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const finished = (slug: string, title: string, ci: string) => [
    join(vault, 'lib.nvim', 'Backlog', 'TASKS', `${today}_${slug}.md`),
    `---\ntitle: ${title}\nstatus: done\nkind: task\ncommits: [lib.nvim@abc1234]\nci: ${ci}\ncreated: ${today}\nupdated: ${today}\n---\n\nFinished.\n`,
  ] as const;
  // Unique titles: the tests share the vault.
  const files = [
    finished('e2e-ciopen-p001', 'Ciopen p001 waits', 'pending'),
    finished('e2e-ciopen-r001', 'Ciopen r001 broke', 'red'),
    finished('e2e-ciopen-g001', 'Ciopen g001 fine', 'green'),
  ];
  try {
    for (const [path, text] of files) {
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, text);
    }
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      // The overview by its address: the page opens on the view it was left on.
      const problems = await pair(page, '/#view=today');

      // The overview: the number of them, a way to them.
      const open = page.locator('[data-ci-open]');
      await expect(open).toHaveText('Finished, CI open or red: 2');
      await expectAccessible(page, `the overview with finished tasks whose CI is open or red (${scheme})`);
      await open.click();

      // Done, narrowed to them: the pending and the red one, not the green one; the state on each row.
      await expect(page.getByText('Showing: CI open or red')).toBeVisible();
      const rows = page.locator('ul.tasks li');
      await expect(rows.filter({ hasText: 'Ciopen p001 waits' })).toContainText('CI: open');
      await expect(rows.filter({ hasText: 'Ciopen r001 broke' })).toContainText('CI: red');
      await expect(rows.filter({ hasText: 'Ciopen g001 fine' })).toHaveCount(0);
      await expectAccessible(page, `Done with the CI open or red (${scheme})`);

      // The details: the state beside the commits.
      await rows.filter({ hasText: 'Ciopen r001 broke' }).getByRole('button', { name: 'Ciopen r001 broke' }).click();
      const dialog = page.locator('dialog.finished-peek');
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('dd[data-ci="red"]')).toHaveText('red');
      await expect(dialog.locator('dt').filter({ hasText: /^CI$/ })).toBeVisible();
      await expectAccessible(page, `the details of a finished task with a red CI (${scheme})`);
      await dialog.getByRole('button', { name: 'Close' }).click();
      await expect(dialog).toBeHidden();

      // Taken off: every finished task again, the green one too.
      await page.getByRole('button', { name: 'Show everything' }).click();
      await expect(rows.filter({ hasText: 'Ciopen g001 fine' })).toContainText('CI: green');
      expect(problems).toEqual([]);
    }
  } finally {
    for (const [path] of files) removeFile(path);
  }
});

test('a CI state set in the Backlog beside the hub lowers the count of the overview without a new focus', async ({ page }) => {
  // `tasks set <id> ci=green` on a finished task writes only in the Backlog: the snapshot of the open tasks stays as it
  // was, and the hub tells it as an event of its own (`finished`). The page is not touched after the change.
  const { vault } = state();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const text = (title: string, ci: string) =>
    `---\ntitle: ${title}\nstatus: done\nkind: task\ncommits: [lib.nvim@abc1234]\nci: ${ci}\ncreated: ${today}\nupdated: ${today}\n---\n\nFinished.\n`;
  const pending = join(vault, 'lib.nvim', 'Backlog', 'TASKS', `${today}_e2e-cievent-p001.md`);
  const red = join(vault, 'lib.nvim', 'Backlog', 'TASKS', `${today}_e2e-cievent-r001.md`);
  try {
    mkdirSync(join(red, '..'), { recursive: true });
    writeFileSync(pending, text('Cievent p001 waits', 'pending'));
    writeFileSync(red, text('Cievent r001 broke', 'red'));
    const problems = await pair(page, '/#view=today');
    const open = page.locator('[data-ci-open]');
    await expect(open).toHaveText('Finished, CI open or red: 2');

    writeFileSync(red, text('Cievent r001 broke', 'green'));
    await expect(open).toHaveText('Finished, CI open or red: 1');
    expect(problems).toEqual([]);
  } finally {
    removeFile(pending);
    removeFile(red);
  }
});
