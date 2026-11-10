// The nvim a test starts sees none of this machine's data: no variable of the engine that points at the real vault or
// setup, and Neovim's own folders in the test's folder (web/nvim-env.mjs).

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { MACHINE_VARS, nvimEnv, withoutMachineVars } from './nvim-env.mjs';
import { testDir } from './tmp.mjs';

const COMPARE = process.env.TASKS_WEB_COMPARE === '1';

/** What a machine of a person has set: the variables of the engine, Neovim's folders, a secret. */
const MACHINE = {
  TASKS_MARKER_DOCS: 'E:/real/vault/ROADMAP.md',
  tasks_vault: 'E:/real/vault',
  TASKS_EXTRA_AREAS: 'private',
  TASKS_LISTS_FILE: 'E:/real/lists.json',
  TASKS_FRECENCY_FILE: 'E:/real/frecency.json',
  TASKS_LINKS: 'wikilink',
  NVIM_CONFIG_DIR: 'E:/real/nvim',
  CLAUDE_CODE_SESSION_ID: 'session-of-the-person',
  XDG_STATE_HOME: 'E:/real/state',
  LOCALAPPDATA: 'E:/real/appdata',
  GITHUB_TOKEN: 'secret',
};

test('only the positive list passes, any case, and the folders of Neovim are the test\'s own', () => {
  const home = join('T:', 'test');
  const env = nvimEnv(home, { LIB_NVIM_DIR: 'L:/lib.nvim' }, { ...MACHINE, Path: 'P:/bin', SystemRoot: 'C:/Windows' });
  assert.deepEqual(Object.keys(env).sort(), [
    'LIB_NVIM_DIR', 'Path', 'SystemRoot', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME',
  ]);
  assert.equal(env.Path, 'P:/bin');
  assert.equal(env.XDG_STATE_HOME, join(home, 'nvim-home', 'state'));
  assert.equal(env.XDG_CONFIG_HOME, join(home, 'nvim-home', 'config'));
  assert.equal(nvimEnv(home, { PATH: 'mine' }, { PATH: 'theirs' }).PATH, 'mine', 'extra wins');
});

test('an nvim started with it sees no variable of the engine and keeps its state in the test folder', {
  skip: !COMPARE && 'set TASKS_WEB_COMPARE=1 (needs nvim)',
}, (t) => {
  const dir = testDir(t, 'nvim-env');
  const script = join(dir, 'env.lua');
  // XDG_STATE_HOME is set, to the test folder: `state` below says where it points
  const names = Object.keys(MACHINE).filter((n) => !n.startsWith('XDG_'));
  writeFileSync(
    script,
    `local out = {}
for _, name in ipairs(vim.json.decode(arg[1])) do
  if vim.env[name] ~= nil then out[#out + 1] = name end
end
io.stdout:write(vim.json.encode({ seen = out, state = vim.fn.stdpath("state") }))
`,
  );
  const text = execFileSync('nvim', ['--headless', '-u', 'NONE', '-l', script, JSON.stringify(names)], {
    encoding: 'utf8',
    env: nvimEnv(dir, {}, { ...process.env, ...MACHINE }),
  });
  const seen = JSON.parse(text);
  assert.deepEqual(seen.seen, [], 'variables of this machine the engine would read');
  assert.ok(seen.state.replaceAll('\\', '/').startsWith(dir.replaceAll('\\', '/')), `stdpath("state") ${seen.state}`);
});

test("the hub of a test gets the environment without the variables of this machine's vault and setup", () => {
  const env = withoutMachineVars({ ...MACHINE, TASKS_ENGINE_DIR: 'E:/repos/tasks.nvim', TASKS_DESKTOP_PORT: '1', Path: 'P' });
  assert.deepEqual(Object.keys(env).sort(), ['GITHUB_TOKEN', 'LOCALAPPDATA', 'Path', 'TASKS_DESKTOP_PORT', 'TASKS_ENGINE_DIR', 'XDG_STATE_HOME']);
  for (const name of Object.keys(MACHINE).filter((n) => n.toUpperCase().startsWith('TASKS_'))) {
    assert.ok(MACHINE_VARS.includes(name.toUpperCase()), `${name} is a variable of this machine`);
  }
});
