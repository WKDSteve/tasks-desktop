import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, isMachineFault, test } from './fixtures';
import { expectAccessible, violations, watchViolations } from './a11y';
import { STATE } from './global';

// The view of the learning paths (`PathsView`) against the real hub and the real engine: the tree with its folding by
// keyboard, a point ticked by a finger, seen with its reason from the menu, a note, and a point promoted to a task the
// page then opens. Every rule is the engine's: the test reads what it wrote into the file.

test.use({ locale: 'en-US', hasTouch: true });

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

/** The answer of the next write the page sends. */
function nextAnswer(page: Page): Promise<unknown> {
  const answer = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/tasks/ops', {
    timeout: WRITE_BUDGET,
  });
  answer.catch(() => undefined);
  return answer;
}

const PATH = (slug: string, title: string) => `---
title: ${title}
status: doing
---

A learning path of one browser test.

## Lernpunkte

- [ ] Lua e2e {#lua}
  - [x] [Manual e2e](https://www.lua.org/manual/5.4/) {#manual}
  - [ ] Metatables e2e {#meta}
  - [ ] Coroutines e2e {#co}
  - [ ] Compiler e2e ${slug} {#cc}
`;

test('a learning path: fold by keyboard, tick by finger, seen with a reason, a note, promote and open the task', async ({ page }) => {
  const slug = 'paths-e2e-p01';
  const dir = join(state().vault, 'lib.nvim', 'ROADMAP', 'paths');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${slug}.md`);
  const title = 'Path e2e p01';
  writeFileSync(file, PATH(slug, title));
  let made: string | null = null;
  try {
    const problems = await pair(page, '/#view=paths');
    await page.locator(`button[data-path="lib.nvim/${slug}"]`).click();
    const tree = page.getByRole('list', { name: `Learning points of ${title}` });
    await expect(tree).toBeVisible();
    const point = (key: string) => tree.locator(`li[data-point="${key}"]`);
    await expect(point('manual')).toHaveAttribute('data-state', 'learned');
    // The parent has no mark of its own; its leaves do.
    await expect(point('lua').locator('button.mark')).toHaveCount(0);
    await expect(page.getByRole('img', { name: /^Progress of Path e2e p01: 1 learned · 0 seen · 0 not applicable · 3 open/ })).toBeVisible();
    // The link opens in a new tab without a referrer.
    const link = point('manual').getByRole('link', { name: 'Open the link of Manual e2e in a new tab' });
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noreferrer/);
    await expectAccessible(page, 'the view of a learning path');

    // Folding by keyboard: the points below go, and come back.
    const fold = point('lua').getByRole('button', { name: 'Fold Lua e2e' });
    await fold.focus();
    await page.keyboard.press('Enter');
    await expect(point('meta')).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(point('meta')).toBeVisible();

    // A finger ticks a point as learned: the engine writes the mark.
    let answer = nextAnswer(page);
    await point('meta').locator('button.mark').tap();
    await answer;
    await expect(point('meta')).toHaveAttribute('data-state', 'learned', { timeout: WRITE_BUDGET });
    expect(readFileSync(file, 'utf8')).toContain('- [x] Metatables e2e {#meta}');

    // Seen asks for a reason first; the engine writes it beside the mark.
    await point('co').locator('[data-choice="point"] summary').tap();
    await point('co').locator('[data-choice-id="seen"]').tap();
    const reason = point('co').getByLabel('Why was it not done?');
    await expect(reason).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(point('co').getByRole('alert')).toHaveText('A reason is needed.');
    await expectAccessible(page, 'a reason that is missing');
    await reason.fill('only chapter 1 needed');
    answer = nextAnswer(page);
    await page.keyboard.press('Enter');
    await answer;
    await expect(point('co')).toHaveAttribute('data-state', 'seen', { timeout: WRITE_BUDGET });
    await expect(point('co').locator('.reason')).toHaveText('Reason: only chapter 1 needed');

    // A note of a point, written by the engine into the tree.
    await point('meta').locator('[data-choice="point"] summary').tap();
    await point('meta').locator('[data-choice-id="note"]').tap();
    await point('meta').getByLabel('Note of Metatables e2e').fill('__index first');
    answer = nextAnswer(page);
    await point('meta').getByRole('button', { name: 'Save note' }).tap();
    await answer;
    await expect(point('meta').locator('.note')).toHaveText('__index first', { timeout: WRITE_BUDGET });
    expect(readFileSync(file, 'utf8')).toContain('__index first');

    // Promote: the engine makes the task, the page opens it.
    await point('cc').locator('[data-choice="point"] summary').tap();
    answer = nextAnswer(page);
    await point('cc').locator('[data-choice-id="promote"]').tap();
    await answer;
    const float = page.getByRole('dialog', { name: 'Task' });
    await expect(float).toBeVisible({ timeout: WRITE_BUDGET });
    const text = readFileSync(file, 'utf8');
    const arrow = /Compiler e2e paths-e2e-p01 → (\S+)/.exec(text);
    expect(arrow, text).not.toBeNull();
    made = arrow![1]!;
    expect(problems).toEqual([]);
    expect(await violations(page)).toEqual([]);
  } finally {
    rmSync(file, { force: true });
    // The promoted task: the fixture clears ROADMAP/tasks as well, this is for a run that stops here.
    if (made) {
      const task = join(state().vault, made.split('/')[0]!, 'ROADMAP', 'tasks', `${made.split('/')[1]}.md`);
      if (existsSync(task)) rmSync(task, { force: true });
    }
  }
});

test('ticking down a list by keyboard: the mark keeps the focus, no tick runs into a conflict, a closed field gives the focus back', async ({
  page,
}) => {
  const slug = 'paths-e2e-p02';
  const dir = join(state().vault, 'lib.nvim', 'ROADMAP', 'paths');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${slug}.md`);
  const title = 'Path e2e p02';
  writeFileSync(file, PATH(slug, title));
  try {
    const problems = await pair(page, '/#view=paths');
    await page.locator(`button[data-path="lib.nvim/${slug}"]`).click();
    const tree = page.getByRole('list', { name: `Learning points of ${title}` });
    await expect(tree).toBeVisible();
    const point = (key: string) => tree.locator(`li[data-point="${key}"]`);
    const mark = (key: string) => point(key).locator('button.mark');

    // Enter on a mark ticks it; the mark is never switched off while the write runs, so the focus stays on it.
    await mark('meta').focus();
    let answer = nextAnswer(page);
    await page.keyboard.press('Enter');
    await answer;
    // The next point at once, while the path may still be read again: refused and said, or sent on the new version;
    // never sent on the version from before the first tick.
    await mark('co').focus();
    await page.keyboard.press('Enter');
    await expect(point('meta')).toHaveAttribute('data-state', 'learned', { timeout: WRITE_BUDGET });
    await expect(mark('meta')).not.toHaveAttribute('aria-disabled', 'true', { timeout: WRITE_BUDGET });
    await expect(mark('co')).not.toHaveAttribute('aria-disabled', 'true', { timeout: WRITE_BUDGET });
    if ((await point('co').getAttribute('data-state')) !== 'learned') {
      answer = nextAnswer(page);
      await page.keyboard.press('Enter');
      await answer;
    }
    await expect(point('co')).toHaveAttribute('data-state', 'learned', { timeout: WRITE_BUDGET });
    await expect(mark('co')).toBeFocused();
    await expect(page.locator('p.conflict')).toHaveCount(0);
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('- [x] Metatables e2e {#meta}');
    expect(text).toContain('- [x] Coroutines e2e {#co}');

    // A note field closed by Escape gives the focus back to the menu of its point, not to the page.
    const menu = point('meta').locator('[data-choice="point"] summary');
    await menu.focus();
    await page.keyboard.press('Enter');
    await point('meta').locator('[data-choice-id="note"]').click();
    await expect(point('meta').getByLabel('Note of Metatables e2e')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(point('meta').locator('textarea')).toHaveCount(0);
    await expect(menu).toBeFocused();
    await expectAccessible(page, 'a learning path after ticking');
    expect(problems).toEqual([]);
    expect(await violations(page)).toEqual([]);
  } finally {
    rmSync(file, { force: true });
  }
});
