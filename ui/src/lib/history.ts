// Back and Forward in the browser: the view and the open task are the places of the page, and each place the
// person reaches is an entry of the history of the tab (the kit's `installNav`). The state sits in
// `history.state`; the view and the open task are also in the fragment of the address (`#view=list&open=<id>`), so
// that a reload, a copied address and a link opened in a new tab show the same place. A window of one task keeps its
// own fragment (`#task=<id>`, route.ts): while the page is one, the address is left to it.
//
// The filter of the list belongs to a place too: each entry keeps the filter its place had when it was left, Back and
// Forward set it again. A change of the filter is no step of its own: it is written into the entry of the place
// (a moment after the last change, so that typing in the search box does not write at every key). It is in the
// address as well (`&filter=...`, while it is short enough): a copied link and a new tab show the same filter.
//
// The same holds for the plan chosen in the plan view, the order of the list and the field and order of the
// statistics: kept with the place, set again by Back and Forward, no step of their own. A link needs the plan and the
// order (`&plan=...`, `&sort=...`); the field of the statistics is kept in the entry only. A value the page does not
// know (an order of a newer page, a field gone) leaves the state as it is.

import { installNav, type Nav, type NavAddress, type NavHistory, type NavWindow } from 'appkit-ui/nav';
import type { Route } from 'appkit-ui/route';
import type { View } from './app.svelte';
import { filterOfText, filterText, type Filter } from './filter';
import { parseSort, type SortWord } from './sort';
import { STAT_DIMS, STAT_SORTS, type StatDim, type StatSort } from './stats';
import { ROUTED_VIEWS, type RoutedView } from './route';

const VIEWS: readonly string[] = ROUTED_VIEWS;
// The views of the page and those a route and the history take are one list: a view missing here would be a place
// that Back skips (it was, for three of them).
const sameViews: [View] extends [RoutedView] ? ([RoutedView] extends [View] ? true : never) : never = true;
void sameViews;

/** The route of a place: its view, and the task open in it. Whether it is looked at in the popup is not kept. */
export function placeRoute(place: Place): Route {
  return {
    view: place.view,
    ...(place.selectedId !== null ? { open: place.selectedId } : {}),
    // A filter with nothing on is no part of the address (an address without one keeps the filter the page has).
    ...(place.filter !== undefined && place.filter !== '{}' ? { filter: place.filter } : {}),
    // The plan view of all plans and the plan's order are what a page shows without a word: no part of the address.
    ...(place.plan !== undefined && place.plan !== '' ? { plan: place.plan } : {}),
    ...(place.sort !== undefined && place.sort !== 'default' ? { sort: place.sort } : {}),
  };
}

/** The place a route names, or null (no view, or a name that is no view). */
export function routePlace(route: Record<string, string>): Place | null {
  const view = route.view;
  if (view === undefined || !VIEWS.includes(view)) return null;
  return {
    view: view as View,
    selectedId: route.open ?? null,
    ...(route.filter !== undefined ? { filter: route.filter } : {}),
    ...(route.plan !== undefined ? { plan: route.plan } : {}),
    ...(route.sort !== undefined ? { sort: route.sort } : {}),
  };
}

/** The address of the page as the history keeps it; `solo`: the page is a window of one task now. */
export function placeAddress(location: NavAddress<Place>['location'], solo: () => boolean): NavAddress<Place> {
  return { location, toRoute: (place) => (solo() ? null : placeRoute(place)), fromRoute: routePlace };
}

/**
 * Where the person is: a view, the task that is open in it (if any), and whether that task is looked at in the popup
 * over the view. `peek` is there only when it is true: a place without it is one from before the popup.
 */
export interface Place {
  view: View;
  selectedId: string | null;
  peek?: true;
  /** The filter of the list at this place (`filterText`); missing in a place from before it was kept: left as it is. */
  filter?: string;
  /** The plan chosen in the plan view (`''`: every task); missing: left as it is. */
  plan?: string;
  /** The order of the list (a word of `SORTS`); missing or a word this page does not know: left as it is. */
  sort?: string;
  /** The field and the order of the statistics, `<dim>:<sort>`; missing or unknown: left as it is. */
  stats?: string;
}

/** What a place keeps besides where it is: the filter, the plan, the order, the statistics. */
type Kept = Required<Pick<Place, 'filter' | 'plan' | 'sort' | 'stats'>>;
const KEPT = ['filter', 'plan', 'sort', 'stats'] as const;

function keptOf(app: HistoryApp): Kept {
  return {
    filter: filterText(app.filter),
    plan: app.planChoice,
    sort: app.sort,
    stats: `${app.statsDim}:${app.statsSort}`,
  };
}

/** The field and order of the statistics `text` names, or null for a text this page does not know. */
function statsOf(text: string): { dim: StatDim; sort: StatSort } | null {
  const [dim = '', sort = ''] = text.split(':');
  if (!(STAT_DIMS as readonly string[]).includes(dim) || !(STAT_SORTS as readonly string[]).includes(sort)) return null;
  return { dim: dim as StatDim, sort: sort as StatSort };
}

export function isPlace(value: unknown): value is Place {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.view === 'string' &&
    VIEWS.includes(v.view) &&
    (v.selectedId === null || typeof v.selectedId === 'string') &&
    (v.peek === undefined || v.peek === true) &&
    KEPT.every((key) => v[key] === undefined || typeof v[key] === 'string')
  );
}

/** What the history needs of the app. */
export interface HistoryApp {
  view: View;
  selectedId: string | null;
  /** The open task is looked at in the popup over the view. */
  peeking: boolean;
  /** The filter of the list: kept with the place, set again by Back and Forward. */
  filter: Filter;
  /** The plan chosen in the plan view, the order of the list, the field and order of the statistics: kept the same way. */
  planChoice: string;
  sort: SortWord;
  setSort(word: SortWord): void;
  statsDim: StatDim;
  statsSort: StatSort;
  setStats(dim: StatDim, sort: StatSort): void;
  tasks: readonly { id: string }[];
  setView(view: View): void;
  select(id: string | null): void;
  peek(id: string): void;
  closePeek(): void;
}

export interface AppHistory {
  /** The app may have changed its place or what it keeps: record it. Called whenever the view, the selection, the filter, the plan, the order or the statistics changed. */
  sync(): void;
  stop(): void;
}

/** How long the filter has to stay before it is written into the entry of the place. */
export const FILTER_SETTLE_MS = 400;

/** The timers the history waits with (the window's; a test gives its own). */
export interface HistoryTimers {
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const windowTimers: HistoryTimers = {
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** The same place, what it keeps aside. */
function samePlace(a: Place, b: Place): boolean {
  return a.view === b.view && a.selectedId === b.selectedId && a.peek === b.peek;
}

/** The same place keeps the same filter, plan, order and statistics. */
function sameKept(a: Place, b: Place): boolean {
  return KEPT.every((key) => a[key] === b[key]);
}

/** Set what `place` keeps; a value missing (an older entry) or one this page does not know leaves the state as it is. */
function applyKept(app: HistoryApp, place: Place): void {
  if (place.filter !== undefined && place.filter !== filterText(app.filter)) app.filter = filterOfText(place.filter);
  if (place.plan !== undefined && place.plan !== app.planChoice) app.planChoice = place.plan;
  if (place.sort !== undefined) {
    const word = parseSort(place.sort);
    if ((word !== 'default' || place.sort === 'default') && word !== app.sort) app.setSort(word);
  }
  if (place.stats !== undefined) {
    const stats = statsOf(place.stats);
    if (stats && (stats.dim !== app.statsDim || stats.sort !== app.statsSort)) app.setStats(stats.dim, stats.sort);
  }
}

export function installAppHistory(
  app: HistoryApp,
  win: NavWindow & { history: NavHistory },
  address?: NavAddress<Place>,
  timers: HistoryTimers = windowTimers,
): AppHistory {
  let last: Place | null = null;
  /** A change of the filter waiting to be written into the entry of the place. */
  let settling: unknown = null;
  const settle = (): void => {
    if (settling === null) return;
    timers.clearTimeout(settling);
    settling = null;
  };
  const nav: Nav<Place> = installNav<Place>({
    history: win.history,
    window: win,
    isState: isPlace,
    ...(address ? { address } : {}),
    restore(place) {
      // A filter still waiting belongs to the entry that is left: it is not written into the one come to.
      settle();
      app.setView(place.view);
      // A task that is gone cannot be opened: the place is the view alone, and takes the entry it came from.
      const open = place.selectedId !== null && app.tasks.some((t) => t.id === place.selectedId);
      app.select(open ? place.selectedId : null);
      // Back closes the popup of the place it leaves, Forward opens it again.
      const peek = open && place.peek === true;
      if (peek && place.selectedId !== null) app.peek(place.selectedId);
      else app.closePeek();
      // What the place keeps; a place from before a state was kept leaves that state as it is.
      applyKept(app, place);
      const kept = keptOf(app);
      last = { view: place.view, selectedId: open ? place.selectedId : null, ...(peek ? { peek: true as const } : {}), ...kept };
      if ((!open && place.selectedId !== null) || KEPT.some((key) => place[key] !== kept[key])) nav.record(last, { replace: true });
    },
  });
  return {
    sync() {
      const now: Place = {
        view: app.view,
        selectedId: app.selectedId,
        ...(app.peeking && app.selectedId !== null ? { peek: true as const } : {}),
        ...keptOf(app),
      };
      if (last !== null && samePlace(last, now)) {
        if (sameKept(last, now)) {
          // The same place: the kit puts the address back where another part of the page changed it (a window of one
          // task that becomes a page of views). A filter still waiting is written when its moment has passed.
          if (settling === null) nav.record(now);
          return;
        }
        // Only what the place keeps changed: its entry takes it, once it has stayed a moment.
        last = now;
        settle();
        settling = timers.setTimeout(() => {
          settling = null;
          if (last !== null) nav.record(last, { replace: true });
        }, FILTER_SETTLE_MS);
        return;
      }
      // Another place: the entry left keeps the filter it had last.
      if (settling !== null && last !== null) {
        settle();
        nav.record(last, { replace: true });
      }
      // The open task vanished by itself (finished, moved away): that place is left, not a new step.
      const vanished =
        last !== null &&
        last.selectedId !== null &&
        now.selectedId === null &&
        last.view === now.view &&
        !app.tasks.some((t) => t.id === last?.selectedId);
      nav.record(now, vanished ? { replace: true } : undefined);
      last = now;
    },
    stop: () => {
      settle();
      nav.stop();
    },
  };
}
