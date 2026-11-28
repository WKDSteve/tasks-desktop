import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, isMachineFault, test } from './fixtures';
import { expectAccessible, violations, watchViolations } from './a11y';
import { STATE } from './global';
import { removeFile } from './hub';

// The badges and the rewards of all learning paths (`BadgesView`, `RewardsView`) against the real hub and the real engine
// (`tasks.paths` with `levels`, capability `paths_levels`; `path_reward`): a path halfway with two levels in percent, one
// reached with a reward, the line of the whole path with a reward still to come. Reached, missing and granted are the
// engine's; the test reads what the pages draw from them, grants a reward and reads the file back.

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
const SLUG = 'lp2-e2e-levels';
const ID = `${A}/${SLUG}`;
// A path in its folder form: only then may it hold pictures below `assets/badges/`.
const FILE = `${A}/ROADMAP/paths/${SLUG}/${SLUG}.md`;
const BADGE = `${A}/ROADMAP/paths/${SLUG}/assets/badges/star.svg`;
const STAR =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#c8a000"/></svg>';
const PATH_TEXT = `---
title: LP2 e2e levels
status: doing
created: 2026-11-20
updated: 2026-11-20
---

## Lernpunkte

- [x] LP2 e2e first leaf {#one}
- [ ] LP2 e2e second leaf {#two}

## Level

- [ ] 50 % · LP2 Halfway · Badge assets/badges/star.svg · Belohnung: LP2 cinema
- [ ] Pfad fertig · Badge assets/badges/star.svg · Belohnung: LP2 a weekend at the lake
`;

function write(): string {
  const file = join(state().vault, FILE);
  const badge = join(state().vault, BADGE);
  mkdirSync(dirname(badge), { recursive: true });
  writeFileSync(file, PATH_TEXT);
  writeFileSync(badge, STAR);
  return file;
}

/** The folder of the path (the file and its pictures), taken away after a test. */
const folderOf = (file: string): string => dirname(file);

test('the badges: earned and open from the engine, the ring of the next one, the detail, the keys, light, dark and narrow', async ({ page }) => {
  const made = write();
  try {
    const problems = await pair(page, '/#view=badges');
    await expect(page.getByRole('heading', { name: 'Badges', level: 2 })).toBeVisible();
    const halfway = page.locator(`[data-badge="${ID}#1"]`);
    const done = page.locator(`[data-badge="${ID}#done"]`);
    await expect(halfway).toHaveAttribute('data-badge-state', 'earned');
    await expect(halfway).toContainText('LP2 Halfway');
    await expect(done).toHaveAttribute('data-badge-state', 'open');
    // the next one: what is missing and how far, in words, with its ring
    await expect(done).toContainText('50 % to go');
    await expect(done.locator('.ring')).toBeVisible();
    // the picture of the path: in colour when earned, grey and faded while open (the word and the lock say it too)
    const earnedImg = halfway.locator('img[data-asset="assets/badges/star.svg"]');
    const openImg = done.locator('img[data-asset="assets/badges/star.svg"]');
    await expect(earnedImg).toBeVisible();
    await expect(openImg).toBeVisible();
    await expect(earnedImg).toHaveCSS('filter', 'none');
    await expect(openImg).toHaveCSS('filter', 'grayscale(1)');
    await expect(openImg).toHaveCSS('opacity', '0.55');
    await expect(done.locator('.lock')).toBeVisible();
    await expectAccessible(page, 'the badges, light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectAccessible(page, 'the badges, dark');
    await page.emulateMedia({ colorScheme: 'light' });

    // the detail below its group; Esc closes it and the focus goes back to the tile
    await done.click();
    const detail = page.locator('[data-badge-detail]');
    await expect(detail).toContainText('the whole path finished');
    await expect(detail.locator('[data-badge-reward]')).toContainText('LP2 a weekend at the lake');
    await expectAccessible(page, 'the badges with a detail open');
    await page.keyboard.press('Escape');
    await expect(detail).toHaveCount(0);
    await expect(done).toBeFocused();
    // the keys walk the tiles: one stop of the Tab key
    await page.keyboard.press('ArrowLeft');
    await expect(halfway).toBeFocused();
    await expect(halfway).toHaveAttribute('tabindex', '0');
    await expect(done).toHaveAttribute('tabindex', '-1');

    // a narrow window: one column, no scrolling sideways
    await page.setViewportSize({ width: 400, height: 800 });
    await expect(halfway).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await expectAccessible(page, 'the badges, narrow');
    expect(problems).toEqual([]);
    expect(await violations(page)).toEqual([]);
  } finally {
    removeFile(folderOf(made));
  }
});

test('the rewards: open, granted and coming; Granted writes the mark into the file, Not granted after all takes it back', async ({ page }) => {
  test.slow();
  const made = write();
  try {
    const problems = await pair(page, '/#view=rewards');
    await expect(page.getByRole('heading', { name: 'Rewards', level: 2 })).toBeVisible();
    const open = page.locator('[data-rewards-part="open"]');
    const given = page.locator('[data-rewards-part="given"]');
    const coming = page.locator('[data-rewards-part="coming"]');
    await expect(open.locator(`[data-reward="${ID}#1"]`)).toContainText('LP2 cinema');
    await expect(coming.locator(`[data-reward="${ID}#done"]`)).toContainText('comes when the path is finished');
    await expectAccessible(page, 'the rewards, light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectAccessible(page, 'the rewards, dark');
    await page.emulateMedia({ colorScheme: 'light' });

    await open.getByRole('button', { name: 'Mark the reward "LP2 cinema" as granted' }).click();
    await expect(given.locator(`[data-reward="${ID}#1"]`)).toBeVisible({ timeout: 15_000 });
    await expect(open.locator(`[data-reward="${ID}#1"]`)).toHaveCount(0);
    expect(readFileSync(made, 'utf8')).toContain('- [x] 50 % · LP2 Halfway · Badge assets/badges/star.svg · Belohnung: LP2 cinema');
    // the focus stays in the view: the heading of the part the row left
    await expect(page.locator('#rewards-open')).toBeFocused();

    // Undo of the toast takes it back
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(open.locator(`[data-reward="${ID}#1"]`)).toBeVisible({ timeout: 15_000 });
    expect(readFileSync(made, 'utf8')).toContain('- [ ] 50 % · LP2 Halfway · Badge assets/badges/star.svg · Belohnung: LP2 cinema');
    await open.getByRole('button', { name: 'Mark the reward "LP2 cinema" as granted' }).click();
    await expect(given.locator(`[data-reward="${ID}#1"]`)).toBeVisible({ timeout: 15_000 });

    // back from the row's detail
    await given.locator(`[data-reward="${ID}#1"] summary`).click();
    await given.getByRole('button', { name: 'Mark the reward "LP2 cinema" as not granted after all' }).click();
    await expect(open.locator(`[data-reward="${ID}#1"]`)).toBeVisible({ timeout: 15_000 });
    expect(readFileSync(made, 'utf8')).toContain('- [ ] 50 % · LP2 Halfway · Badge assets/badges/star.svg · Belohnung: LP2 cinema');

    await page.setViewportSize({ width: 400, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await expectAccessible(page, 'the rewards, narrow');
    expect(problems).toEqual([]);
    expect(await violations(page)).toEqual([]);
  } finally {
    removeFile(folderOf(made));
  }
});
