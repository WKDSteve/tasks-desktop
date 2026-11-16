// The fixture of `fixtures.ts` itself: a task or a saved view one test left in the shared vault is not there for the next.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as base } from '@playwright/test';
import { type E2eFixtures, expect, fixtures, test } from './fixtures';
import { STATE } from './global';

test.describe.configure({ mode: 'serial' });

const left = (): string => {
  const { vault } = JSON.parse(readFileSync(STATE, 'utf8')) as { vault: string };
  return join(vault, 'lib.nvim', 'ROADMAP', 'tasks', 'fixture-self-test-left-behind.md');
};

test('a test leaves a task in the vault', () => {
  writeFileSync(left(), '---\ntitle: Left behind\nstatus: open\n---\n');
  expect(existsSync(left())).toBe(true);
});

test('the next test does not find it', () => {
  expect(existsSync(left())).toBe(false);
});

// A test that breaks off before it deletes its view (on the runner the next test then found it chosen).
const views = (): string => join(JSON.parse(readFileSync(STATE, 'utf8')).vault as string, 'lib.nvim', 'ROADMAP', 'views');
const leftView = (): string => join(views(), 'fixture-self-test-left-view.md');

test('a test leaves a saved view in the vault', () => {
  mkdirSync(views(), { recursive: true });
  writeFileSync(leftView(), ['---', 'name: Left behind', '---', ''].join('\n'));
  expect(existsSync(leftView())).toBe(true);
});

test('the next test does not find the view', () => {
  expect(existsSync(leftView())).toBe(false);
});

// A test that runs out of time while its context closes (on a loaded machine the close hung 30 s): Playwright skips every
// teardown after the one that ran out, so what the test made must be gone before the context closes. The layer under
// the fixtures notes whether the view is still there when the context is closed.
let leftAtClose: boolean | undefined;
const leftByClose = (): string => join(views(), 'fixture-self-test-left-at-close.md');
const closeWatched = base
  .extend({
    context: async ({ context }, use) => {
      await use(context);
      leftAtClose = existsSync(leftByClose());
    },
  })
  .extend<E2eFixtures>(fixtures);

closeWatched('a test leaves a saved view and its context is closed', async ({ page }) => {
  await page.goto('about:blank');
  mkdirSync(views(), { recursive: true });
  writeFileSync(leftByClose(), ['---', 'name: Left at the close', '---', ''].join('\n'));
});

test('the view was gone before the context closed', () => {
  test.skip(leftAtClose === undefined, 'measures the test before it: run the whole file');
  expect(leftAtClose).toBe(false);
  expect(existsSync(leftByClose())).toBe(false);
});
