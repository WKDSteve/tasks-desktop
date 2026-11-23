// @vitest-environment jsdom
// "Open in DocMap" at a task: the button shows only where the hub says docmap-desktop is found and can open the place
// (a `code-ref` block or a ref `<file>:<lines>` of the task), one button per place, and a click names the task and the
// number of the place, never a path.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import { task } from '../lib/fixtures';
import Detail from './Detail.svelte';

type Made = ReturnType<typeof make>;

let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await tick();
    await Promise.resolve();
    flushSync();
  }
}

const BLOCK = '```code-ref\n{ "schema": "code-ref/1", "repo": "x", "file": "a.lua", "lines": [1, 2] }\n```';

async function show(opts: { body?: string; refs?: string[]; docmap?: Made['hub']['docmapDoc']; web?: boolean }) {
  const m = make({ token: 't', ...(opts.web ? { mode: 'web' as const } : {}) });
  made = m;
  m.hub.doc = snapshot([task('pub/a', { title: 'A task', etag: 'e1', refs: opts.refs ?? [] })]);
  m.hub.taskBody = opts.body ?? 'text';
  m.hub.docmapDoc = opts.docmap ?? null;
  await m.app.start(null);
  m.app.select('pub/a');
  const root = document.createElement('div');
  document.body.append(root);
  mounted = mount(Detail, { target: root, props: { app: m.app } });
  await settle();
  // The buttons live in a chunk that is loaded on demand: wait for it (a task without a place never loads it).
  const mayShow = (opts.body ?? '').includes('code-ref') || (opts.refs ?? []).some((r) => r.includes(':'));
  if (mayShow && !opts.web) await vi.waitFor(() => expect(m.hub.docmapAsked).toBeGreaterThan(0));
  await settle();
  return { m, buttons: () => [...root.querySelectorAll<HTMLButtonElement>('[data-testid="open-docmap"]')] };
}

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

describe('the button "Open in DocMap" of the detail', () => {
  it('shows for a task with a code-ref block that the hub can open, and a click names task and number', async () => {
    const { m, buttons } = await show({
      body: BLOCK,
      docmap: { found: true, places: [{ label: 'a.lua:1-2', repo: 'x', ok: true }] },
    });
    expect(buttons().map((b) => b.textContent?.trim())).toEqual(['In DocMap öffnen']);
    buttons()[0]?.click();
    await settle();
    expect(m.hub.docmapOpened).toEqual(['pub/a 0']);
  });

  it('shows for a ref <file>:<lines> without a block, one button per place the hub can open, with its place', async () => {
    const { m, buttons } = await show({
      refs: ['a.lua:3-4', 'b.lua:9'],
      docmap: {
        found: true,
        places: [
          { label: 'a.lua:3-4', repo: 'x', ok: false, why: 'the repo is not one of your tiles' },
          { label: 'b.lua:9', repo: 'x', ok: true },
        ],
      },
    });
    // Only the second place can be opened: its button stands alone, and a click names number 1 (not 0).
    expect(buttons().map((b) => b.textContent?.trim())).toEqual(['In DocMap öffnen']);
    buttons()[0]?.click();
    await settle();
    expect(m.hub.docmapOpened).toEqual(['pub/a 1']);
  });

  it('names the place on each button when several can be opened', async () => {
    const { buttons } = await show({
      body: BLOCK,
      docmap: {
        found: true,
        places: [
          { label: 'a.lua:1-2', repo: 'x', ok: true },
          { label: 'b.lua:9', repo: 'x', ok: true },
        ],
      },
    });
    expect(buttons().map((b) => b.textContent?.trim())).toEqual([
      'In DocMap öffnen: a.lua:1-2',
      'In DocMap öffnen: b.lua:9',
    ]);
  });

  it('is not there without docmap-desktop, without a place, for a place the hub refuses, or in the web variant', async () => {
    const ok = [{ label: 'a.lua:1-2', repo: 'x', ok: true }];
    for (const opts of [
      { body: BLOCK, docmap: { found: false, places: ok } },
      { body: 'no place here', refs: ['a task/slug'], docmap: { found: true, places: ok } },
      { body: BLOCK, docmap: { found: true, places: [{ label: 'a.lua:1-2', repo: 'x', ok: false }] } },
      { body: BLOCK, docmap: null },
      { body: BLOCK, docmap: { found: true, places: ok }, web: true },
    ]) {
      const { buttons } = await show(opts);
      expect(buttons(), JSON.stringify(opts)).toEqual([]);
      if (mounted) void unmount(mounted);
      mounted = undefined;
      made?.app.stop();
      document.body.replaceChildren();
    }
  });
});
