#!/usr/bin/env node
// The vault of the test sheet TESTS/sheets/learn-figures.sheet.lua (`prepare` of the app `learn-figures-hub` in
// .testing.lua): a copy of the synthetic fixture vault (e2e/fixture/vault) in the folder of the run, plus a running
// learning path and the rows of the series of the learning figures as the engine writes them
// (`_Telemetry/history/learn-YYYY-MM.jsonl`, absolute figures per day and path) around the day of the run: where the
// path started eight days ago, 2 points learned a week ago, 5 today; the paths of the fixture are left out. Nothing of a
// real vault is read or written.
//
//   node tools/sheet-learn-figures-vault.mjs <folder of the run>

import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const AREA = 'lib.nvim';
export const PATH = `${AREA}/learn-sheet-figures`;

/** A day of this machine `n` days from today, as the hub and the engine count days. */
export function dayFrom(n, now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 10 XP a point, half an hour done on each one learned: the file says what the rows say (the hub writes today's row anew).
const leaves = Array.from({ length: 8 }, (_, i) => `  - [${i < 5 ? 'x' : ' '}] Figure ${i + 1} {xp=10}${i < 5 ? ' {done_h=0.5}' : ''} {#f${i + 1}}`);
const FILE = [
  '---',
  'title: Learn sheet Figures',
  'status: doing',
  'created: 2026-11-01',
  'updated: 2026-11-20',
  '---',
  '',
  '## Lernpunkte',
  '',
  '- [ ] Stage {#s}',
  ...leaves,
  '',
].join('\n');

/** A row of the series: the absolute figures of the path on a day. */
const row = (day, learned) =>
  JSON.stringify({ v: 1, day, path: PATH, area: AREA, at: `${day}T08:00:00Z`, done_h: learned / 2, learned, seen: 0, dropped: 0, open: 8 - learned, total: 8, xp: learned * 10 });

/** Write the vault below `run` (the folder of the run); returns its path. */
export function prepare(run, now = new Date()) {
  const vault = join(run, 'vault');
  cpSync(join(repo, 'e2e', 'fixture', 'vault'), vault, { recursive: true });
  // The paths of the fixture would get their first row of the series on the day of the run, and a path that comes into
  // the series later counts from nothing (the engine's rule): their points would be learned today. This path alone.
  for (const area of readdirSync(vault)) {
    const paths = join(vault, area, 'ROADMAP', 'paths');
    if (existsSync(paths)) rmSync(paths, { recursive: true, force: true });
  }
  const file = join(vault, AREA, 'ROADMAP', 'paths', 'learn-sheet-figures.md');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, FILE);
  for (const [n, learned] of [
    [-8, 0],
    [-7, 2],
    [0, 5],
  ]) {
    const day = dayFrom(n, now);
    const month = join(vault, '_Telemetry', 'history', `learn-${day.slice(0, 7)}.jsonl`);
    mkdirSync(dirname(month), { recursive: true });
    appendFileSync(month, `${row(day, learned)}\n`);
  }
  return vault;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const run = process.argv[2];
  if (!run) {
    console.error('usage: node tools/sheet-learn-figures-vault.mjs <folder of the run>');
    process.exit(2);
  }
  prepare(run);
}
