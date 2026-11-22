// The rewards of all paths: sorted into open, granted and coming from the engine's levels as they are; only levels with
// a reward count, and the order within each part is the one the concept names.
import { describe, expect, it } from 'vitest';
import type { PathEntry, PathEntryLevel } from './contract';
import { openRewardCount, rewardRows } from './rewards';

const level = (over: Partial<PathEntryLevel> & { ref: string }): PathEntryLevel => ({ line: 1, kind: 'xp', given: false, reached: false, ...over });
const path = (id: string, levels: PathEntryLevel[], etag = `e-${id}`): PathEntry =>
  ({ id, area: 'learning', title: id, file: `${id}.md`, etag, valid: true, problems: [], progress: {}, levels }) as unknown as PathEntry;

const PATHS = [
  path('learning/a', [
    level({ ref: '1', reached: true, reached_on: '2026-11-10', reward: 'Eis' }),
    level({ ref: '2', reached: true, reward: 'Kino', given: true, given_on: '2026-11-01' }),
    level({ ref: '3', threshold: 100, missing_xp: 90, reward: 'Buch' }),
    level({ ref: '4', threshold: 200, reward: 'Reise' }),
    level({ ref: 'done', kind: 'done', missing_percent: 10, reward: 'See' }),
  ]),
  path('learning/b', [
    level({ ref: '1', reached: true, reached_on: '2026-11-02', reward: 'Kuchen' }),
    level({ ref: '2', reached: true, reward: 'Spiel', given: true, given_on: '2026-11-20' }),
    level({ ref: '3', reached: true, reward: 'Ohne Tag', given: true }),
    level({ ref: '4', reached: true, reward: '   ' }),
    level({ ref: '5', reached: true }),
  ]),
];

describe('rewardRows', () => {
  const rows = rewardRows(PATHS);
  const keys = (list: { tile: { key: string } }[]) => list.map((r) => r.tile.key);

  it('takes only levels with a reward, open ones the longest reached first', () => {
    expect(keys(rows.open)).toEqual(['learning/b#1', 'learning/a#1']);
    expect(rows.open[0]!.reward).toBe('Kuchen');
    expect(rows.open[0]!.etag).toBe('e-learning/b');
  });

  it('puts the granted ones latest first, one without a day last', () => {
    expect(keys(rows.given)).toEqual(['learning/b#2', 'learning/a#2', 'learning/b#3']);
  });

  it('puts the coming ones furthest along first, one without a share last', () => {
    // a#done is 90 % there (only the next one of a badge carries a ring, but every coming reward its share), a#3 10 %
    expect(keys(rows.coming)).toEqual(['learning/a#done', 'learning/a#3', 'learning/a#4']);
    expect(rows.coming[0]!.progress).toBe(90);
    expect(rows.coming[2]!.progress).toBeUndefined();
  });

  it('counts the open ones for the overview', () => {
    expect(openRewardCount(PATHS)).toBe(2);
    expect(openRewardCount([])).toBe(0);
  });
});
