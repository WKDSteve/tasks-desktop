// The area filter of the page for the views of the tab "Lernpläne" (concept "Reiter Lernpläne", 2: every view follows
// it). One way for all of them: the reads whose engine method takes a list of areas (`learn_notes`, `learn_evidence`,
// `learn_history`, `competences`) ask with `query`, the engine resolving area groups (WEB-13); the lists of paths
// (`paths`, `learn_next`, whose methods take one name only) are narrowed by `has`, with the areas the page resolved
// from the engine's groups (`App.matchAreas`).
import { NO_AREA } from './areaGroups';

/**
 * A name the hub takes as a plain query value (`parse_query` of appkit-hub): a name with a blank or an umlaut is
 * refused there, so it cannot be asked for.
 */
const PLAIN = /^[A-Za-z0-9._-]{1,128}$/;

/** The most bytes the hub takes for one query value, and the most names of `areas` (`AREAS_MAX` of the hub). */
const VALUE_MAX = 128;
const AREAS_MAX = 32;

export interface LearnScope {
  /** Whether the area filter names any area or area group. */
  readonly active: boolean;
  /** The names the filter chose (an area group by its name), for the words of the view. */
  readonly names: readonly string[];
  /** The filter names only empty groups: no area, nothing to show. */
  readonly empty: boolean;
  /**
   * The parameters of a read that takes a list of areas: `{ area }` for one name, `{ areas }` (joined by `/`, which no
   * area name holds) for several; `{}` without a filter, or when the hub cannot be asked for these names (a name with a
   * blank, too many): then the engine answers for all areas and the view narrows the list by `keep`.
   */
  readonly query: { area?: string; areas?: string };
  /** Whether an area is one the filter means (every area without a filter). */
  has(area: string): boolean;
  /** `items` without the ones of an area the filter hides. */
  keep<T extends { area: string }>(items: readonly T[]): T[];
}

/** The scope of the filter: `chosen` as the filter names it (`App.filter.areas`), `matched` with groups resolved (`App.matchAreas`). */
export function learnScope(chosen: readonly string[], matched: readonly string[]): LearnScope {
  const active = chosen.length > 0;
  const set = new Set(matched);
  const has = (area: string): boolean => !active || set.has(area);
  const plain = chosen.every((name) => PLAIN.test(name));
  const joined = chosen.join('/');
  const query: { area?: string; areas?: string } =
    !active || !plain ? {} : chosen.length === 1 ? { area: joined } : chosen.length <= AREAS_MAX && joined.length <= VALUE_MAX ? { areas: joined } : {};
  return {
    active,
    names: chosen,
    empty: active && matched.length === 1 && matched[0] === NO_AREA,
    query,
    has,
    // Without a filter the same array (a caller may tell nothing changed); the caller never writes to it.
    keep: <T extends { area: string }>(items: readonly T[]): T[] => (active ? items.filter((item) => set.has(item.area)) : (items as T[])),
  };
}
