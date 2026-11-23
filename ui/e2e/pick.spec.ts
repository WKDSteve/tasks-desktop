import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { violations, watchViolations } from './a11y';
import { STATE } from './global';
import { chooseFromMenu } from './menu';

// The searchable choices (`PickList`): the plan of a task chosen from the engine's plans, a new plan made from that
// choice and given to the task; tasks put into a phase of a plan from the plan view, and a new task made in the plan.

test.use({ locale: 'en-US' });

const state = (): { token: string; vault: string } => JSON.parse(readFileSync(STATE, 'utf8')) as { token: string; vault: string };
const WRITE_BUDGET = 15_000;

async function pair(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await watchViolations(page);
  await page.addInitScript((token) => sessionStorage.setItem('tasks-desktop.session', token), state().token);
  await page.goto('/');
  await expect(page.getByRole('menubar')).toBeVisible();
  return problems;
}

function taskFloat(page: Page): Locator {
  return page.locator('dialog.peek[open]');
}

async function closeFloat(page: Page): Promise<void> {
  const float = taskFloat(page);
  if ((await float.count()) === 0) return;
  await expect(async () => {
    if ((await float.count()) > 0) await float.locator('button[data-close]').click({ timeout: 1000 });
    await expect(float).toHaveCount(0, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}

async function chooseView(page: Page, menu: string, item: string): Promise<void> {
  await closeFloat(page);
  await chooseFromMenu(page, menu, item);
}

/** Make a task in lib.nvim through the capture dialog; its float stays open when `keep` asks for it. */
async function capture(page: Page, title: string, { keep = false }: { keep?: boolean } = {}): Promise<void> {
  await closeFloat(page);
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await expect(async () => {
    if (!(await dialog.isVisible())) await page.keyboard.press('c');
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10000 });
  await dialog.getByLabel('Title').fill(title);
  await dialog.locator('select').first().selectOption('lib.nvim');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toHaveCount(0, { timeout: WRITE_BUDGET });
  await expect(taskFloat(page).locator('aside.detail .task-title')).toHaveText(title, { timeout: WRITE_BUDGET });
  if (!keep) await closeFloat(page);
}

const taskFile = (slug: string): string => join(state().vault, 'lib.nvim', 'ROADMAP', 'tasks', `${slug}.md`);
const planFile = (slug: string): string => join(state().vault, 'lib.nvim', 'ROADMAP', 'plans', `${slug}.md`);
const front = (slug: string): string => (existsSync(taskFile(slug)) ? readFileSync(taskFile(slug), 'utf8') : '');

test('the plan of a task is chosen from the plans, and a plan made from that choice is given to the task', async ({ page }) => {
  const problems = await pair(page);
  await chooseView(page, 'View', 'List');
  const plan = 'pick-e2e-made-plan';
  try {
    await capture(page, 'Pick e2e plan task', { keep: true });
    const detail = taskFloat(page).locator('aside.detail');
    const planField = detail.locator('button[data-field="plan"]');
    await expect(planField).toHaveText(/No plan/);
    await expect(detail.locator('button[data-field="phase"]')).toBeDisabled();

    // The list: a field to type in, the actions first, the keys in the field.
    await planField.click();
    const search = detail.getByRole('combobox', { name: 'Search plans' });
    await expect(search).toBeFocused();
    await expect(detail.locator('[data-pick="plan"] [data-action="none"]')).toHaveText('No plan');
    await search.press('ArrowDown');
    await search.press('Enter');

    const wizard = page.getByRole('dialog', { name: 'Create a plan' });
    await expect(wizard).toBeVisible();
    // The area of the task is the area of the new plan.
    await expect(wizard.getByLabel('Area of the plan file')).toHaveValue('lib.nvim');
    await wizard.getByLabel('Title', { exact: true }).fill('Pick e2e made plan');
    await wizard.getByLabel(/Phases in order/).fill('draft, final');
    await expect(wizard.getByRole('status')).toHaveText(`The plan will be lib.nvim/${plan}`);
    await wizard.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(wizard).toHaveCount(0, { timeout: WRITE_BUDGET });

    // The task belongs to it, and the view stayed where it was (the plan view did not open).
    await expect.poll(() => front('pick-e2e-plan-task'), { timeout: WRITE_BUDGET }).toContain(`plan: lib.nvim/${plan}`);
    await expect(planField).toHaveText(/Pick e2e made plan/, { timeout: WRITE_BUDGET });
    await expect(taskFloat(page)).toHaveCount(1);

    // The phase offers the phases of the plan.
    const phaseField = detail.locator('button[data-field="phase"]');
    await expect(phaseField).toBeEnabled();
    await phaseField.click();
    const phases = detail.locator('[data-pick="phase"] [role="option"][data-value]');
    await expect(phases).toHaveText(['draft', 'final']);
    await detail.locator('[data-pick="phase"] [data-value="final"]').click();
    await expect.poll(() => front('pick-e2e-plan-task'), { timeout: WRITE_BUDGET }).toContain('phase: final');

    // "No plan" takes it away again (with the phase that belongs to it).
    await expect(detail.locator('input, textarea').and(page.locator('[readonly]'))).toHaveCount(0, { timeout: WRITE_BUDGET });
    await planField.click();
    await detail.getByRole('combobox', { name: 'Search plans' }).fill('');
    await detail.locator('[data-pick="plan"] [data-action="none"]').click();
    await expect.poll(() => front('pick-e2e-plan-task'), { timeout: WRITE_BUDGET }).not.toContain('plan: ');
    expect(front('pick-e2e-plan-task')).not.toContain('phase: ');

    expect(await violations(page)).toEqual([]);
    expect(problems).toEqual([]);
  } finally {
    rmSync(planFile(plan), { force: true });
  }
});

test('tasks are put into a phase of a plan from the plan view, and a new task is made in the plan', async ({ page }) => {
  test.slow();
  const problems = await pair(page);
  await chooseView(page, 'View', 'List');
  const plan = 'pick-e2e-add-plan';
  try {
    for (const n of ['r000', 'r001', 'r002']) await capture(page, `Pick e2e add ${n}`);

    // A plan with two phases, made in the wizard: the plan view opens on it.
    await page.getByRole('menuitem', { name: 'Project', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Create a plan' }).click();
    const wizard = page.getByRole('dialog', { name: 'Create a plan' });
    await wizard.getByLabel('Title', { exact: true }).fill('Pick e2e add plan');
    await wizard.getByLabel('Area of the plan file').selectOption('lib.nvim');
    await wizard.getByLabel(/Phases in order/).fill('one, two');
    await expect(wizard.getByRole('status')).toHaveText(`The plan will be lib.nvim/${plan}`);
    await wizard.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(wizard).toHaveCount(0, { timeout: WRITE_BUDGET });
    await expect(page.locator('.plan-select select')).toHaveValue(`lib.nvim/${plan}`);

    // "+" of the phase "two": a choice of several open tasks, narrowed to the plan's areas.
    await page.getByRole('button', { name: 'Add tasks to phase two' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add tasks to Pick e2e add plan, phase two' });
    await expect(dialog).toBeVisible();
    const search = dialog.getByRole('combobox', { name: 'Search open tasks' });
    await expect(search).toBeFocused();
    await search.fill('Pick e2e add r00');
    const options = dialog.getByRole('option');
    await expect(options).toHaveCount(3);
    // Keys and presses both: Space ticks the active one once the words are gone, a press ticks another.
    await options.nth(0).click();
    await options.nth(1).click();
    await options.nth(2).click();
    await expect(dialog.getByRole('status')).toHaveText('3 chosen');
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(dialog).toHaveCount(0, { timeout: WRITE_BUDGET });
    for (const n of ['r000', 'r001', 'r002']) {
      await expect.poll(() => front(`pick-e2e-add-${n}`), { timeout: WRITE_BUDGET }).toContain(`plan: lib.nvim/${plan}`);
      expect(front(`pick-e2e-add-${n}`)).toContain('phase: two');
    }
    // One message for all of them, with the way back.
    await expect(page.getByRole('status').filter({ hasText: '3 tasks added.' })).toBeVisible();

    // "New task in this plan": the capture form opens with the plan and the phase.
    await page.getByRole('button', { name: 'Add tasks to phase one' }).click();
    const one = page.getByRole('dialog', { name: 'Add tasks to Pick e2e add plan, phase one' });
    await one.getByRole('button', { name: 'New task in this plan' }).click();
    const form = page.getByRole('dialog', { name: 'New task' });
    await expect(form).toBeVisible();
    await expect(form.locator('button[data-field="plan"]')).toHaveText(/Pick e2e add plan/);
    await expect(form.locator('button[data-field="phase"]')).toHaveText(/one/);
    await form.getByLabel('Title').fill('Pick e2e add new');
    await form.getByRole('button', { name: 'Create' }).click();
    await expect(form).toHaveCount(0, { timeout: WRITE_BUDGET });
    await expect.poll(() => front('pick-e2e-add-new'), { timeout: WRITE_BUDGET }).toContain(`plan: lib.nvim/${plan}`);
    expect(front('pick-e2e-add-new')).toContain('phase: one');

    expect(await violations(page)).toEqual([]);
    expect(problems).toEqual([]);
  } finally {
    rmSync(planFile(plan), { force: true });
  }
});

test.describe('on a touchscreen', () => {
  test.use({ hasTouch: true });

  test('tasks are added to a project with taps, and a new task is made in the project', async ({ page }) => {
    test.slow();
    const problems = await pair(page);
    await chooseView(page, 'View', 'List');
    const project = 'pick-e2e-touch-project';
    const projectFile = join(state().vault, 'lib.nvim', 'ROADMAP', 'projects', `${project}.md`);
    try {
      await capture(page, 'Pick e2e touch r000');

      // A project, made in the wizard: the plan view shows its page.
      await chooseView(page, 'View', 'Plan');
      await page.getByRole('button', { name: 'Create a project', exact: true }).tap();
      const wizard = page.getByRole('dialog', { name: 'Create a project' });
      await wizard.getByLabel('Title', { exact: true }).fill('Pick e2e touch project');
      await wizard.locator('select').first().selectOption('lib.nvim');
      await expect(wizard.getByRole('status')).toContainText(`lib.nvim/${project}`);
      await wizard.getByRole('button', { name: 'Create', exact: true }).tap();
      await expect(wizard).toHaveCount(0, { timeout: WRITE_BUDGET });
      const head = page.locator(`section[data-project="lib.nvim/${project}"]`);
      await expect(head).toBeVisible();

      // Tapped, not clicked: the entry is chosen, and Add puts it into the project.
      await head.locator('button[data-add="project"]').tap();
      const dialog = page.getByRole('dialog', { name: 'Add tasks to Pick e2e touch project' });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('combobox', { name: 'Search open tasks' }).fill('Pick e2e touch r000');
      await dialog.getByRole('option').first().tap();
      await expect(dialog.getByRole('status')).toHaveText('1 chosen');
      await dialog.getByRole('button', { name: 'Add', exact: true }).tap();
      await expect(dialog).toHaveCount(0, { timeout: WRITE_BUDGET });
      await expect.poll(() => front('pick-e2e-touch-r000'), { timeout: WRITE_BUDGET }).toContain(`project: lib.nvim/${project}`);

      // "New task in this project": the capture form opens with the project.
      await head.locator('button[data-add="project"]').tap();
      await page.getByRole('dialog', { name: 'Add tasks to Pick e2e touch project' }).getByRole('button', { name: 'New task in this project' }).tap();
      const form = page.getByRole('dialog', { name: 'New task' });
      await expect(form).toBeVisible();
      await expect(form.locator('button[data-field="project"]')).toHaveText(/Pick e2e touch project/);
      await form.getByLabel('Title').fill('Pick e2e touch new');
      await form.getByRole('button', { name: 'Create', exact: true }).tap();
      await expect(form).toHaveCount(0, { timeout: WRITE_BUDGET });
      await expect.poll(() => front('pick-e2e-touch-new'), { timeout: WRITE_BUDGET }).toContain(`project: lib.nvim/${project}`);

      expect(await violations(page)).toEqual([]);
      expect(problems).toEqual([]);
    } finally {
      rmSync(projectFile, { force: true });
    }
  });
});
