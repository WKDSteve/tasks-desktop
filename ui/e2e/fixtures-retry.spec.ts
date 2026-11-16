// The retry of `fixtures.ts`: a test runs again only after a first attempt that failed while the machine broke its
// connections. The fault the runner saw (a change of the network interfaces) cannot be made on purpose, so the watch is
// shown with another fault in its place.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeTree, tempDir } from '../web/tmp.mjs';
import { contextMaker, expect, isMachineFault, loadWhole, machineFaultNote, noteMachineFaults, retryRefusal, test, watchMachineFaults } from './fixtures';

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

// Only the self tests of the watch make a bare context (they watch it themselves); any other spec takes `newContext`
// of the fixture, or a change of the network in its context fails the test with no retry (mobile.spec did, twice).
test('no spec makes a context the fixture does not watch', () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const bare = readdirSync(dir)
    .filter((f) => f.endsWith('.spec.ts') && !f.startsWith('fixtures-'))
    .filter((f) => readFileSync(join(dir, f), 'utf8').includes('browser.newContext('));
  expect(bare).toEqual([]);
});
