// The task float of a learning point in the single-file page, opened from disk in Chrome: the same float as in the app
// (PathExercise.svelte), over the engine that runs in the page. A click on the title shows task, "done when" and proof;
// ticking needs the result, which the engine writes as the `**Ergebnis:**` line of the note before the point is learned.
// The counterpart of e2e/learn-exercise.spec.ts (hub) for the web variant; no hub is involved.

import { expect, test } from '@playwright/test';
import { disk, openVault, vaultFiles, violations, watchPage } from './page';

const FILE = 'lib.nvim/ROADMAP/paths/exercise-web.md';

const PATH = `---
title: Exercise web
status: doing
---

A learning path of one browser test.

## Lernpunkte

- [ ] Stage one {#stage}
  - [ ] Üben: Verzeichnis anzeigen exweb {#ls}
    > **Aufgabe:** Lege im Übungsordner drei Dateien an und zeige ihn mit \`ls -l\` an.
    > **Fertig, wenn:** Du nennst die Spalten von \`ls -l\`.
    > **Nachweis:** Füge die Ausgabe von \`ls -lh\` ein.
    > **Ergebnis:**
`;

test('web variant: a click on an exercise point opens its task float; the result is written and the point learned', async ({ page }) => {
  const seen = await watchPage(page);
  await openVault(page, { ...vaultFiles(), [FILE]: PATH });
  await page.getByRole('menuitem', { name: /^(Learning plans|Lernpläne)$/ }).click();
  await page.getByRole('menuitemradio', { name: /^(Learning paths|Lernpfade)$/ }).click();
  await page.locator('button[data-path="lib.nvim/exercise-web"]').click({ timeout: 30_000 });
  const tree = page.getByRole('list', { name: /^(Learning points of|Lernpunkte von) Exercise web$/ });
  await expect(tree).toBeVisible({ timeout: 30_000 });
  const point = tree.locator('li[data-point="ls"]');
  // The block is not dumped under the point: it is in the float.
  await expect(point.locator('.note')).toHaveCount(0);

  const title = point.getByRole('button', { name: 'Üben: Verzeichnis anzeigen exweb', exact: true });
  await title.click();
  const float = page.getByRole('dialog', { name: /^(Task|Aufgabe): Üben: Verzeichnis anzeigen exweb/ });
  await expect(float).toBeVisible();
  await expect(float.locator('[data-part="aufgabe"]')).toContainText('Lege im Übungsordner drei Dateien an');
  await expect(float.locator('[data-part="fertig"]')).toContainText('Spalten');
  await expect(float.locator('[data-part="nachweis"]')).toContainText('ls -lh');

  // Without a result the point is not learned: said, nothing written.
  const learn = float.getByRole('button', { name: /^(Save and mark as learned|Speichern und als gelernt markieren)$/ });
  await learn.click();
  await expect(float.getByRole('alert')).toContainText(/Enter your result first|Trage zuerst dein Ergebnis ein/);
  expect((await disk(page))[FILE]).toContain('- [ ] Üben: Verzeichnis anzeigen exweb');

  await float.getByRole('textbox', { name: /^(Result|Ergebnis)$/ }).fill('total 12 -rw-r--r-- 1 me me 0 a');
  await learn.click();
  await expect(float).toHaveCount(0, { timeout: 30_000 });
  await expect(point).toHaveAttribute('data-state', 'learned', { timeout: 30_000 });
  await expect.poll(async () => (await disk(page))[FILE]).toContain('- [x] Üben: Verzeichnis anzeigen exweb');
  expect((await disk(page))[FILE]).toContain('> **Ergebnis:** total 12 -rw-r--r-- 1 me me 0 a');

  expect(seen.errors).toEqual([]);
  expect(await violations(page)).toEqual([]);
});
