import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, isMachineFault, test } from './fixtures';
import { expectAccessible, violations, watchViolations } from './a11y';
import { STATE } from './global';

// The competence map of the learning paths (`PathMapView`) against the real hub and the real engine (capability
// `requires`): a finished path in the Backlog as the root of a chain, two projects where one needs the other (hard),
// a path that waits through its project, a soft requirement not met, a circle and a requirement that names nothing.
// Stage, waiting and the circle are the engine's; the test reads what the page draws from them.

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
const id = (slug: string) => `${A}/${slug}`;
const head = (fields: string) => `---\n${fields}\ncreated: 2026-11-20\nupdated: 2026-11-20\n---\n\n`;
const tree = (slug: string, learned = false) => `## Lernpunkte\n\n- [ ] Map e2e ${slug} {#root}\n  - [${learned ? 'x' : ' '}] Leaf e2e ${slug} {#leaf}\n  - [ ] Other e2e ${slug} {#other}\n`;

/** The files of the vault of this test, by their path under the vault. */
function files(): Record<string, string> {
  return {
    [`${A}/Backlog/FEATURES/2026-11-19_pm-e2e-root.md`]: head('title: PM e2e root\nstatus: done\nclosed_kind: path') + tree('root', true),
    [`${A}/ROADMAP/projects/pm-e2e-base.md`]: head(`title: PM e2e base project\nstatus: doing\nareas: [${A}]\nphase_order: []`),
    [`${A}/ROADMAP/projects/pm-e2e-top.md`]: head(
      `title: PM e2e top project\nstatus: planning\nareas: [${A}]\nphase_order: []\nrequires: [${id('pm-e2e-base')}]\nrequires_gate: hard`,
    ),
    [`${A}/ROADMAP/paths/pm-e2e-a.md`]: head(`title: PM e2e a\nstatus: doing\nproject: ${id('pm-e2e-base')}\nrequires: [${id('pm-e2e-root')}]`) + tree('a', true),
    [`${A}/ROADMAP/paths/pm-e2e-b.md`]: head(`title: PM e2e b\nstatus: planning\nproject: ${id('pm-e2e-top')}`) + tree('b'),
    [`${A}/ROADMAP/paths/pm-e2e-soft.md`]: head(`title: PM e2e soft\nstatus: planning\nrequires: [${id('pm-e2e-a')}]`) + tree('soft'),
    [`${A}/ROADMAP/paths/pm-e2e-x.md`]: head(`title: PM e2e x\nstatus: planning\nrequires: [${id('pm-e2e-y')}]`) + tree('x'),
    [`${A}/ROADMAP/paths/pm-e2e-y.md`]: head(`title: PM e2e y\nstatus: planning\nrequires: [${id('pm-e2e-x')}]`) + tree('y'),
    [`${A}/ROADMAP/paths/pm-e2e-ghost.md`]: head(`title: PM e2e ghost\nstatus: planning\nrequires: [${id('pm-e2e-nothing')}]`) + tree('ghost'),
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

const box = (page: Page, slug: string) => page.locator(`[data-box="${id(slug)}"]`);

test('the competence map: stages, frames, a chain, a circle and a ghost from the engine; the keys, hiding the finished ones, the list', async ({ page }) => {
  const made = write();
  try {
    const problems = await pair(page, '/#view=pathmap');
    await expect(page.getByRole('heading', { name: 'Competence map', level: 2 })).toBeVisible();
    await expect(box(page, 'pm-e2e-root')).toHaveAttribute('data-stage', 'done');
    await expect(box(page, 'pm-e2e-a')).toHaveAttribute('data-stage', 'doing');
    // waits through its project: the top project needs the base project (hard), which is not finished
    await expect(box(page, 'pm-e2e-b')).toHaveAttribute('data-stage', 'waiting');
    await expect(box(page, 'pm-e2e-b')).toHaveAccessibleName(/^PM e2e b, waits for PM e2e base project, 0 of 2 learned/);
    await expect(box(page, 'pm-e2e-soft')).toHaveAccessibleName(/a soft requirement is not met yet; needs: PM e2e a \(soft, open\)/);
    await expect(page.locator(`[data-frame="${id('pm-e2e-base')}"]`)).toBeVisible();
    await expect(page.locator(`[data-edge="j:${id('pm-e2e-base')}>j:${id('pm-e2e-top')}"]`)).toHaveClass(/hard.*warn/);
    await expect(page.locator(`[data-edge="p:${id('pm-e2e-root')}>p:${id('pm-e2e-a')}"]`)).toHaveClass(/soft.*muted/);
    // the circle last, in an area of its own; the requirement that names nothing as a ghost
    await expect(page.locator('[data-pathmap-cycle]')).toContainText('Circle: PM e2e x → PM e2e y → PM e2e x');
    await expect(box(page, 'pm-e2e-nothing')).toHaveAttribute('data-stage', 'ghost');
    await expectAccessible(page, 'the competence map, light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectAccessible(page, 'the competence map, dark');
    await page.emulateMedia({ colorScheme: 'light' });

    // the contrast mode of the system (forced-colors): arrows, heads and box borders take the system's text colour,
    // and hard and soft stay apart by the line (dashes) and the head (filled or open), not by colour
    await page.emulateMedia({ forcedColors: 'active' });
    const look = (selector: string) =>
      page.locator(selector).evaluate((el) => {
        const s = getComputedStyle(el);
        return { stroke: s.stroke, dash: s.strokeDasharray, fill: s.fill };
      });
    const text = await page.locator('body').evaluate((el) => getComputedStyle(el).color);
    const hard = await look(`[data-edge="j:${id('pm-e2e-base')}>j:${id('pm-e2e-top')}"]`);
    const soft = await look(`[data-edge="p:${id('pm-e2e-root')}>p:${id('pm-e2e-a')}"]`);
    expect(hard.stroke).toBe(text);
    expect(soft.stroke).toBe(text);
    expect(hard.dash).toBe('none');
    expect(soft.dash).not.toBe('none');
    expect((await look('marker[id="pathmap-hard-warn"] path')).fill).toBe(text);
    expect((await look('marker[id="pathmap-soft-muted"] path')).fill).toBe('none');
    await expect(box(page, 'pm-e2e-b')).toHaveCSS('border-top-color', text);
    // the learned part of the bar stays visible (not the forced background of the track)
    await expect(box(page, 'pm-e2e-a').locator('.bar-fill')).toHaveCSS('background-color', text);
    await expect(box(page, 'pm-e2e-soft').locator('.bar-fill')).toHaveCSS('background-color', text);
    await expectAccessible(page, 'the competence map, forced colours');
    await page.emulateMedia({ forcedColors: 'none' });

    // the keys: from the root along the chain, Space holds it
    await box(page, 'pm-e2e-root').focus();
    await page.keyboard.press('ArrowRight');
    await expect(box(page, 'pm-e2e-a')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(box(page, 'pm-e2e-a')).toHaveAttribute('aria-pressed', 'true');
    await expect(box(page, 'pm-e2e-x')).toHaveClass(/dim/);
    await page.keyboard.press('Escape');
    await expect(box(page, 'pm-e2e-a')).not.toHaveAttribute('aria-pressed', 'true');

    // finished ones hidden, kept over a reload
    await page.locator('[data-pathmap-hide-done]').check();
    await expect(box(page, 'pm-e2e-root')).toHaveCount(0);
    await page.reload();
    await expect(box(page, 'pm-e2e-a')).toBeVisible();
    await expect(box(page, 'pm-e2e-root')).toHaveCount(0);
    await page.locator('[data-pathmap-hide-done]').uncheck();
    await expect(box(page, 'pm-e2e-root')).toBeVisible();

    // the list: the same as a table, the circle last
    await page.getByRole('radio', { name: 'List' }).check();
    const list = page.locator('[data-pathmap-list]');
    await expect(list.locator(`[data-row="${id('pm-e2e-b')}"]`)).toContainText('waits for PM e2e base project');
    await expect(list.locator('table').last().locator('caption')).toHaveText('Circle');
    await expectAccessible(page, 'the competence map as a list, light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectAccessible(page, 'the competence map as a list, dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.getByRole('radio', { name: 'Map' }).check();

    // a box opens its path in the view of the paths
    await box(page, 'pm-e2e-a').click();
    await expect(page.getByRole('list', { name: 'Learning points of PM e2e a' })).toBeVisible();
    expect(problems).toEqual([]);
    expect(await violations(page)).toEqual([]);
  } finally {
    for (const file of made) rmSync(file, { force: true });
  }
});
