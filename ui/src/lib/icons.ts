// What stands for an item (concept "Lernplan" 11.3, E11): its own `icon`, else the icon of the learning path it was
// promoted from, else the icon of its first category that has one. The engine normalises `icon:` to an emoji, an
// asset below the item's folder or a word of its list (`Icon`); an asset is drawn only as `<img>` of the owner's
// folder, so the result names whose folder it lies in.

import type { AssetOwner } from './api';
import type { Icon } from './contract';

/** The icons of the categories as they come: the last step of the inheritance until the person changes them. */
export const CATEGORY_ICONS: Readonly<Record<string, string>> = {
  learning: '📚',
  bug: '🐞',
  security: '🔒',
  performance: '⚡',
  docs: '📄',
  tests: '🧪',
};

/** No icon for any category: the last step of the inheritance switched off. */
export const NO_CATEGORY_ICONS: Readonly<Record<string, string>> = Object.freeze(Object.create(null) as Record<string, string>);

/**
 * The setting "Icons of the categories" (Options > Defaults): whether the last step of the inheritance is on, and what
 * differs from `CATEGORY_ICONS` (a category with `''` has no icon; one not named keeps the icon it comes with).
 */
export interface CategoryIconPrefs {
  on: boolean;
  changed: Readonly<Record<string, string>>;
}

export const DEFAULT_CATEGORY_ICON_PREFS: CategoryIconPrefs = Object.freeze({ on: true, changed: Object.freeze({}) });

/** The icon a record names for `category`, only its own key (a category `constructor` is no icon of Object). */
export function ownIcon(icons: Readonly<Record<string, string>>, category: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(icons, category) ? icons[category] : undefined;
}

/** A record without a prototype: any category word is a plain key, `__proto__` too. */
function record(): Record<string, string> {
  return Object.create(null) as Record<string, string>;
}

/** A category word as the engine writes it: no space, no separator of a list. */
const CATEGORY_WORD = /^[^\s,[\]]+$/;

/** The setting as kept in the browser; anything unreadable is the setting as it comes. */
export function parseCategoryIcons(raw: string | null | undefined): CategoryIconPrefs {
  if (!raw) return DEFAULT_CATEGORY_ICON_PREFS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_CATEGORY_ICON_PREFS;
  }
  if (typeof parsed !== 'object' || parsed === null) return DEFAULT_CATEGORY_ICON_PREFS;
  const { on, changed } = parsed as { on?: unknown; changed?: unknown };
  const kept = record();
  if (typeof changed === 'object' && changed !== null) {
    for (const [category, icon] of Object.entries(changed)) {
      if (!CATEGORY_WORD.test(category) || typeof icon !== 'string') continue;
      if (icon !== '' && !isOneGrapheme(icon)) continue;
      if ((ownIcon(CATEGORY_ICONS, category) ?? '') === icon) continue;
      kept[category] = icon;
    }
  }
  return { on: on !== false, changed: kept };
}

export function serializeCategoryIcons(prefs: CategoryIconPrefs): string {
  return JSON.stringify({ on: prefs.on, changed: prefs.changed });
}

/** The setting with the icon of one category set (`''`: none); the icon it comes with is no change. */
export function withCategoryIcon(prefs: CategoryIconPrefs, category: string, icon: string): CategoryIconPrefs {
  const changed = record();
  for (const [c, i] of Object.entries(prefs.changed)) if (c !== category) changed[c] = i;
  if ((ownIcon(CATEGORY_ICONS, category) ?? '') !== icon) changed[category] = icon;
  return { on: prefs.on, changed };
}

/**
 * The icon of each category with one, by the setting: what `shownIcon` takes as its last step. `chosen`: the icons the
 * setting names even while the step is off (what its fields show).
 */
export function categoryIconsOf(prefs: CategoryIconPrefs, chosen = false): Readonly<Record<string, string>> {
  if (!prefs.on && !chosen) return NO_CATEGORY_ICONS;
  const icons = Object.assign(record(), CATEGORY_ICONS);
  for (const [category, icon] of Object.entries(prefs.changed)) {
    if (icon === '') delete icons[category];
    else icons[category] = icon;
  }
  return icons;
}

/**
 * The categories the setting offers: those that come with an icon, then the ones the vault knows (`known`), then any
 * other the setting names, each once.
 */
export function categoryIconRows(prefs: CategoryIconPrefs, known: readonly string[]): string[] {
  const rows: string[] = [];
  for (const c of [...Object.keys(CATEGORY_ICONS), ...known, ...Object.keys(prefs.changed)]) if (!rows.includes(c)) rows.push(c);
  return rows;
}

// Code points that never begin a character of their own in the fallback below: marks (also the variation selectors
// and the keycap), the joiner, the modifiers of the skin tone and the tags of a flag of a region.
const EXTENDS = /^[\p{M}\u{200D}\p{Emoji_Modifier}\u{E0020}-\u{E007F}]$/u;
const REGIONAL = /^[\u{1F1E6}-\u{1F1FF}]$/u;

/**
 * Whether `text` is exactly one character as a person sees it (one grapheme): an emoji with its variants and joins
 * counts as one. `Intl.Segmenter` where the browser has it (not Chrome 86, the oldest of the matrix), else an
 * approximation that knows the joins of emoji, marks, skin tones, flags and keycaps.
 */
export function isOneGrapheme(text: string, segmenter: Intl.Segmenter | null = defaultSegmenter()): boolean {
  if (text === '' || text.trim() !== text) return false;
  if (segmenter) {
    const parts = segmenter.segment(text)[Symbol.iterator]();
    return !parts.next().done && parts.next().done === true;
  }
  let bases = 0;
  let afterJoin = false;
  let regional = 0;
  for (const cp of text) {
    if (cp === '\u{200D}') {
      afterJoin = true;
      continue;
    }
    if (EXTENDS.test(cp)) continue;
    if (afterJoin) {
      afterJoin = false;
      continue;
    }
    if (REGIONAL.test(cp)) {
      regional += 1;
      if (regional % 2 === 0) continue;
    } else regional = 0;
    bases += 1;
    if (bases > 1) return false;
  }
  return bases === 1;
}

let segmenterMade: Intl.Segmenter | null | undefined;

function defaultSegmenter(): Intl.Segmenter | null {
  if (segmenterMade === undefined) {
    try {
      segmenterMade = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
    } catch {
      segmenterMade = null;
    }
  }
  return segmenterMade;
}

/** An icon to draw and the container whose folder an asset of it lies in. */
export interface ShownIcon {
  icon: Icon;
  owner: { kind: AssetOwner; id: string };
  from: 'own' | 'path' | 'category';
}

/** The container of a learning point (`point: <container id>#<key>`), or null. */
export function containerOfPoint(point: string | undefined): string | null {
  if (point === undefined) return null;
  const cut = point.indexOf('#');
  const id = cut < 0 ? point : point.slice(0, cut);
  return /^[^/#\s]+\/[^/#\s]+$/.test(id) ? id : null;
}

/** An icon the page can draw: an emoji, or an asset whose path is below `assets/`; a word has no picture here. */
export function drawable(icon: Icon | undefined): icon is Icon {
  if (!icon || typeof icon.value !== 'string' || icon.value === '') return false;
  if (icon.kind === 'emoji') return true;
  return icon.kind === 'asset' && icon.value.startsWith('assets/');
}

/**
 * The icon of an item by the inheritance: its own (`self`), else the one of the path its point belongs to (`paths`:
 * the icons of the paths by id), else the one of its first category with an icon in `categories` (the setting,
 * `App.categoryIcons`; none when not given).
 */
export function shownIcon(
  self: { kind: AssetOwner; id: string; icon?: Icon; point?: string; category?: readonly string[] },
  paths: ReadonlyMap<string, Icon | undefined> = new Map(),
  categories: Readonly<Record<string, string>> = NO_CATEGORY_ICONS,
): ShownIcon | null {
  if (drawable(self.icon)) return { icon: self.icon, owner: { kind: self.kind, id: self.id }, from: 'own' };
  const path = containerOfPoint(self.point);
  const inherited = path === null ? undefined : paths.get(path);
  if (path !== null && drawable(inherited)) return { icon: inherited, owner: { kind: 'path', id: path }, from: 'path' };
  for (const category of self.category ?? []) {
    const emoji = ownIcon(categories, category);
    if (emoji) return { icon: { kind: 'emoji', value: emoji }, owner: { kind: self.kind, id: self.id }, from: 'category' };
  }
  return null;
}
