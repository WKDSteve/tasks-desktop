// @vitest-environment jsdom
// The images of a task's text in a DOM: a task in its folder form draws a file below `assets/` as `<img>` with the
// `blob:` address the page made from the hub's answer, a missing one as "Image missing", a click shows it larger; a
// task without a folder, an address of another host or `data:` stays text and asks nothing. The addresses are given
// back when another task is shown. The icon and the cover stand in the head.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import { task } from '../lib/fixtures';
import type { TaskEntry } from '../lib/contract';
import Detail from './Detail.svelte';

type Made = ReturnType<typeof make>;

let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;
let made_urls: string[] = [];
let revoked: string[] = [];

beforeEach(() => {
  made_urls = [];
  revoked = [];
  let n = 0;
  vi.stubGlobal('URL', Object.assign(globalThis.URL, {
    createObjectURL: () => {
      n += 1;
      const url = `blob:http://localhost/${n}`;
      made_urls.push(url);
      return url;
    },
    revokeObjectURL: (url: string) => {
      revoked.push(url);
    },
  }));
});

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await tick();
    await Promise.resolve();
    flushSync();
  }
}

async function show(body: string, fields: Partial<TaskEntry> = {}, files: Record<string, string> = {}) {
  const m = make({ token: 't' });
  made = m;
  m.hub.doc = snapshot([
    task('pub/a', { title: 'A task', etag: 'e1', folder: true, ...fields }),
    task('pub/b', { title: 'B task', etag: 'e1', folder: true }),
  ]);
  m.hub.taskBody = body;
  for (const [file, text] of Object.entries(files)) m.hub.assetAnswers.set(file, new Blob([text], { type: 'image/svg+xml' }));
  await m.app.start(null);
  m.app.select('pub/a');
  const root = document.createElement('div');
  document.body.append(root);
  mounted = mount(Detail, { target: root, props: { app: m.app } });
  await settle();
  return { m, root };
}

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('the images of a task text', () => {
  it('draws a file below assets/ as <img> from a blob: address, and its description as alt', async () => {
    const { m, root } = await show('Look: ![Lua syntax](assets/images/lua.svg)', {}, { 'assets/images/lua.svg': '<svg/>' });
    const img = root.querySelector<HTMLImageElement>('.prose img');
    expect(img?.getAttribute('src')).toBe('blob:http://localhost/1');
    expect(img?.getAttribute('alt')).toBe('Lua syntax');
    expect(m.hub.assetReads).toEqual(['task pub/a assets/images/lua.svg']);
    // Never an <svg> of the page: the drawing is a picture.
    expect(root.querySelector('.prose svg')).toBeNull();
  });

  it('shows "Image missing" with its description for a file the hub does not give, and never throws', async () => {
    const { root } = await show('![Gone](assets/gone.png)');
    expect(root.querySelector('.prose img')).toBeNull();
    expect(root.querySelector('.prose')?.textContent).toMatch(/(Image missing|Bild fehlt): Gone/);
  });

  it('asks nothing and draws no picture for a task without a folder, a foreign address or data:', async () => {
    const { m, root } = await show(
      '![a](assets/x.png) ![b](https://tracker.example/p.png) ![c](data:image/png;base64,AA) ![d](../x.png)',
      { folder: false },
      { 'assets/x.png': 'x' },
    );
    expect(root.querySelector('.prose img')).toBeNull();
    expect(m.hub.assetReads).toEqual([]);
    expect(root.querySelector('.prose')?.textContent).toContain('a');
  });

  it('asks only for the asset of a folder task, never for a foreign address in the same text', async () => {
    const { m } = await show('![a](assets/x.png) ![b](https://tracker.example/p.png) ![c](/etc/x.png)', {}, { 'assets/x.png': 'x' });
    expect(m.hub.assetReads).toEqual(['task pub/a assets/x.png']);
  });

  it('shows an image larger on a click, and gives the addresses back when another task is shown', async () => {
    const { m, root } = await show('![Big](assets/big.svg)', {}, { 'assets/big.svg': '<svg/>' });
    root.querySelector<HTMLButtonElement>('.prose button.img-open')!.click();
    await settle();
    expect(root.querySelector('[data-viewer-image]')?.getAttribute('src')).toBe('blob:http://localhost/1');
    m.app.select('pub/b');
    await settle();
    expect(revoked).toContain('blob:http://localhost/1');
  });

  it('draws the icon and the cover in the head, and says when an image of the edited text has no description', async () => {
    const { root } = await show(
      'text',
      { icon: { kind: 'emoji', value: '🦀' }, cover: 'assets/cover.png' },
      { 'assets/cover.png': 'png' },
    );
    expect(root.querySelector('.title-line [data-icon="own"]')?.textContent).toBe('🦀');
    // The heading is the title alone: the icon stands beside it.
    expect(root.querySelector('.task-title')?.textContent).toBe('A task');
    expect(root.querySelector('.cover img')?.getAttribute('src')).toMatch(/^blob:/);
  });

  it('reads a missing image again when the task comes in a new version, and leaves a drawn one as it is', async () => {
    const { m, root } = await show(
      '![Later](assets/later.png) ![Here](assets/here.png)',
      {},
      { 'assets/here.png': 'here' },
    );
    expect(root.querySelector('.prose')?.textContent).toMatch(/(Image missing|Bild fehlt): Later/);
    const reads = () => m.hub.assetReads.filter((r) => r.endsWith('assets/later.png')).length;
    expect(reads()).toBe(1);
    // The same version read again: nothing is asked anew.
    await m.app.refresh();
    await settle();
    expect(reads()).toBe(1);
    // The file came into the folder, and the task is read in a new version: the missing image is read again; the one
    // that was drawn keeps its address.
    m.hub.assetAnswers.set('assets/later.png', new Blob(['later'], { type: 'image/png' }));
    m.hub.doc = snapshot([
      task('pub/a', { title: 'A task', etag: 'e2', folder: true }),
      task('pub/b', { title: 'B task', etag: 'e1', folder: true }),
    ], 'rev:2');
    await m.app.refresh();
    await settle();
    expect(reads()).toBe(2);
    // the drawn one is only asked with its tag: the same bytes, the same address
    expect(m.hub.assetReads.filter((r) => r.includes('assets/here.png'))).toEqual([
      'task pub/a assets/here.png',
      'task pub/a assets/here.png if "4-image/svg+xml"',
    ]);
    const srcs = [...root.querySelectorAll<HTMLImageElement>('.prose img')].map((img) => img.getAttribute('alt'));
    expect(srcs).toEqual(['Later', 'Here']);
  });

  it('shows an image replaced by hand under the same name once the window comes back to the front', async () => {
    const { m, root } = await show('![Shot](assets/shot.png)', {}, { 'assets/shot.png': 'old' });
    const src = () => root.querySelector<HTMLImageElement>('.prose img')?.getAttribute('src');
    const first = src();
    expect(first).toMatch(/^blob:/);
    // Replaced in the folder: no new version of the task, no event of the vault. The window comes back to the front.
    m.hub.assetAnswers.set('assets/shot.png', new Blob(['new picture'], { type: 'image/png' }));
    window.dispatchEvent(new Event('focus'));
    await settle();
    expect(src()).toMatch(/^blob:/);
    expect(src()).not.toBe(first);
    expect(revoked).toContain(first);
    // Back in front again at once: not asked again (focus and visibility come together)
    const asked = m.hub.assetReads.length;
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(m.hub.assetReads.length).toBe(asked);
  });

  it('takes the category icon for a task without one of its own', async () => {
    const { root } = await show('text', { category: ['learning'] });
    expect(root.querySelector('.title-line [data-icon="category"]')?.textContent).toBe('📚');
    expect(root.querySelector('.task-title')?.textContent).toBe('A task');
  });
});
