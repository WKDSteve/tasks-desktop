// The store of a container's images: a file is read once; a new version of the container asks again for every file
// shown (a missing one whole, the others with the tag of their bytes), and so does `recheck` (the window back in front):
// the same bytes keep the address, other bytes under the same name replace it and give the old one back.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetAnswer } from './api';
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const settle = () => new Promise((r) => setTimeout(r, 0));

/** A folder of files by name, each with the tag of its content; a read with that tag answers 'same'. */
function folder(files: Record<string, string>) {
  const answers = new Map(Object.entries(files));
  const reads: string[] = [];
  const load = async (_kind: string, _id: string, file: string, held?: string): Promise<AssetAnswer> => {
    reads.push(held ? `${file} if ${held}` : file);
    const text = answers.get(file);
    if (text === undefined) return null;
    const tag = `"t-${text}"`;
    return held === tag ? 'same' : { blob: new Blob([text]), tag };
  };
  return { answers, reads, load };
}

describe('the images of a container', () => {
  it('asks again for every file when the version changes: a missing one whole, the others with their tag', async () => {
    const f = folder({ 'assets/here.png': '1' });
    const store = new AssetImages(f.load, 'meeting', 'a/m');
    store.refresh('e1', ['assets/here.png']);
    expect(store.url('assets/gone.png')).toBeUndefined();
    store.url('assets/here.png');
    await settle();
    expect(store.url('assets/gone.png')).toBeNull();
    expect(store.url('assets/here.png')).toBe('blob:x/1');

    // the same version again: nothing is read
    store.refresh('e1', ['assets/here.png']);
    await settle();
    expect(f.reads).toEqual(['assets/gone.png', 'assets/here.png']);

    // the missing file is there now: it is read whole, here.png with its tag (unchanged: its address stays)
    f.answers.set('assets/gone.png', '2');
    store.refresh('e2', ['assets/gone.png']);
    await settle();
    expect(f.reads.slice(2).sort()).toEqual(['assets/gone.png', 'assets/here.png if "t-1"']);
    expect(store.url('assets/gone.png')).toBe('blob:x/2');
    expect(store.url('assets/here.png')).toBe('blob:x/1');

    // here.png listed anew (its entry came back): read whole, a new address, the old one given back
    store.refresh('e2', ['assets/gone.png', 'assets/here.png']);
    await settle();
    expect(f.reads.slice(4).sort()).toEqual(['assets/gone.png if "t-2"', 'assets/here.png']);
    expect(store.url('assets/here.png')).toBe('blob:x/3');
    expect(revoked).toEqual(['blob:x/1']);

    store.dispose();
    expect(revoked.sort()).toEqual(['blob:x/1', 'blob:x/2', 'blob:x/3']);
  });

  it('shows a file replaced by hand under the same name once it is asked again, and keeps an unchanged one', async () => {
    const f = folder({ 'assets/a.png': 'old', 'assets/b.png': 'same' });
    const store = new AssetImages(f.load, 'task', 'a/t');
    store.url('assets/a.png');
    store.url('assets/b.png');
    await settle();
    expect(store.url('assets/a.png')).toBe('blob:x/1');
    expect(store.url('assets/b.png')).toBe('blob:x/2');

    // a.png replaced in its folder: no version of the container changes, only the window comes back
    f.answers.set('assets/a.png', 'new');
    store.recheck();
    await settle();
    expect(f.reads.slice(2).sort()).toEqual(['assets/a.png if "t-old"', 'assets/b.png if "t-same"']);
    expect(store.url('assets/a.png')).toBe('blob:x/3');
    expect(store.url('assets/b.png')).toBe('blob:x/2');
    expect(revoked).toEqual(['blob:x/1']);

    // removed: the page's word for a missing image; a read still on its way is not asked twice
    f.answers.delete('assets/a.png');
    store.recheck();
    store.recheck();
    await settle();
    expect(store.url('assets/a.png')).toBeNull();
    expect(f.reads.filter((r) => r.startsWith('assets/a.png'))).toHaveLength(3);
    store.dispose();
  });

  it('asks again when the window comes to the front only where it was asked to (not the icon of every row)', async () => {
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', doc);
    const f = folder({ 'assets/a.png': '1' });
    const icon = new AssetImages(f.load, 'task', 'a/icon');
    const page = new AssetImages(f.load, 'task', 'a/page', { recheckOnFront: true });
    icon.url('assets/a.png');
    page.url('assets/a.png');
    await settle();
    win.dispatchEvent(new Event('focus'));
    await settle();
    expect(f.reads).toEqual(['assets/a.png', 'assets/a.png', 'assets/a.png if "t-1"']);
    page.dispose();
    icon.dispose();
    // later than the gap between two asks: a store given back has let go of the window
    const later = Date.now() + 5000;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    win.dispatchEvent(new Event('focus'));
    doc.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(f.reads).toHaveLength(3);
  });

  it('asks nothing once it is given back', async () => {
    const f = folder({ 'assets/a.png': '1' });
    const store = new AssetImages(f.load, 'task', 'a/t');
    store.url('assets/a.png');
    await settle();
    store.dispose();
    store.recheck();
    store.refresh('e9', ['assets/a.png', 'assets/b.png']);
    await settle();
    expect(f.reads).toEqual(['assets/a.png']);
  });
});
