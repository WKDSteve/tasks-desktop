// `loadWhole` of `fixtures.ts`: a page that lost a file is loaded again, and only for a fault of the machine. The fault
// the runner saw cannot be made on purpose (a route has no such error), so these tests name another one in its place.
import type { Page } from '@playwright/test';
import { expect, isMachineFault, loadWhole, MACHINE_FAULTS, test } from './fixtures';

const ORIGIN = 'http://load-whole.invalid';
const FAULT = 'net::ERR_CONNECTION_FAILED';

/** A page with a stylesheet that is lost as often as `lost` says, in the way `how` says. The count of its requests. */
async function pageWithStylesheet(page: Page, lost: number, how: 'connectionfailed' | 'blockedbyclient'): Promise<() => number> {
  let asked = 0;
  await page.route(`${ORIGIN}/`, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><link rel="stylesheet" href="/a.css"><p>text</p>' }),
  );
  await page.route(`${ORIGIN}/a.css`, (route) => {
    asked += 1;
    return asked <= lost ? route.abort(how) : route.fulfill({ contentType: 'text/css', body: 'p { color: rgb(1, 2, 3); }' });
  });
  return () => asked;
}

const colourOfText = (page: Page): Promise<string> => page.locator('p').evaluate((p) => getComputedStyle(p).color);

test('the page is loaded again when the machine lost its stylesheet, and is then whole', async ({ page }) => {
  const asked = await pageWithStylesheet(page, 1, 'connectionfailed');
  const response = await loadWhole(page, () => page.goto(`${ORIGIN}/`), [FAULT]);
  expect(response?.ok()).toBe(true);
  expect(asked()).toBe(2);
  expect(await colourOfText(page)).toBe('rgb(1, 2, 3)');
});

test('a machine that does not recover fails the test for that reason, and names the file', async ({ page }) => {
  const asked = await pageWithStylesheet(page, 99, 'connectionfailed');
  await expect(loadWhole(page, () => page.goto(`${ORIGIN}/`), [FAULT])).rejects.toThrow(/lost a file of the page 3 times: .*a\.css/);
  expect(asked()).toBe(3);
});

test('another failure is the page\'s own: it is not loaded again', async ({ page }) => {
  const asked = await pageWithStylesheet(page, 99, 'blockedbyclient');
  await loadWhole(page, () => page.goto(`${ORIGIN}/`), [FAULT]);
  expect(asked()).toBe(1);
});

test('page.goto of the fixture goes through it, and answers as before', async ({ page }) => {
  const asked = await pageWithStylesheet(page, 0, 'connectionfailed');
  const response = await page.goto(`${ORIGIN}/`);
  expect(response?.ok()).toBe(true);
  expect(asked()).toBe(1);
  // What the runner saw, and nothing wider: a policy that blocks a file is a finding.
  expect(MACHINE_FAULTS).toEqual(['net::ERR_NO_BUFFER_SPACE']);
});

test('the console line of that fault is no finding of a test, any other line stays one', () => {
  expect(isMachineFault('Failed to load resource: net::ERR_NO_BUFFER_SPACE')).toBe(true);
  expect(isMachineFault('Failed to load resource: net::ERR_BLOCKED_BY_CSP')).toBe(false);
  expect(isMachineFault('Failed to load resource: the server responded with a status of 404')).toBe(false);
});
