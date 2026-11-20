// What stands for an item (concept "Lernplan" 11.3, E11): its own `icon`, else the icon of the learning path it was
// promoted from, else the icon of its first category that has one. The engine normalises `icon:` to an emoji, an
// asset below the item's folder or a word of its list (`Icon`); an asset is drawn only as `<img>` of the owner's
// folder, so the result names whose folder it lies in.

import type { AssetOwner } from './api';
import type { Icon } from './contract';

/** The icon of a category, where it has one: the last step of the inheritance. */
export const CATEGORY_ICONS: Readonly<Record<string, string>> = {
  learning: '📚',
  bug: '🐞',
  security: '🔒',
  performance: '⚡',
  docs: '📄',
  tests: '🧪',
};

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
 * the icons of the paths by id), else the one of its first category with an icon.
 */
export function shownIcon(
  self: { kind: AssetOwner; id: string; icon?: Icon; point?: string; category?: readonly string[] },
  paths: ReadonlyMap<string, Icon | undefined> = new Map(),
): ShownIcon | null {
  if (drawable(self.icon)) return { icon: self.icon, owner: { kind: self.kind, id: self.id }, from: 'own' };
  const path = containerOfPoint(self.point);
  const inherited = path === null ? undefined : paths.get(path);
  if (path !== null && drawable(inherited)) return { icon: inherited, owner: { kind: 'path', id: path }, from: 'path' };
  for (const category of self.category ?? []) {
    const emoji = CATEGORY_ICONS[category];
    if (emoji) return { icon: { kind: 'emoji', value: emoji }, owner: { kind: self.kind, id: self.id }, from: 'category' };
  }
  return null;
}
