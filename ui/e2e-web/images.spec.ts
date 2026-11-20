// The images below `assets/` of a task in the single-file page, opened from disk: the same `<img>` from a `blob:`
// address as in the app, read from the chosen folder (the engine in the page holds only the text files). A malicious
// SVG as an asset runs nothing, and the page asks no host at all; a missing image is a line. In Chrome, Firefox and
// WebKit: each draws an SVG in an `<img>` by its own rules.

import { expect, test } from '@playwright/test';
import { openVault, vaultFiles, violations, watchPage } from './page';

const EVIL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="40" height="20" onload="top.__pwned = 'onload'">
<script>top.__pwned = 'script'</script>
<rect width="40" height="20" fill="red"/>
<foreignObject width="40" height="20"><iframe xmlns="http://www.w3.org/1999/xhtml" src="https://tracker.example/frame"></iframe></foreignObject>
<image href="https://tracker.example/pixel.png" width="1" height="1"/>
</svg>`;

test('the images of a task in the web variant: from the folder, a missing one said, a malicious SVG runs nothing', async ({ page }) => {
  const seen = await watchPage(page);
  const slug = 'images-web-t01';
  const dir = `lib.nvim/ROADMAP/tasks/${slug}`;
  await openVault(page, {
    ...vaultFiles(),
    [`${dir}/${slug}.md`]: `---
title: Images web t01
status: open
created: 2026-11-20
updated: 2026-11-20
---

The drawing: ![Evil drawing](assets/images/evil.svg)

Gone: ![Gone picture](assets/images/gone.svg)
`,
    [`${dir}/assets/images/evil.svg`]: EVIL_SVG,
  });
  await page.getByText('Images web t01').first().click();
  const prose = page.locator('aside.detail .prose');
  const evil = prose.getByRole('img', { name: 'Evil drawing' });
  await expect(evil).toHaveAttribute('src', /^blob:/, { timeout: 30_000 });
  await expect.poll(() => evil.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(prose).toContainText(/(Image missing|Bild fehlt): Gone picture/);
  await expect(page.locator('aside.detail iframe, aside.detail foreignObject')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __pwned?: string }).__pwned ?? null)).toBeNull();
  expect(seen.requests, 'no request outside the page').toEqual([]);
  expect(seen.errors).toEqual([]);
  expect(await violations(page)).toEqual([]);
});
