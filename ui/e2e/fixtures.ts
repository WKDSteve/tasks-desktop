// The `test` of the browser tests. The tests share one vault, so a task one of them makes would be counted by the next
// (a capture test left a task in a plan and turned the connections tests red): whatever a test made in the vault is
// removed when it ends, whether it passed or not.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as base } from '@playwright/test';
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

export const test = base.extend<{ vaultClean: void }>({
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
