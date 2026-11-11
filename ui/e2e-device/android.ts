// The way to a real Android phone for the device suite: adb, a reverse port for the hub of the tests and Chrome's
// DevTools socket (the way chrome://inspect works), through a filter that hides the tabs of the person. Nothing here touches a port or a rule it did not set up itself:
// the real hub of the person (17615) and its `adb reverse` stay as they are.

import { execFileSync } from 'node:child_process';
import { chromium, type Browser, type BrowserContext } from '@playwright/test';
import { freePort } from '../e2e/port.ts';
import { startFilter, type FilterProxy } from './cdp-filter.ts';

/** The port of the real hub on this PC; the suite never forwards or removes it. */
export const REAL_HUB_PORT = 17615;

const CHROME = 'com.android.chrome';

export function adb(serial: string | null, ...args: string[]): string {
  const full = serial === null ? args : ['-s', serial, ...args];
  return execFileSync('adb', full, { encoding: 'utf8', timeout: 30_000 });
}

/** An entry of `adb devices` that is a phone over the network (`adb connect <ip>:<port>`, Tailscale), not over USB. */
export function isNetworkSerial(serial: string): boolean {
  return /^[\d.]+:\d+$/.test(serial) || /^\[[0-9a-f:]+\]:\d+$/i.test(serial);
}

/**
 * The phone to test on among the entries adb lists as ready: `ANDROID_SERIAL` when given, else the one phone. A phone on
 * the cable and over the network at once is two entries of one phone (the same `ro.serialno`, asked with `serialOf`):
 * it counts once, by its USB entry. Two phones without `ANDROID_SERIAL` are a reason to skip, so that the suite never
 * picks one by chance.
 */
export function pickDevice(
  ready: readonly string[],
  wanted: string | undefined,
  serialOf: (entry: string) => string | null,
): { serial: string } | { skip: string } {
  if (wanted)
    return ready.includes(wanted) ? { serial: wanted } : { skip: `ANDROID_SERIAL ${wanted} is not connected` };
  if (ready.length === 0)
    return {
      skip: 'no Android device with USB debugging is connected (adb devices)',
    };
  // one entry per phone: an entry whose serial number nobody can tell stays an entry of its own
  const byPhone = new Map<string, string>();
  for (const entry of ready) {
    const phone = ready.length > 1 ? (serialOf(entry) ?? entry) : entry;
    const kept = byPhone.get(phone);
    if (kept === undefined || (isNetworkSerial(kept) && !isNetworkSerial(entry))) byPhone.set(phone, entry);
  }
  if (byPhone.size > 1)
    return {
      skip: `${byPhone.size} devices are connected: set ANDROID_SERIAL to the one to test on`,
    };
  return { serial: [...byPhone.values()][0]! };
}

/** The serial number of the phone behind an entry of `adb devices` (the same for its USB and its network entry). */
function serialNumber(entry: string): string | null {
  try {
    const out = adb(entry, 'shell', 'getprop', 'ro.serialno').trim();
    return out === '' ? null : out;
  } catch {
    return null;
  }
}

/**
 * The phone to test on: `ANDROID_SERIAL` when given, else the one device adb sees (`pickDevice`). No adb or no device
 * is a reason to skip (returned as text).
 */
export function findDevice(env: Record<string, string | undefined>): { serial: string } | { skip: string } {
  let out: string;
  try {
    out = adb(null, 'devices');
  } catch (error) {
    return {
      skip: `adb is not available (${error instanceof Error ? error.message.split('\n')[0] : String(error)})`,
    };
  }
  const ready = out
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === 'device')
    .map(([serial]) => serial!);
  return pickDevice(ready, env['ANDROID_SERIAL'], serialNumber);
}

/** The window in front on the phone: its app (package) and its activity. */
export interface Front {
  pkg: string;
  activity: string;
}

/**
 * The window in front, read from `dumpsys window`: null only when no window has the focus. A focused window without an
 * app component (the notification shade, the lock screen, a popup) is named by its title, with no activity: it is not
 * Chrome, so the phone counts as in use.
 */
export function parseFocus(dumpsys: string): Front | null {
  const focus = /mCurrentFocus=(?:null|Window\{\S+ \S+ ([^}]*)\})/.exec(dumpsys);
  const title = focus?.[1]?.trim();
  if (title === undefined || title === '') return null;
  const slash = title.indexOf('/');
  return slash < 0 ? { pkg: title, activity: '' } : { pkg: title.slice(0, slash), activity: title.slice(slash + 1) };
}

/** The window in front on the phone (its focused window), or null when none has the focus. */
export function foreground(serial: string): Front | null {
  return parseFocus(adb(serial, 'shell', 'dumpsys', 'window'));
}

/**
 * Runs every step of a clean-up, also when one fails (a loose cable fails the first adb call, the next may still
 * matter), and throws the first error afterwards.
 */
export async function cleanUp(steps: (() => unknown)[]): Promise<void> {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) throw errors[0];
}

/**
 * Whether the window is a tab of Chrome itself. An installed web app (WebAPK) or a custom tab of another app runs under
 * Chrome's package as well, but it is an app of the person, and the tabs of the suite stay behind it.
 */
export function chromeTab(front: Front | null): boolean {
  return front?.pkg === CHROME && /\.(ChromeTabbedActivity\d*|Main)$/.test(front.activity);
}

function named(front: Front | null): string {
  return front === null ? 'nothing' : `${front.pkg}/${front.activity}`;
}

/**
 * Fails unless a tab of Chrome is in front. The suite types into its own tab only, never on the screen; but a tab
 * behind another app is paused, and an app in front means the person is using the phone: the run stops and says so.
 */
export function assertChromeInFront(serial: string): void {
  const front = foreground(serial);
  if (!chromeTab(front)) {
    throw new Error(`the phone is in use (${named(front)} is in front, not Chrome): run again when it is free`);
  }
}

/** The home screen of the phone (the launcher), or null when the phone names none. */
function launcher(serial: string): string | null {
  const out = adb(
    serial,
    'shell',
    'cmd',
    'package',
    'resolve-activity',
    '--brief',
    '-a',
    'android.intent.action.MAIN',
    '-c',
    'android.intent.category.HOME',
  );
  const last = out.trim().split(/\r?\n/).pop() ?? '';
  return /^[\w.]+\//.test(last) ? last.split('/')[0]! : null;
}

/**
 * Whether the suite may take the phone: a tab of Chrome, the home screen or nothing is in front. Any other app means
 * the person is using it (also an installed web app, which runs under Chrome's package); then nothing is started or
 * brought to the front.
 */
export function phoneFree(front: Front | null, home: string | null): boolean {
  return front === null || chromeTab(front) || front.pkg === home;
}

/** What the suite set up on the phone, so that the end removes exactly that. */
export interface Phone {
  serial: string;
  hubPort: number;
  devtoolsPort: number;
  filter: FilterProxy;
  browser: Browser;
  context: BrowserContext;
}

/** The hub of the tests is reachable from the phone at 127.0.0.1:port (`adb reverse`), or not any more. */
export function reverse(serial: string, port: number, on: boolean): void {
  if (port === REAL_HUB_PORT) throw new Error(`port ${port} is the real hub: the device suite never touches it`);
  if (on) adb(serial, 'reverse', `tcp:${port}`, `tcp:${port}`);
  else if (adb(serial, 'reverse', '--list').includes(`tcp:${port} tcp:${port}`))
    adb(serial, 'reverse', '--remove', `tcp:${port}`);
}

/**
 * Connects to Chrome on the phone and brings it to the front. Playwright goes through the filter (cdp-filter.ts): it
 * sees the pages the suite opens and nothing else of the person. What is set up is removed again when a step fails.
 */
export async function connect(serial: string, hubPort: number): Promise<Phone> {
  const front = foreground(serial);
  if (!phoneFree(front, launcher(serial))) {
    throw new Error(`the phone is in use (${named(front)} is in front): run again when it is free`);
  }
  // A free phone is handed over to the suite: Chrome comes to the front (a running Chrome only comes forward).
  adb(serial, 'shell', 'am', 'start', '-n', `${CHROME}/com.google.android.apps.chrome.Main`);
  const deadline = Date.now() + 15_000;
  while (!adb(serial, 'shell', 'cat /proc/net/unix').includes('@chrome_devtools_remote')) {
    if (Date.now() > deadline) throw new Error('Chrome on the phone opened no DevTools socket (is USB debugging on?)');
    await new Promise((r) => setTimeout(r, 500));
  }
  const devtoolsPort = await freePort();
  let filter: FilterProxy | null = null;
  adb(serial, 'forward', `tcp:${devtoolsPort}`, 'localabstract:chrome_devtools_remote');
  try {
    reverse(serial, hubPort, true);
    const version = (await (
      await fetch(`http://127.0.0.1:${devtoolsPort}/json/version`, {
        signal: AbortSignal.timeout(10_000),
      })
    ).json()) as {
      webSocketDebuggerUrl: string;
    };
    filter = await startFilter(version.webSocketDebuggerUrl, `http://127.0.0.1:${hubPort}`);
    const browser = await chromium.connectOverCDP(filter.endpoint, {
      timeout: 30_000,
    });
    const context = browser.contexts()[0];
    if (!context) throw new Error('Chrome on the phone has no browser context');
    return { serial, hubPort, devtoolsPort, filter, browser, context };
  } catch (error) {
    // The error of the connect is the one to tell; one of the clean-up would hide it.
    await cleanUp([
      () => filter?.close(),
      () => reverse(serial, hubPort, false),
      () => adb(serial, 'forward', '--remove', `tcp:${devtoolsPort}`),
    ]).catch(() => undefined);
    throw error;
  }
}

/** Removes what `connect` set up: the pages are closed by the tests, the filter, forward and reverse port go here. */
export async function disconnect(phone: Phone): Promise<void> {
  await cleanUp([
    () => phone.browser.close(),
    () => phone.filter.close(),
    () => reverse(phone.serial, phone.hubPort, false),
    () => adb(phone.serial, 'forward', '--remove', `tcp:${phone.devtoolsPort}`),
  ]);
}
