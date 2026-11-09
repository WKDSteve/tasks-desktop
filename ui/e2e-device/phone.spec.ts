import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { STATE } from '../e2e/global';
import { origin, pairingLink, port } from '../e2e/hub';
import {
  assertChromeInFront,
  chromeTab,
  connect,
  disconnect,
  findDevice,
  foreground,
  reverse,
  REAL_HUB_PORT,
  type Phone,
} from './android';

// The hand test of the phone page as a suite on a real Android phone (Chrome over adb): pairing, a restart, create,
// status, conflict, finish, the share target, offline and sending, unpair. The hub is the one of the tests (its own
// vault, its own port, see e2e/hub.ts); the phone reaches it through `adb reverse`. Playwright drives the page over
// Chrome's DevTools socket: input goes to that one page, never to the screen, so no other app of the person gets a tap.
// The page lives under the port of the run, an origin of its own; its data is deleted before and after.

test.describe.configure({ mode: 'serial' });

interface State {
  vault: string;
  config: string;
}

const state = (): State => JSON.parse(readFileSync(STATE, 'utf8')) as State;
const device = findDevice(process.env);
let phone: Phone | null = null;
let page: Page;
let network: CDPSession | null = null;

/** Deletes everything the page of this origin keeps on the phone (key, copy, queue, worker). */
async function clearOrigin(p: Phone): Promise<void> {
  // Through a tab of the suite: Chrome on Android refuses it on the browser session ("Internal error").
  const blank = await p.context.newPage();
  try {
    const cdp = await p.context.newCDPSession(blank);
    await cdp.send('Storage.clearDataForOrigin', {
      origin: origin(),
      storageTypes: 'all',
    });
  } finally {
    await blank.close();
  }
}

/** A new tab of the suite, in English whatever the phone's language is (the texts below are the English ones). */
async function openPage(p: Phone, url: string): Promise<Page> {
  const fresh = await p.context.newPage();
  const cdp = await p.context.newCDPSession(fresh);
  const userAgent = await fresh.evaluate(() => navigator.userAgent);
  await cdp.send('Emulation.setUserAgentOverride', {
    userAgent,
    acceptLanguage: 'en-US',
  });
  await fresh.goto(url);
  // The tab of the suite is the one Chrome shows: a tab behind another one is paused (no frames, so a click waits for
  // ever). Chrome on Android does not always switch at the first ask.
  await expect
    .poll(
      async () => {
        await fresh.bringToFront();
        return fresh.evaluate(() => document.visibilityState);
      },
      { message: 'the tab of the suite is not shown on the phone', timeout: 15_000 },
    )
    .toBe('visible');
  return fresh;
}

/**
 * The PC is out of reach, or back: the reverse port goes (as when the cable or the tunnel goes) and the page is offline
 * (a connection Chrome already holds outlives the reverse port, so that alone does not cut the page off).
 */
async function reachable(on: boolean): Promise<void> {
  reverse(phone!.serial, phone!.hubPort, on);
  // The session stays open: detaching it would end the emulation again.
  network ??= await page.context().newCDPSession(page);
  await network.send('Network.enable');
  await network.send('Network.emulateNetworkConditions', {
    offline: !on,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
}

function taskFile(slug: string): string {
  return join(state().vault, 'lib.nvim', 'ROADMAP', 'tasks', `${slug}.md`);
}

async function create(title: string): Promise<void> {
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Area').selectOption('lib.nvim');
  await page.getByRole('button', { name: 'Create' }).click();
}

test.beforeAll(async () => {
  // The list reporter does not print the reason of a skip: said here, so that a run without a phone is never silently
  // green.
  if ('skip' in device)
    console.warn(`
DEVICE SUITE SKIPPED: ${device.skip}
`);
  test.skip('skip' in device, 'skip' in device ? `device suite skipped: ${device.skip}` : '');
  if (!('serial' in device)) return;
  if (port() === REAL_HUB_PORT)
    throw new Error(`the hub of the tests must not take port ${REAL_HUB_PORT} (the real hub)`);
  phone = await connect(device.serial, port());
  await clearOrigin(phone);
});

test.beforeEach(() => {
  if (phone) assertChromeInFront(phone.serial);
});

test.afterAll(async () => {
  if (!phone) return;
  try {
    // A tab behind another app is paused: closing it or deleting the data would wait forever.
    if (chromeTab(foreground(phone.serial))) {
      for (const p of phone.context.pages()) if (p.url().startsWith(origin())) await p.close();
      await clearOrigin(phone);
    } else {
      console.warn(`
DEVICE SUITE: Chrome is not in front any more, the tabs of ${origin()} stay open on the phone
`);
    }
  } finally {
    await disconnect(phone);
    phone = null;
  }
});

test('pairs through a pairing link', async () => {
  page = await openPage(phone!, pairingLink(state().config).replace('/#pair=', '/m/#pair='));
  await expect(page.getByTestId('connection')).toHaveAttribute('data-state', 'live', { timeout: 15_000 });
  expect(new URL(page.url()).hash).toBe('');
  await expect(page.getByTestId('task-list').locator('[data-id]').first()).toBeVisible();
});

test('signs in by itself after a restart, without pairing again', async () => {
  await page.close();
  network = null;
  page = await openPage(phone!, `${origin()}/m/`);
  await expect(page.getByTestId('connection')).toHaveAttribute('data-state', 'live', { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Connect to the PC' })).toHaveCount(0);
});

test('creates a task and sets its status', async () => {
  await create('Device capture d001');
  await expect(page.getByTestId('notice')).toHaveText('Created: “Device capture d001”');
  expect(existsSync(taskFile('device-capture-d001'))).toBe(true);
  await page.getByRole('button', { name: 'List' }).click();
  await page.locator('[data-id="lib.nvim/device-capture-d001"]').click();
  await expect(page.getByTestId('task-body')).toBeVisible();
  await page.getByLabel('Status').selectOption('doing');
  await page.getByRole('button', { name: 'Set status' }).click();
  await expect.poll(() => readFileSync(taskFile('device-capture-d001'), 'utf8')).toMatch(/^status: doing$/m);
});

test('a change on the PC is a conflict, nothing is overwritten', async () => {
  await page.getByRole('button', { name: 'List' }).click();
  await page.locator('[data-id="lib.nvim/device-capture-d001"]').click();
  await expect(page.getByTestId('task-body')).toBeVisible();
  const file = taskFile('device-capture-d001');
  const changed = `${readFileSync(file, 'utf8')}\nChanged on the PC d001.\n`;
  writeFileSync(file, changed);
  await page.getByLabel('Status').selectOption('blocked');
  await page.getByRole('button', { name: 'Set status' }).click();
  await page.getByRole('button', { name: /Waiting/ }).click();
  await expect(page.getByTestId('queue').locator('li')).toHaveAttribute('data-state', 'conflict');
  expect(readFileSync(file, 'utf8')).toBe(changed);
  await page.getByRole('button', { name: 'Drop' }).click();
  await expect(page.getByTestId('queue').locator('li')).toHaveCount(0);
});

test('finishes a task after the preview and goes back to the list', async () => {
  await create('Device finish d002');
  await expect(page.getByTestId('notice')).toHaveText('Created: “Device finish d002”');
  await page.getByRole('button', { name: 'List' }).click();
  await page.locator('[data-id="lib.nvim/device-finish-d002"]').click();
  await page.getByRole('button', { name: 'Finish …' }).click();
  await expect(page.getByTestId('done-preview')).toBeVisible();
  await page.getByRole('button', { name: 'Yes, finish' }).click();
  await expect(page.getByTestId('notice')).toHaveText('Done: “Device finish d002”');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('[data-id="lib.nvim/device-finish-d002"]')).toHaveCount(0);
  const finished = readdirSync(join(state().vault, 'lib.nvim'), {
    recursive: true,
    encoding: 'utf8',
  }).filter((f) => f.endsWith('device-finish-d002.md'));
  expect(finished).toHaveLength(1);
  expect(readFileSync(join(state().vault, 'lib.nvim', finished[0]!), 'utf8')).toMatch(/^status: done$/m);
});

test('a shared link fills the form and creates nothing', async () => {
  // What Chrome opens for a share to the installed app: the share_target of the manifest (GET, these names).
  const query = new URLSearchParams({
    share_title: 'Device share d003',
    share_url: 'https://example.org/d003',
  });
  await page.goto(`${origin()}/m/?${query}`);
  await expect(page.getByTestId('from-share')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel('Title')).toHaveValue('Device share d003');
  await expect(page.getByLabel(/context/i)).toHaveValue(/https:\/\/example\.org\/d003/);
  expect(existsSync(taskFile('device-share-d003'))).toBe(false);
});

test('offline, a new task waits and is sent when the PC is back', async () => {
  await reachable(false);
  await create('Device offline d004');
  await expect(page.getByTestId('notice')).toHaveText('Waiting for the PC: “Device offline d004”', { timeout: 15_000 });
  await page.getByRole('button', { name: /Waiting/ }).click();
  await expect(page.getByTestId('queue').locator('li')).toHaveAttribute('data-state', 'waiting');
  expect(existsSync(taskFile('device-offline-d004'))).toBe(false);
  // Back online: the page sends by itself (the `online` event), "Send now" is the way when it does not.
  await reachable(true);
  await expect(page.getByTestId('queue').locator('li')).toHaveCount(0, {
    timeout: 15_000,
  });
  expect(existsSync(taskFile('device-offline-d004'))).toBe(true);
});

test('unpairing deletes the list and what waits', async () => {
  await reachable(false);
  await create('Device unpair d005');
  await expect(page.getByTestId('notice')).toHaveText('Waiting for the PC: “Device unpair d005”', { timeout: 15_000 });
  await page.getByRole('button', { name: /Waiting/ }).click();
  await page.getByRole('button', { name: 'Disconnect and delete the data' }).click();
  await page.getByTestId('forget-confirm').getByRole('button', { name: 'Disconnect and delete the data' }).click();
  await expect(page.getByRole('heading', { name: 'Connect to the PC' })).toBeVisible();
  await reachable(true);
  // A reload with the PC reachable again: nothing is left to send, and no list without pairing.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Connect to the PC' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('task-list')).toHaveCount(0);
  await page.waitForTimeout(2_000);
  expect(existsSync(taskFile('device-unpair-d005'))).toBe(false);
});
