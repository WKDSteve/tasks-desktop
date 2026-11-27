// Playwright setup of the end-to-end tests: the `*.spec.ts` files of `e2e/` run against the real hub and engine in the
// system's Chrome.

import { defineConfig } from '@playwright/test';
import { e2ePort, lastRunFile, runOutputDir } from './e2e/port';
import { shardOf } from './e2e/shard';

// `--last-failed` reads the last run from one file of this suite (the outputDir is a new one for every run).
lastRunFile(process.env, 'hub');

// The runner is the author's machine: other programs build there while a run is on, and then every step of a test is
// slow at once, with nothing stuck. Read from the traces of run 43636854784: two axe passes of 6 s each after 23 s of
// ordinary steps (app.spec.ts "a step is ticked ..."), 18.8 s for `POST /api/vaults/select` ("another vault is chosen
// ..."), 16.8 s for the check of the vault ("the findings of the check stay ..."), each in a test whose steps take 2 to
// 5 s on a quiet machine. No wait of those tests was wrong, so there is nothing to fix in them: on the runner a test
// gets twice the time, and an `expect` the time a write gets (WRITE_BUDGET). A wait that names its own time keeps it.
// Not on a developer's machine: there a test that needs more than 30 s has a fault worth seeing.
const onRunner = Boolean(process.env['CI']);

// CI runs the tests in parallel jobs, a part each (e2e/shard.ts). Playwright splits by file unless the tests of a file
// may be split too; app.spec.ts holds more than half of the time, so a split part needs `fullyParallel`. With one
// worker it changes no order inside a part, and a `serial` group stays together. Without E2E_SHARD it stays off.
const shard = shardOf(process.env);

// The system's Chrome is used (`channel`), so nothing is downloaded. One
// worker: the tests share one hub and pair it one after the other.
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  globalSetup: './e2e/global.ts',
  workers: 1,
  fullyParallel: shard !== null,
  shard,
  timeout: onRunner ? 60_000 : 30_000,
  expect: { timeout: onRunner ? 15_000 : 5_000 },
  // One more attempt, but only for a test that failed while the machine broke its connections (a change of the network
  // interfaces drops those to 127.0.0.1 too): any other failure refuses the retry at once (e2e/fixtures.ts).
  retries: 1,
  reporter: 'list',
  // A folder of its own per run: two runs on one machine (the runner, a terminal) would clear each other's.
  outputDir: runOutputDir(process.env, process.pid),
  use: {
    channel: 'chrome',
    // The free port the global setup took for this run (e2e/port.ts), read again by each worker.
    baseURL: `http://127.0.0.1:${e2ePort(process.env)}`,
    trace: 'retain-on-failure',
    screenshot: 'off',
    video: 'off',
  },
});
