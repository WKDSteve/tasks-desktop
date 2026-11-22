#!/usr/bin/env node
// The vault of the test sheet TESTS/sheets/meetings-make.sheet.lua (`prepare` of the app `meetings-hub` in .testing.lua):
// a copy of the synthetic fixture vault (e2e/fixture/vault) in the folder of the run, plus one meeting of the task
// lib.nvim/alpha that is over (2026-01-05), with an agenda item and a participant to tick. Nothing of a real vault is
// read or written.
//
//   node tools/sheet-meetings-vault.mjs <folder of the run>

import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const AREA = 'lib.nvim';
export const TASK = `${AREA}/alpha`;
export const PAST_SLUG = 'sheet-past-meeting';

/** Write the vault below `run` (the folder of the run); returns its path. */
export function prepare(run) {
  const vault = join(run, 'vault');
  cpSync(join(repo, 'e2e', 'fixture', 'vault'), vault, { recursive: true });
  const dir = join(vault, AREA, 'MEETINGS');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${PAST_SLUG}.md`),
    [
      '---',
      'title: Sheet past meeting',
      'status: planned',
      'date: 2026-01-05',
      'time: "10:00"',
      'duration: 60m',
      `tasks: [${TASK}]`,
      '---',
      '',
      'A meeting of the test sheet meetings-make.',
      '',
      '## Agenda',
      '',
      '- [ ] Point one',
      '',
      '## Teilnehmer',
      '',
      '- [ ] Rick <rick@example.org> (Organisator)',
      '',
      '## Unterlagen',
      '',
      '## Protokoll',
      '',
      '## Beschlüsse',
      '',
      '## Folgeaufgaben',
      '',
      '## Ergebnis',
      '',
    ].join('\n'),
  );
  return vault;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const run = process.argv[2];
  if (!run) {
    console.error('usage: node tools/sheet-meetings-vault.mjs <folder of the run>');
    process.exit(2);
  }
  prepare(run);
}
