import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';
import { STATE } from './global';
import { pairingLink } from './hub';

test.use({ locale: 'en-US', viewport: { width: 1100, height: 700 } });

const state = (): { config: never } => JSON.parse(readFileSync(STATE, 'utf8')) as { config: never };

test('the sign-out button is in every view and ends the session: the page asks for pairing, the token is dead', async ({ page, request }) => {
  // A session of its own: signing out the shared one of the other tests would end theirs.
  await page.goto(pairingLink(state().config));
  await expect(page.getByRole('menubar')).toBeVisible();
  const token = await page.evaluate(() => sessionStorage.getItem('tasks-desktop.session'));
  expect(token).toMatch(/^[0-9a-f]{64}$/);
  for (const view of ['list', 'board', 'inbox', 'timeline']) {
    await page.goto(`/#view=${view}`);
    await expect(page.getByRole('menubar')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'This browser is not paired with the hub' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('tasks-desktop.session'))).toBeNull();
  const dead = await request.get('/api/tasks/snapshot', { headers: { Authorization: `Bearer ${token}` } });
  expect(dead.status()).toBe(401);
});
