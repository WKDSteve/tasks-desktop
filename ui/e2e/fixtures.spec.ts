// The fixture of `fixtures.ts` itself: a task one test left in the shared vault is not there for the next.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
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
