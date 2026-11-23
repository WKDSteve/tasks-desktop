import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, isMachineFault, test } from './fixtures';
import { expectAccessible, watchViolations } from './a11y';
import { STATE } from './global';

// The task float of a learning point against the real hub and the real engine: a click on the title opens the exercise
// block under the point (task, "done when", proof) over the list; ticking needs the result, which the engine writes as
// the `**Ergebnis:**` line of the note before the point is learned; Escape closes and the focus goes back to the title.
// Every rule is the engine's: the test reads what it wrote into the file.

test.use({ locale: 'en-US' });

const state = (): { token: string; vault: string } => JSON.parse(readFileSync(STATE, 'utf8')) as { token: string; vault: string };

async function pair(page: Page, path: string): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !isMachineFault(m.text())) problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await watchViolations(page);
  await page.addInitScript((token) => sessionStorage.setItem('tasks-desktop.session', token), state().token);
  await page.goto(path);
  await expect(page.getByRole('menubar')).toBeVisible();
  return problems;
}

const PATH = `---
title: Exercise e2e
status: doing
---

A learning path of one browser test.

## Lernpunkte

- [ ] Stage one {#stage}
  - [ ] Üben: Verzeichnis anzeigen exe2e {#ls}
    > **Aufgabe:** Lege im Übungsordner drei Dateien an und zeige ihn mit \`ls -l\` an.
    > **Fertig, wenn:** Du nennst die Spalten von \`ls -l\`.
    > **Nachweis:** Füge die Ausgabe von \`ls -lh\` ein.
    > **Ergebnis:**
  - [ ] Lesen exe2e ohne Aufgabe {#read}
`;

test('a click on the title opens the task float; the point is learned only with a result, which the engine writes', async ({ page }) => {
  const slug = 'exercise-e2e-p01';
  const dir = join(state().vault, 'lib.nvim', 'ROADMAP', 'paths');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${slug}.md`);
  writeFileSync(file, PATH);
  try {
    const problems = await pair(page, '/#view=paths');
    await page.locator(`button[data-path="lib.nvim/${slug}"]`).click();
    const tree = page.getByRole('list', { name: 'Learning points of Exercise e2e' });
    await expect(tree).toBeVisible();
    const point = (key: string) => tree.locator(`li[data-point="${key}"]`);
    // The block is not dumped under the point: it is in the float.
    await expect(point('ls').locator('.note')).toHaveCount(0);

    const title = point('ls').getByRole('button', { name: 'Üben: Verzeichnis anzeigen exe2e', exact: true });
    await title.click();
    const float = page.getByRole('dialog', { name: /Task: Üben: Verzeichnis anzeigen exe2e/ });
    await expect(float).toBeVisible();
    await expect(float.locator('[data-part="aufgabe"]')).toContainText('Lege im Übungsordner drei Dateien an');
    await expect(float.locator('[data-part="aufgabe"] code')).toHaveText('ls -l');
    await expect(float.locator('[data-part="fertig"]')).toContainText('Spalten');
    await expect(float.locator('[data-part="nachweis"]')).toContainText('ls -lh');
    // The list and its state stay behind the float.
    await expect(tree).toBeVisible();
    await expect(float.getByRole('textbox', { name: 'Result' })).toBeFocused();
    await expectAccessible(page, 'the task float');

    // Without a result the point is not learned: said, nothing written.
    await float.getByRole('button', { name: 'Save and mark as learned' }).click();
    await expect(float.getByRole('alert')).toContainText('Enter your result first');
    expect(readFileSync(file, 'utf8')).toContain('[ ] Üben: Verzeichnis anzeigen exe2e');

    // Escape closes, the focus goes back to the title.
    await page.keyboard.press('Escape');
    await expect(float).toHaveCount(0);
    await expect(title).toBeFocused();

    // Open again by keyboard, write the result, tick: note and state are in the file.
    await page.keyboard.press('Enter');
    await expect(float).toBeVisible();
    await float.getByRole('textbox', { name: 'Result' }).fill('total 12 -rw-r--r-- 1 me me 0 a');
    await float.getByRole('button', { name: 'Save and mark as learned' }).click();
    await expect(float).toHaveCount(0);
    await expect(point('ls')).toHaveAttribute('data-state', 'learned');
    const written = readFileSync(file, 'utf8');
    expect(written).toContain('[x] Üben: Verzeichnis anzeigen exe2e');
    expect(written).toContain('> **Ergebnis:** total 12 -rw-r--r-- 1 me me 0 a');

    // A point without a task text says so and is ticked off as before.
    await point('read').getByRole('button', { name: 'Lesen exe2e ohne Aufgabe', exact: true }).click();
    const plain = page.getByRole('dialog', { name: /Task: Lesen exe2e ohne Aufgabe/ });
    await expect(plain).toContainText('no task text yet');
    await page.keyboard.press('Escape');
    await point('read').locator('button.mark').click();
    await expect(point('read')).toHaveAttribute('data-state', 'learned');
    expect(problems).toEqual([]);
  } finally {
    rmSync(file, { force: true });
  }
});
