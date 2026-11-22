// The badges of all learning paths (concept "Reiter Lernpläne" 8): every line of `## Level` of every path as a tile,
// earned or open, the next one of each path with how far it is. What is reached, what is missing and the day it was
// reached are the engine's (`tasks.paths` with `levels`, capability `paths_levels`; WEB-13): this file only orders,
// filters and groups them, and turns "missing" into a share for the ring of the next one.
import type { Icon, PathEntry, PathEntryLevel } from './contract';

/** One badge: a level of a path. */
export interface BadgeTile {
  /** `<path>#<ref>`: unique over all paths. */
  key: string;
  path: string;
  pathTitle: string;
  area: string;
  icon?: Icon;
  /** The path has a folder (only then can it hold `assets/badges/`). */
  folder: boolean;
  /** The finished path (from a Backlog). */
  pathDone: boolean;
  level: PathEntryLevel;
  earned: boolean;
  /** The first level of its path not reached yet: it carries the ring. */
  next: boolean;
  /** For the next one: how far it is, 0..100 (whole numbers); absent when the engine said nothing missing. */
  progress?: number;
}

export type BadgeFilter = 'all' | 'earned' | 'open';
export type BadgeGrouping = 'path' | 'date';
export const BADGE_FILTERS: readonly BadgeFilter[] = ['all', 'earned', 'open'];
export const BADGE_GROUPINGS: readonly BadgeGrouping[] = ['path', 'date'];

/** A group of tiles: a path, or a month of earned badges, or the earned ones without a day, or the open ones. */
export interface BadgeGroup {
  key: string;
  kind: 'path' | 'month' | 'undated' | 'open';
  /** The path (kind `path`) or the month `YYYY-MM` (kind `month`). */
  id?: string;
  tiles: BadgeTile[];
}

const clampPercent = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/**
 * How far a level not reached is, 0..100, from what the engine says is missing: a level in XP by its threshold, a level
 * in percent by its threshold (with XP in the tree: by the XP the threshold stands for), the line of the whole path by
 * 100 %. Undefined when nothing is said missing (an older engine, a broken line).
 */
export function levelProgress(level: PathEntryLevel, xp?: PathEntry['xp']): number | undefined {
  if (level.reached) return 100;
  const threshold = level.threshold;
  if (level.kind === 'done') {
    return level.missing_percent === undefined ? undefined : clampPercent(100 - level.missing_percent);
  }
  if (threshold === undefined || threshold <= 0) return undefined;
  if (level.kind === 'xp') {
    return level.missing_xp === undefined ? undefined : clampPercent(((threshold - level.missing_xp) / threshold) * 100);
  }
  if (level.missing_percent !== undefined) return clampPercent(((threshold - level.missing_percent) / threshold) * 100);
  if (level.missing_xp !== undefined && xp && xp.possible > 0) {
    const needed = (threshold / 100) * xp.possible;
    return needed <= 0 ? undefined : clampPercent(((needed - level.missing_xp) / needed) * 100);
  }
  return undefined;
}

/** Every level of every path as a tile, in the engine's order of the paths and the file order of the levels. */
export function badgeTiles(paths: readonly PathEntry[]): BadgeTile[] {
  const out: BadgeTile[] = [];
  for (const path of paths) {
    const levels = path.levels ?? [];
    const next = levels.find((l) => !l.reached);
    for (const level of levels) {
      const isNext = level === next;
      const progress = isNext ? levelProgress(level, path.xp) : undefined;
      out.push({
        key: `${path.id}#${level.ref}`,
        path: path.id,
        pathTitle: path.title,
        area: path.area,
        ...(path.icon ? { icon: path.icon } : {}),
        folder: path.folder === true,
        pathDone: path.stage === 'done',
        level,
        earned: level.reached,
        next: isNext,
        ...(progress !== undefined ? { progress } : {}),
      });
    }
  }
  return out;
}

export function filterTiles(tiles: readonly BadgeTile[], filter: BadgeFilter): BadgeTile[] {
  if (filter === 'all') return [...tiles];
  return tiles.filter((tile) => tile.earned === (filter === 'earned'));
}

/** By path, in the order of the tiles; a path without a tile shown has no group. */
export function groupByPath(tiles: readonly BadgeTile[]): BadgeGroup[] {
  const groups = new Map<string, BadgeGroup>();
  for (const tile of tiles) {
    let group = groups.get(tile.path);
    if (!group) {
      group = { key: `path:${tile.path}`, kind: 'path', id: tile.path, tiles: [] };
      groups.set(tile.path, group);
    }
    group.tiles.push(tile);
  }
  return [...groups.values()];
}

/**
 * By date: the earned ones by the month they were reached, the latest first (and the latest first within it), then the
 * earned ones whose day the series does not know, then the open ones, the nearest first.
 */
export function groupByDate(tiles: readonly BadgeTile[]): BadgeGroup[] {
  const dated = tiles.filter((t) => t.earned && t.level.reached_on !== undefined);
  dated.sort((a, b) => (b.level.reached_on ?? '').localeCompare(a.level.reached_on ?? '') || a.key.localeCompare(b.key));
  const months = new Map<string, BadgeGroup>();
  for (const tile of dated) {
    const month = (tile.level.reached_on ?? '').slice(0, 7);
    let group = months.get(month);
    if (!group) {
      group = { key: `month:${month}`, kind: 'month', id: month, tiles: [] };
      months.set(month, group);
    }
    group.tiles.push(tile);
  }
  const out = [...months.values()];
  const undated = tiles.filter((t) => t.earned && t.level.reached_on === undefined);
  if (undated.length > 0) out.push({ key: 'undated', kind: 'undated', tiles: undated });
  const open = tiles.filter((t) => !t.earned);
  // The next ones of their paths first, the furthest along first; the rest after them in their order.
  const nearness = (t: BadgeTile): number => (t.next ? 1000 + (t.progress ?? 0) : 0);
  const openSorted = open.map((t, i) => ({ t, i })).sort((a, b) => nearness(b.t) - nearness(a.t) || a.i - b.i);
  if (open.length > 0) out.push({ key: 'open', kind: 'open', tiles: openSorted.map((x) => x.t) });
  return out;
}

export function groupTiles(tiles: readonly BadgeTile[], grouping: BadgeGrouping): BadgeGroup[] {
  return grouping === 'date' ? groupByDate(tiles) : groupByPath(tiles);
}

/** A day `YYYY-MM-DD` as a date at noon UTC (no time zone moves it to another day), or null for anything else. */
export function dayDate(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The badge's picture when it is one the page may draw: a file below `assets/badges/` of a path with a folder. */
export function badgeImage(tile: BadgeTile): string | null {
  const badge = tile.level.badge;
  return tile.folder && badge !== undefined && badge.startsWith('assets/badges/') ? badge : null;
}

/**
 * The roving focus over the tiles of several grids (one per group), as one Tab stop: `at` is the index over all tiles,
 * `sizes` the number of tiles of each group, `columns` the tiles in a row. Left and right go on over the end of a group,
 * up and down keep the column (into the last or first row of the group before or after), Home and End go to the first and
 * last tile of all. The next index, or null when the key is not one of the walk.
 */
export function walkTiles(key: string, at: number, sizes: readonly number[], columns: number): number | null {
  const count = sizes.reduce((a, b) => a + b, 0);
  if (count === 0) return null;
  const cols = Math.max(1, columns);
  // The group of `at` and the index within it.
  let group = 0;
  let start = 0;
  while (group < sizes.length - 1 && at >= start + sizes[group]!) {
    start += sizes[group]!;
    group += 1;
  }
  const inGroup = at - start;
  const size = sizes[group]!;
  switch (key) {
    case 'ArrowRight':
      return Math.min(count - 1, at + 1);
    case 'ArrowLeft':
      return Math.max(0, at - 1);
    case 'ArrowDown': {
      if (inGroup + cols < size) return at + cols;
      // The last row of a group: the same column of the first row of the next group (or its last tile).
      if (group === sizes.length - 1) return at;
      const col = inGroup % cols;
      return start + size + Math.min(col, sizes[group + 1]! - 1);
    }
    case 'ArrowUp': {
      if (inGroup - cols >= 0) return at - cols;
      if (group === 0) return at;
      const before = sizes[group - 1]!;
      const col = inGroup % cols;
      const lastRow = Math.floor((before - 1) / cols) * cols;
      return start - before + Math.min(lastRow + col, before - 1);
    }
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
