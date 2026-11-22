#!/usr/bin/env node
// The vault of the test sheet TESTS/sheets/path-levels.sheet.lua (`prepare` of the app `levels-hub` in .testing.lua):
// a copy of the synthetic fixture vault (e2e/fixture/vault) in the folder of the run, plus a learning path with a
// badge below its assets/badges/, one point already learned (60 XP) and one point promoted to a task with `xp: 10`;
// and the plain path of TESTS/sheets/learning-paths.sheet.lua (five open leaves).
// Nothing of a real vault is read or written.
//
//   node tools/sheet-levels-vault.mjs <folder of the run>

import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const AREA = 'lib.nvim';
export const PATH_SLUG = 'levels-sheet';
export const TASK_SLUG = 'levels-sheet-task';
export const POINTS_SLUG = 'points-sheet';

/** Write the vault below `run` (the folder of the run); returns its path. */
export function prepare(run) {
  const vault = join(run, 'vault');
  cpSync(join(repo, 'e2e', 'fixture', 'vault'), vault, { recursive: true });
  const roadmap = join(vault, AREA, 'ROADMAP');
  const dir = join(roadmap, 'paths', PATH_SLUG);
  mkdirSync(join(dir, 'assets', 'badges'), { recursive: true });
  writeFileSync(
    join(dir, 'assets', 'badges', 'star.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="7" fill="gold"/></svg>\n',
  );
  writeFileSync(
    join(dir, `${PATH_SLUG}.md`),
    [
      '---',
      'title: Levels sheet',
      'status: doing',
      '---',
      '',
      'A path of the test sheet path-levels.',
      '',
      '## Lernpunkte',
      '',
      '- [ ] Levels sheet {#root}',
      '  - [x] First point {xp=60} {#first}',
      `  - [ ] Task point → ${AREA}/${TASK_SLUG} {#t}`,
      '',
    ].join('\n'),
  );
  // The path of TESTS/sheets/learning-paths.sheet.lua: one leaf for each thing that sheet does to a point.
  writeFileSync(
    join(roadmap, 'paths', `${POINTS_SLUG}.md`),
    [
      '---',
      'title: Points sheet',
      'status: doing',
      '---',
      '',
      'A path of the test sheet learning-paths.',
      '',
      '## Lernpunkte',
      '',
      '- [ ] Points sheet {#root}',
      '  - [ ] Tick point {#tick}',
      '  - [ ] Drop point {#drop}',
      '  - [ ] Block point {#block}',
      '  - [ ] Outside point {#outside}',
      '  - [ ] Promote point {#promo}',
      '',
    ].join('\n'),
  );
  mkdirSync(join(roadmap, 'tasks'), { recursive: true });
  writeFileSync(
    join(roadmap, 'tasks', `${TASK_SLUG}.md`),
    ['---', 'title: Levels sheet task', 'status: open', 'xp: 10', '---', '', 'Promoted from a point.', ''].join('\n'),
  );
  return vault;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const run = process.argv[2];
  if (!run) {
    console.error('usage: node tools/sheet-levels-vault.mjs <folder of the run>');
    process.exit(2);
  }
  prepare(run);
}
