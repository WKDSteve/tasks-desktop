// The store of a container's images: a file is read once; a new version of the container reads a missing file again,
// and one that its folder lists now and did not before (put there after it was shown), giving the old address back.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetImages } from './assetImages.svelte';

let n = 0;
let revoked: string[] = [];

beforeEach(() => {
  n = 0;
  revoked = [];
  vi.stubGlobal('URL', Object.assign(globalThis.URL, {
    createObjectURL: () => `blob:x/${(n += 1)}`,
    revokeObjectURL: (url: string) => void revoked.push(url),
  }));
});

afterEach(() => vi.unstubAllGlobals());

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('the images of a container', () => {
  it('reads a missing file and a newly listed one again when the version changes, and gives the old address back', async () => {
    const answers = new Map<string, Blob>([['assets/here.png', new Blob(['1'])]]);
    const reads: string[] = [];
    const store = new AssetImages(async (_kind, _id, file) => {
      reads.push(file);
      return answers.get(file) ?? null;
    }, 'meeting', 'a/m');
    store.refresh('e1', ['assets/here.png']);
    expect(store.url('assets/gone.png')).toBeUndefined();
    store.url('assets/here.png');
    await settle();
    expect(store.url('assets/gone.png')).toBeNull();
    expect(store.url('assets/here.png')).toBe('blob:x/1');

    // the same version again: nothing is read
    store.refresh('e1', ['assets/here.png']);
    await settle();
    expect(reads).toEqual(['assets/gone.png', 'assets/here.png']);

    // the missing file is there now, and here.png was replaced and listed anew (its entry came back)
    answers.set('assets/gone.png', new Blob(['2']));
    store.refresh('e1', ['assets/gone.png']);
    await settle();
    expect(reads).toEqual(['assets/gone.png', 'assets/here.png', 'assets/gone.png']);
    expect(store.url('assets/gone.png')).toBe('blob:x/2');

    store.refresh('e2', ['assets/gone.png', 'assets/here.png']);
    await settle();
    expect(reads.slice(3)).toEqual(['assets/here.png']);
    expect(store.url('assets/here.png')).toBe('blob:x/3');
    expect(revoked).toEqual(['blob:x/1']);

    store.dispose();
    expect(revoked.sort()).toEqual(['blob:x/1', 'blob:x/2', 'blob:x/3']);
  });
});
