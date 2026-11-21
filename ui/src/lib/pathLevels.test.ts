// The levels of a path as a form (lib/paths.ts, capability `path_levels`): the engine's levels turned into rows and
// back into the operation, the badge files offered, the XP of a promoted task as a `set`. No rule of the engine is
// tested (or made) here: rising thresholds, lengths and the badge are the engine's to judge.
import { describe, expect, it } from 'vitest';
import type { PathLevel } from './contract';
import { badgeFiles, levelRows, levelsOp, nextRow, taskXpOp } from './paths';

const LEVELS: PathLevel[] = [
  { ref: '1', number: 1, line: 3, kind: 'xp', threshold: 20, name: 'Einsteiger', badge: 'assets/badges/stern.png', reward: 'Eis', given: true, reached: true },
  { ref: '2', number: 2, line: 4, kind: 'percent', threshold: 50, given: false, reached: false },
  { ref: 'done', line: 5, kind: 'done', reward: 'See', given: false, reached: false },
];

describe('levelRows', () => {
  it('turns the levels into rows and the path line into its own row', () => {
    expect(levelRows(LEVELS)).toEqual({
      rows: [
        { threshold: '20', unit: 'xp', name: 'Einsteiger', badge: 'assets/badges/stern.png', reward: 'Eis', given: true },
        { threshold: '50', unit: 'percent', name: '', badge: '', reward: '', given: false },
      ],
      done: { on: true, reward: 'See', given: false },
    });
  });
  it('a path without levels: no rows, no path line', () => {
    expect(levelRows(undefined)).toEqual({ rows: [], done: { on: false, reward: '', given: false } });
  });
});

describe('levelsOp', () => {
  it('sends the rows as the engine takes them: trimmed, empty parts left out, given only with a reward', () => {
    const { rows, done } = levelRows(LEVELS);
    rows[1]!.given = true; // no reward: not sent
    rows[1]!.name = '  Profi ';
    expect(levelsOp('lib/lua', 'e1', rows, done)).toEqual({
      op: 'path_levels',
      id: 'lib/lua',
      levels: {
        list: [
          { threshold: 20, unit: 'xp', name: 'Einsteiger', badge: 'assets/badges/stern.png', reward: 'Eis', given: true },
          { threshold: 50, unit: 'percent', name: 'Profi' },
        ],
        done: { reward: 'See' },
      },
      if_match: 'e1',
    });
  });
  it('an empty form removes the levels; a path line without a reward is sent as such', () => {
    expect(levelsOp('a/b', undefined, [], { on: false, reward: '', given: true })).toEqual({ op: 'path_levels', id: 'a/b', levels: { list: [] } });
    expect(levelsOp('a/b', undefined, [], { on: true, reward: ' ', given: true })).toEqual({ op: 'path_levels', id: 'a/b', levels: { list: [], done: {} } });
  });
  it('names the row whose threshold is no whole number from 1, and sends nothing', () => {
    const row = nextRow([]);
    expect(levelsOp('a/b', 'e', [row, { ...row, threshold: 'viel' }], { on: false, reward: '', given: false })).toEqual({ invalid: 1 });
    expect(levelsOp('a/b', 'e', [{ ...row, threshold: '0' }], { on: false, reward: '', given: false })).toEqual({ invalid: 0 });
    expect(levelsOp('a/b', 'e', [{ ...row, threshold: '1234567' }], { on: false, reward: '', given: false })).toEqual({ invalid: 0 });
  });
});

describe('nextRow', () => {
  it('proposes 50 XP first, then 50 above the last XP threshold', () => {
    expect(nextRow([]).threshold).toBe('50');
    const { rows } = levelRows(LEVELS);
    expect(nextRow(rows)).toEqual({ threshold: '70', unit: 'xp', name: '', badge: '', reward: '', given: false });
  });
});

describe('badgeFiles', () => {
  it('offers the pictures below assets/badges/ only, sorted', () => {
    expect(
      badgeFiles(['assets/badges/z.svg', 'assets/cover.png', 'assets/badges/a.PNG', 'assets/badges/notes.txt', 'assets/badges/sub/b.webp', 'assets/badges/a b.png']),
    ).toEqual(['assets/badges/a.PNG', 'assets/badges/sub/b.webp', 'assets/badges/z.svg']);
    expect(badgeFiles(undefined)).toEqual([]);
  });
});

describe('taskXpOp', () => {
  it('is a set of xp on the task, null to remove it', () => {
    expect(taskXpOp('lib/cc', 'e9', 40)).toEqual({ op: 'set', id: 'lib/cc', patch: { xp: 40 }, if_match: 'e9' });
    expect(taskXpOp('lib/cc', undefined, 'clear')).toEqual({ op: 'set', id: 'lib/cc', patch: { xp: null } });
  });
});
