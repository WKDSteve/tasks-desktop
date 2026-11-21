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

test('XP and levels: a level reached is said once with its reward, granted on disk, and the switch hides it all', async ({ page }) => {
  const slug = 'paths-e2e-x01';
  const dir = join(state().vault, 'lib.nvim', 'ROADMAP', 'paths');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${slug}.md`);
  const title = 'Path e2e x01';
  writeFileSync(
    file,
    `---\ntitle: ${title}\nstatus: doing\n---\n\n## Lernpunkte\n\n- [ ] XP e2e {#root}\n  - [x] One e2e {xp=20} {#one}\n  - [ ] Two e2e {xp=40} {#two}\n\n## Level\n\n- [ ] 20 XP · Starter e2e · Belohnung: Ice e2e\n- [ ] 60 XP · Pro e2e · Belohnung: Movie e2e\n`,
  );
  try {
    const problems = await pair(page, '/#view=paths');
    await page.locator(`button[data-path="lib.nvim/${slug}"]`).click();
    const tree = page.getByRole('list', { name: `Learning points of ${title}` });
    await expect(tree).toBeVisible();
    const point = (key: string) => tree.locator(`li[data-point="${key}"]`);
    await expect(page.getByRole('img', { name: `XP of ${title}: 20 of 60` })).toBeVisible();
    await expect(page.locator('p.level')).toHaveText('Level 1 (Starter e2e) · 40 XP to level 2');
    await expect(point('one').locator('.xp-point')).toHaveText('20 XP');
    // the level the path is first seen with is no news
    await expect(page.getByText(/reached in Path e2e x01/)).toHaveCount(0);
    await expectAccessible(page, 'a learning path with XP and levels');

    // ticking the last point reaches level 2: said once, with its reward
    let answer = nextAnswer(page);
    await point('two').locator('button.mark').click();
    await answer;
    await expect(page.getByText(`Level 2 reached in ${title}. Treat yourself: Movie e2e`)).toBeVisible({ timeout: WRITE_BUDGET });
    await expect(page.locator('p.level')).toHaveText('Level 2 (Pro e2e)');

    // granted: the mark of its line in ## Level
    answer = nextAnswer(page);
    await page.getByRole('button', { name: 'Mark the reward "Movie e2e" as granted' }).click();
    await answer;
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: WRITE_BUDGET }).toContain('- [x] 60 XP · Pro e2e · Belohnung: Movie e2e');
    await expect(page.locator('[data-reward="2"]')).toHaveCount(0, { timeout: WRITE_BUDGET });

    // opened again: no second notice
    await page.reload();
    await expect(page.getByRole('menubar')).toBeVisible();
    await page.locator(`button[data-path="lib.nvim/${slug}"]`).click();
    await expect(tree).toBeVisible();
    await expect(page.locator('p.level')).toHaveText('Level 2 (Pro e2e)');
    await expect(page.getByText(/reached in Path e2e x01/)).toHaveCount(0);

    // the switch of Options > Defaults hides XP, levels and rewards; the progress stays
    const defaults = page.getByRole('dialog', { name: 'Defaults' });
    await page.getByRole('menuitem', { name: 'Options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Defaults ...' }).click();
    await expect(defaults).toBeVisible();
    await defaults.getByRole('checkbox', { name: 'XP, levels and rewards in learning paths' }).uncheck();
    await defaults.getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('p.level')).toHaveCount(0);
    await expect(page.locator('[data-xp]')).toHaveCount(0);
    await expect(tree.locator('.xp-point')).toHaveCount(0);
    await expect(page.getByRole('img', { name: /^Progress of Path e2e x01/ })).toBeVisible();
    expect(problems).toEqual([]);
    expect(await violations(page)).toEqual([]);
  } finally {
    rmSync(file, { force: true });
  }
});

test('levels set in a form: written into ## Level with a badge, refused when they fall, and the XP of a promoted task', async ({ page }) => {
  const slug = 'paths-e2e-l01';
  const area = join(state().vault, 'lib.nvim', 'ROADMAP');
  const dir = join(area, 'paths', slug);
  mkdirSync(join(dir, 'assets', 'badges'), { recursive: true });
  writeFileSync(
    join(dir, 'assets', 'badges', 'star.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="7" fill="gold"/></svg>',
  );
  const file = join(dir, `${slug}.md`);
  const taskSlug = 'paths-e2e-l01-task';
  const taskFile = join(area, 'tasks', `${taskSlug}.md`);
  const title = 'Path e2e l01';
  mkdirSync(join(area, 'tasks'), { recursive: true });
  writeFileSync(taskFile, `---\ntitle: Task e2e l01\nstatus: open\nxp: 10\n---\n\nPromoted from a point.\n`);
  writeFileSync(
    file,
    `---\ntitle: ${title}\nstatus: doing\n---\n\n## Lernpunkte\n\n- [ ] Levels e2e {#root}\n  - [x] First e2e {xp=60} {#first}\n  - [ ] Task e2e → lib.nvim/${taskSlug} {#t}\n`,
  );
  try {
    const problems = await pair(page, '/#view=paths');
    await page.locator(`button[data-path="lib.nvim/${slug}"]`).click();
    const tree = page.getByRole('list', { name: `Learning points of ${title}` });
    await expect(tree).toBeVisible();

    // the form: two levels, a badge of the path's assets/badges/, a reward for the whole path
    await page.getByRole('button', { name: 'Set levels and rewards …' }).click();
    const form = page.getByRole('form', { name: 'Levels and rewards of the path' });
    await expect(form).toBeVisible();
    await form.getByRole('button', { name: 'Add a level' }).click();
    await expect(form.locator('#level-threshold-0')).toHaveValue('50');
    await form.locator('#level-name-0').fill('Starter e2e');
    await form.locator('#level-badge-0').selectOption('assets/badges/star.svg');
    await form.locator('#level-reward-0').fill('Tea e2e');
    await form.getByRole('button', { name: 'Add a level' }).click();
    await expect(form.locator('#level-threshold-1')).toHaveValue('100');
    await form.getByRole('checkbox', { name: 'A reward when the whole path is done' }).check();
    await form.locator('#level-done-reward').fill('Trip e2e');
    await expectAccessible(page, 'the form of the levels of a path');
    let answer = nextAnswer(page);
    await form.getByRole('button', { name: 'Save levels' }).click();
    await answer;
    await expect
      .poll(() => readFileSync(file, 'utf8'), { timeout: WRITE_BUDGET })
      .toContain('## Level\n\n- [ ] 50 XP · Starter e2e · Badge assets/badges/star.svg · Belohnung: Tea e2e\n- [ ] 100 XP\n- [ ] Pfad fertig · Belohnung: Trip e2e\n');
    await expect(form).toHaveCount(0, { timeout: WRITE_BUDGET });
    // level 1 reached (60 XP): its badge beside the level and in the gallery, as an image
    await expect(page.locator('p.level')).toContainText('Level 1 (Starter e2e)', { timeout: WRITE_BUDGET });
    await expect(page.locator('[data-badge="1"] img')).toBeVisible({ timeout: WRITE_BUDGET });
    await expect(page.locator('p.level img.badge')).toBeVisible();

    // thresholds that fall: the engine refuses, the file stays, the form stays open with what was typed
    const before = readFileSync(file, 'utf8');
    await page.getByRole('button', { name: 'Edit levels and rewards …' }).click();
    await expect(form).toBeVisible();
    await form.locator('#level-threshold-1').fill('40');
    answer = nextAnswer(page);
    await form.getByRole('button', { name: 'Save levels' }).click();
    await answer;
    await expect(page.getByRole('alert').filter({ hasText: /must rise/ })).toBeVisible({ timeout: WRITE_BUDGET });
    await expect(form).toBeVisible();
    await expect(form.locator('#level-threshold-1')).toHaveValue('40');
    expect(readFileSync(file, 'utf8')).toBe(before);
    await form.getByRole('button', { name: 'Cancel' }).click();
    await expect(form).toHaveCount(0);

    // the XP of the promoted task: xp: of the task, through set
    const t = tree.locator('li[data-point="t"]');
    await expect(t.locator('.xp-point')).toHaveText('10 XP, from the task');
    await t.locator('[data-choice="point"] summary').click();
    await page.getByRole('button', { name: 'XP of the task …' }).click();
    const field = t.getByLabel(`XP of task lib.nvim/${taskSlug}`);
    await expect(field).toHaveValue('10');
    await field.fill('25');
    answer = nextAnswer(page);
    await field.press('Enter');
    await answer;
    await expect.poll(() => readFileSync(taskFile, 'utf8'), { timeout: WRITE_BUDGET }).toContain('xp: 25');
    await expect(t.locator('.xp-point')).toHaveText('25 XP, from the task', { timeout: WRITE_BUDGET });
    expect(problems).toEqual([]);
    expect(await violations(page)).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(taskFile, { force: true });
  }
});
