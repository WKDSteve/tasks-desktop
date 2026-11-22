import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, isMachineFault, test } from './fixtures';
import { expectAccessible, violations, watchViolations } from './a11y';
import { STATE } from './global';

// The catalogue of the competences and the evidence of all learning paths (`CompetencesView`, `EvidenceView`) against the
// real hub and the real engine (`tasks.competences`, `tasks.learn_evidence`): a field of knowledge in its own file with
// stages and targets, a path that serves it with one evidence learned (for practice 3) and one open, and a path that
// names no field. Stages, scale and evidence are the engine's; the test reads what the pages draw from them.

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

const A = 'lib.nvim';
const FIELD = `${A}/lp2-e2e-os`;
const SERVES = `${A}/lp2-e2e-serves`;
const FREE = `${A}/lp2-e2e-free`;
const head = (fields: string) => `---\n${fields}\ncreated: 2026-11-20\nupdated: 2026-11-20\n---\n\n`;

function files(): Record<string, string> {
  return {
    [`${A}/ROADMAP/competences/lp2-e2e-os.md`]:
      '---\ntitle: "LP2 e2e operating systems"\ngroup: "LP2 e2e core"\nt: 3\np: 1.5\ntarget_12: 4\ntarget_24: 4.5\nassessed: 2026-10-29\n---\nWhy: **processes** first.\n',
    [`${A}/ROADMAP/paths/lp2-e2e-serves.md`]:
      head(`title: LP2 e2e serves\nstatus: doing\ncompetence: ${FIELD}`) +
      '## Lernpunkte\n\n- [x] Nachweis: LP2 e2e a small shell {for=p3} {#shell}\n- [ ] Nachweis: LP2 e2e a scheduler {#sched}\n- [ ] LP2 e2e plain leaf {#plain}\n',
    [`${A}/ROADMAP/paths/lp2-e2e-free.md`]: head('title: LP2 e2e free\nstatus: planning') + '## Lernpunkte\n\n- [ ] LP2 e2e free leaf {#leaf}\n',
  };
}

function write(): string[] {
  const made: string[] = [];
  for (const [path, text] of Object.entries(files())) {
    const file = join(state().vault, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    made.push(file);
  }
  return made;
}

test('the competence catalogue: ladders, targets, paths and evidence from the engine; a row opens; light, dark and narrow', async ({ page }) => {
  const made = write();
  try {
    const problems = await pair(page, '/#view=competences');
    await expect(page.getByRole('heading', { name: 'Competence catalogue', level: 2 })).toBeVisible();
    const row = page.locator(`[data-competence="${FIELD}"]`);
    await expect(row).toBeVisible();
    await expect(page.getByRole('img', { name: /^Theory: 3 .+, target in 12 months 4 .+, target in 24 months 4\.5 / })).toBeVisible();
    await expect(row.locator('[data-ladder="p"] .rung.half')).toHaveCount(1);
    await expect(row.locator(`[data-competence-path="${SERVES}"]`)).toBeVisible();
    await expect(row.locator('[data-competence-evidence]')).toContainText('1 given · 1 open');
    await expect(page.locator('[data-competences-without]')).toContainText('LP2 e2e free');
    await expectAccessible(page, 'the catalogue, light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectAccessible(page, 'the catalogue, dark');
    await page.emulateMedia({ colorScheme: 'light' });

    await row.locator('[data-competence-more]').click();
    const detail = page.locator(`[data-competence-detail="${FIELD}"]`);
    await expect(detail.locator('strong')).toHaveText('processes');
    await expect(detail).toContainText('lp2-e2e-os.md');
    await expectAccessible(page, 'the catalogue with a row open');

    // a narrow window: the table as cards, nothing sideways
    await page.setViewportSize({ width: 400, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await expectAccessible(page, 'the catalogue, narrow');
    // a chip opens its path
    await page.setViewportSize({ width: 1280, height: 800 });
    await row.locator(`[data-competence-path="${SERVES}"]`).click();
    await expect(page.getByRole('list', { name: 'Learning points of LP2 e2e serves' })).toBeVisible();
    expect(problems).toEqual([]);
    expect(await violations(page)).toEqual([]);
  } finally {
    for (const file of made) rmSync(file, { force: true });
  }
});

test('the evidence: by field, given and open, the stage it proves, a point opens in its path; light, dark and narrow', async ({ page }) => {
  const made = write();
  try {
    const problems = await pair(page, '/#view=evidence');
    await expect(page.getByRole('heading', { name: 'Evidence', level: 2 })).toBeVisible();
    const group = page.locator(`[data-evidence-group-of="competence:${FIELD}"]`);
    await expect(group.getByRole('heading', { name: 'LP2 e2e operating systems' })).toBeVisible();
    const shell = group.locator('[data-evidence-state="given"]').filter({ hasText: 'a small shell' });
    await expect(shell).toContainText('given');
    await expect(shell.locator('.for .sr')).toHaveText(/^proves practice 3 /);
    await expect(group.locator('[data-evidence-state="open"]').filter({ hasText: 'a scheduler' })).toBeVisible();
    await expectAccessible(page, 'the evidence, light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectAccessible(page, 'the evidence, dark');
    await page.emulateMedia({ colorScheme: 'light' });

    await page.locator('[data-evidence-filter="open"]').check();
    await expect(shell).toHaveCount(0);
    await page.locator('[data-evidence-filter="all"]').check();

    await page.setViewportSize({ width: 400, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await expectAccessible(page, 'the evidence, narrow');
    await page.setViewportSize({ width: 1280, height: 800 });
    // a point opens in its path, focused
    await shell.locator('[data-evidence-open]').click();
    await expect(page.getByRole('list', { name: 'Learning points of LP2 e2e serves' })).toBeVisible();
    expect(problems).toEqual([]);
    expect(await violations(page)).toEqual([]);
  } finally {
    for (const file of made) rmSync(file, { force: true });
  }
});
