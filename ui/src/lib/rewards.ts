// The rewards of all learning paths (concept "Reiter Lernpläne" 9): every level with a reward, sorted into open (reached,
// not granted yet), granted (latest first) and coming (not reached, the nearest first). Reached, granted, missing and the
// days are the engine's (`tasks.paths` with `levels`, capability `paths_levels`; WEB-13); granting goes through
// `path_reward` as in the view of the paths. The tiles of lib/badges.ts carry the picture and the share of the way.
import type { PathEntry } from './contract';
import { badgeTiles, levelProgress, type BadgeTile } from './badges';

export interface RewardRow {
  tile: BadgeTile;
  /** The reward as written (untrusted text). */
  reward: string;
  /** The version of the path's file, sent with `path_reward` (a path changed meanwhile is refused as a conflict). */
  etag?: string;
  /** For a coming one: how far its level is, 0..100; absent when the engine said nothing missing. */
  progress?: number;
}

export interface Rewards {
  open: RewardRow[];
  given: RewardRow[];
  coming: RewardRow[];
}

/** Sorted into the three parts. */
export function rewardRows(paths: readonly PathEntry[]): Rewards {
  const byPath = new Map(paths.map((p) => [p.id, p] as const));
  const out: Rewards = { open: [], given: [], coming: [] };
  for (const tile of badgeTiles(paths)) {
    const reward = tile.level.reward;
    if (reward === undefined || reward.trim() === '') continue;
    const entry = byPath.get(tile.path);
    const row: RewardRow = { tile, reward, ...(entry?.etag !== undefined ? { etag: entry.etag } : {}) };
    if (tile.level.given) out.given.push(row);
    else if (tile.earned) out.open.push(row);
    else {
      const progress = levelProgress(tile.level, entry?.xp);
      out.coming.push({ ...row, ...(progress !== undefined ? { progress } : {}) });
    }
  }
  // Open: the longest reached first (a day the series knows before one it does not), else in the order of the paths.
  const day = (row: RewardRow, field: 'reached_on' | 'given_on'): string => row.tile.level[field] ?? '';
  out.open = stable(out.open, (a, b) => compareDays(day(a, 'reached_on'), day(b, 'reached_on'), 'asc'));
  // Granted: the latest first; one without a day last.
  out.given = stable(out.given, (a, b) => compareDays(day(a, 'given_on'), day(b, 'given_on'), 'desc'));
  // Coming: the furthest along first; one without a share last.
  out.coming = stable(out.coming, (a, b) => (b.progress ?? -1) - (a.progress ?? -1));
  return out;
}

/** The number of rewards earned and not granted yet: for the overview of the tab. */
export function openRewardCount(paths: readonly PathEntry[]): number {
  return rewardRows(paths).open.length;
}

/** Days `YYYY-MM-DD` compared; an empty one (unknown) always last. */
function compareDays(a: string, b: string, order: 'asc' | 'desc'): number {
  if (a === b) return 0;
  if (a === '') return 1;
  if (b === '') return -1;
  return order === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
}

function stable<T>(list: readonly T[], compare: (a: T, b: T) => number): T[] {
  return list
    .map((value, i) => ({ value, i }))
    .sort((a, b) => compare(a.value, b.value) || a.i - b.i)
    .map((x) => x.value);
}
