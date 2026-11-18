import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openTask } from './camera';
import { expect, test } from './fixtures';

// The question of the browser itself, answered with no: Chrome has a stand-in camera, the hub lets the page use it,
// and nobody allows it (a test browser refuses a question nobody answers). The page tells it and attaches nothing.
test.use({ locale: 'en-US', launchOptions: { args: ['--use-fake-device-for-media-stream'] } });

test('a question of the browser that is refused is told, and nothing is attached', async ({ page }) => {
  const { float, dir } = await openTask(page, 'Attach browser refused');
  const bar = float.getByRole('group', { name: 'Attach to this task' });
  await bar.locator('details[data-choice="image"] summary').click();
  const take = page.getByRole('group', { name: 'Image' }).getByRole('button', { name: 'Take a photo' });
  // The hub does not stand in the way: the entry can be chosen.
  await expect(take).not.toHaveAttribute('aria-disabled', 'true');
  await take.click();
  await expect(page.getByRole('alert').filter({ hasText: 'The camera was not allowed' })).toBeVisible({ timeout: 15_000 });
  await expect(float.locator('[data-taking]')).toHaveCount(0);
  expect(existsSync(join(dir, 'assets'))).toBe(false);
});
