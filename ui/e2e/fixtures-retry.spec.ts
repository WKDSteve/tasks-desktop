// The retry of `fixtures.ts`: a test runs again only after a first attempt that failed while the machine broke its
// connections. The fault the runner saw (a change of the network interfaces) cannot be made on purpose, so the watch is
// shown with another fault in its place.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, isMachineFault, loadWhole, machineFaultNote, noteMachineFaults, retryRefusal, test, watchMachineFaults } from './fixtures';

const ORIGIN = 'http://machine-faults.invalid';

test('a change of the network interfaces is a fault of the machine', () => {
  expect(isMachineFault('Failed to load resource: net::ERR_NETWORK_CHANGED')).toBe(true);
});

test('a retry runs only after an attempt that left the note of a fault of the machine', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tasks-e2e-retry-'));
  try {
    const note = machineFaultNote(dir, 'abc123');
    expect(retryRefusal(0, note)).toBeNull();
    expect(retryRefusal(1, note)).toMatch(/not run again: the first attempt failed without a fault of the machine/);
    noteMachineFaults(note, [`${ORIGIN}/api (net::ERR_NETWORK_CHANGED)`]);
    expect(retryRefusal(1, note)).toBeNull();
    expect(readFileSync(note, 'utf8')).toContain('net::ERR_NETWORK_CHANGED');
  } finally {
    rmSync(dir, { recursive: true, force: true });
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
