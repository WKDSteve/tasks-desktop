// The badges of all paths: the tiles come from the engine's levels as they are (reached, missing, the day), the next one
// of each path carries how far it is, and the filters and groupings only order them.
import { describe, expect, it } from 'vitest';
import type { PathEntry, PathEntryLevel } from './contract';
import { badgeImage, badgeTiles, dayDate, filterTiles, groupByDate, groupByPath, levelProgress, walkTiles } from './badges';

const level = (over: Partial<PathEntryLevel> & { ref: string }): PathEntryLevel => ({
  line: 1,
  kind: 'xp',
  given: false,
  reached: false,
  ...over,
});

const path = (id: string, levels: PathEntryLevel[], over: Partial<PathEntry> = {}): PathEntry =>
  ({
    id,
    area: 'learning',
    title: `Title ${id}`,
    status: 'open',
    progress: { learned: 0, seen: 0, dropped: 0, open: 0, blocked: 0, total: 0 },
    file: `learning/ROADMAP/paths/${id}.md`,
    valid: true,
    problems: [],
    levels,
    ...over,
  }) as unknown as PathEntry;

describe('levelProgress', () => {
  it('turns what is missing into a share of the threshold', () => {
    expect(levelProgress(level({ ref: '1', kind: 'xp', threshold: 100, missing_xp: 40 }))).toBe(60);
    expect(levelProgress(level({ ref: '2', kind: 'percent', threshold: 50, missing_percent: 10 }))).toBe(80);
    expect(levelProgress(level({ ref: 'done', kind: 'done', missing_percent: 12 }))).toBe(88);
  });

  it('takes a level in percent of a tree with XP by the XP the threshold stands for', () => {
    // 50 % of 200 XP is 100 XP; 25 missing: 75 %.
    const xp = { earned: 75, possible: 200, open: 125, points: 4, missing: 0 };
    expect(levelProgress(level({ ref: '2', kind: 'percent', threshold: 50, missing_xp: 25 }), xp)).toBe(75);
  });

  it('says nothing when the engine says nothing missing, and stays within 0..100', () => {
    expect(levelProgress(level({ ref: '1', kind: 'xp', threshold: 100 }))).toBeUndefined();
    expect(levelProgress(level({ ref: '1', kind: 'xp', missing_xp: 3 }))).toBeUndefined();
    expect(levelProgress(level({ ref: '1', kind: 'xp', threshold: 10, missing_xp: 30 }))).toBe(0);
    expect(levelProgress(level({ ref: '1', reached: true }))).toBe(100);
  });
});

describe('badgeTiles', () => {
  const a = path('learning/a', [
    level({ ref: '1', number: 1, reached: true, reached_on: '2026-11-03', threshold: 10 }),
    level({ ref: '2', number: 2, threshold: 100, missing_xp: 40 }),
    level({ ref: '3', number: 3, threshold: 200, missing_xp: 140 }),
    level({ ref: 'done', kind: 'done', missing_percent: 50 }),
  ]);
  const b = path('learning/b', [level({ ref: '1', number: 1, reached: true })], { stage: 'done' } as Partial<PathEntry>);
  const none = path('learning/c', []);
  const tiles = badgeTiles([a, b, none]);

  it('makes a tile of every level, the first not reached of a path is the next one with its progress', () => {
    expect(tiles.map((t) => t.key)).toEqual(['learning/a#1', 'learning/a#2', 'learning/a#3', 'learning/a#done', 'learning/b#1']);
    expect(tiles.filter((t) => t.next).map((t) => t.key)).toEqual(['learning/a#2']);
    expect(tiles.find((t) => t.next)?.progress).toBe(60);
    // Only the next one carries a ring.
    expect(tiles.find((t) => t.key === 'learning/a#3')?.progress).toBeUndefined();
    expect(tiles.find((t) => t.key === 'learning/b#1')?.pathDone).toBe(true);
  });

  it('filters earned and open', () => {
    expect(filterTiles(tiles, 'earned').map((t) => t.key)).toEqual(['learning/a#1', 'learning/b#1']);
    expect(filterTiles(tiles, 'open')).toHaveLength(3);
    expect(filterTiles(tiles, 'all')).toHaveLength(5);
  });

  it('groups by path in the engine order', () => {
    expect(groupByPath(tiles).map((g) => [g.id, g.tiles.length])).toEqual([
      ['learning/a', 4],
      ['learning/b', 1],
    ]);
  });

  it('groups by date: months latest first, then earned without a day, then the open ones nearest first', () => {
    const more = badgeTiles([
      a,
      b,
      path('learning/d', [
        level({ ref: '1', reached: true, reached_on: '2026-10-30' }),
        level({ ref: '2', reached: true, reached_on: '2026-11-20' }),
        level({ ref: '3', threshold: 10, missing_xp: 1 }),
      ]),
    ]);
    const groups = groupByDate(more);
    expect(groups.map((g) => g.key)).toEqual(['month:2026-11', 'month:2026-10', 'undated', 'open']);
    expect(groups[0]!.tiles.map((t) => t.key)).toEqual(['learning/d#2', 'learning/a#1']);
    expect(groups[2]!.tiles.map((t) => t.key)).toEqual(['learning/b#1']);
    // d#3 is 90 % there, a#2 60 %: d first; a#3 and a#done are no next ones and keep their order.
    expect(groups[3]!.tiles.map((t) => t.key)).toEqual(['learning/d#3', 'learning/a#2', 'learning/a#3', 'learning/a#done']);
  });
});

describe('badgeImage', () => {
  it('draws only a file below assets/badges/ of a path with a folder', () => {
    const tile = (badge: string | undefined, folder: boolean) =>
      badgeTiles([path('learning/a', [level({ ref: '1', ...(badge ? { badge } : {}) })], { folder })])[0]!;
    expect(badgeImage(tile('assets/badges/one.png', true))).toBe('assets/badges/one.png');
    expect(badgeImage(tile('assets/badges/one.png', false))).toBeNull();
    expect(badgeImage(tile('assets/other.png', true))).toBeNull();
    expect(badgeImage(tile(undefined, true))).toBeNull();
  });
});

describe('dayDate', () => {
  it('reads a day as noon UTC, and nothing else', () => {
    expect(dayDate('2026-11-03')?.toISOString()).toBe('2026-11-03T12:00:00.000Z');
    expect(dayDate('03.11.2026')).toBeNull();
    expect(dayDate('2026-11-03T10:00')).toBeNull();
  });
});

describe('walkTiles', () => {
  // Two groups: 5 tiles (rows of 3: 0 1 2 / 3 4) and 2 tiles (5 6).
  const sizes = [5, 2];
  it('goes left and right over the end of a group, Home and End to the first and last', () => {
    expect(walkTiles('ArrowRight', 4, sizes, 3)).toBe(5);
    expect(walkTiles('ArrowLeft', 5, sizes, 3)).toBe(4);
    expect(walkTiles('ArrowRight', 6, sizes, 3)).toBe(6);
    expect(walkTiles('ArrowLeft', 0, sizes, 3)).toBe(0);
    expect(walkTiles('Home', 4, sizes, 3)).toBe(0);
    expect(walkTiles('End', 0, sizes, 3)).toBe(6);
  });

  it('keeps the column up and down, into the group before or after', () => {
    expect(walkTiles('ArrowDown', 1, sizes, 3)).toBe(4);
    // From the last row of the first group, column 1: the second tile of the next group.
    expect(walkTiles('ArrowDown', 4, sizes, 3)).toBe(6);
    // Column 2 of the first row, no tile below it but a shorter row: that row's last tile, no row is skipped.
    expect(walkTiles('ArrowDown', 2, sizes, 3)).toBe(4);
    // From there on into the next group.
    expect(walkTiles('ArrowDown', 4, sizes, 3)).toBe(6);
    expect(walkTiles('ArrowUp', 6, sizes, 3)).toBe(4);
    expect(walkTiles('ArrowUp', 5, sizes, 3)).toBe(3);
    expect(walkTiles('ArrowUp', 1, sizes, 3)).toBe(1);
    expect(walkTiles('ArrowDown', 6, sizes, 3)).toBe(6);
  });

  it('ignores other keys and an empty grid', () => {
    expect(walkTiles('a', 0, sizes, 3)).toBeNull();
    expect(walkTiles('ArrowRight', 0, [], 3)).toBeNull();
  });
});
