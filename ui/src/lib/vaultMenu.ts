// The vault part of the menu "Project": which vault is read, the others the hub can read, and what is done with its
// folder. The web variant has no hub and nothing on the machine it could start: it reads the one folder the person
// chose in the browser, so the entry that shows the folder in the file explorer (`vault_reveal`) is not offered there,
// and in place of managing the vaults of a hub it goes back to the way in, where another folder is chosen. The folders
// it read before are its vaults (`folderVaultList`): one click reads another (web/vault-switch.ts).

import type { MenuItem } from 'appkit-ui/menu';
import type { App } from './app.svelte';
import { translate, type Key } from './i18n';

/** What the entries need of the page. */
export type VaultMenuApp = Pick<
  App,
  'lang' | 'phase' | 'snapshot' | 'tasks' | 'vaultList' | 'vaultBusy' | 'machineActions' | 'selectVault' | 'revealVault' | 'openVaults' | 'canChooseFolder' | 'chooseFolder' | 'folderVaultList' | 'folderSwitching' | 'selectFolderVault' | 'loadFolderVaults'
>;

/**
 * The menu "Project" opens (`Menu.onopen`): the folders of the web variant are read again. Their access is the
 * browser's and changes without the page (it drops a permission after a while, a folder is moved away), so a tab that
 * was open for long would still say "ready" for a folder that asks again or is gone. Beside a hub there are no such
 * folders and nothing is read.
 */
export function vaultMenuOpened(app: Pick<App, 'loadFolderVaults'>): void {
  void app.loadFolderVaults();
}

export function vaultMenuItems(app: VaultMenuApp): MenuItem[] {
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);
  const ready = app.phase === 'ready';
  // The web variant names the folder it reads (the engine's id there is the name of its mount point, the same for all).
  const folders = app.folderVaultList ?? [];
  const vault = folders.find((v) => v.active)?.name ?? app.snapshot?.vault?.id;
  const areas = new Set(app.tasks.map((x) => x.area)).size;
  return [
    { kind: 'section', label: t('menu.sec.vault') },
    ...(vault ? [{ kind: 'info' as const, label: t('menu.vault', { name: vault }) }] : []),
    ...(ready ? [{ kind: 'info' as const, label: t('menu.vault_info', { areas, tasks: app.tasks.length }) }] : []),
    ...(app.vaultList?.vaults ?? []).map((v) => ({
      kind: 'radio' as const,
      label: v.name === 'main' ? `${v.label} (main)` : `${v.name} (${v.label})`,
      checked: v.name === app.vaultList?.active,
      disabled: !ready || app.vaultBusy,
      hint: t('hint.item.menu.vault_switch'),
      onselect: () => void app.selectVault(v.name),
    })),
    ...folders.map((v) => ({
      kind: 'radio' as const,
      label: v.access === 'gone' ? t('menu.vault_gone', { name: v.name }) : v.name,
      checked: v.active,
      disabled: !ready || app.folderSwitching || v.access === 'gone',
      hint: t(v.access === 'granted' || v.active ? 'hint.item.menu.vault_switch' : 'hint.item.menu.vault_switch_allow'),
      onselect: () => void app.selectFolderVault(v.id),
    })),
    ...(app.machineActions
      ? [
          {
            kind: 'action' as const,
            label: t('menu.vault_reveal'),
            hint: t('hint.item.menu.vault_reveal'),
            disabled: !ready || app.vaultBusy,
            onselect: () => void app.revealVault(),
          },
        ]
      : []),
    app.canChooseFolder
      ? {
          kind: 'action' as const,
          label: t('menu.vault_open_other'),
          hint: t('hint.item.menu.vault_open_other'),
          disabled: app.vaultBusy || app.folderSwitching,
          onselect: () => app.chooseFolder(),
        }
      : {
          kind: 'action' as const,
          label: t('menu.vaults_manage'),
          hint: t('hint.item.menu.vaults_manage'),
          disabled: !ready || !app.vaultList,
          onselect: () => app.openVaults(),
        },
  ];
}
