// The tiles of "The vault in numbers" in the statistics: the headline numbers and one tile per field with how the
// tasks spread over its values. Which tiles are shown is the person's choice, remembered per device as what differs
// from the tiles shown at first: a tile that comes with a later version then shows or hides as that version means it.

import { STAT_DIMS, type StatDim } from './stats';

/** The headline numbers, in the order they are drawn. */
export const NUMBER_TILES = ['open', 'ready', 'doing', 'blocked', 'quickWins', 'noEffort', 'finished', 'effort'] as const;
export type NumberTile = (typeof NUMBER_TILES)[number];

/** A tile: a headline number (`n:open`) or the spread over a field (`d:status`). */
export type TileId = `n:${NumberTile}` | `d:${StatDim}`;

export const numberTile = (name: NumberTile): TileId => `n:${name}`;
export const dimTile = (dim: StatDim): TileId => `d:${dim}`;
/** The field of a tile of a field, else null. */
export const dimOf = (id: TileId): StatDim | null => (id.startsWith('d:') ? (id.slice(2) as StatDim) : null);

/** Every tile there is, in the order they are drawn: the numbers, then the fields. */
export const ALL_TILES: readonly TileId[] = [...NUMBER_TILES.map(numberTile), ...STAT_DIMS.map(dimTile)];

/** The fields whose tile is shown at first; the others are there to be added. */
const FIRST_DIMS: readonly StatDim[] = ['status', 'effort', 'kind', 'prio', 'state', 'actor'];
/** The tiles shown until the person chooses: every number, and the fields most looked at. */
export const DEFAULT_TILES: readonly TileId[] = [...NUMBER_TILES.map(numberTile), ...FIRST_DIMS.map(dimTile)];

/** What the person changed: the tiles added to the ones shown at first, and the ones of those taken away. */
export interface TilePrefs {
  on: TileId[];
  off: TileId[];
}

export const defaultTilePrefs = (): TilePrefs => ({ on: [], off: [] });
export const isDefaultTiles = (prefs: TilePrefs): boolean => prefs.on.length === 0 && prefs.off.length === 0;

const isTile = (v: unknown): v is TileId => typeof v === 'string' && (ALL_TILES as readonly string[]).includes(v);

/** Whether a tile is shown. */
export function tileShown(prefs: TilePrefs, id: TileId): boolean {
  return DEFAULT_TILES.includes(id) ? !prefs.off.includes(id) : prefs.on.includes(id);
}

/**
 * The tiles shown, of the ones there are now (`available`: a number the engine did not give has no tile), in the
 * order they are drawn.
 */
export function shownTiles(prefs: TilePrefs, available: readonly TileId[] = ALL_TILES): TileId[] {
  return ALL_TILES.filter((id) => available.includes(id) && tileShown(prefs, id));
}

/** The choice with one tile shown or hidden; a tile put back to how it came leaves no trace. */
export function withTile(prefs: TilePrefs, id: TileId, shown: boolean): TilePrefs {
  const on = prefs.on.filter((t) => t !== id);
  const off = prefs.off.filter((t) => t !== id);
  if (DEFAULT_TILES.includes(id)) {
    if (!shown) off.push(id);
  } else if (shown) on.push(id);
  return { on, off };
}

/**
 * The choice after the person ticked `shown` among the tiles there are now. A tile that is not there now (its number
 * is missing today) keeps what was chosen for it. An empty choice is "as it came": a view without a tile shows
 * nothing, and the reset of the choice empties it.
 */
export function withShown(prefs: TilePrefs, available: readonly TileId[], shown: readonly string[]): TilePrefs {
  if (shown.length === 0) return defaultTilePrefs();
  let next = prefs;
  for (const id of available) next = withTile(next, id, shown.includes(id));
  return next;
}

/** The stored choice read back: only tiles that exist, each once, none in both lists. */
export function parseTilePrefs(text: string | null): TilePrefs {
  const out = defaultTilePrefs();
  if (!text) return out;
  try {
    const raw: unknown = JSON.parse(text);
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
    const { on, off } = raw as Record<string, unknown>;
    const list = (v: unknown): TileId[] => (Array.isArray(v) ? [...new Set(v.filter(isTile))] : []);
    // Only what differs from how the tiles come is kept: a tile shown at first cannot be "added".
    out.on = list(on).filter((id) => !DEFAULT_TILES.includes(id));
    out.off = list(off).filter((id) => DEFAULT_TILES.includes(id));
  } catch {
    // as it came
  }
  return out;
}
