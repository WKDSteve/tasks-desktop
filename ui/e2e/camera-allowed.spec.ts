import { readFileSync, readdirSync } from 'node:fs';
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
