#!/usr/bin/env node
// The vault of the test sheet TESTS/sheets/learn-steps.sheet.lua (`prepare` of the app `learn-steps-hub` in .testing.lua): a
// copy of the synthetic fixture vault (e2e/fixture/vault) in the folder of the run, plus two running learning paths for
// the views of the tab Lernpläne: next steps (one under {safety}, one for the private machine only), planned and done
// hours (one path over its plan, two sessions), notes and links. Nothing of a real vault is read or written.
//
//   node tools/sheet-learn-steps-vault.mjs <folder of the run>

import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const AREA = 'lib.nvim';
const head = (fields) => ['---', ...fields, 'created: 2026-11-20', 'updated: 2026-11-20', '---', ''].join('\n');

/** The files below the vault, by their path. */
export const FILES = {
  [`${AREA}/ROADMAP/paths/learn-sheet-os.md`]:
    head(['title: Learn sheet OS', 'status: doing']) +
    [
      '',
      '## Lernpunkte',
      '',
      '- [ ] Stage one {#s1}',
      '  - [x] Processes {#proc}',
      '  - [ ] Week 1: fork and exec {h=4-6} {done_h=2} {#w1}',
      '    - [ ] [man fork](https://man7.org/linux/man-pages/man2/fork.2.html) {#fork}',
      '      > Note: check the return value of fork.',
      '    - [ ] Exec family {#exec}',
      '  - [ ] Load a driver {machine=private} {#drv}',
      '- [ ] Stage two {#s2}',
      '  - [ ] Page tables {h=2} {#pt}',
      '',
    ].join('\n'),
  [`${AREA}/ROADMAP/paths/learn-sheet-shell.md`]:
    head(['title: Learn sheet Shell', 'status: doing']) +
    [
      '',
      '## Lernpunkte',
      '',
      '- [ ] Basics {h=2} {done_h=5} {#basics}',
      '  - [x] Pipes {#pipes}',
      '  - [ ] Quoting {safety} {#quoting}',
      '    > Note: `set -euo pipefail` first.',
      '',
    ].join('\n'),
};

/** Write the vault below `run` (the folder of the run); returns its path. */
export function prepare(run) {
  const vault = join(run, 'vault');
  cpSync(join(repo, 'e2e', 'fixture', 'vault'), vault, { recursive: true });
  for (const [path, text] of Object.entries(FILES)) {
    const file = join(vault, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return vault;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const run = process.argv[2];
  if (!run) {
    console.error('usage: node tools/sheet-learn-steps-vault.mjs <folder of the run>');
    process.exit(2);
  }
  prepare(run);
}
