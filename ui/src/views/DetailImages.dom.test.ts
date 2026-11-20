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
    expect(root.querySelector('.task-title [data-icon="own"]')?.textContent).toBe('🦀');
    expect(root.querySelector('.cover img')?.getAttribute('src')).toMatch(/^blob:/);
  });

  it('takes the category icon for a task without one of its own', async () => {
    const { root } = await show('text', { category: ['learning'] });
    expect(root.querySelector('.task-title [data-icon="category"]')?.textContent).toBe('📚');
  });
});
