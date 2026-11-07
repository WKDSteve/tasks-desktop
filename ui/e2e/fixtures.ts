// The `test` of the browser tests. The tests share one vault, so a task one of them makes would be counted by the next
// (a capture test left a task in a plan and turned the connections tests red): whatever a test made in the vault is
// removed when it ends, whether it passed or not. And a page is only tested whole: see `loadWhole`.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, type Page, type Request, type Response } from '@playwright/test';
import { STATE } from './global';
import { removeFile } from './hub';

/** Where a task can land: open tasks of every area, and those a test finished. */
const TASK_DIRS = [join('ROADMAP', 'tasks'), join('Backlog', 'TASKS')];

/** The path of every task (a file, or the folder of a folder task) in the vault right now. */
export function vaultTasks(vault: string): Set<string> {
  const found = new Set<string>();
  for (const area of readdirSync(vault, { withFileTypes: true })) {
    if (!area.isDirectory() || area.name.startsWith('.')) continue;
    for (const dir of TASK_DIRS) {
      const at = join(vault, area.name, dir);
      if (!existsSync(at)) continue;
      for (const entry of readdirSync(at)) found.add(join(at, entry));
    }
  }
  return found;
}

/**
 * A request the machine could not make, whatever the page asked: Windows was out of socket buffers. Only what was seen
 * on the runner is here; a request the policy blocks or a missing file is a finding of the page and must stay one.
 */
export const MACHINE_FAULTS = ['net::ERR_NO_BUFFER_SPACE'];

/**
 * Whether a line of the console only reports such a fault. A test that takes every line for a finding must not count it:
 * the browser writes it for the load that `loadWhole` repeats, and a file that stays lost fails the test there anyway.
 */
export const isMachineFault = (line: string): boolean => MACHINE_FAULTS.some((fault) => line.includes(fault));

/** How often a page is loaded before the machine is named as the reason the test cannot go on. */
const LOAD_ATTEMPTS = 3;
const LOAD_PAUSE_MS = 1_000;

/**
 * Load a page and see that its stylesheets and scripts came. Without its stylesheet a page still runs, and a test then
 * judges something no person ever sees: axe passes on it, and a finger's drag ends at once, because `touch-action: none`
 * of the grip is gone and the browser takes the touch for a scroll (seen in CI). So the page is loaded again, the warning
 * says so in the log, and if the machine does not recover the test fails for that reason and not for a later symptom.
 */
export async function loadWhole(
  page: Page,
  load: () => Promise<Response | null>,
  faults: readonly string[] = MACHINE_FAULTS,
): Promise<Response | null> {
  const lost: string[] = [];
  const note = (request: Request): void => {
    const text = request.failure()?.errorText;
    if (text === undefined || !faults.includes(text)) return;
    if (['stylesheet', 'script'].includes(request.resourceType())) lost.push(`${request.url()} (${text})`);
  };
  page.on('requestfailed', note);
  try {
    let response = await load();
    for (let attempt = 1; lost.length > 0; attempt += 1) {
      if (attempt >= LOAD_ATTEMPTS) throw new Error(`the machine lost a file of the page ${attempt} times: ${lost.join(', ')}`);
      console.warn(`a page is loaded again, the machine lost: ${lost.join(', ')}`);
      lost.length = 0;
      await page.waitForTimeout(LOAD_PAUSE_MS);
      response = await page.reload();
    }
    return response;
  } finally {
    page.off('requestfailed', note);
  }
}

export const test = base.extend<{ vaultClean: void }>({
  page: async ({ page }, use) => {
    const goto = page.goto.bind(page);
    page.goto = (url, options) => loadWhole(page, () => goto(url, options));
    await use(page);
  },
  vaultClean: [
    // eslint-disable-next-line no-empty-pattern -- Playwright asks for a destructured first argument
    async ({}, use) => {
      const { vault } = JSON.parse(readFileSync(STATE, 'utf8')) as { vault: string };
      const before = vaultTasks(vault);
      await use();
      for (const path of vaultTasks(vault)) {
        if (!before.has(path)) removeFile(path);
      }
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
