import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { devices } from '@playwright/test';
import { expect, test } from './fixtures';
import { STATE } from './global';
import { devicesCommand, origin, pairingLink } from './hub';

// The phone page (tasks-mobile, mobile.lock) as this hub serves it under /m/: the real binary, the real engine, the
// vault of the tests, with the screen and touch of a phone. The page itself is tested in tasks-mobile on a synthetic
// vault; here it is the way through this hub: the policy of /m/, pairing, the classes of areas.json, and a write.

test.use({
  ...devices['Pixel 7'],
  channel: 'chrome',
  locale: 'en-US',
  // A fake microphone (a tone) and no prompt for it: the voice note of the phone page is recorded for real.
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
});

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
  // The page starts on "Today": the counts are the engine's `by_status` of the snapshot, the picks its `next`.
  await expect(page.getByTestId('today-counts').locator('[data-status="open"] dd')).toHaveText(/^\d+$/);
  await expect(page.getByTestId('today-counts-part')).toHaveCount(0);
  await expect(page.getByTestId('today-next').locator('[data-id]').first()).toBeVisible();
  const picks = await page.getByTestId('today-next').locator('[data-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-id') ?? ''));
  for (const id of picks) expect(['lib.nvim', 'cascade.nvim', 'ALL', 'migrate.nvim', 'nvim-config']).toContain(id.split('/')[0]);
  await page.getByRole('button', { name: 'List', exact: true }).click();
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

  // Finishing through the engine: the engine serves no finished task, so the page goes back to the list and says it
  // is done, never "the PC refused: no such task" (seen on a Fairphone, tasks-mobile 748586a).
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByLabel('Title').fill('Phone finish m002');
  await page.getByLabel('Area').selectOption('lib.nvim');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByTestId('notice')).toContainText('Created');
  await page.getByRole('button', { name: 'List' }).click();
  await page.locator('[data-id="lib.nvim/phone-finish-m002"]').click();
  await page.getByRole('button', { name: 'Finish …' }).click();
  await page.getByRole('button', { name: 'Yes, finish' }).click();
  await expect(page.getByTestId('notice')).toHaveText('Done: “Phone finish m002”');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('[data-id="lib.nvim/phone-finish-m002"]')).toHaveCount(0);
  // A finished task moves within the area; it is there once, finished.
  const finished = readdirSync(join(vault, 'lib.nvim'), { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('phone-finish-m002.md'));
  expect(finished).toHaveLength(1);
  expect(readFileSync(join(vault, 'lib.nvim', finished[0]!), 'utf8')).toMatch(/^status: done$/m);

  // The worker is registered under the policy of /m/ and keeps no route of the hub.
  await page.waitForFunction(async () => (await navigator.serviceWorker.ready).active !== null);
  expect(problems).toEqual([]);
});

test('the phone page names a coming meeting of an internal area without its address to join, writes a line of its minutes, and puts a tick, a photo and a voice note into a public one', async ({
  page,
}) => {
  const problems = watchConsole(page);
  const { vault, config } = state();
  const dir = join(vault, 'lib.nvim', 'MEETINGS');
  mkdirSync(dir, { recursive: true });
  const slug = 'phone-meeting-m003';
  const file = join(dir, `${slug}.md`);
  // A meeting of a public area (cascade.nvim): its people reach the phone, which ticks one; a photo and a voice note
  // go into its minutes through the upload of the hub.
  const pubDir = join(vault, 'cascade.nvim', 'MEETINGS');
  mkdirSync(pubDir, { recursive: true });
  const pubSlug = 'phone-meeting-m004';
  const pubFile = join(pubDir, `${pubSlug}.md`);
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  writeFileSync(
    file,
    `---\ntitle: Phone meeting m003\nstatus: planned\ndate: ${day}\ntime: "23:30"\nduration: 15m\nonline: https://teams.microsoft.com/l/meetup-join/m003\n---\n\nA meeting of one phone test.\n\n## Teilnehmer\n\n- [ ] Rick <rick@example.org>\n\n## Protokoll\n`,
  );
  writeFileSync(
    pubFile,
    `---\ntitle: Phone meeting m004\nstatus: planned\ndate: ${day}\ntime: "23:40"\nduration: 15m\n---\n\nA public meeting of one phone test.\n\n## Teilnehmer\n\n- [ ] Rita <rita@example.org>\n\n## Protokoll\n`,
  );
  try {
    // The hub holds the meetings for the state of the vault it last read: the phone is paired once the hub sees the file
    // just written (asked with the PC's session). Not by loading the phone page again: every start of a paired phone
    // is a sign-in of its device, and the hub limits those (a later test would get 429).
    const token = (JSON.parse(readFileSync(STATE, 'utf8')) as { token: string }).token;
    // The very question the phone page asks (today and the 13 days after it, `MEETING_DAYS` of tasks-mobile): the hub
    // holds an answer per question and state of the vault, so only this one tells what the phone will get.
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 14);
    const until = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    await expect
      .poll(
        async () => {
          const r = await page.request.get(`${origin()}/api/tasks/meetings?since=${day}&until=${until}&limit=100`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const text = r.ok() ? await r.text() : '';
          return text.includes(`lib.nvim/${slug}`) && text.includes(`cascade.nvim/${pubSlug}`);
        },
        { timeout: 20_000 },
      )
      .toBe(true);
    await page.goto(pairingLink(config).replace('/#pair=', '/m/#pair='));
    await expect(page.getByTestId('connection')).toHaveAttribute('data-state', 'live');
    const row = page.getByTestId('meetings').locator(`[data-meeting="lib.nvim/${slug}"]`);
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByTestId('meeting-title')).toContainText('Phone meeting m003');
    // lib.nvim is internal and the hub's settings let no address of it out: no Join, no people.
    await expect(page.getByTestId('join')).toHaveCount(0);
    expect(await page.content()).not.toContain('rick@example.org');
    await page.getByTestId('minutes-line').fill('Notiz vom Handy m003');
    await page.getByRole('button', { name: 'Note', exact: true }).click();
    await expect(page.getByTestId('minutes')).toContainText('Notiz vom Handy m003');
    expect(readFileSync(file, 'utf8')).toMatch(/## Protokoll\s+- \d\d:\d\d Notiz vom Handy m003/);

    // The public meeting, opened inside the page (no second start: that would be another sign-in of the device).
    await page.getByRole('button', { name: '← Meetings' }).click();
    await page.locator(`[data-meeting="cascade.nvim/${pubSlug}"]`).first().click();
    await expect(page.getByTestId('meeting-title')).toContainText('Phone meeting m004');
    const rita = page.getByRole('checkbox', { name: 'Rita present' });
    await expect(rita).not.toBeChecked();
    expect(await page.content()).not.toContain('rita@example.org');
    await rita.click();
    await expect(rita).toBeChecked();
    // A photo from the camera: to the meeting as an image, then its line of the minutes.
    const png = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5ad6f0b0000000049454e44ae426082',
      'hex',
    );
    await page.getByTestId('meeting-photo-input').setInputFiles({ name: 'IMG_0001.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByTestId('minutes')).toContainText(/Photo: photo-\d{4}-\d{2}-\d{2}-\d{4}-[A-Za-z0-9]{6}\.png/, { timeout: 15_000 });
    // A voice note from the (fake) microphone, granted without a prompt (else the question of Chrome may stay open):
    // as an audio file.
    await page.context().grantPermissions(['microphone'], { origin: origin() });
    await page.getByTestId('meeting-voice').click();
    await expect(page.getByTestId('meeting-voice-stop')).toBeVisible();
    await page.waitForTimeout(1200);
    await page.getByTestId('meeting-voice-stop').click();
    await expect(page.getByTestId('minutes')).toContainText(/Voice note: voice-.*\.webm/, { timeout: 15_000 });
    // The meeting took the folder form: the files lie in the folders of their kinds, the minutes link them.
    const folder = join(pubDir, pubSlug);
    const text = readFileSync(join(folder, `${pubSlug}.md`), 'utf8');
    expect(text).toMatch(/^- \[x\] Rita/m);
    const photo = /\]\((assets\/images\/photo-[^)]+\.png)\)/.exec(text)?.[1];
    const voice = /\]\((assets\/audio\/voice-[^)]+\.webm)\)/.exec(text)?.[1];
    expect(photo, text).toBeTruthy();
    expect(voice, text).toBeTruthy();
    expect(readFileSync(join(folder, photo!))).toEqual(png);
    expect(existsSync(join(folder, voice!))).toBe(true);
    await expect(page.getByTestId('queue')).toHaveCount(0);
    expect(problems).toEqual([]);
  } finally {
    rmSync(join(dir, slug), { recursive: true, force: true });
    rmSync(file, { force: true });
    rmSync(join(pubDir, pubSlug), { recursive: true, force: true });
    rmSync(pubFile, { force: true });
  }
});

test('the phone page shows a learning path cut by the hub and ticks a point through the engine', async ({ page }) => {
  const problems = watchConsole(page);
  const { vault, config } = state();
  const file = join(vault, 'lib.nvim', 'ROADMAP', 'paths', 'lua-lernen.md');
  const before = readFileSync(file, 'utf8');
  try {
    await page.goto(pairingLink(config).replace('/#pair=', '/m/#pair='));
    await expect(page.getByTestId('connection')).toHaveAttribute('data-state', 'live');
    await page.getByRole('button', { name: 'Learn', exact: true }).click();
    const list = page.getByTestId('paths');
    await expect(list.getByRole('button', { name: /Lua lernen/ })).toBeVisible();
    await list.getByRole('button', { name: /Lua lernen/ }).click();
    await expect(page.getByTestId('path-title')).toContainText('Lua lernen');
    // The engine's tree as the hub cut it: a link of a point is a web address, its note and reason are there.
    const manual = page.locator('[data-point="manual"]');
    await expect(manual.getByRole('link')).toHaveAttribute('href', 'https://www.lua.org/manual/5.4/');
    await expect(manual).toContainText('Operatorrangfolge');
    await expect(page.locator('[data-point="pil"]')).toContainText('nur Kap. 1 gebraucht');

    // Ticked on the phone, written by the engine into the file of the path.
    const meta = page.locator('[data-point="meta"]');
    await meta.getByRole('button', { name: 'Learned' }).click();
    await expect(meta).toHaveAttribute('data-state', 'learned');
    expect(readFileSync(file, 'utf8')).toMatch(/- \[x\] Metatables \{#meta\}/);
    expect(problems).toEqual([]);
  } finally {
    writeFileSync(file, before);
  }
});

test('the phone captures a task with a photo and a voice note, and both land in the vault as its assets', async ({ newContext }) => {
  const { vault, config } = state();
  // Chrome's fake microphone (a tone), granted without a prompt: the note is recorded for real, under the hub's policy.
  const phone = await newContext({ ...devices['Pixel 7'], locale: 'en-US', baseURL: origin(), permissions: ['microphone'] });
  try {
    const page = await phone.newPage();
    const problems = watchConsole(page);
    // The page asks for the exact name of each file (`exact=1`): a taken name is `exists`, the file already arrived.
    const uploads: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/tasks/upload')) uploads.push(r.url());
    });
    const response = await page.goto(pairingLink(config).replace('/#pair=', '/m/#pair='));
    expect(response?.headers()['permissions-policy']).toContain('microphone=(self)');
    expect(response?.headers()['content-security-policy']).toContain("media-src 'self' blob:");
    await expect(page.getByTestId('connection')).toHaveAttribute('data-state', 'live');
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByLabel('Title').fill('Phone files m003');
    await page.getByLabel('Area').selectOption('lib.nvim');
    const png = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5ad6f0b0000000049454e44ae426082',
      'hex',
    );
    await page.getByTestId('photo-input').setInputFiles({ name: 'IMG_0001.png', mimeType: 'image/png', buffer: png });
    await page.getByTestId('voice-start').click();
    await page.waitForTimeout(1200);
    await page.getByTestId('voice-stop').click();
    await expect(page.getByTestId('attachments').locator('li')).toHaveCount(2);
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByTestId('notice')).toContainText('Created', { timeout: 15_000 });
    const assets = join(vault, 'lib.nvim', 'ROADMAP', 'tasks', 'phone-files-m003', 'assets');
    await expect.poll(() => (existsSync(assets) ? readdirSync(assets).sort() : []), { timeout: 15_000 }).toEqual([
      expect.stringMatching(/^photo-.*\.png$/),
      expect.stringMatching(/^voice-.*\.webm$/),
    ]);
    const photo = readdirSync(assets).find((f) => f.startsWith('photo-'))!;
    expect(readFileSync(join(assets, photo)).equals(png)).toBe(true);
    expect(uploads).toHaveLength(2);
    for (const url of uploads) expect(new URL(url).searchParams.get('exact')).toBe('1');
    await page.getByRole('button', { name: /Waiting/ }).click();
    await expect(page.getByText('Nothing waits.')).toBeVisible();
    expect(problems).toEqual([]);
  } finally {
    await phone.close();
  }
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

test('a paired phone signs in by itself on the next start, until the PC revokes it', async ({ page, newContext }) => {
  const { config } = state();
  // A browser profile of its own: the phone, with its own storage.
  const phone = await newContext({ ...devices['Pixel 7'], locale: 'en-US', baseURL: origin() });
  try {
    const first = await phone.newPage();
    const problems = watchConsole(first);
    await first.goto(pairingLink(config).replace('/#pair=', '/m/#pair='));
    await expect(first.getByTestId('connection')).toHaveAttribute('data-state', 'live');
    await first.close();

    // The app is opened again: a new page, no session in it, the device key in IndexedDB.
    const again = await phone.newPage();
    problems.push(...watchConsole(again));
    await again.goto('/m/');
    await expect(again.getByTestId('connection')).toHaveAttribute('data-state', 'live');
    await expect(again.getByRole('heading', { name: 'Connect to the PC' })).toHaveCount(0);

    // The PC lists the phone and revokes it: the next start asks for pairing and says why.
    const list = devicesCommand(config);
    expect(list).toContain('Phone');
    // The newest device is this phone (the list is in the order the devices were paired; other tests pair too).
    const id = list.trim().split(/\r?\n/).at(-1)?.split(/\s+/)[0] ?? '';
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(devicesCommand(config, 'revoke', id)).toContain('revoked');
    await again.reload();
    await expect(again.getByRole('heading', { name: 'Connect to the PC' })).toBeVisible();
    await expect(again.getByTestId('notice')).toContainText('disconnected on the PC');
    // Only the refused session of the revoked device may show in the console.
    expect(problems.filter((p) => !p.includes('401'))).toEqual([]);
  } finally {
    await phone.close();
  }
});
