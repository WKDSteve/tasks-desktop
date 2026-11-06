import { describe, expect, it } from 'vitest';
import { CheckoutFolder, MAX_SNAPSHOT_BYTES, readSnapshot, snapshotParts, type SnapshotDir } from './snapshots';

const NAME = 'ui.nvim/TESTS/__snapshots__/sheets/a.sheet/grid.snap';

/** A folder of the browser from a tree of names: a string is a file. */
function folder(tree: Record<string, unknown>): SnapshotDir {
  return {
    async getDirectoryHandle(name) {
      const next = tree[name];
      if (typeof next !== 'object' || next === null) throw new Error('NotFoundError');
      return folder(next as Record<string, unknown>);
    },
    async getFileHandle(name) {
      const next = tree[name];
      if (typeof next !== 'string') throw new Error('NotFoundError');
      return { getFile: async () => new Blob([next]) };
    },
  };
}

const checkouts = (text: string) =>
  folder({ 'ui.nvim': { TESTS: { __snapshots__: { sheets: { 'a.sheet': { 'grid.snap': text } } }, 'secret.snap': 'no' } } });

describe('the name of a snapshot', () => {
  it('is that of the hub', () => {
    expect(snapshotParts(NAME)).toHaveLength(6);
  });
  it.each([
    '',
    'ui.nvim/TESTS/secret.snap',
    'ui.nvim/TESTS/__snapshots__/../secret.snap',
    'ui.nvim/TESTS/__snapshots__/../../../other/x.snap',
    '../ui.nvim/TESTS/__snapshots__/a.snap',
    'ui.nvim/TESTS/__snapshots__/a.txt',
    'ui.nvim\\TESTS\\__snapshots__\\a.snap',
    'ui.nvim/TESTS/__snapshots__/.hidden/a.snap',
    'ui.nvim/TESTS/__snapshots__//a.snap',
    'C:/TESTS/__snapshots__/a.snap',
    `ui.nvim/TESTS/__snapshots__/${'x'.repeat(400)}.snap`,
  ])('refuses %s', async (name) => {
    expect(snapshotParts(name)).toBeNull();
    await expect(readSnapshot(checkouts('x'), name)).rejects.toMatchObject({ code: 'bad_name' });
  });
});

describe('reading a snapshot', () => {
  it('gives its text', async () => {
    expect(await readSnapshot(checkouts('a grid'), NAME)).toBe('a grid');
  });
  it('says when it is not there or too large', async () => {
    await expect(readSnapshot(folder({}), NAME)).rejects.toMatchObject({ code: 'not_found' });
    await expect(readSnapshot(checkouts('x'.repeat(MAX_SNAPSHOT_BYTES + 1)), NAME)).rejects.toMatchObject({ code: 'too_large' });
  });
});

describe('the folder of the checkouts', () => {
  it('is asked for by a click; before that every read says so in one code', async () => {
    let answer: SnapshotDir | null = null;
    const place = new CheckoutFolder(async () => answer);
    await expect(place.read(NAME)).rejects.toMatchObject({ code: 'no_checkouts' });
    expect(await place.choose()).toBe(false);
    answer = checkouts('a grid');
    expect(await place.choose()).toBe(true);
    expect(await place.read(NAME)).toBe('a grid');
  });
});
