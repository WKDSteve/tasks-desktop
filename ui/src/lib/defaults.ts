// The defaults of the page: where it starts and what it shows without a choice of the person's own. They are kept in
// the browser (`tasks-desktop.defaults`) next to what was used last (`tasks-desktop.view`, `.filter`, `.sort`):
// what was used last wins at the start unless the person said "start with the defaults"; a reset goes back to them.
// The page reckons nothing of the tasks here: a default filter is a filter like any other, the order is a word of
// the engine.

import type { View } from './app.svelte';
import { parseSort, type SortWord } from './sort';

export const DEFAULTS_KEY = 'tasks-desktop.defaults';

/** The views a page can start on, in the order of the menu. */
export const START_VIEWS: readonly View[] = [
  'today',
  'list',
  'board',
  'plan',
  'inbox',
  'abnahme',
  'cross',
  'calendar',
  'stats',
  'done',
  'views',
  'repos',
];

export interface Defaults {
  /** The view the page opens on: the one it was left on (`last`), or always this one. */
  startView: 'last' | View;
  /** Filter and order at the start: those used last (when there are any), or always the defaults below. */
  startWith: 'last' | 'defaults';
  /** The order of the list without a choice. */
  sort: SortWord;
  /** The filter without a choice, as the page keeps filters (`serializeFilter`, with its vault); empty: none. */
  filter: string;
}

/** What the page did before there were defaults: no filter, the plan's order, the view it was left on. */
export const FACTORY_DEFAULTS: Defaults = { startView: 'last', startWith: 'last', sort: 'default', filter: '' };

/** The longest default filter kept: a filter is a few chosen names, not a document. */
const MAX_FILTER = 16 * 1024;

export function isStartView(value: unknown): value is View {
  return typeof value === 'string' && (START_VIEWS as readonly string[]).includes(value);
}

/** The defaults of a kept text; what cannot be read is the factory's (never an error). */
export function parseDefaults(text: string | null | undefined): Defaults {
  const out = { ...FACTORY_DEFAULTS };
  if (!text) return out;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return out;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  const o = raw as Record<string, unknown>;
  if (o.startView === 'last' || isStartView(o.startView)) out.startView = o.startView;
  if (o.startWith === 'last' || o.startWith === 'defaults') out.startWith = o.startWith;
  out.sort = parseSort(o.sort);
  if (typeof o.filter === 'string' && o.filter.length <= MAX_FILTER) {
    try {
      const f: unknown = o.filter === '' ? {} : JSON.parse(o.filter);
      if (typeof f === 'object' && f !== null && !Array.isArray(f)) out.filter = o.filter;
    } catch {
      // not a filter: none
    }
  }
  return out;
}

export function serializeDefaults(defaults: Defaults): string {
  return JSON.stringify(defaults);
}

/** Whether these are the factory's: nothing the person set. */
export function isFactory(defaults: Defaults): boolean {
  return serializeDefaults(defaults) === serializeDefaults(FACTORY_DEFAULTS);
}

/** The view the page opens on: the default one, or the one it was left on (`today` when that is none of ours). */
export function startView(defaults: Defaults, remembered: string | null): View {
  if (defaults.startView !== 'last') return defaults.startView;
  return isStartView(remembered) ? remembered : 'today';
}

/**
 * The filter and the order the page starts with: those used last when the person keeps them and there are any, else
 * the defaults. A filter is the kept text (`parseFilter` reads it), `null` for none.
 */
export function startChoice(
  defaults: Defaults,
  remembered: { filter: string | null; sort: string | null },
): { filter: string | null; sort: SortWord } {
  if (defaults.startWith === 'defaults') {
    return { filter: defaults.filter || null, sort: defaults.sort };
  }
  return {
    filter: remembered.filter ?? (defaults.filter || null),
    sort: remembered.sort === null ? defaults.sort : parseSort(remembered.sort),
  };
}
