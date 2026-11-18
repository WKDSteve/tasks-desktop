// The cards of the statistics: their order, which of them are folded, and the window a card is opened alone in. The
// view (`StatsView`) draws them; what a card is exported as is `statsExport.ts` (loaded with the view).

import { readRoute, routeHash } from 'appkit-ui/route';
import { STAT_DIMS, STAT_SORTS, type StatDim, type StatSort } from './stats';

/**
 * The cards below the filter, in the order they stand: the bars per area with the field they are cut up by, the
 * headline numbers, the history, and the table of the bars.
 */
export const STATS_CARDS = ['chart', 'figures', 'history', 'table'] as const;
export type StatsCard = (typeof STATS_CARDS)[number];

export const isStatsCard = (value: unknown): value is StatsCard => (STATS_CARDS as readonly unknown[]).includes(value);

/** The folded cards as they are remembered: a list of names; anything else (an older version, a damaged entry) is none. */
export function parseCardFolds(raw: string | null | undefined): StatsCard[] {
  if (raw === null || raw === undefined) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return STATS_CARDS.filter((card) => value.includes(card));
  } catch {
    return [];
  }
}

/** The folded cards with `card` folded or unfolded, in the order of the cards. */
export function withCardFolded(folded: readonly StatsCard[], card: StatsCard, fold: boolean): StatsCard[] {
  return STATS_CARDS.filter((c) => (c === card ? fold : folded.includes(c)));
}

/** What a window of one card is told: the card, and the field and the order of the statistics. */
export interface CardRoute {
  card: StatsCard;
  dim?: StatDim;
  sort?: StatSort;
}

/**
 * The fragment of a window that shows one card alone: the view, the card, the field and order of the statistics and
 * the filter (a filter of nothing is left out: the window then takes the filter it remembers, which is the one of this
 * browser).
 */
export function cardRoute(card: StatsCard, dim: StatDim, sort: StatSort, filter: string): string {
  return routeHash({ view: 'stats', card, stats: `${dim}:${sort}`, ...(filter !== '{}' && filter !== '' ? { filter } : {}) });
}

/** The card a fragment names alone, with the field and order it was opened with; null for any other fragment. */
export function routedCard(hash: string): CardRoute | null {
  const route = readRoute(hash);
  if (route['view'] !== 'stats' || !isStatsCard(route['card'])) return null;
  const out: CardRoute = { card: route['card'] };
  const [dim = '', sort = ''] = (route['stats'] ?? '').split(':');
  if ((STAT_DIMS as readonly string[]).includes(dim)) out.dim = dim as StatDim;
  if ((STAT_SORTS as readonly string[]).includes(sort)) out.sort = sort as StatSort;
  return out;
}
