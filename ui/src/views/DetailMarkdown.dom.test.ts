// @vitest-environment jsdom
// The text of a task before the Markdown reader has come: the reader is a chunk of its own (`markdownLoader.ts`), so
// that it is not in the start of the page. A detail opened before it is there shows the text as written and asks for
// the reader; once it comes, the text is drawn. A reader that does not come leaves the text as written.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import { task } from '../lib/fixtures';

const reader = vi.hoisted(() => {
  let resolve: (module: typeof import('appkit-ui/markdown')) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  let module: typeof import('appkit-ui/markdown') | undefined;
  let asked = 0;
  const load = Object.assign(
    () => {
      asked += 1;
      return new Promise<typeof import('appkit-ui/markdown')>((ok, fail) => {
        resolve = (m) => {
          module = m;
          ok(m);
        };
        reject = fail;
      });
    },
    { loaded: () => module },
  );
  return {
    load,
    asked: () => asked,
    come: (m: typeof import('appkit-ui/markdown')) => resolve(m),
    fail: () => reject(new Error('chunk gone')),
    /** As on a page that has not fetched the reader yet. */
    reset: () => {
      module = undefined;
      asked = 0;
    },
  };
});
vi.mock('./markdownLoader', () => ({ loadMarkdown: reader.load }));

const Detail = (await import('./Detail.svelte')).default;

let mounted: ReturnType<typeof mount> | undefined;
let made: ReturnType<typeof make> | undefined;

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await tick();
    await Promise.resolve();
    flushSync();
  }
}

async function show(body: string) {
  const m = make({ token: 't' });
  made = m;
  m.hub.doc = snapshot([task('pub/a', { title: 'A task', etag: 'e1' })]);
  m.hub.taskBody = body;
  await m.app.start(null);
  m.app.select('pub/a');
  const root = document.createElement('div');
  document.body.append(root);
  mounted = mount(Detail, { target: root, props: { app: m.app } });
  await settle();
  return root;
}

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
  reader.reset();
});

describe('the text of a task before the Markdown reader has come', () => {
  it('shows the text as written, then draws it when the reader comes', async () => {
    const root = await show('# Plan\n\nSome **bold** words');
    expect(reader.asked()).toBeGreaterThan(0);
    expect(root.querySelector('pre.body')?.textContent).toBe('# Plan\n\nSome **bold** words');
    expect(root.querySelector('.prose')).toBeNull();

    reader.come(await vi.importActual<typeof import('appkit-ui/markdown')>('appkit-ui/markdown'));
    await settle();
    expect(root.querySelector('pre.body')).toBeNull();
    expect(root.querySelector('.prose strong')?.textContent).toBe('bold');
  });
});

describe('a reader that does not come', () => {
  it('leaves the text as written and nothing breaks', async () => {
    const root = await show('Some **bold** words');
    reader.fail();
    await settle();
    expect(root.querySelector('pre.body')?.textContent).toBe('Some **bold** words');
  });
});
