import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { STATE } from './global';
import { removeFile } from './hub';

// A plan made outside the page (`tasks plan-new` in a terminal, another window) while the page is open: the hub's
// watcher sees the file in ROADMAP/plans, and the open page shows the plan without being loaded again, as it shows a
// new task (tasks-desktop/neuer-plan-erscheint-in-einer-offenen-seite-erst-nach).

test.use({ locale: 'en-US' });

const state = (): { token: string; vault: string } => JSON.parse(readFileSync(STATE, 'utf8')) as { token: string; vault: string };

test('a plan written into the vault while the page is open appears in the plan view without a reload', async ({ page }) => {
  await page.addInitScript((token) => sessionStorage.setItem('tasks-desktop.session', token), state().token);
  await page.goto('/#view=plan');
  await expect(page.getByRole('menubar')).toBeVisible();
  const select = page.locator('label.plan-select select');
  await expect(select).toBeVisible();
  const option = select.locator('option', { hasText: 'Live e2e plan p001' });
  await expect(option).toHaveCount(0);

  const file = join(state().vault, 'lib.nvim', 'ROADMAP', 'plans', 'live-e2e-plan-p001.md');
  writeFileSync(
    file,
    '---\ntitle: Live e2e plan p001\nstatus: doing\nareas: [lib.nvim]\nphase_order: []\ncreated: 2026-11-28\nupdated: 2026-11-28\n---\n\nMade outside the page.\n',
  );
  try {
    // No reload, no click: the event of the hub brings it.
    await expect(option).toHaveCount(1, { timeout: 15_000 });
  } finally {
    removeFile(file);
  }
  await expect(option).toHaveCount(0, { timeout: 15_000 });
});
