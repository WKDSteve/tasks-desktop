import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expectAccessible, watchViolations } from './a11y';
import { expect, test } from './fixtures';
import { env, exe, prepareVault } from './hub';
import { freePort } from './port';
import { removeTree } from '../web/tmp.mjs';

// The page when its hub ends, and when a new one is started in its place. The hub all the tests share must not end,
// so this one has a hub of its own: its own vault and settings, a free port. It is ended and started again the way a
// hub in the background ends itself and a double click starts it anew (another instance, which knows no old session).

test.use({ locale: 'en-US' });

interface OwnHub {
  child: ChildProcess;
  origin: string;
}

async function startOwn(config: string, port: number): Promise<OwnHub> {
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(exe, ['serve'], { env: { ...env(config), TASKS_DESKTOP_PORT: String(port) }, stdio: 'ignore' });
  const deadline = Date.now() + 20_000;
  for (;;) {
    const ready = await fetch(`${origin}/api/tasks/hello`).then(
      async (r) => r.ok && ((await r.json()) as { engine: { ready: boolean } }).engine.ready,
      () => false,
    );
    if (ready && existsSync(join(config, 'hub.json'))) break;
    if (Date.now() > deadline) {
      child.kill();
      throw new Error('the hub of this test did not come up');
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { child, origin };
}

async function endOwn(hub: OwnHub): Promise<void> {
  if (hub.child.exitCode !== null || hub.child.signalCode !== null) return;
  const gone = new Promise<void>((done) => hub.child.once('exit', () => done()));
  hub.child.kill();
  let giveUp: NodeJS.Timeout | undefined;
  await Promise.race([gone, new Promise((done) => (giveUp = setTimeout(done, 10_000)))]);
  clearTimeout(giveUp);
}

/** The link `tasks-hub open` prints for the hub of `config` on `port`. */
function linkOf(config: string, port: number): string {
  const out = execFileSync(exe, ['open'], { env: { ...env(config), TASKS_DESKTOP_PORT: String(port) }, encoding: 'utf8' });
  const link = out.trim().split(/\r?\n/)[0] ?? '';
  if (!link.startsWith(`http://127.0.0.1:${port}/#pair=`)) throw new Error(`unexpected link: ${link}`);
  return link;
}

test('a page whose hub ends says so and keeps what was typed; a new hub takes the page with its new link', async ({ page }) => {
  // Two starts of a hub with its engine, and the page waits for its probes in between.
  test.slow();
  const { root, config } = prepareVault();
  const port = await freePort();
  let hub = await startOwn(config, port);
  try {
    await watchViolations(page);
    await page.goto(linkOf(config, port));
    await expect(page.getByRole('menubar')).toBeVisible();
    const notice = page.locator('.hub-notice');
    await expect(notice).toBeAttached();
    await expect(notice).toHaveText('');

    // Something typed and not saved: the form of a new task, with a title.
    await page.keyboard.press('c');
    const capture = page.getByRole('dialog', { name: 'New task' });
    await capture.getByLabel('Title').fill('Typed before the hub ended');

    // The hub ends (as one in the background does ten minutes after its last page).
    await endOwn(hub);
    await expect(notice).toContainText('The hub is not running any more', { timeout: 30_000 });
    await expect(notice).toContainText('tasks-hub start --open');
    await expect(notice).toHaveAttribute('role', 'status');
    // No toast in a loop, the page is not emptied, and what was typed stands.
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);
    await expect(capture.getByLabel('Title')).toHaveValue('Typed before the hub ended');
    await expectAccessible(page, 'the page whose hub is gone');

    // A new hub is started on the same port: another instance, it does not know the session of this tab.
    hub = await startOwn(config, port);
    await expect(notice).toContainText('The hub was started anew', { timeout: 30_000 });
    await expect(notice).toContainText('tasks-hub open');
    await expect(page.getByRole('menubar')).toBeVisible();
    await expect(capture.getByLabel('Title')).toHaveValue('Typed before the hub ended');
    await expectAccessible(page, 'the page that waits for the link of a new hub');

    // The new link, pasted into this tab (the browser changes only the fragment): the page goes on where it stood.
    const code = linkOf(config, port).split('#pair=')[1] ?? '';
    await page.evaluate((c) => {
      window.location.hash = `#pair=${c}`;
    }, code);
    await expect(notice).toHaveText('', { timeout: 30_000 });
    await expect(capture.getByLabel('Title')).toHaveValue('Typed before the hub ended');
    // And it writes again: the task that was typed before the hub ended is created by the new one.
    await capture.locator('select').first().selectOption('lib.nvim');
    await capture.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('status').getByText('Saved.')).toBeVisible({ timeout: 15_000 });
  } finally {
    await endOwn(hub);
    removeTree(root, { retries: 30, delay: 200 });
  }
});
