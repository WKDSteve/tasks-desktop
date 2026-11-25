// The word of an export entry of the menu View and the palette. Its own module: the start of the page needs it, and
// lib/export.ts comes later, with an export.

import type { ViewTables } from './export';

/**
 * The word of an export entry of the menu View or the palette: the view's own (`ViewTables.label`, "tables") while the
 * view shown gives its tables (`App.ownTables`), else the page's (`page`, which speaks of tasks).
 */
export const exportWord = <K extends string>(
  app: { ownTables: ViewTables | null },
  key: K,
  page: (key: K, params?: Record<string, string | number>) => string,
  params?: Record<string, string | number>,
): string => app.ownTables?.label?.(key, params) || page(key, params);
