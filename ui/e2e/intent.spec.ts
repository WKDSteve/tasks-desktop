import { expectAccessible, watchViolations } from './a11y';
import { state, WRITE_BUDGET } from './camera';
import { expect, test } from './fixtures';

// "Paste an intent": what another app hands over (wkd-intent/1) is pasted into the field or chosen as a file, checked
// by the real engine through the hub, and becomes the new-task form filled in. Nothing is written before Create; the
// same finding a second time is told with the task that holds it.

test.use({ locale: 'en-US' });

test('an intent is pasted: the finding fills the new-task form, Create makes the task, and the same finding again names it', async ({ page }) => {
  test.slow();
  const fp = `${Date.now().toString(16)}${test.info().repeatEachIndex}${test.info().retry}`.padStart(16, '0').slice(-16);
  const title = `Finding ${fp}: an empty line ends the list`;
  const intent = (change: (doc: { finding: Record<string, unknown> }) => void = () => undefined): string => {
    const doc = {
      schema: 'wkd-intent/1',
      action: 'tasks.new',
      mode: 'form',
      source: { app: 'testing', finding: fp },
      finding: {
        schema: 'testing-finding/1',
        fp,
        kind: 'case',
        repo: 'lib.nvim',
        area: 'lib.nvim',
        sha: '0123456789abcdef0123456789abcdef01234567',
        class: 'internal',
        where: { file: 'TESTS/parse_spec.lua', line: 12 },
        run: { source: 'ci', id: '1234', os: 'linux', url: 'https://github.com/example/lib.nvim/actions/runs/1234' },
        title,
        excerpt: 'expected 2 items, got 1',
        repro: 'scripts/test.sh --file parse_spec',
        rule: null,
      } as Record<string, unknown>,
      target: null,
    };
    change(doc);
    return JSON.stringify(doc, null, 2);
  };
  await watchViolations(page);
  await page.addInitScript((token) => sessionStorage.setItem('tasks-desktop.session', token), state().token);
  await page.goto('/#view=list');
  await expect(page.getByRole('menubar')).toBeVisible();
  const open = async (): Promise<void> => {
    await page.getByRole('menuitem', { name: 'Work', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Paste an intent ...' }).click();
    await expect(page.getByRole('dialog', { name: 'Paste an intent' })).toBeVisible();
  };
  const dialog = page.getByRole('dialog', { name: 'Paste an intent' });
  const field = dialog.getByLabel(/^The intent/);

  // What breaks a rule of the schema is refused by the engine, in its words, and no form opens.
  await open();
  await expectAccessible(page, 'the dialog of a pasted intent');
  await field.fill(intent((doc) => (doc.finding['class'] = 'private')));
  await dialog.getByRole('button', { name: 'Check' }).click();
  await expect(dialog.getByRole('alert')).toContainText('The intent was not taken');
  await expect(dialog.getByRole('alert')).toContainText('class');
  await field.fill(intent((doc) => (doc.finding['where'] = { file: 'C:\\Users\\x\\secret.lua', line: 1 })));
  await dialog.getByRole('button', { name: 'Check' }).click();
  await expect(dialog.getByRole('alert')).toContainText('The intent was not taken');
  await field.fill('this is no intent');
  await dialog.getByRole('button', { name: 'Check' }).click();
  await expect(dialog.getByRole('alert')).toContainText('one JSON object is expected');
  await expect(page.getByRole('dialog', { name: 'New task' })).toHaveCount(0);

  // The finding: the form of a new task, filled in. Nothing is written yet.
  await field.fill(intent());
  await dialog.getByRole('button', { name: 'Check' }).click();
  const capture = page.getByRole('dialog', { name: 'New task' });
  await expect(capture).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(capture.getByLabel('Title')).toHaveValue(title);
  await expect(capture.locator('select').first()).toHaveValue('lib.nvim');
  await expect(capture.getByLabel(/^Context/)).toHaveValue(/A finding of testing\.nvim \(`[0-9a-f]{16}`\):[\s\S]*expected 2 items, got 1/);
  await expect(page.locator('button.row', { hasText: title })).toHaveCount(0);
  await capture.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('status').getByText('Saved.')).toBeVisible({ timeout: WRITE_BUDGET });
  const id = (await page.locator('aside.detail .id, dialog.peek[open] .id').first().innerText()).trim();
  expect(id).toMatch(/^lib\.nvim\//);

  // The same finding again: the task that holds it, offered to be opened; no second form.
  await page.keyboard.press('Escape');
  await open();
  await field.fill(intent());
  await dialog.getByRole('button', { name: 'Check' }).click();
  await expect(dialog.getByRole('status')).toContainText(`A task holds this finding already: ${id}`, { timeout: WRITE_BUDGET });
  await expect(page.getByRole('dialog', { name: 'New task' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Open that task' }).click();
  const float = page.locator('dialog.peek[open]');
  await expect(float).toContainText(title);
  await page.keyboard.press('Escape');

  // tasks.show, from a file: the task is shown.
  await open();
  const show = { schema: 'wkd-intent/1', action: 'tasks.show', mode: 'form', source: { app: 'hub' }, finding: null, target: { id } };
  await dialog.locator('input[type=file]').setInputFiles({ name: 'show.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(show)) });
  await expect(float).toContainText(title, { timeout: WRITE_BUDGET });
  await expect(dialog).toHaveCount(0);
});
