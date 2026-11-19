#!/usr/bin/env node
// Is node_modules of the page the kit the lockfile names? A pull that raised the pin of appkit-ui or appkit-web changes
// ui/pnpm-lock.yaml, and until `pnpm install` runs the check, the tests and the build go on with the kit of before,
// without a word (2026-11-19: svelte-check named `onopen` of `Menu` unknown, the browser tests ran with the menu bar of
// before). pnpm's own `verifyDepsBeforeRun` compares package.json with the lockfile, not what is installed.
//
// The commits of the kit in ui/pnpm-lock.yaml against those in ui/node_modules/.pnpm/lock.yaml (pnpm's copy of the
// lockfile it installed). Run before `check`, `test` and `build` (ui/package.json); exit 1 with what to do.
//   node ../tools/check-installed-kit.mjs [<ui folder>]
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KIT = /(appkit-(?:ui|web))@https:\/\/codeload\.github\.com\/WKDSteve\/appkit\/tar\.gz\/([0-9a-f]{40})/g;

/** The commit of each package of the kit a lockfile names: `{ "appkit-ui": "<sha>", ... }`. */
export function kitCommits(text) {
  const out = {};
  for (const [, name, sha] of text.matchAll(KIT)) out[name] ??= sha;
  return out;
}

/** What differs between the lockfile and what is installed, as sentences; empty when they agree. */
export function differences(lockText, installedText) {
  const wanted = kitCommits(lockText);
  const have = installedText === null ? {} : kitCommits(installedText);
  return Object.entries(wanted)
    .filter(([name, sha]) => have[name] !== sha)
    .map(([name, sha]) =>
      have[name] === undefined
        ? `${name} ${sha.slice(0, 7)} is in the lockfile but not installed`
        : `${name} is installed at ${have[name].slice(0, 7)}, the lockfile names ${sha.slice(0, 7)}`,
    );
}

function main() {
  const ui = resolve(process.argv[2] ?? ".");
  const lock = join(ui, "pnpm-lock.yaml");
  const installed = join(ui, "node_modules", ".pnpm", "lock.yaml");
  const found = differences(readFileSync(lock, "utf8"), existsSync(installed) ? readFileSync(installed, "utf8") : null);
  if (found.length === 0) return;
  for (const line of found) console.error(`error: ${line}`);
  console.error('Run "pnpm install" in ui/ (the kit of the lockfile), then again.');
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
