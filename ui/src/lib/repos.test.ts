import { describe, expect, it } from 'vitest';
import {
  groupAdded,
  groupMoved,
  groupRemoved,
  groupRenamed,
  initial,
  newId,
  parseRepos,
  repoRemoved,
  saveBody,
  tileCopied,
  tileMoved,
  tileTaken,
  type RepoGroup,
} from './repos';

const doc = {
  kind: 'hub.repos',
  rev: 'fnv1a:1',
  repos: {
    aaaa0001: { name: 'Tasks', label: 'tasks.nvim', image: true, area: 'tasks.nvim' },
    aaaa0002: { name: 'lib', label: 'wkdbook-lib.nvim', image: false, area: null },
    aaaa0003: { name: 'UI kit', label: 'appkit', image: false, area: null },
  },
  groups: [
    { id: 'gggg0001', title: 'Files & Navigation', tiles: ['aaaa0001', 'aaaa0002'] },
    { id: 'gggg0002', title: 'UI', tiles: ['aaaa0001', 'aaaa0003'] },
  ],
};
const groups = (): RepoGroup[] => parseRepos(doc).groups;
const tiles = (gs: RepoGroup[]) => gs.map((g) => [g.id, g.tiles]);

describe('the document of the hub', () => {
  it('is read as it is, and what is not whole is dropped', () => {
    const read = parseRepos(doc);
    expect(read.groups).toHaveLength(2);
    expect(read.repos['aaaa0002']?.area).toBeNull();
    const odd = parseRepos({
      ...doc,
      repos: { ...doc.repos, BAD: { name: 'x', label: 'x' }, cccc0001: { name: 7 } },
      groups: [{ id: 'gggg0001', title: 'T', tiles: ['aaaa0001', 'aaaa0001', 'zzzz9999'] }, { id: 'x', title: 'no' }],
    });
    expect(Object.keys(odd.repos)).toEqual(['aaaa0001', 'aaaa0002', 'aaaa0003']);
    expect(tiles(odd.groups)).toEqual([['gggg0001', ['aaaa0001']]]);
  });

  it('is an empty page that says it is broken for what is no document, and keeps the word of the hub', () => {
    for (const bad of [null, 'x', { kind: 'hub.other', rev: '1' }, { kind: 'hub.repos' }]) {
      expect(parseRepos(bad)).toMatchObject({ problem: 'invalid', groups: [], repos: {} });
    }
    expect(parseRepos({ ...doc, groups: [], problem: 'invalid', message: 'repos.json: schema 2' })).toMatchObject({
      problem: 'invalid',
      message: 'repos.json: schema 2',
    });
  });
});

describe('the order of the tiles', () => {
  it('moves a tile in its group and into another, and a tile the other holds only moves there', () => {
    expect(tiles(tileMoved(groups(), 'aaaa0002', 'gggg0001', 'gggg0001', 0))[0]).toEqual(['gggg0001', ['aaaa0002', 'aaaa0001']]);
    expect(tiles(tileMoved(groups(), 'aaaa0002', 'gggg0001', 'gggg0002', 1))).toEqual([
      ['gggg0001', ['aaaa0001']],
      ['gggg0002', ['aaaa0001', 'aaaa0002', 'aaaa0003']],
    ]);
    expect(tiles(tileMoved(groups(), 'aaaa0001', 'gggg0001', 'gggg0002', 99))).toEqual([
      ['gggg0001', ['aaaa0002']],
      ['gggg0002', ['aaaa0003', 'aaaa0001']],
    ]);
    expect(tiles(tileMoved(groups(), 'aaaa0003', 'gggg0001', 'gggg0002', 0))).toEqual(tiles(groups()));
  });

  it('copies a tile into a group once, takes it out of one group, or out of all', () => {
    expect(tiles(tileCopied(groups(), 'aaaa0003', 'gggg0001'))[0]).toEqual(['gggg0001', ['aaaa0001', 'aaaa0002', 'aaaa0003']]);
    expect(tiles(tileCopied(groups(), 'aaaa0001', 'gggg0002'))).toEqual(tiles(groups()));
    expect(tiles(tileTaken(groups(), 'aaaa0001', 'gggg0002'))).toEqual([
      ['gggg0001', ['aaaa0001', 'aaaa0002']],
      ['gggg0002', ['aaaa0003']],
    ]);
    expect(tiles(repoRemoved(groups(), 'aaaa0001'))).toEqual([
      ['gggg0001', ['aaaa0002']],
      ['gggg0002', ['aaaa0003']],
    ]);
  });

  it('adds, renames, moves and removes a group, and leaves the original as it was', () => {
    const before = groups();
    const added = groupAdded(before, '  Tools ', 'gggg0003');
    expect(added.at(-1)).toEqual({ id: 'gggg0003', title: 'Tools', tiles: [] });
    expect(groupRenamed(added, 'gggg0003', 'Build').at(-1)?.title).toBe('Build');
    expect(groupMoved(added, 'gggg0003', -1).map((g) => g.id)).toEqual(['gggg0001', 'gggg0003', 'gggg0002']);
    expect(groupMoved(added, 'gggg0001', -1).map((g) => g.id)).toEqual(['gggg0001', 'gggg0002', 'gggg0003']);
    expect(groupRemoved(added, 'gggg0002').map((g) => g.id)).toEqual(['gggg0001', 'gggg0003']);
    expect(before).toEqual(groups());
  });
});

describe('what a tile needs', () => {
  it('shows the first letter of its name when it has no image', () => {
    expect(initial('lib')).toBe('L');
    expect(initial('  émoji')).toBe('É');
    expect(initial('')).toBe('?');
  });

  it('makes an id of 8 lowercase letters or digits, not a taken one', () => {
    let n = 0;
    const random = (b: Uint8Array) => b.map(() => (n++ * 7) % 256);
    const first = newId(random);
    expect(first).toMatch(/^[a-z0-9]{8}$/);
    expect(newId(random, (id) => id === first)).not.toBe(first);
    expect(() => newId(() => new Uint8Array(8), () => true)).toThrow('no free id');
  });

  it('sends the groups and the names on the state it read', () => {
    const read = parseRepos(doc);
    expect(saveBody(read, read.groups, { aaaa0002: 'Lib' })).toEqual({ rev: 'fnv1a:1', groups: read.groups, names: { aaaa0002: 'Lib' } });
  });
});
