import { defineConfig } from '@playwright/test';
import { e2ePort, lastRunFile, runOutputDir } from './e2e/port';

// The device suite (`pnpm e2e:device`): the phone page on a real Android phone over adb, against the hub of the tests
// (the same global setup as `pnpm e2e`: its own vault, a free port). Without a phone the tests are skipped and say
// why. Not in the CI: the runner has no phone.
lastRunFile(process.env, 'device');

export default defineConfig({
  testDir: './e2e-device',
  testMatch: /.*\.spec\.ts/,
  globalSetup: './e2e/global.ts',
  workers: 1,
  fullyParallel: false,
  // A real phone over USB is slower than Chrome on the PC.
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  outputDir: runOutputDir(process.env, process.pid),
  use: {
    baseURL: `http://127.0.0.1:${e2ePort(process.env)}`,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
});
