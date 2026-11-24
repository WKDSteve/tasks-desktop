// Every control is at least 24 x 24 CSS px, and at least 44 x 44 on a coarse pointer (a finger). The box that counts is the
// one a click lands on: `button`, `[role=button]`, `select`, `summary`, a checkbox or radio, and a link that stands alone
// (a link inside a line of text is exempt, as is a button that looks like one: `.link`). The test walks the main views.

import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { STATE } from './global';

test.use({ locale: 'en-US' });

const state = (): { token: string } => JSON.parse(readFileSync(STATE, 'utf8')) as { token: string };

const VIEWS = ['today', 'list', 'board', 'inbox', 'plan', 'calendar', 'paths', 'stats', 'contacts', 'meetings'];

/** The controls of the page that are shown and smaller than `min` in either direction, as a readable line each. */
async function small(page: Page, min: number): Promise<string[]> {
  return page.evaluate((limit) => {
    const out: string[] = [];
    const sel = 'button, [role=button], select, summary, input[type=checkbox], input[type=radio], a[href]';
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      if (el.closest('[inert], [hidden], .sr-only, .sr')) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      // A link or a button inside a line of text, and a button made to look like one, is exempt.
      if (el.matches('.link') || (el.tagName === 'A' && getComputedStyle(el).display === 'inline')) continue;
      // A checkbox or radio is hit through its label too: the larger of the two boxes counts.
      let rect = el.getBoundingClientRect();
      if (el instanceof HTMLInputElement && el.labels && el.labels.length > 0) {
        const label = el.labels[0]!.getBoundingClientRect();
        if (label.width * label.height > rect.width * rect.height) rect = label;
      }
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.width < limit - 0.5 || rect.height < limit - 0.5) {
        const name = el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 24) ?? '';
        out.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''} "${name}" ${Math.round(rect.width)}x${Math.round(rect.height)}`);
      }
    }
    return out;
  }, min);
}

async function open(page: Page, view: string): Promise<void> {
  await page.goto(`/#view=${view}`);
  await expect(page.getByRole('menubar')).toBeVisible();
  // The page holds an event stream open, so the network is never idle: a pause for the view to draw is all there is.
  await page.waitForTimeout(500);
}

test('every control of the main views is at least 24 px', async ({ page }) => {
  test.slow();
  await page.addInitScript((token) => sessionStorage.setItem('tasks-desktop.session', token), state().token);
  const found: string[] = [];
  for (const view of VIEWS) {
    await open(page, view);
    found.push(...(await small(page, 24)).map((line) => `${view}: ${line}`));
  }
  expect(found).toEqual([]);
});

// A finger: Chrome in a touch context (`hasTouch`, `isMobile`) matches `(pointer: coarse)`, and a control then needs 44 px.
test.describe('with a coarse pointer', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 900, height: 900 } });

  test('every control of the main views is at least 44 px', async ({ page }) => {
    test.slow();
    await page.addInitScript((token) => sessionStorage.setItem('tasks-desktop.session', token), state().token);
    await page.goto('/#view=list');
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    const found: string[] = [];
    for (const view of ['today', 'list', 'board', 'inbox']) {
      await open(page, view);
      found.push(...(await small(page, 44)).map((line) => `${view}: ${line}`));
    }
    expect(found).toEqual([]);
  });
});
