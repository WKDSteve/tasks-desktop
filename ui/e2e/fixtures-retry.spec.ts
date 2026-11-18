// The retry of `fixtures.ts`: a test runs again only after a first attempt that failed while the machine broke its
// connections. The fault the runner saw (a change of the network interfaces) cannot be made on purpose, so the watch is
// shown with another fault in its place.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeTree, tempDir } from '../web/tmp.mjs';
import type { Browser, BrowserContext, BrowserContextOptions, TestInfo } from '@playwright/test';
import {
  type AttemptInfo,
  contextMaker,
  expect,
  fixtures,
  isMachineFault,
  loadWhole,
  machineFaultNote,
  noteMachineFaults,
  retryRefusal,
  test,
  watchMachineFaults,
} from './fixtures';

const ORIGIN = 'http://machine-faults.invalid';

test('a change of the network interfaces is a fault of the machine', () => {
  expect(isMachineFault('Failed to load resource: net::ERR_NETWORK_CHANGED')).toBe(true);
});

test('a retry runs only after an attempt that left the note of a fault of the machine', () => {
  const dir = tempDir('e2e-retry');
  try {
    const note = machineFaultNote(dir, 'abc123');
    expect(retryRefusal(0, note)).toBeNull();
    expect(retryRefusal(1, note)).toMatch(/not run again: the first attempt failed without a fault of the machine/);
    // A test of a serial group that passed runs again with its group: the refusal says why it has no note.
    expect(retryRefusal(1, note)).toMatch(/in a serial group the failed attempt may be of a test before this one/);
    noteMachineFaults(note, [`${ORIGIN}/api (net::ERR_NETWORK_CHANGED)`]);
    expect(retryRefusal(1, note)).toBeNull();
    expect(readFileSync(note, 'utf8')).toContain('net::ERR_NETWORK_CHANGED');
  } finally {
    removeTree(dir);
  }
});

for (const [how, counted] of [['internetdisconnected', true], ['blockedbyclient', false]] as const) {
  test(`the watch counts a request of the page that failed for the machine, and only that (${how})`, async ({ browser }) => {
    const context = await browser.newContext();
    try {
      const seen = watchMachineFaults(context, ['net::ERR_INTERNET_DISCONNECTED']);
      const page = await context.newPage();
      await page.route(`${ORIGIN}/`, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><p>text</p>' }));
      await page.route(`${ORIGIN}/api`, (route) => route.abort(how));
      await page.goto(`${ORIGIN}/`);
      await page.evaluate(() => fetch('/api').catch(() => undefined));
      await expect.poll(() => seen.length).toBe(counted ? 1 : 0);
      if (counted) expect(seen[0]).toBe(`${ORIGIN}/api (net::ERR_INTERNET_DISCONNECTED)`);
    } finally {
      await context.close();
    }
  });
}

test('a stylesheet the load of the page got again is no fault for the retry: a test failing after it fails for itself', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const seen = watchMachineFaults(context, ['net::ERR_INTERNET_DISCONNECTED']);
    const page = await context.newPage();
    let asked = 0;
    await page.route(`${ORIGIN}/`, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><link rel="stylesheet" href="/a.css"><p>text</p>' }),
    );
    await page.route(`${ORIGIN}/a.css`, (route) => {
      asked += 1;
      return asked === 1 ? route.abort('internetdisconnected') : route.fulfill({ contentType: 'text/css', body: 'p { color: red; }' });
    });
    await loadWhole(page, () => page.goto(`${ORIGIN}/`), ['net::ERR_INTERNET_DISCONNECTED']);
    expect(asked).toBe(2);
    expect(seen).toEqual([]);
  } finally {
    await context.close();
  }
});

test('a context a test makes itself is watched like that of the fixture: its fault reaches the retry', async ({ browser }) => {
  const maker = contextMaker(browser, ['net::ERR_INTERNET_DISCONNECTED']);
  const context = await maker.make();
  try {
    const page = await context.newPage();
    await page.route(`${ORIGIN}/`, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><p>text</p>' }));
    await page.route(`${ORIGIN}/api`, (route) => route.abort('internetdisconnected'));
    await page.goto(`${ORIGIN}/`);
    await page.evaluate(() => fetch('/api').catch(() => undefined));
    await expect.poll(() => maker.seen()).toEqual([`${ORIGIN}/api (net::ERR_INTERNET_DISCONNECTED)`]);
    maker.check();
  } finally {
    await context.close();
  }
});

test('a context the test left open is closed by the maker', async ({ browser }) => {
  const maker = contextMaker(browser);
  const context = await maker.make();
  await context.newPage();
  await maker.close();
  expect(browser.contexts()).not.toContain(context);
  await maker.close();
});

// A close that hangs runs out the time of the teardown, and Playwright skips every teardown after it, that of
// `machineFaults` too: the note for the retry is written by the teardown of `context` before the close.
type ContextFixture = (
  args: { context: BrowserContext; machineFaults: string[]; vaultClean: () => void },
  use: (context: BrowserContext) => Promise<void>,
  info: TestInfo,
) => Promise<void>;

test('a failed attempt leaves its note before its context closes', async ({ browser }) => {
  const dir = tempDir('e2e-note-before-close');
  const maker = contextMaker(browser);
  try {
    const context = await maker.make();
    const attempt: AttemptInfo = {
      status: 'failed',
      expectedStatus: 'passed',
      errors: [],
      testId: 'note-before-close',
      project: { outputDir: dir },
    };
    const note = machineFaultNote(dir, attempt.testId);
    let noteAtClean = false;
    const fixture = fixtures.context as unknown as ContextFixture;
    await fixture(
      { context, machineFaults: [`${ORIGIN}/api (net::ERR_NETWORK_CHANGED)`], vaultClean: () => (noteAtClean = existsSync(note)) },
      async () => {},
      attempt as unknown as TestInfo,
    );
    expect(noteAtClean).toBe(true);
    expect(readFileSync(note, 'utf8')).toContain('net::ERR_NETWORK_CHANGED');
  } finally {
    await maker.close();
    removeTree(dir);
  }
});

test('a note that cannot be written costs neither the cleaning of the vault nor the end of the teardown', async ({ browser }) => {
  const dir = tempDir('e2e-note-unwritable');
  const maker = contextMaker(browser);
  try {
    // The folder of the note is a file: making it fails, as a folder a scanner holds does.
    const blocked = join(dir, 'blocked');
    writeFileSync(blocked, 'not a folder');
    const attempt: AttemptInfo = { status: 'failed', expectedStatus: 'passed', errors: [], testId: 'x', project: { outputDir: blocked } };
    let cleaned = false;
    const fixture = fixtures.context as unknown as ContextFixture;
    await fixture(
      { context: await maker.make(), machineFaults: ['x (net::ERR_NETWORK_CHANGED)'], vaultClean: () => (cleaned = true) },
      async () => {},
      attempt as unknown as TestInfo,
    );
    expect(cleaned).toBe(true);
  } finally {
    await maker.close();
    removeTree(dir);
  }
});

type NewContextFixture = (
  args: { browser: Browser; machineFaults: string[]; vaultClean: () => void },
  use: (make: (options?: BrowserContextOptions) => Promise<BrowserContext>) => Promise<void>,
  info: TestInfo,
) => Promise<void>;

test('a context of newContext whose close hangs still leaves the note of a failed attempt', async ({ browser }) => {
  const dir = tempDir('e2e-note-new-context');
  const real: BrowserContext[] = [];
  // The contexts this browser makes never finish closing, as the one under load did.
  const hanging = {
    newContext: async (options?: BrowserContextOptions): Promise<BrowserContext> => {
      const context = await browser.newContext(options);
      real.push(context);
      return new Proxy(context, {
        get(target, prop) {
          if (prop === 'close') return () => new Promise<void>(() => {});
          const value: unknown = Reflect.get(target, prop);
          return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
        },
      });
    },
  } as unknown as Browser;
  try {
    const attempt: AttemptInfo = { status: 'failed', expectedStatus: 'passed', errors: [], testId: 'new-context', project: { outputDir: dir } };
    const note = machineFaultNote(dir, attempt.testId);
    let noteAtClean = false;
    const fixture = fixtures.newContext as unknown as NewContextFixture;
    const teardown = fixture(
      { browser: hanging, machineFaults: [`${ORIGIN}/api (net::ERR_NETWORK_CHANGED)`], vaultClean: () => (noteAtClean = existsSync(note)) },
      async (make) => {
        await make();
      },
      attempt as unknown as TestInfo,
    );
    // The teardown never ends (the close hangs): the note must be there all the same.
    await Promise.race([teardown, new Promise((resolve) => setTimeout(resolve, 2000))]);
    expect(noteAtClean).toBe(true);
    expect(readFileSync(note, 'utf8')).toContain('net::ERR_NETWORK_CHANGED');
  } finally {
    await Promise.all(real.map((c) => c.close().catch(() => undefined)));
    removeTree(dir);
  }
});

test('an attempt that passed leaves no note, faults or not', async ({ browser }) => {
  const dir = tempDir('e2e-no-note');
  const maker = contextMaker(browser);
  try {
    const attempt: AttemptInfo = { status: 'passed', expectedStatus: 'passed', errors: [], testId: 'passed', project: { outputDir: dir } };
    const fixture = fixtures.context as unknown as ContextFixture;
    await fixture({ context: await maker.make(), machineFaults: ['x (net::ERR_NETWORK_CHANGED)'], vaultClean: () => {} }, async () => {}, attempt as unknown as TestInfo);
    expect(existsSync(machineFaultNote(dir, attempt.testId))).toBe(false);
  } finally {
    await maker.close();
    removeTree(dir);
  }
});

// Only the self tests of the watch make a bare context (they watch it themselves); any other file takes `newContext`
// of the fixture, or a change of the network in its context fails the test with no retry (mobile.spec did, twice).
// `browser.newPage` makes a context of its own as well.
const BARE_CONTEXT = /\bbrowser\s*\.\s*new(Context|Page)\s*\(/;

test('no file of the tests makes a context the fixture does not watch', () => {
  expect(BARE_CONTEXT.test('const c = await browser\n    .newContext({})')).toBe(true);
  expect(BARE_CONTEXT.test('await browser.newPage()')).toBe(true);
  expect(BARE_CONTEXT.test('await newContext({})')).toBe(false);
  const dir = dirname(fileURLToPath(import.meta.url));
  const bare = readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts') && !/^fixtures(-[a-z]+)?\.(spec\.)?ts$/.test(f.split(/[\\/]/).pop() ?? ''))
    .filter((f) => BARE_CONTEXT.test(readFileSync(join(dir, f), 'utf8')));
  expect(bare).toEqual([]);
});
