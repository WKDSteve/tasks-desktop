import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, isMachineFault, test } from './fixtures';
import { STATE } from './global';

// The board and the saved views are loaded on demand (`ViewsView`, `BoardView`: the start has a budget,
// tools/check-bundle-size.py). They must not flicker for it: their chunk comes while the page is idle after its start,
// and a view opened again is drawn in the frame of its heading (`ui/src/views/loader.ts`).

test.use({ locale: 'en-US' });

const state = (): { token: string } => JSON.parse(readFileSync(STATE, 'utf8')) as { token: string };

async function pair(page: Page, path: string): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !isMachineFault(m.text())) problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.addInitScript((token) => sessionStorage.setItem('tasks-desktop.session', token), state().token);
  await page.goto(path);
  await expect(page.getByRole('menubar')).toBeVisible();
  return problems;
}

/** The chunks of the page fetched so far, by the start of their name (`ViewsView` for `ViewsView-<hash>.js`). */
const fetched = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => /\/assets\/[^/]+\.js$/.test(name))
      .map((name) => (/\/assets\/([A-Za-z]+)-/.exec(name)?.[1] ?? '')),
  );

/**
 * Samples every frame until `stop`: the heading of the page and whether the view under it is there. A frame with the
 * heading of a view but without the view is the flicker.
 */
async function sampleFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { frames_: { heading: string; board: boolean; views: boolean }[]; sampling: boolean };
    w.frames_ = [];
    w.sampling = true;
    const sample = () => {
      if (!w.sampling) return;
      w.frames_.push({
        heading: document.querySelector('main h1')?.textContent?.trim() ?? '',
        board: document.querySelector('main [role="group"][aria-label="Board"]') !== null,
        views: document.querySelector('main [role="group"][aria-label="Saved views"]') !== null,
      });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function emptyFrames(page: Page): Promise<string[]> {
  const frames = await page.evaluate(() => {
    const w = window as unknown as { frames_: { heading: string; board: boolean; views: boolean }[]; sampling: boolean };
    w.sampling = false;
    return w.frames_;
  });
  expect(frames.length).toBeGreaterThan(0);
  return frames
    .filter((f) => (f.heading === 'Board' && !(f.board && f.views)) || (f.heading === 'Views' && !f.views))
    .map((f) => JSON.stringify(f));
}

async function chord(page: Page, key: string): Promise<void> {
  await page.keyboard.press('g');
  await page.keyboard.press(key);
}

test('the board and the views come without flicker: fetched while idle after the start, drawn with their heading', async ({ page }) => {
  const problems = await pair(page, '/#view=list');
  await expect(page.locator('main h1')).toHaveText('List');
  // Not opened, yet fetched: the page did it on its own once it was ready.
  await expect.poll(() => fetched(page), { message: 'the chunk of the views is fetched while the page is idle' }).toContain('ViewsView');
  expect(await fetched(page)).toContain('BoardView');
  // Wait until the module has been evaluated, not only fetched: importing the same address resolves after it.
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((name) => /\/assets\/ViewsView-[^/]+\.js$/.test(name));
    if (url) await import(url);
  });
  await page.locator('main').click({ position: { x: 5, y: 5 } });

  await sampleFrames(page);
  await chord(page, 'b');
  await expect(page.getByRole('group', { name: 'Board' })).toBeVisible();
  // To the list and back, and to the views: each time a new element, each time at once.
  await chord(page, 'l');
  await expect(page.locator('main h1')).toHaveText('List');
  await chord(page, 'b');
  await expect(page.getByRole('group', { name: 'Board' })).toBeVisible();
  await chord(page, 'v');
  await expect(page.locator('main h1')).toHaveText('Views');
  await expect(page.getByRole('group', { name: 'Saved views' })).toBeVisible();
  expect(await emptyFrames(page), 'frames with the heading of a view but without the view').toEqual([]);
  expect(problems).toEqual([]);
});

test('a deep link to the board loads it at the start', async ({ page }) => {
  const problems = await pair(page, '/#view=board');
  await expect(page.locator('main h1')).toHaveText('Board');
  await expect(page.getByRole('group', { name: 'Board' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Saved views' })).toBeVisible();
  expect(problems).toEqual([]);
});
