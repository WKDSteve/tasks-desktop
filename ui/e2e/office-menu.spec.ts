import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, isMachineFault, test } from './fixtures';
import { expectAccessible, watchViolations } from './a11y';
import { STATE } from './global';
import { menuTab } from './menu';

// The tab Office of the menu bar against the real hub and engine: Dates (Meetings, Calendar, Timeline), Remind
// (Reminders) and Create (New meeting), the views gone from View, the list of the meetings and its filters.

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

test('Office: sections, the views with their links, the dot, and nothing of it left in View', async ({ page }) => {
  const problems = await pair(page, '/#view=list');
  await menuTab(page, 'Office').click();
  const menu = page.getByRole('menu', { name: /^Office/ });
  for (const group of ['Dates', 'Remind', 'Create']) await expect(menu.getByRole('group', { name: group })).toBeVisible();
  await expect(menu.getByRole('menuitemradio')).toHaveText(['Meetings', 'Calendar', 'Timeline', 'Reminders']);
  await expect(menu.getByRole('menuitemradio', { name: 'Timeline' })).toHaveAttribute('href', /#view=timeline/);
  await expect(menu.getByRole('menuitem', { name: 'New meeting ...' })).toBeVisible();
  await menu.getByRole('menuitemradio', { name: 'Calendar' }).click();
  await expect(page).toHaveURL(/#view=calendar/);
  await expect(menuTab(page, 'Office')).toHaveAccessibleName('Office, current: Calendar');
  await expect(menuTab(page, 'View')).toHaveAccessibleName('View');

  await menuTab(page, 'View').click();
  const view = page.getByRole('menu', { name: /^View/ });
  await expect(view.getByRole('menuitem', { name: /^Time/ })).toHaveCount(0);
  await expect(view.getByRole('menuitemradio', { name: 'Calendar' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await menuTab(page, 'Project').click();
  await expect(page.getByRole('menu', { name: /^Project/ }).getByRole('menuitem', { name: 'New meeting ...' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect(problems).toEqual([]);
});

test('Office: the New meeting entry opens the form of a meeting', async ({ page }) => {
  await pair(page, '/#view=list');
  await menuTab(page, 'Office').click();
  await page.getByRole('menuitem', { name: 'New meeting ...' }).click();
  await expect(page.getByRole('dialog', { name: 'New meeting' })).toBeVisible();
});

/** A day `offset` days from today on the wall of this machine, `YYYY-MM-DD`. */
function day(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test('Meetings: the parts of the list, the mark on a past one, the filter, a row opens the meeting, accessible', async ({ page }) => {
  const dir = join(state().vault, 'lib.nvim', 'MEETINGS');
  mkdirSync(dir, { recursive: true });
  const files = [
    ['off-e2e-today', 'Off e2e today', day(0)],
    ['off-e2e-past', 'Off e2e past', day(-3)],
    ['off-e2e-later', 'Off e2e later', day(30)],
  ] as const;
  for (const [slug, title, date] of files) writeFileSync(join(dir, `${slug}.md`), `---
title: ${title}
status: planned
date: ${date}
time: "10:00"
---

A meeting of one browser test.
`);
  try {
    const problems = await pair(page, '/#view=meetings');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Meetings');
    await expect(page.locator('[data-part="today"] [data-meeting="lib.nvim/off-e2e-today"]')).toBeVisible();
    await expect(page.locator('[data-part="later"] [data-meeting="lib.nvim/off-e2e-later"]')).toBeVisible();
    const past = page.locator('[data-part="past"] [data-meeting="lib.nvim/off-e2e-past"]');
    await expect(past).toBeVisible();
    await expect(past.locator('[data-followup]')).toBeVisible();
    await expectAccessible(page, 'the list of the meetings');

    await page.locator('[data-meetings-search]').fill('off e2e later');
    await expect(page.locator('[data-meeting="lib.nvim/off-e2e-today"]')).toHaveCount(0);
    await page.locator('[data-meetings-search]').fill('zzz-no-such-meeting-zzz');
    await expect(page.locator('[data-meetings-empty]')).toBeVisible();
    await page.locator('[data-meetings-search]').fill('off e2e later');
    await page.locator('[data-meeting="lib.nvim/off-e2e-later"]').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(problems).toEqual([]);
  } finally {
    for (const [slug] of files) rmSync(join(dir, `${slug}.md`), { force: true });
  }
});
