import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, isMachineFault, test } from './fixtures';
import { expectAccessible, violations, watchViolations } from './a11y';
import { STATE } from './global';
import { removeFile } from './hub';

// The icon of a task beside its title wherever the task stands as a card or a line: board, inbox, calendar, timeline
// and a saved view, against the real hub and the real engine. The icon here is the one of the category `bug` (the
// last step of the inheritance); it is hidden from a screen reader, and the name of the card stays its title.

test.use({ locale: 'en-US' });

const state = (): { token: string; vault: string } => JSON.parse(readFileSync(STATE, 'utf8')) as { token: string; vault: string };

const BUG = '🐞';

function day(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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

/** The icon is in `holder`, hidden from a screen reader; the accessible name of `named` is the title without it. */
async function expectIcon(holder: Locator, named: Locator, title: string): Promise<void> {
  const icon = holder.locator('[data-icon="category"]').first();
  await expect(icon).toHaveText(BUG);
  await expect(icon).toHaveAttribute('aria-hidden', 'true');
  const name = await named.evaluate((el) => {
    const label = el.getAttribute('aria-label');
    if (label) return label;
    const copy = el.cloneNode(true) as Element;
    for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
    return copy.textContent ?? '';
  });
  expect(name).toContain(title);
  expect(name).not.toContain(BUG);
}

test('the icon of a task stands beside its title on the board, in the inbox, the calendar, the timeline and a saved view', async ({ page }) => {
  const slug = 'icons-e2e-c01';
  const title = 'Icons e2e c01';
  const file = join(state().vault, 'lib.nvim', 'ROADMAP', 'tasks', `${slug}.md`);
  const viewDir = join(state().vault, 'lib.nvim', 'ROADMAP', 'views');
  const viewFile = join(viewDir, 'icons-e2e-v01.md');
  // no prio: the task is in the inbox too; a start and a due day: a bar on the timeline, a chip in the calendar
  writeFileSync(
    file,
    `---\ntitle: ${title}\nstatus: open\ncategory: [bug]\nstart: ${day(0)}\ndue: ${day(2)}\ncreated: 2026-11-21\nupdated: 2026-11-21\n---\n\nA task with the icon of its category.\n`,
  );
  mkdirSync(viewDir, { recursive: true });
  writeFileSync(viewFile, '---\ntitle: Icons e2e v01\ndisplay: columns\ngroup_by: status\n---\n');
  try {
    await expect
      .poll(
        async () => {
          const r = await page.request.get('/api/tasks/snapshot', { headers: { Authorization: `Bearer ${state().token}` } });
          return r.ok() && (await r.text()).includes(`"lib.nvim/${slug}"`);
        },
        { timeout: 20_000 },
      )
      .toBe(true);
    const problems = await pair(page, '/#view=board');

    const card = page.locator(`[data-card="lib.nvim/${slug}"]`);
    await expectIcon(card, card, title);
    await expect(card.locator('.title')).not.toContainText(BUG);
    await expectAccessible(page, 'board');

    await page.goto('/#view=inbox');
    const row = page.locator('.inbox .title', { hasText: title }).locator('..');
    await expectIcon(row, row, title);
    await expectAccessible(page, 'inbox');

    await page.goto('/#view=calendar');
    const chip = page.locator(`.chip[data-task="lib.nvim/${slug}"]`).first();
    await expectIcon(chip, chip, title);
    await expectAccessible(page, 'calendar');

    await page.goto('/#view=timeline');
    const name = page.locator(`[data-column="name"][data-task="lib.nvim/${slug}"]`);
    await expectIcon(name, name, title);
    await expectAccessible(page, 'timeline');

    await page.goto('/#view=views');
    const choose = page.getByRole('combobox', { name: 'Saved view', exact: true });
    await expect(choose.locator('option', { hasText: 'Icons e2e v01' })).toHaveCount(1, { timeout: 15_000 });
    await choose.selectOption({ label: 'Icons e2e v01' });
    const item = page.getByRole('region', { name: 'Icons e2e v01' }).locator('.title', { hasText: title }).locator('..');
    await expectIcon(item, item, title);
    await expectAccessible(page, 'saved view');

    expect(problems).toEqual([]);
    expect(await violations(page)).toEqual([]);
  } finally {
    removeFile(file);
    removeFile(viewFile);
  }
});

test('the icons of the categories are chosen in the defaults: another icon on the board, and none while switched off', async ({ page }) => {
  const slug = 'icons-e2e-c02';
  const title = 'Icons e2e c02';
  const file = join(state().vault, 'lib.nvim', 'ROADMAP', 'tasks', `${slug}.md`);
  writeFileSync(file, `---\ntitle: ${title}\nstatus: open\ncategory: [bug]\ncreated: 2026-11-21\nupdated: 2026-11-21\n---\n\nA task with the icon of its category.\n`);
  try {
    await expect
      .poll(
        async () => {
          const r = await page.request.get('/api/tasks/snapshot', { headers: { Authorization: `Bearer ${state().token}` } });
          return r.ok() && (await r.text()).includes(`"lib.nvim/${slug}"`);
        },
        { timeout: 20_000 },
      )
      .toBe(true);
    const problems = await pair(page, '/#view=board');
    const card = page.locator(`[data-card="lib.nvim/${slug}"]`);
    const icon = card.locator('[data-icon="category"]');
    await expect(icon).toHaveText(BUG);

    const openDefaults = async () => {
      await page.getByRole('menuitem', { name: 'Options', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Defaults ...' }).click();
      const dialog = page.getByTestId('defaults-dialog');
      await expect(dialog).toBeVisible();
      return dialog;
    };
    let dialog = await openDefaults();
    const section = dialog.getByRole('group', { name: 'Icons of the categories' });
    await section.scrollIntoViewIfNeeded();
    await expectAccessible(page, 'the icons of the categories in the defaults dialog');
    const bug = section.getByLabel('bug', { exact: true });
    await expect(bug).toHaveValue(BUG);
    // not one character: said at the field, not taken
    await bug.fill('xy');
    await expect(bug).toHaveAttribute('aria-invalid', 'true');
    await expect(section.getByRole('alert')).toBeVisible();
    await expectAccessible(page, 'a wrong icon of a category');
    await expect(icon).toHaveText(BUG);
    await bug.fill('🪲');
    await expect(section.getByRole('alert')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(icon).toHaveText('🪲');

    // kept in this browser: a reload shows the same
    await page.reload();
    await expect(page.getByRole('menubar')).toBeVisible();
    await expect(icon).toHaveText('🪲');

    dialog = await openDefaults();
    await dialog.getByRole('checkbox', { name: 'A task without an icon of its own shows the icon of its category' }).uncheck();
    await expect(dialog.getByLabel('bug', { exact: true })).toBeDisabled();
    await expectAccessible(page, 'the icons of the categories switched off');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(card).toBeVisible();
    await expect(card.locator('[data-icon]')).toHaveCount(0);
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem('tasks-desktop.category-icons'))) ?? '{}')).toEqual({ on: false, changed: { bug: '🪲' } });

    expect(problems).toEqual([]);
    expect(await violations(page)).toEqual([]);
  } finally {
    removeFile(file);
  }
});
