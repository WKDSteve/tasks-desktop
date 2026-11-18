import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect } from './fixtures';
import { STATE } from './global';

// What the two camera specs share (camera-allowed.spec.ts, camera-refused.spec.ts): the options of Chrome that put a
// stand-in in place of a camera are options of the browser, so each of the two has a file (and a worker) of its own.

export const state = (): { config: string; vault: string; token: string } =>
  JSON.parse(readFileSync(STATE, 'utf8')) as { config: string; vault: string; token: string };

/** How long a write may take (the engine is one Neovim process per write). */
export const WRITE_BUDGET = 15_000;

/** A task of the vault opened in its float on a paired page; the folder of its attachments. */
export async function openTask(page: Page, title: string): Promise<{ float: Locator; dir: string; attached: Locator }> {
  const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;
  const tasks = join(state().vault, 'lib.nvim', 'ROADMAP', 'tasks');
  writeFileSync(join(tasks, `${slug}.md`), `---\ntitle: ${title}\nstatus: open\nkind: task\n---\n\nSomething is attached to this one.\n`);
  await page.addInitScript((token) => sessionStorage.setItem('tasks-desktop.session', token), state().token);
  await page.goto('/#view=list');
  await expect(page.getByRole('menubar')).toBeVisible();
  await page.getByRole('searchbox', { name: /search/i }).first().fill(title);
  await page.locator('button.row', { hasText: title }).click();
  const float = page.locator('dialog.peek[open]');
  await expect(float).toBeVisible();
  return { float, dir: join(tasks, slug), attached: float.locator('.attached input') };
}
