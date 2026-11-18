// The part of the menu "Options" that chooses the actions at the end of a row of a list (lib/rowActions.ts): one
// switch for each action, and one that shows them on every row. Nothing is forced: as the page comes, a row offers
// the one action it had before.

import type { MenuItem } from 'appkit-ui/menu';
import type { App } from './app.svelte';
import { translate, type Key } from './i18n';
import { ROW_ACTIONS, toggleRowAction } from './rowActions';

/** What the entries need of the page. */
export type RowActionsMenuApp = Pick<App, 'lang' | 'rowActions' | 'setRowActions'>;

export function rowActionsMenuItems(app: RowActionsMenuApp): MenuItem[] {
  const t = (key: Key) => translate(app.lang, key);
  const prefs = app.rowActions;
  return [
    { kind: 'section', label: t('menu.sec.row_actions') },
    ...ROW_ACTIONS.map((action) => ({
      kind: 'check' as const,
      label: t(`menu.rowact.${action}`),
      hint: t('hint.item.menu.rowact'),
      checked: prefs.shown.includes(action),
      onselect: () => app.setRowActions(toggleRowAction(prefs, action)),
    })),
    {
      kind: 'check',
      label: t('menu.rowact.always'),
      hint: t('hint.item.menu.rowact.always'),
      checked: prefs.always,
      onselect: () => app.setRowActions({ ...prefs, always: !prefs.always }),
    },
  ];
}
