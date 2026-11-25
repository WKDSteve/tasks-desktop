// @vitest-environment jsdom
// The whole page and the browser's question before it is closed: asked only while a task holds unsaved fields (the
// option to save them with a button), and not asked again once they are saved or the page has none.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, expect, it, vi } from 'vitest';
import App from './App.svelte';

vi.mock('./lib/logo', () => ({ logo: '' }));
import { make, snapshot } from './lib/appDouble';
import { task } from './lib/fixtures';

let page: ReturnType<typeof mount> | undefined;
let made: ReturnType<typeof make> | undefined;

afterEach(async () => {
  if (page) await unmount(page);
  made?.app.stop();
  page = undefined;
  made = undefined;
  document.body.innerHTML = '';
});

async function start(): Promise<ReturnType<typeof make>> {
  made = make({ token: 't' });
  made.hub.doc = snapshot([task('pub/a', { title: 'A task', etag: 'e1' })]);
  page = mount(App, { target: document.body, props: { app: made.app, code: null } });
  flushSync();
  for (let i = 0; i < 20 && made.app.phase !== 'ready'; i += 1) await new Promise((r) => setTimeout(r, 5));
  await tick();
  flushSync();
  return made;
}

/** Whether the browser would ask before the page goes. */
function asks(): boolean {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

it('asks before the page goes only while a task holds unsaved fields', async () => {
  const { app } = await start();
  expect(asks()).toBe(false);
  app.saveMode = 'manual';
  app.drafts = { 'pub/a': { title: 'A new title' } };
  flushSync();
  expect(app.hasDrafts).toBe(true);
  expect(asks()).toBe(true);
  app.drafts = {};
  flushSync();
  expect(asks()).toBe(false);
});
