#!/usr/bin/env node
// The vault of the test sheet TESTS/sheets/pathmap.sheet.lua (`prepare` of the app `pathmap-hub` in .testing.lua): a
// copy of the synthetic fixture vault (e2e/fixture/vault) in the folder of the run, plus learning paths that build on
// each other (`requires`, tasks.nvim capability `requires`): a finished root in the Backlog, a chain through two
// projects where one needs the other (hard, so a path of the second waits), a soft requirement not met, a circle and a
// requirement that names nothing. Nothing of a real vault is read or written.
//
//   node tools/sheet-pathmap-vault.mjs <folder of the run>

import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const AREA = 'lib.nvim';
const id = (slug) => `${AREA}/${slug}`;
const head = (fields) => ['---', ...fields, 'created: 2026-11-20', 'updated: 2026-11-20', '---', ''].join('\n');
const tree = (slug, learned) =>
  ['', '## Lernpunkte', '', `- [ ] Map sheet ${slug} {#root}`, `  - [${learned ? 'x' : ' '}] First ${slug} {#first}`, `  - [ ] Second ${slug} {#second}`, ''].join('\n');

/** The files below the vault, by their path. */
export const FILES = {
  [`${AREA}/Backlog/FEATURES/2026-11-19_map-sheet-root.md`]: head(['title: Map sheet root', 'status: done', 'closed_kind: path']) + tree('root', true),
  [`${AREA}/ROADMAP/projects/map-sheet-base.md`]: head(['title: Map sheet base', 'status: doing', `areas: [${AREA}]`, 'phase_order: []']),
  [`${AREA}/ROADMAP/projects/map-sheet-top.md`]: head([
    'title: Map sheet top',
    'status: planning',
    `areas: [${AREA}]`,
    'phase_order: []',
    `requires: [${id('map-sheet-base')}]`,
    'requires_gate: hard',
  ]),
  [`${AREA}/ROADMAP/paths/map-sheet-a.md`]: head(['title: Map sheet a', 'status: doing', `project: ${id('map-sheet-base')}`, `requires: [${id('map-sheet-root')}]`]) + tree('a', true),
  [`${AREA}/ROADMAP/paths/map-sheet-b.md`]: head(['title: Map sheet b', 'status: planning', `project: ${id('map-sheet-top')}`]) + tree('b', false),
  [`${AREA}/ROADMAP/paths/map-sheet-soft.md`]: head(['title: Map sheet soft', 'status: planning', `requires: [${id('map-sheet-a')}]`]) + tree('soft', false),
  [`${AREA}/ROADMAP/paths/map-sheet-x.md`]: head(['title: Map sheet x', 'status: planning', `requires: [${id('map-sheet-y')}]`]) + tree('x', false),
  [`${AREA}/ROADMAP/paths/map-sheet-y.md`]: head(['title: Map sheet y', 'status: planning', `requires: [${id('map-sheet-x')}]`]) + tree('y', false),
  [`${AREA}/ROADMAP/paths/map-sheet-ghost.md`]: head(['title: Map sheet ghost', 'status: planning', `requires: [${id('map-sheet-nothing')}]`]) + tree('ghost', false),
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
    console.error('usage: node tools/sheet-pathmap-vault.mjs <folder of the run>');
    process.exit(2);
  }
  prepare(run);
}
