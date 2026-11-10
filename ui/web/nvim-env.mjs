// The environment of a Neovim a test starts (the nvim side of the web compare): a positive list, never the person's own.
//
// The engine reads variables that point it at this machine's data and setup: `TASKS_MARKER_DOCS` (marker documents of
// the real vault: with it set, a write that finished a task refreshed them and the compare of `move_area` failed),
// `TASKS_VAULT`, `TASKS_EXTRA_AREAS`, `TASKS_LISTS_FILE`, `TASKS_FRECENCY_FILE`, `TASKS_LINKS`, `NVIM_CONFIG_DIR`,
// `CLAUDE_CODE_SESSION_ID`, and Neovim's own `XDG_*`/`LOCALAPPDATA` folders hold the saved lists of this machine
// (`stdpath("state")/tasks/lists.json`). So nothing passes but what a process needs to run at all, and Neovim's folders
// are moved into the test's own folder. The hub starts its engine the same way (`child_env` of appkit-hub).

import { join } from 'node:path';

/** What passes from the environment of the test: the search path, the system, the temp and home folders, the locale. */
export const PASS = [
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'windir',
  'ComSpec',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
];

/** Neovim's folders (`stdpath`), each moved below `home`. */
export const XDG = ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME'];

/**
 * The environment for an nvim of a test: the variables of `PASS` from `from` (any case: Windows names them as it
 * likes), Neovim's folders below `home`, then `extra` (`LIB_NVIM_DIR` of the pinned checkout, say).
 * @param {string} home  a folder of the test (`testDir`); Neovim makes what it needs below it
 * @param {Record<string, string>} [extra]
 * @param {NodeJS.ProcessEnv} [from]
 * @returns {Record<string, string>}
 */
export function nvimEnv(home, extra = {}, from = process.env) {
  const pass = new Set(PASS.map((name) => name.toUpperCase()));
  const env = {};
  for (const [name, value] of Object.entries(from)) {
    if (value !== undefined && pass.has(name.toUpperCase())) env[name] = value;
  }
  for (const name of XDG) env[name] = join(home, 'nvim-home', name.slice(4, -5).toLowerCase());
  return { ...env, ...extra };
}

/**
 * The variables of the engine (and of the hub's discovery) that name this machine's data or setup. The hub of a test
 * needs much of the environment (`TASKS_ENGINE_DIR`, `TASKS_DESKTOP_*`, the toolchain), so it gets everything but
 * these: with `TASKS_VAULT` it would open the real vault where a test has none configured, and its sheet runs (which
 * inherit) would read the rest.
 */
export const MACHINE_VARS = [
  'TASKS_VAULT',
  'TASKS_MARKER_DOCS',
  'TASKS_EXTRA_AREAS',
  'TASKS_LISTS_FILE',
  'TASKS_FRECENCY_FILE',
  'TASKS_LINKS',
  'TASKS_TRUST_VAULT_LINT',
  'NVIM_CONFIG_DIR',
  'CLAUDE_CODE_SESSION_ID',
];

/**
 * `from` without `MACHINE_VARS` (any case).
 * @param {NodeJS.ProcessEnv} [from]
 * @returns {NodeJS.ProcessEnv}
 */
export function withoutMachineVars(from = process.env) {
  const drop = new Set(MACHINE_VARS);
  return Object.fromEntries(Object.entries(from).filter(([name]) => !drop.has(name.toUpperCase())));
}
