import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { openTask, WRITE_BUDGET } from './camera';
import { expect, test } from './fixtures';

// The question of the browser itself, answered with yes: Chrome's stand-in for a camera and a microphone (a moving test
// picture and a beep), and its question accepted. Nothing of the page is replaced, so the policy of the hub
// (`camera=(self), microphone=(self)` for its page), `getUserMedia` and the recorder are the real ones. A real camera
// and a real microphone stay a check by hand.
test.use({ locale: 'en-US', launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

test('a video is recorded with the camera of the browser and attached, and a photo is taken and attached', async ({ page }) => {
  test.slow();
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  const { float, dir, attached } = await openTask(page, 'Attach browser camera');
  const bar = float.getByRole('group', { name: 'Attach to this task' });
  await bar.locator('details[data-choice="video"] summary').click();
  await page.getByRole('group', { name: 'Video' }).getByRole('button', { name: 'Record a video' }).click();
  const taking = float.getByRole('group', { name: 'Record a video' });
  await expect(taking.getByRole('status')).toContainText('Recording', { timeout: 15_000 });
  await page.waitForTimeout(1000);
  await taking.getByRole('button', { name: 'Stop and attach' }).click();
  await expect(attached).toHaveValue(/^\[video-\d{8}-\d{6}\.webm\]\(assets\/videos\/video-\d{8}-\d{6}\.webm\)$/, { timeout: WRITE_BUDGET });
  const clips = readdirSync(join(dir, 'assets', 'videos'));
  expect(clips).toHaveLength(1);
  const clip = readFileSync(join(dir, 'assets', 'videos', clips[0] ?? ''));
  // A WebM file (EBML) with something in it.
  expect(clip.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))).toBe(true);
  expect(clip.length).toBeGreaterThan(200);

  await bar.locator('details[data-choice="image"] summary').click();
  await page.getByRole('group', { name: 'Image' }).getByRole('button', { name: 'Take a photo' }).click();
  const photo = float.getByRole('group', { name: 'Take a photo' });
  await expect(photo.getByRole('status')).toContainText('The camera is on', { timeout: 15_000 });
  await photo.getByRole('button', { name: 'Take the photo' }).click();
  await expect(attached).toHaveValue(/^!\[photo-\d{8}-\d{6}\.png\]\(assets\/images\/photo-\d{8}-\d{6}\.png\)$/, { timeout: WRITE_BUDGET });
  const photos = readdirSync(join(dir, 'assets', 'images'));
  expect(photos).toHaveLength(1);
  const taken = readFileSync(join(dir, 'assets', 'images', photos[0] ?? ''));
  expect(taken.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
  expect(taken.readUInt32BE(16)).toBeGreaterThan(0);
  expect(problems).toEqual([]);
});

/** How many pictures the task folder holds (none while it has no folder of pictures yet). */
const images = (dir: string): number => (existsSync(join(dir, 'assets', 'images')) ? readdirSync(join(dir, 'assets', 'images')).length : 0);

test('a recording whose upload fails is kept, and is attached when it is sent again', async ({ page }) => {
  test.slow();
  const { float, dir } = await openTask(page, 'Attach browser kept');
  // The first upload is refused as with a full disk; the next ones go through.
  let refused = 0;
  await page.route('**/api/tasks/upload**', async (route) => {
    if (refused > 0) return route.continue().catch(() => undefined);
    refused += 1;
    return route.fulfill({ status: 507, contentType: 'application/json', body: '{"error":{"code":"disk_full","message":"full"}}' });
  });
  const bar = float.getByRole('group', { name: 'Attach to this task' });
  await bar.locator('details[data-choice="image"] summary').click();
  await page.getByRole('group', { name: 'Image' }).getByRole('button', { name: 'Take a photo' }).click();
  const photo = float.getByRole('group', { name: 'Take a photo' });
  await expect(photo.getByRole('status')).toContainText('The camera is on', { timeout: 15_000 });
  await photo.getByRole('button', { name: 'Take the photo' }).click();
  const kept = float.locator('[data-kept="photo"]');
  await expect(kept).toContainText(/photo-\d{8}-\d{6}\.png/, { timeout: WRITE_BUDGET });
  expect(refused).toBe(1);
  // A second photo that is attached leaves the kept one where it is.
  await bar.locator('details[data-choice="image"] summary').click();
  await page.getByRole('group', { name: 'Image' }).getByRole('button', { name: 'Take a photo' }).click();
  await expect(photo.getByRole('status')).toContainText('The camera is on', { timeout: 15_000 });
  await photo.getByRole('button', { name: 'Take the photo' }).click();
  await expect.poll(() => images(dir), { timeout: WRITE_BUDGET }).toBe(1);
  await expect(kept).toHaveCount(1);
  await kept.getByRole('button', { name: 'Send again' }).click();
  await expect.poll(() => images(dir), { timeout: WRITE_BUDGET }).toBe(2);
  await expect(kept).toHaveCount(0);
});
