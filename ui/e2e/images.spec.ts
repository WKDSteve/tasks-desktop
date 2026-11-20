import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, isMachineFault, test } from './fixtures';
import { expectAccessible, violations, watchViolations } from './a11y';
import { STATE } from './global';

// The images below `assets/` of a task and of a learning path against the real hub and the real engine (concept
// "Lernplan" 11.3, E12): drawn as `<img>` from the page's own `blob:` addresses, a missing one as a line, larger on a
// click. A malicious SVG (a script, an onload, a foreignObject with a frame, an image of another host) is an asset:
// nothing of it runs, and the page asks no host but its own.

test.use({ locale: 'en-US' });

const state = (): { token: string; vault: string } => JSON.parse(readFileSync(STATE, 'utf8')) as { token: string; vault: string };

const EVIL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="40" height="20" onload="top.__pwned = 'onload'">
<script>top.__pwned = 'script'</script>
<rect width="40" height="20" fill="red"/>
<foreignObject width="40" height="20"><iframe xmlns="http://www.w3.org/1999/xhtml" src="https://tracker.example/frame"></iframe></foreignObject>
<image href="https://tracker.example/pixel.png" width="1" height="1"/>
<a xlink:href="javascript:top.__pwned='link'"><text y="10">x</text></a>
</svg>`;
// The smallest PNG: one transparent pixel.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function pair(page: Page, path: string): Promise<{ problems: string[]; foreign: string[] }> {
  const problems: string[] = [];
  const foreign: string[] = [];
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !isMachineFault(m.text())) problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.protocol !== 'blob:' && url.protocol !== 'data:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') foreign.push(r.url());
  });
  await watchViolations(page);
  await page.addInitScript((token) => sessionStorage.setItem('tasks-desktop.session', token), state().token);
  await page.goto(path);
  await expect(page.getByRole('menubar')).toBeVisible();
  return { problems, foreign };
}

const pwned = (page: Page) => page.evaluate(() => (window as unknown as { __pwned?: string }).__pwned ?? null);

test('the images of a task: drawn from its folder, a missing one said, larger on a click, a malicious SVG runs nothing', async ({ page }) => {
  const slug = 'images-e2e-t01';
  const folder = join(state().vault, 'lib.nvim', 'ROADMAP', 'tasks', slug);
  mkdirSync(join(folder, 'assets', 'images'), { recursive: true });
  writeFileSync(join(folder, 'assets', 'images', 'evil.svg'), EVIL_SVG);
  writeFileSync(join(folder, 'assets', 'images', 'dot.png'), PNG);
  writeFileSync(
    join(folder, `${slug}.md`),
    `---
title: Images e2e t01
status: open
icon: assets/images/dot.png
cover: assets/images/dot.png
created: 2026-11-20
updated: 2026-11-20
---

A task with pictures.

The drawing: ![Evil drawing](assets/images/evil.svg)

A dot: ![A dot](assets/images/dot.png)

Gone: ![Gone picture](assets/images/gone.png)

Foreign: ![Tracker](https://tracker.example/pixel.png)
`,
  );
  try {
    // The hub reads a new file when its watcher tells it: the page opens the task once the hub knows it.
    await expect
      .poll(async () => (await page.request.get(`/api/tasks/task?id=lib.nvim/${slug}`, { headers: { Authorization: `Bearer ${state().token}` } })).status(), {
        timeout: 15_000,
      })
      .toBe(200);
    const { problems, foreign } = await pair(page, `/#task=lib.nvim%2F${slug}`);
    const detail = page.locator('aside.detail');
    const prose = detail.locator('.prose');
    const evil = prose.getByRole('img', { name: 'Evil drawing' });
    await expect(evil).toBeVisible();
    await expect(evil).toHaveAttribute('src', /^blob:/);
    await expect(prose.getByRole('img', { name: 'A dot' })).toHaveAttribute('src', /^blob:/);
    // The browser drew the drawing (it is a picture of 40 px), and nothing of it ran.
    await expect.poll(() => evil.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(40);
    await expect(prose).toContainText('Image missing: Gone picture');
    await expect(prose).toContainText('Tracker');
    await expect(prose.locator('img[src*="tracker"]')).toHaveCount(0);
    await expect(page.locator('aside.detail svg foreignObject, aside.detail iframe')).toHaveCount(0);
    // The icon and the cover in the head.
    await expect(detail.locator('.title-line [data-icon="own"] img')).toHaveAttribute('src', /^blob:/);
    await expect(detail.locator('.task-title')).toHaveText('Images e2e t01');
    await expect(detail.locator('.cover img')).toHaveAttribute('src', /^blob:/);
    await expectAccessible(page, 'a task with images');

    // Larger on a click, closed with Escape.
    await prose.getByRole('button', { name: 'Evil drawing' }).click();
    const viewer = page.getByRole('dialog', { name: 'Image: Evil drawing' });
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('[data-viewer-image]')).toHaveAttribute('src', /^blob:/);
    await expectAccessible(page, 'an image shown larger');
    await page.keyboard.press('Escape');
    await expect(viewer).toBeHidden();

    // The drawing opened on its own (the hub's answer, as a new tab would show it) runs nothing either: it is sealed.
    const direct = await page.request.get(`/api/tasks/asset?kind=task&id=lib.nvim/${slug}&file=assets/images/evil.svg`, {
      headers: { Authorization: `Bearer ${state().token}` },
    });
    expect(direct.headers()['content-security-policy']).toMatch(/sandbox/);
    expect(direct.headers()['x-content-type-options']).toBe('nosniff');

    expect(await pwned(page)).toBeNull();
    expect(foreign, 'no request to another host').toEqual([]);
    expect(await violations(page)).toEqual([]);
    expect(problems.filter((p) => !p.includes('404'))).toEqual([]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('the images of a learning path: a point, the cover and the badges of its levels', async ({ page }) => {
  const slug = 'images-e2e-p01';
  const folder = join(state().vault, 'lib.nvim', 'ROADMAP', 'paths', slug);
  mkdirSync(join(folder, 'assets', 'badges'), { recursive: true });
  writeFileSync(join(folder, 'assets', 'evil.svg'), EVIL_SVG);
  writeFileSync(join(folder, 'assets', 'badges', 'star.png'), PNG);
  writeFileSync(join(folder, 'assets', 'cover.png'), PNG);
  writeFileSync(
    join(folder, `${slug}.md`),
    `---
title: Images path e2e
status: doing
cover: assets/cover.png
---

A path with pictures.

## Lernpunkte

- [ ] Draw e2e {#draw}
  - [x] ![Syntax drawing](assets/evil.svg) {xp=10} {#svg}
  - [ ] ![Missing drawing](assets/none.svg) {xp=10} {#none}

## Level

- [ ] 10 XP · Badge assets/badges/star.png · Belohnung: ice cream
- [ ] 20 XP · Badge assets/badges/star.png · Belohnung: cake
`,
  );
  try {
    const { problems, foreign } = await pair(page, '/#view=paths');
    await page.locator(`button[data-path="lib.nvim/${slug}"]`).click();
    const tree = page.getByRole('list', { name: 'Learning points of Images path e2e' });
    await expect(tree).toBeVisible();
    const drawing = tree.locator('li[data-point="svg"]').getByRole('img', { name: 'Syntax drawing' });
    await expect(drawing).toHaveAttribute('src', /^blob:/);
    await expect(tree.locator('li[data-point="none"]')).toContainText('Image missing: Missing drawing');
    await expect(page.locator('.path .cover img')).toHaveAttribute('src', /^blob:/);
    const badges = page.getByRole('list', { name: 'Badges' });
    await expect(badges.locator('li')).toHaveCount(2);
    await expect(badges.locator('li.reached img')).toHaveAttribute('src', /^blob:/);
    await expectAccessible(page, 'a learning path with images');
    expect(await pwned(page)).toBeNull();
    expect(foreign, 'no request to another host').toEqual([]);
    expect(await violations(page)).toEqual([]);
    expect(problems.filter((p) => !p.includes('404'))).toEqual([]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
