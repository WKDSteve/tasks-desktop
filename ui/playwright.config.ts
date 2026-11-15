import { defineConfig } from '@playwright/test';
import { e2ePort, lastRunFile, runOutputDir } from './e2e/port';

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

// The system's Chrome is used (`channel`), so nothing is downloaded. One
// worker: the tests share one hub and pair it one after the other.
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  globalSetup: './e2e/global.ts',
  workers: 1,
  fullyParallel: false,
  timeout: onRunner ? 60_000 : 30_000,
  expect: { timeout: onRunner ? 15_000 : 5_000 },
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
