// @vitest-environment jsdom
// The icon of an item in a DOM: an asset icon is read once for its owner and drawn from a `blob:` address; when the
// icon becomes an emoji (or the owner another) the address is given back, and a change of the icon object for the
// same owner reads nothing again.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../lib/app.svelte';
import type { ShownIcon } from '../lib/icons';
import ItemIcon from './ItemIcon.svelte';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await tick();
    await Promise.resolve();
    flushSync();
  }
}

describe('ItemIcon', () => {
  it('reads an asset icon once, and gives its address back when the icon is an emoji', async () => {
    const revoked: string[] = [];
    let n = 0;
    vi.stubGlobal(
      'URL',
      Object.assign(globalThis.URL, {
        createObjectURL: () => `blob:http://localhost/i${(n += 1)}`,
        revokeObjectURL: (url: string) => void revoked.push(url),
      }),
    );
    const reads: string[] = [];
    const app = {
      asset: async (kind: string, id: string, file: string) => {
        reads.push(`${kind} ${id} ${file}`);
        return new Blob(['<svg/>']);
      },
    } as unknown as App;
    const asset = (): ShownIcon => ({ icon: { kind: 'asset', value: 'assets/i.svg' }, owner: { kind: 'path', id: 'a/p' }, from: 'path' });
    const props = $state<{ app: App; shown: ShownIcon | null }>({ app, shown: asset() });
    const target = document.createElement('div');
    document.body.append(target);
    const mounted = mount(ItemIcon, { target, props });
    await settle();
    expect(target.querySelector('img')?.getAttribute('src')).toBe('blob:http://localhost/i1');

    // Another object for the same owner and file: nothing is read again.
    props.shown = asset();
    await settle();
    expect(reads, 'nothing is read again').toEqual(['path a/p assets/i.svg']);
    expect(revoked).toEqual([]);

    props.shown = { icon: { kind: 'emoji', value: '🦀' }, owner: { kind: 'path', id: 'a/p' }, from: 'path' };
    await settle();
    expect(target.textContent).toContain('🦀');
    expect(revoked).toEqual(['blob:http://localhost/i1']);
    void unmount(mounted);
  });
});
