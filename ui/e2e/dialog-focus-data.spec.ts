import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { violations, watchViolations } from './a11y';
import { aiDesktopDoubleIn } from './ai-desktop';
import { STATE } from './global';
import { chooseFromMenu } from './menu';

// The rest of the dialogs of the raster (`dialog-focus.spec.ts`): the ones that need files of their own in the vault or a
// double of ai-desktop. Each case: the focus goes into the dialog, Escape closes it (an open hint takes the first one),
// the focus is back on what opened it and not on the body. Every case writes only its own files and removes them again.

test.use({ locale: 'en-US', viewport: { width: 1100, height: 700 } });

const state = (): { token: string; vault: string; config: string } =>
  JSON.parse(readFileSync(STATE, 'utf8')) as { token: string; vault: string; config: string };
const lib = (...parts: string[]): string => join(state().vault, 'lib.nvim', ...parts);

async function pair(page: Page, start: string): Promise<void> {
  await watchViolations(page);
  await page.addInitScript((token) => sessionStorage.setItem('tasks-desktop.session', token), state().token);
  await page.goto(start);
  await expect(page.getByRole('menubar')).toBeVisible();
}

/** The hub reads a file that appears when its watcher tells it: wait until the snapshot of the page holds the task. */
async function known(page: Page, id: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const r = await page.request.get('/api/tasks/snapshot', { headers: { Authorization: `Bearer ${state().token}` } });
        return r.ok() && (await r.text()).includes(`"${id}"`);
      },
      { timeout: 20_000 },
    )
    .toBe(true);
}

/** The shared case: `open` opens the dialog, then in, Escape out, and the focus on `back`. */
async function dialogCase(page: Page, name: string | RegExp, open: () => Promise<void>, back: Locator): Promise<void> {
  await open();
  const dialog = page.getByRole('dialog', { name });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  expect(await violations(page)).toEqual([]);
  // A hint that is open on the focused element takes the first Escape (WCAG 1.4.13); the dialog the next.
  await page.keyboard.press('Escape');
  if (await dialog.count()) await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(back).toBeFocused();
}

const day = (): string => {
  const now = new Date();
  const two = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
};

test('the page of a contact: the focus goes in, Escape closes it, the focus is back on the contact', async ({ page }) => {
  const file = lib('CONTACTS', 'focus-e2e-c.md');
  mkdirSync(lib('CONTACTS'), { recursive: true });
  writeFileSync(file, `---\nname: "Focus E2e Contact"\norg: "E2e GmbH"\ntags: [e2e]\n---\n\nKnows the old setup.\n`);
  try {
    await pair(page, '/#view=contacts');
    const contact = page.locator('[data-contact="lib.nvim/focus-e2e-c"]');
    await expect(contact).toBeVisible();
    await dialogCase(page, 'Focus E2e Contact', () => contact.click(), contact);
  } finally {
    rmSync(file, { force: true });
  }
});

/** A meeting that is on now: its page opens from the task, and the board of the minutes from its page. */
async function withMeeting(slug: string, title: string, run: () => Promise<void>): Promise<void> {
  const meetings = lib('MEETINGS');
  mkdirSync(meetings, { recursive: true });
  const file = join(meetings, `${slug}.md`);
  const now = new Date();
  const two = (n: number) => String(n).padStart(2, '0');
  const begins = new Date(Math.max(now.getTime() - 30 * 60_000, new Date(`${day()}T00:00:00`).getTime()));
  writeFileSync(
    file,
    `---\ntitle: ${title}\nstatus: planned\ndate: ${day()}\ntime: "${two(begins.getHours())}:${two(begins.getMinutes())}"\nduration: 3h\ntasks: [lib.nvim/alpha]\n---\n\nA meeting of one browser test.\n`,
  );
  try {
    await run();
  } finally {
    rmSync(file, { force: true });
    rmSync(join(meetings, slug), { force: true, recursive: true });
  }
}

test('the page of a meeting and its board: each gives the focus back to the button that opened it', async ({ page }) => {
  await withMeeting('focus-e2e-m005', 'Focus e2e m005', async () => {
    await pair(page, '/#view=list');
    await page.locator('button.row', { hasText: 'lib.nvim/alpha' }).first().click();
    const detail = page.locator('aside.detail');
    const meeting = detail.getByRole('button', { name: 'Focus e2e m005' });
    await expect(meeting).toBeVisible();
    await dialogCase(page, /Focus e2e m005/, () => meeting.click(), meeting);
    // The board is opened from the page of the meeting; the page stays under it.
    await meeting.click();
    const meetingPage = page.getByRole('dialog', { name: /Focus e2e m005/ });
    const board = meetingPage.getByRole('button', { name: '✎ Board' });
    await dialogCase(page, /^Board board-/, () => board.click(), board);
  });
});

test('an image shown larger: the focus goes in, Escape closes it, the focus is back on the image', async ({ page }) => {
  const slug = 'focus-e2e-img';
  const folder = lib('ROADMAP', 'tasks', slug);
  mkdirSync(join(folder, 'assets', 'images'), { recursive: true });
  // The smallest PNG: one transparent pixel.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  writeFileSync(join(folder, 'assets', 'images', 'dot.png'), png);
  writeFileSync(join(folder, `${slug}.md`), `---\ntitle: Focus e2e img\nstatus: open\ncreated: 2026-11-20\nupdated: 2026-11-20\n---\n\nA dot: ![A dot](assets/images/dot.png)\n`);
  try {
    await known(page, `lib.nvim/${slug}`);
    await pair(page, `/#task=lib.nvim%2F${slug}`);
    const image = page.locator('aside.detail .prose').getByRole('button', { name: 'A dot' });
    await expect(image).toBeVisible();
    await dialogCase(page, 'Image: A dot', () => image.click(), image);
  } finally {
    rmSync(folder, { force: true, recursive: true });
  }
});

test('the exercise of a learning point: the focus goes in, Escape closes it, the focus is back on the title of the point', async ({ page }) => {
  const slug = 'focus-e2e-path';
  const dir = lib('ROADMAP', 'paths');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${slug}.md`);
  writeFileSync(
    file,
    `---\ntitle: Focus path e2e\nstatus: doing\n---\n\nA learning path of one browser test.\n\n## Lernpunkte\n\n- [ ] Stage one {#stage}\n  - [ ] Üben: Verzeichnis anzeigen foc2e {#ls}\n    > **Aufgabe:** Lege im Übungsordner drei Dateien an.\n    > **Fertig, wenn:** Du nennst die Spalten.\n    > **Nachweis:** Füge die Ausgabe ein.\n    > **Ergebnis:**\n`,
  );
  try {
    await pair(page, '/#view=paths');
    await page.locator(`button[data-path="lib.nvim/${slug}"]`).click();
    const tree = page.getByRole('list', { name: 'Learning points of Focus path e2e' });
    const title = tree.locator('li[data-point="ls"]').getByRole('button', { name: 'Üben: Verzeichnis anzeigen foc2e', exact: true });
    await dialogCase(page, /Task: Üben: Verzeichnis anzeigen foc2e/, () => title.click(), title);
  } finally {
    rmSync(file, { force: true });
  }
});

/** A plan of two phases with one member, as the plan view shows it. */
async function withPlan(slug: string, run: () => Promise<void>): Promise<void> {
  const plan = lib('ROADMAP', 'plans', `${slug}.md`);
  const member = lib('ROADMAP', 'tasks', `${slug}-member.md`);
  mkdirSync(lib('ROADMAP', 'plans'), { recursive: true });
  writeFileSync(plan, `---\ntitle: Focus plan\nstatus: doing\nareas: [lib.nvim]\nphase_order: [one, two]\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n\nThe definition of done.\n`);
  writeFileSync(member, `---\ntitle: Member of the focus plan\nstatus: open\nkind: task\nplan: lib.nvim/${slug}\nphase: one\n---\n\nText.\n`);
  try {
    await run();
  } finally {
    rmSync(plan, { force: true });
    rmSync(member, { force: true });
  }
}

async function showPlan(page: Page, slug: string): Promise<void> {
  await chooseFromMenu(page, 'View', 'Plan');
  const select = page.getByRole('combobox', { name: 'Plan' });
  await expect(select.locator(`option[value="lib.nvim/${slug}"]`)).toBeAttached({ timeout: 15_000 });
  await select.selectOption(`lib.nvim/${slug}`);
}

test('adding tasks to a phase: the focus goes in, Escape closes it, the focus is back on the button of the phase', async ({ page }) => {
  const slug = 'focus-e2e-add';
  await withPlan(slug, async () => {
    await pair(page, '/#view=list');
    await showPlan(page, slug);
    const add = page.getByRole('button', { name: 'Add tasks to phase two' });
    await dialogCase(page, /^Add tasks to Focus plan, phase two/, () => add.click(), add);
  });
});

test('splitting a plan: the focus goes in, Escape closes it, the focus is back on the button of the plan', async ({ page }) => {
  const slug = 'focus-e2e-split';
  const ai = await aiDesktopDoubleIn(state().config, (_, path) =>
    path === '/jobs' ? { status: 201, body: { job_id: '0123456789abcdef', status: 'running', private: false } } : { status: 200, body: { id: '0123456789abcdef', status: 'running' } },
  );
  try {
    await withPlan(slug, async () => {
      await pair(page, '/#view=list');
      await showPlan(page, slug);
      const split = page.getByRole('button', { name: 'Split into tasks …' });
      await dialogCase(page, 'Split into tasks', () => split.click(), split);
    });
  } finally {
    await ai.close();
  }
});

test('handing a task to an agent: the focus goes in, Escape closes it, the focus is back on the button', async ({ page }) => {
  const ai = await aiDesktopDoubleIn(state().config, () => ({ status: 404, body: { error: { message: 'no such route' } } }));
  try {
    await pair(page, '/#view=list');
    await page.locator('button.row', { hasText: 'lib.nvim/alpha' }).first().click();
    const hand = page.locator('aside.detail').getByRole('button', { name: 'Hand to an agent ...' });
    await dialogCase(page, 'Hand to an agent', () => hand.click(), hand);
  } finally {
    await ai.close();
  }
});

test('the review of a finished task: the focus goes in, Escape closes it, the focus does not stay on the closed dialog', async ({ page }) => {
  const ai = await aiDesktopDoubleIn(state().config, (_, path) =>
    path === '/jobs' ? { status: 201, body: { job_id: '0123456789abcdef', status: 'running', private: false } } : { status: 200, body: { id: '0123456789abcdef', status: 'running' } },
  );
  try {
    await pair(page, '/#view=list');
    await page.getByText('More filters', { exact: false }).first().click();
    await page.getByLabel('Show finished tasks under the list').check();
    const finished = page.getByRole('region', { name: 'Finished' });
    await finished.getByLabel('Period').selectOption('all');
    await finished.getByRole('button', { name: /Shipped bug/ }).click();
    const check = page.getByRole('dialog', { name: 'Finished task' }).getByRole('button', { name: 'Check against the acceptance ...' });
    // The dialog of the finished task closes itself to give way, so the focus returns to the entry of the list that opened it.
    await dialogCase(page, 'Review against the acceptance', () => check.click(), finished.getByRole('button', { name: /Shipped bug/ }));
  } finally {
    await ai.close();
  }
});

/** Two open tasks on the board: one of priority 1 and one without a priority, below it. */
async function withBoardTasks(run: (page: Page) => Promise<void>, page: Page): Promise<void> {
  const files = [
    [lib('ROADMAP', 'tasks', 'focus-e2e-b1.md'), `---\ntitle: Focus board b1\nstatus: open\nkind: task\nprio: 1\n---\n\nFirst.\n`],
    [lib('ROADMAP', 'tasks', 'focus-e2e-b2.md'), `---\ntitle: Focus board b2\nstatus: open\nkind: task\n---\n\nSecond.\n`],
  ] as const;
  for (const [file, text] of files) writeFileSync(file, text);
  try {
    await pair(page, '/#view=list');
    await known(page, 'lib.nvim/focus-e2e-b2');
    await chooseFromMenu(page, 'View', 'Board');
    await expect(page.getByRole('group', { name: 'Board' })).toBeVisible();
    await run(page);
  } finally {
    for (const [file] of files) rmSync(file, { force: true });
  }
}

/** The second card (no priority, under the one of priority 1), focused as the keyboard does: that is what selects a card. */
async function cardByKeyboard(page: Page): Promise<Locator> {
  const card = page.getByRole('region', { name: 'open', exact: true }).locator('.card', { hasText: 'Focus board b2' });
  // A key first: the focus of a script is "from the keyboard" only after the last input was one.
  await page.keyboard.press('Shift');
  await card.focus();
  await expect(card).toHaveAttribute('aria-current', 'true');
  return card;
}

test('the blocker of a card: the focus goes in, Escape closes it, the focus is back on the card', async ({ page }) => {
  await withBoardTasks(async () => {
    const card = await cardByKeyboard(page);
    await dialogCase(page, 'Blocked by what?', () => page.keyboard.press('Shift+h'), card);
  }, page);
});

test('the priority a card asks for: the focus goes in, Escape closes it, the focus is back on the card', async ({ page }) => {
  await withBoardTasks(async () => {
    // Only a drag crosses a priority border (the keys stay inside a group): the card without one onto the lower half of P1.
    // A window tall enough for the whole column: both cards are on the screen, nothing scrolls under the pointer.
    await page.setViewportSize({ width: 1100, height: 2600 });
    const open = page.getByRole('region', { name: 'open', exact: true });
    const mover = open.locator('.card', { hasText: 'Focus board b2' });
    const target = open.locator('.card', { hasText: 'Focus board b1' });
    const drag = async (): Promise<void> => {
      const from = (await mover.boundingBox())!;
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + from.width / 2 - 30, from.y + from.height / 2 + 10, { steps: 4 });
      const to = (await target.boundingBox())!;
      await page.mouse.move(to.x + to.width / 2, to.y + to.height - 8, { steps: 10 });
      await page.mouse.up();
    };
    await dialogCase(page, 'Priority 1?', drag, mover);
  }, page);
});

test('the install dialog of the Help menu: the focus goes in, Escape closes it, the focus is on the page', async ({ page }) => {
  // The hub of the run is not a download: say that it is, as a hub that starts from the Downloads folder would.
  await page.route(
    (url) => url.pathname === '/api/tasks/setup',
    async (route) => {
      const real = await route.fetch();
      await route.fulfill({ response: real, json: { ...((await real.json()) as Record<string, unknown>), install: 'install' } });
    },
  );
  await pair(page, '/#view=list');
  await page.getByRole('menuitem', { name: 'Help', exact: true }).click();
  const entry = page.getByRole('menuitem', { name: /^Install/ });
  await entry.click();
  const dialog = page.getByRole('dialog', { name: 'Install the program' });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  if (await dialog.count()) await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement !== null && document.activeElement !== document.body)).toBe(true);
});

test('a move that is asked for: the dialog that follows the choice has the focus on Cancel, and Escape gives it back to the row', async ({ page }) => {
  await pair(page, '/#view=list');
  const host = page.locator('.rows .row-host').first();
  await host.locator('button.row').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  const choose = page.getByRole('dialog', { name: 'Move to another area' });
  await expect(choose).toBeVisible();
  await choose.getByRole('combobox').selectOption('cascade.nvim');
  await choose.getByRole('button', { name: 'Check the move' }).click();
  const ask = page.getByRole('dialog', { name: 'Move to cascade.nvim?' });
  await expect(ask).toBeVisible();
  // The choice that changes a file starts on the safe answer; the field of the step before is gone, the focus has not been lost.
  await expect(ask.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(ask).toHaveCount(0);
  await expect(host.getByRole('button', { name: /^Move .* to another area$/ })).toBeFocused();
});
