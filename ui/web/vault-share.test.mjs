// Who cleans the shared vault of the browser tests (e2e/vault-share.ts), without a browser: two tests beside each other
// (`--workers=2`) must not remove each other's tasks, and nothing stays behind when the last one is over.
//
// Node loads the file as TypeScript (type stripping, as in `web:test`).

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { joinVault, registryOf, vaultTasks, writeBaseline } from '../e2e/vault-share.ts';
import { testDir } from './tmp.mjs';

/** A vault with one task of the start, and the registry of the run beside it. */
function run(t) {
  const root = testDir(t, 'vault-share');
  const vault = join(root, 'vault');
  const tasks = join(vault, 'lib.nvim', 'ROADMAP', 'tasks');
  mkdirSync(tasks, { recursive: true });
  writeFileSync(join(tasks, 'seed.md'), 'seed');
  const registry = registryOf(join(root, 'state.json'));
  writeBaseline(registry, vault);
  const make = (name) => {
    const file = join(tasks, `${name}.md`);
    writeFileSync(file, name);
    return file;
  };
  // The ids start with the process id, as in the fixture: the test is "alive" as long as this process is.
  const join_ = (name) => joinVault(vault, registry, `${process.pid}-${name}`);
  return { vault, tasks, make, join: join_, seed: join(tasks, 'seed.md') };
}

test('a test that is alone removes what it made and nothing else', (t) => {
  const { make, join: enter, seed } = run(t);
  const a = enter('a');
  const file = make('mine');
  assert.equal(a.shared(), false);
  a.leave();
  assert.equal(existsSync(file), false);
  assert.equal(existsSync(seed), true);
});

test('two tests beside each other: the first to end leaves the files of the other', (t) => {
  const { make, join: enter, seed } = run(t);
  const a = enter('a');
  const b = enter('b');
  const fileA = make('of-a');
  const fileB = make('of-b');
  assert.equal(a.shared() && b.shared(), true);
  // A is over while B is still running and has just made its task: B's task is there for B.
  a.leave();
  assert.equal(existsSync(fileB), true, 'the task of the test that still runs is not removed');
  // B is the last: everything that is not of the start goes, A's file too.
  b.leave();
  assert.equal(existsSync(fileB), false);
  assert.equal(existsSync(fileA), false);
  assert.equal(existsSync(seed), true, 'what was in the vault at the start stays');
});

test('a test that started and ended inside another counts as beside it, for both', (t) => {
  const { make, join: enter } = run(t);
  const a = enter('long');
  const fileA = make('of-long');
  const b = enter('short');
  const fileB = make('of-short');
  b.leave();
  // The short test saw the long one running: it removed nothing. The long one saw the short one start: it removes nothing now either.
  assert.equal(existsSync(fileB), true);
  a.clean();
  assert.equal(existsSync(fileA), true);
  a.leave();
  assert.equal(existsSync(fileA), false);
  assert.equal(existsSync(fileB), false);
});

test('the entry of a worker that died does not keep the others from cleaning', (t) => {
  const { make, join: enter, vault } = run(t);
  const registry = registryOf(join(vault, '..', 'state.json'));
  // A process id that no process has: the entry is left over.
  mkdirSync(join(registry, 'active'), { recursive: true });
  writeFileSync(join(registry, 'active', '2147483646-gone'), '');
  const a = enter('a');
  const file = make('mine');
  assert.equal(a.shared(), false);
  a.leave();
  assert.equal(existsSync(file), false);
  assert.equal(vaultTasks(vault).size, 1);
});
