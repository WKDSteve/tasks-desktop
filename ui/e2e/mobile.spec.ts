import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { devices } from '@playwright/test';
import { expect, test } from './fixtures';
import { STATE } from './global';
import { pairingLink } from './hub';

// The phone page (tasks-mobile, mobile.lock) as this hub serves it under /m/: the real binary, the real engine, the
// vault of the tests, with the screen and touch of a phone. The page itself is tested in tasks-mobile on a synthetic
// vault; here it is the way through this hub: the policy of /m/, pairing, the classes of areas.json, and a write.

test.use({ ...devices['Pixel 7'], channel: 'chrome', locale: 'en-US' });

interface State {
  vault: string;
  config: string;
}

const state = (): State => JSON.parse(readFileSync(STATE, 'utf8')) as State;

function watchConsole(page: import('@playwright/test').Page): string[] {
  const lines: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') lines.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => lines.push(`pageerror: ${e.message}`));
  return lines;
}

test('the phone page pairs, shows only the classified areas and creates a task through the engine', async ({ page }) => {
  const problems = watchConsole(page);
  const { vault, config } = state();
  // `tasks-hub open` prints the link of the desktop page; the phone opens the same code under /m/.
  const response = await page.goto(pairingLink(config).replace('/#pair=', '/m/#pair='));
  const csp = response?.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("worker-src 'self'");
  expect(csp).toContain('trusted-types svelte-trusted-html tasks-mobile-worker');
  // The code leaves the address at once.
  expect(new URL(page.url()).hash).toBe('');
  await expect(page.getByTestId('connection')).toHaveAttribute('data-state', 'live');
  // Every area of the test vault has a class in areas.json (public or internal), so nothing is left out and the page
  // says no part is missing; an unclassified area is left out by the page (tested in tasks-mobile on its own vault).
  await expect(page.getByTestId('partial')).toHaveCount(0);
  const ids = await page.getByTestId('task-list').locator('[data-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-id') ?? ''));
  expect(ids.length).toBeGreaterThan(0);
  for (const id of ids) expect(['lib.nvim', 'cascade.nvim', 'ALL', 'migrate.nvim', 'nvim-config']).toContain(id.split('/')[0]);

  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByLabel('Title').fill('Phone capture m001');
  await page.getByLabel('Area').selectOption('lib.nvim');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByTestId('notice')).toContainText('Created');
  expect(existsSync(join(vault, 'lib.nvim', 'ROADMAP', 'tasks', 'phone-capture-m001.md'))).toBe(true);
  await page.getByRole('button', { name: 'List' }).click();
  await expect(page.locator('[data-id="lib.nvim/phone-capture-m001"]')).toBeVisible();

  // A change on the PC after the phone read the task: setting a status is a conflict, the file is not overwritten.
  await page.locator('[data-id="lib.nvim/phone-capture-m001"]').click();
  // The page has read the task (its version) before the PC changes it.
  await expect(page.getByTestId('task-body')).toBeVisible();
  const file = join(vault, 'lib.nvim', 'ROADMAP', 'tasks', 'phone-capture-m001.md');
  const changed = `${readFileSync(file, 'utf8')}\nChanged on the PC m001.\n`;
  writeFileSync(file, changed);
  await page.getByLabel('Status').selectOption('doing');
  await page.getByRole('button', { name: 'Set status' }).click();
  await page.getByRole('button', { name: /Waiting/ }).click();
  await expect(page.getByTestId('queue').locator('li')).toHaveAttribute('data-state', 'conflict');
  expect(readFileSync(file, 'utf8')).toBe(changed);
  await page.getByRole('button', { name: 'Drop' }).click();

  // The worker is registered under the policy of /m/ and keeps no route of the hub.
  await page.waitForFunction(async () => (await navigator.serviceWorker.ready).active !== null);
  expect(problems).toEqual([]);
});

test('the desktop page keeps its policy, and /m without a slash is not the page', async ({ page }) => {
  const desk = await page.request.get('/');
  expect(desk.headers()['content-security-policy']).not.toContain('worker-src');
  expect((await page.request.get('/m')).status()).toBe(404);
  expect((await page.request.get('/m/nope.js')).status()).toBe(404);
  const manifest = await page.request.get('/m/manifest.webmanifest');
  expect(manifest.headers()['content-type']).toBe('application/manifest+json');
  // Every icon the manifest names is served from /m/icons/, the PNGs (maskable, monochrome) as PNG.
  const icons = ((await manifest.json()) as { icons: { src: string }[] }).icons.map((i) => i.src);
  expect(icons.some((src) => src.endsWith('.png'))).toBe(true);
  for (const src of icons) {
    const icon = await page.request.get(new URL(src, 'http://x/m/').pathname);
    expect(icon.status(), src).toBe(200);
    expect(icon.headers()['content-type'], src).toBe(src.endsWith('.png') ? 'image/png' : 'image/svg+xml');
  }
});
