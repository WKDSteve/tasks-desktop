#!/usr/bin/env node
// The vault of the test sheet TESTS/sheets/learn-views.sheet.lua (`prepare` of the app `learn-views-hub` in .testing.lua):
// a copy of the synthetic fixture vault (e2e/fixture/vault) in the folder of the run, plus what the views of the tab
// "Learning plans" read over all paths: a path halfway with two levels in percent (one reached with a reward, the line
// of the whole path still to come), a field of knowledge with stages and targets, a path that serves it with one piece
// of evidence learned (for practice 3) and one open, and a path that names no field. Nothing of a real vault is read or
// written.
//
//   node tools/sheet-learn-vault.mjs <folder of the run>

import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const AREA = 'lib.nvim';
const head = (fields) => ['---', ...fields, 'created: 2026-11-20', 'updated: 2026-11-20', '---', ''].join('\n');

/** The files below the vault, by their path. */
export const FILES = {
  // A path in its folder form, with a badge picture below assets/badges/ (grey while its level is open).
  [`${AREA}/ROADMAP/paths/learn-sheet-levels/assets/badges/star.svg`]:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#c8a000"/></svg>',
  [`${AREA}/ROADMAP/paths/learn-sheet-levels/learn-sheet-levels.md`]:
    head(['title: Learn sheet levels', 'status: doing']) +
    [
      '',
      '## Lernpunkte',
      '',
      '- [x] Learn sheet first leaf {#one}',
      '- [ ] Learn sheet second leaf {#two}',
      '',
      '## Level',
      '',
      '- [ ] 50 % · Learn sheet halfway · Badge assets/badges/star.svg · Belohnung: Learn sheet cinema',
      '- [ ] Pfad fertig · Badge assets/badges/star.svg · Belohnung: Learn sheet lake',
      '',
    ].join('\n'),
  [`${AREA}/ROADMAP/competences/learn-sheet-os.md`]: [
    '---',
    'title: "Learn sheet operating systems"',
    'group: "Learn sheet core"',
    't: 3',
    'p: 1.5',
    'target_12: 4',
    'target_24: 4.5',
    'assessed: 2026-10-29',
    '---',
    'Why: **processes** first.',
    '',
  ].join('\n'),
  [`${AREA}/ROADMAP/paths/learn-sheet-serves.md`]:
    head(['title: Learn sheet serves', 'status: doing', `competence: ${AREA}/learn-sheet-os`]) +
    [
      '',
      '## Lernpunkte',
      '',
      '- [x] Nachweis: Learn sheet a small shell {for=p3} {#shell}',
      '- [ ] Nachweis: Learn sheet a scheduler {#sched}',
      '- [ ] Learn sheet plain leaf {#plain}',
      '',
    ].join('\n'),
  [`${AREA}/ROADMAP/paths/learn-sheet-free.md`]: head(['title: Learn sheet free', 'status: planning']) + '\n## Lernpunkte\n\n- [ ] Learn sheet free leaf {#leaf}\n',
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
    console.error('usage: node tools/sheet-learn-vault.mjs <folder of the run>');
    process.exit(2);
  }
  prepare(run);
}
