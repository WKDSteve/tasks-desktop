// The `test` of the browser tests. The tests share one vault, so a task one of them makes would be counted by the next
// (a capture test left a task in a plan and turned the connections tests red): whatever a test made in the vault is
// removed when it ends, whether it passed or not. And a page is only tested whole: see `loadWhole` and `guardPages`. A
// test runs a second time only when the machine broke its connections while it failed: see `retryRefusal`.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  test as base,
  type Browser,
  type Fixtures,
  type PlaywrightTestArgs,
  type PlaywrightTestOptions,
  type PlaywrightWorkerArgs,
  type PlaywrightWorkerOptions,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
  type Request,
  type Response,
  type TestInfo,
} from '@playwright/test';
import { STATE } from './global';
import { removeFile } from './hub';
import { joinVault, registryOf, vaultTasks } from './vault-share';

export { vaultTasks };

/**
 * A request the machine could not make, whatever the page asked: Windows was out of socket buffers, or the network
 * interfaces of the machine changed (Chrome then drops every connection, those to 127.0.0.1 too; on the runner a Wi-Fi
 * adapter that came and went beside the cable, 2026-11-16). Only what was seen on the runner is here; a request the
 * policy blocks or a missing file is a finding of the page and must stay one.
 */
export const MACHINE_FAULTS = ['net::ERR_NO_BUFFER_SPACE', 'net::ERR_NETWORK_CHANGED'];

/**
 * Whether a line of the console only reports such a fault. A test that takes every line for a finding must not count it:
 * the browser writes it for the load that `loadWhole` repeats, and a file that stays lost fails the test there anyway.
 */
export const isMachineFault = (line: string): boolean => MACHINE_FAULTS.some((fault) => line.includes(fault));

/** How often a page is loaded before the machine is named as the reason the test cannot go on. */
const LOAD_ATTEMPTS = 3;
const LOAD_PAUSE_MS = 1_000;
/** The start of the error of a load the machine did not let `loadWhole` repair. */
export const LOAD_GAVE_UP = 'the machine lost a file of the page';

/** The pages in `loadWhole` right now: it deals with what they lose, `guardPages` with everything else. */
const loading = new WeakSet<Page>();

/** The file a failed request lost, if it is a file a page needs and one of `faults` was the reason. */
function lostFile(request: Request, faults: readonly string[]): string | null {
  const text = request.failure()?.errorText;
  if (text === undefined || !faults.includes(text)) return null;
  return ['stylesheet', 'script'].includes(request.resourceType()) ? `${request.url()} (${text})` : null;
}

/**
 * Load a page and see that its stylesheets and scripts came. Without its stylesheet a page still runs, and a test then
 * judges something no person ever sees: axe passes on it, and a finger's drag ends at once, because `touch-action: none`
 * of the grip is gone and the browser takes the touch for a scroll (seen in CI). So the page is loaded again, the warning
 * says so in the log, and if the machine does not recover the test fails for that reason and not for a later symptom.
 */
export async function loadWhole(
  page: Page,
  load: () => Promise<Response | null>,
  faults: readonly string[] = MACHINE_FAULTS,
): Promise<Response | null> {
  const lost: string[] = [];
  const note = (request: Request): void => {
    const file = lostFile(request, faults);
    if (file !== null) lost.push(file);
  };
  // `load` may be the `page.goto` of `guardPages`, which comes here again: only the outermost call ends the load.
  const outermost = !loading.has(page);
  loading.add(page);
  page.on('requestfailed', note);
  try {
    let response = await load();
    for (let attempt = 1; lost.length > 0; attempt += 1) {
      if (attempt >= LOAD_ATTEMPTS) throw new Error(`${LOAD_GAVE_UP} ${attempt} times: ${lost.join(', ')}`);
      console.warn(`a page is loaded again, the machine lost: ${lost.join(', ')}`);
      lost.length = 0;
      await page.waitForTimeout(LOAD_PAUSE_MS);
      response = await page.reload();
    }
    return response;
  } finally {
    page.off('requestfailed', note);
    if (outermost) loading.delete(page);
  }
}

/**
 * Keep every page of a context whole, the first one and the tabs a test opens later. `page.goto` goes through `loadWhole`.
 * What a page loses anywhere else (a window a click opens, a part loaded later, `page.reload`) cannot be repeated from
 * here, since a test may be in the middle of something: the function this returns fails the test for that reason, as it
 * may have judged a page no person ever sees.
 */
export function guardPages(context: BrowserContext, faults: readonly string[] = MACHINE_FAULTS): () => void {
  const unrepaired: string[] = [];
  context.on('page', (page) => {
    const goto = page.goto.bind(page);
    page.goto = (url, options) => loadWhole(page, () => goto(url, options), faults);
  });
  // Of the context and not of each page: a window's first files can fail before the context reports the window.
  context.on('requestfailed', (request) => {
    const file = lostFile(request, faults);
    if (file === null) return;
    if (request.serviceWorker() !== null || !loading.has(request.frame().page())) unrepaired.push(file);
  });
  return () => {
    if (unrepaired.length > 0) throw new Error(`the machine lost a file outside a load that could repeat it: ${unrepaired.join(', ')}`);
  };
}

/**
 * Every request of a context that failed for a fault of the machine, as `url (fault)`, for as long as the test runs. Not
 * a file `loadWhole` deals with: it loads the page again, and a test that fails after that fails for its own reason (a
 * load that does not recover fails with LOAD_GAVE_UP, which the fixture counts instead).
 */
export function watchMachineFaults(context: BrowserContext, faults: readonly string[] = MACHINE_FAULTS): string[] {
  const seen: string[] = [];
  context.on('requestfailed', (request) => {
    const text = request.failure()?.errorText;
    if (text === undefined || !faults.includes(text)) return;
    if (request.serviceWorker() === null && loading.has(request.frame().page()) && lostFile(request, faults) !== null) return;
    seen.push(`${request.url()} (${text})`);
  });
  return seen;
}


/**
 * The contexts a test makes itself (another device, a browser profile of its own), kept whole and watched like the
 * context of the fixture: without this a change of the network interfaces in them failed the test with no retry.
 * `seen` and `check` cover every context `make` made.
 */
export function contextMaker(browser: Browser, faults: readonly string[] = MACHINE_FAULTS) {
  const made: { context: BrowserContext; check: () => void; seen: string[] }[] = [];
  return {
    make: async (options?: BrowserContextOptions): Promise<BrowserContext> => {
      const context = await browser.newContext(options);
      made.push({ context, check: guardPages(context, faults), seen: watchMachineFaults(context, faults) });
      return context;
    },
    seen: (): string[] => made.flatMap((m) => m.seen),
    check: (): void => made.forEach((m) => m.check()),
    /** Close what the test left open (it ran out of time before its own `close`); a closed one is closed again harmlessly. */
    close: async (): Promise<void> => {
      await Promise.all(made.map((m) => m.context.close().catch(() => undefined)));
    },
  };
}

/** The note a failed attempt leaves for its retry: the folder of the run, one file per test. */
export const machineFaultNote = (outputDir: string, testId: string): string => join(outputDir, '.machine-faults', `${testId}.txt`);

/** Leave the note: the attempt failed while the machine broke these requests. */
export function noteMachineFaults(note: string, seen: readonly string[]): void {
  mkdirSync(join(note, '..'), { recursive: true });
  writeFileSync(note, seen.map((line) => `${line}\n`).join(''));
}

/** What of `TestInfo` the note of an attempt reads. */
export type AttemptInfo = Pick<TestInfo, 'status' | 'expectedStatus' | 'errors' | 'testId'> & { project: Pick<TestInfo['project'], 'outputDir'> };

/**
 * Leave the note for the retry if this attempt failed (`failed`, by default its status) while the machine broke its
 * requests or a load gave up. Written by the teardown of `context`/`newContext` before the context closes, and again by
 * that of `machineFaults` with every error of the attempt: a close that hangs runs out the time of the teardown, and
 * Playwright then skips every later teardown, that of `machineFaults` too (the fault behind the hang got no retry).
 */
export function noteFailedAttempt(info: AttemptInfo, seen: readonly string[], failed = info.status !== info.expectedStatus): void {
  const gaveUp = info.errors.filter((error) => error.message?.includes(LOAD_GAVE_UP)).map((error) => error.message ?? '');
  if (failed && seen.length + gaveUp.length > 0) noteMachineFaults(machineFaultNote(info.project.outputDir, info.testId), [...seen, ...gaveUp]);
}

/**
 * `noteFailedAttempt` in a teardown, before the vault is cleaned and the contexts close: a note that cannot be written (a
 * scanner or indexer holds the folder, EPERM/EBUSY) is said on the console and costs neither the cleaning nor the close.
 */
export function noteBeforeClose(info: AttemptInfo, seen: readonly string[], failed: boolean): void {
  try {
    noteFailedAttempt(info, seen, failed);
  } catch (error) {
    console.warn(`the note for a retry was not written: ${String(error)}`);
  }
}

/** Run the check of `guardPages`/`contextMaker` now and give back its error, to be thrown after the note is written. */
function checkError(check: () => void): unknown {
  try {
    check();
    return undefined;
  } catch (error) {
    return error;
  }
}

/**
 * Why a retry must not run, or null when it may. The config gives every test one retry, but only an attempt that failed
 * while the machine broke its connections earns it: any other failure is the test's or the page's, and a second run that
 * passes would hide it. Such a retry fails at once and points to the first attempt. A group in serial mode runs again
 * as a whole and its tests that passed left no note, so such a group is not retried (only the self tests are serial):
 * the refusal says so, as such a test may have passed itself.
 */
export function retryRefusal(retry: number, note: string): string | null {
  if (retry === 0 || existsSync(note)) return null;
  return (
    'not run again: the first attempt failed without a fault of the machine, its error is the finding ' +
    '(in a serial group the failed attempt may be of a test before this one: the group runs again as a whole)'
  );
}

/** The fixtures of the browser tests, as an object so that a self test can put them over another `context`. */
export interface E2eFixtures {
  /** Removes what the test made in the vault (at once, and again when the test ends: see `context`). */
  vaultClean: () => void;
  machineFaults: string[];
  /** Instead of `browser.newContext`: a context the test makes itself, kept whole and watched for the retry. */
  newContext: (options?: BrowserContextOptions) => Promise<BrowserContext>;
}

export const fixtures: Fixtures<E2eFixtures, object, PlaywrightTestArgs & PlaywrightTestOptions, PlaywrightWorkerArgs & PlaywrightWorkerOptions> = {
  machineFaults: [
    // eslint-disable-next-line no-empty-pattern -- Playwright asks for a destructured first argument
    async ({}, use, testInfo) => {
      const note = machineFaultNote(testInfo.project.outputDir, testInfo.testId);
      const refusal = retryRefusal(testInfo.retry, note);
      if (refusal !== null) throw new Error(refusal);
      if (testInfo.retry > 0) console.warn(`run again after a fault of the machine: ${readFileSync(note, 'utf8').trim()}`);
      const seen: string[] = [];
      await use(seen);
      noteFailedAttempt(testInfo, seen);
    },
    { auto: true },
  ],
  // The vault is cleaned here first, before Playwright closes the context: a close that hangs (a loaded runner, a write
  // still on its way) runs out the time of the teardown, and Playwright then skips every teardown after it, the one of
  // vaultClean too. The tasks of a test that timed out stayed, and every repetition after it found them (app.spec "a
  // task moved between the groups", 14 of 30 red after one timeout).
  // The note of a fault of the machine is written here as well, before the close, for the same reason.
  context: async ({ context, machineFaults, vaultClean }, use, testInfo) => {
    const check = guardPages(context);
    const seen = watchMachineFaults(context);
    let lost: unknown;
    try {
      await use(context);
    } finally {
      machineFaults.push(...seen);
      lost = checkError(check);
      noteBeforeClose(testInfo, machineFaults, testInfo.status !== testInfo.expectedStatus || lost !== undefined);
      vaultClean();
    }
    if (lost !== undefined) throw lost;
  },
  // Like `context`: the vault is cleaned before the contexts close (a close that hangs skips every later teardown), and
  // a context the test left open (it ran out of time before its `finally`) is closed here, not left writing.
  newContext: async ({ browser, machineFaults, vaultClean }, use, testInfo) => {
    const maker = contextMaker(browser);
    let lost: unknown;
    try {
      await use(maker.make);
    } finally {
      machineFaults.push(...maker.seen());
      lost = checkError(maker.check);
      noteBeforeClose(testInfo, machineFaults, testInfo.status !== testInfo.expectedStatus || lost !== undefined);
      vaultClean();
      await maker.close();
    }
    if (lost !== undefined) throw lost;
  },
  vaultClean: [
    // eslint-disable-next-line no-empty-pattern -- Playwright asks for a destructured first argument
    async ({}, use, testInfo) => {
      const { vault } = JSON.parse(readFileSync(STATE, 'utf8')) as { vault: string };
      // Alone, the test removes what is new in the vault; beside another worker it cannot tell its own files from that
      // worker's, and the last test of the run removes them (vault-share.ts).
      const share = joinVault(vault, registryOf(STATE), `${process.pid}-${testInfo.testId}-${testInfo.retry}`, removeFile);
      try {
        await use(share.clean);
        // Again: a write the closed page still had on its way may have landed after the first time.
      } finally {
        share.leave();
      }
    },
    { auto: true },
  ],
};

export const test = base.extend<E2eFixtures>(fixtures);

export { expect } from '@playwright/test';
