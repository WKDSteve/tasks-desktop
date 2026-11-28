// Switching between the vaults used before, in the web variant: the menu "Project" lists the folders the page remembers
// (their handles in IndexedDB, `RecentFolders`) and one click opens another.
//
// A switch loads the page again: a fresh engine reads the other folder, and nothing of the vault that was left (its
// engine, its list, its view) is carried over. The click itself asks the browser for the folder when it dropped the
// permission (after a restart): `requestPermission` needs the click, the page that loads next has none. The folder to
// open is put into the tab's session storage (only its id, never a name or anything of the vault) and taken out by the
// way in, which opens it without asking again (`Entry.start`).
//
// What the page remembers per vault (filter, order, view, the named lists) is kept under the id of the folder
// (`vaultPrefs`), so that a vault opens with the filter and the view it was left with. The id is the one the folders
// used before give each folder; it says nothing of the vault.

import { grantAccess, LOOK_WAIT_MS, permissionOf, within, type DirHandle, type Recent, type RecentFolders } from './folder.ts';

/** The key in the tab's session storage under which the next page finds the folder to open. */
export const SWITCH_KEY = 'tasks-web.switch-to';

export type Access = 'granted' | 'prompt' | 'denied' | 'gone';

/** A vault in the menu: a folder used before. `active`: the one the page reads now. */
export interface FolderVault {
  id: string;
  name: string;
  active: boolean;
  access: Access;
}

/**
 * What came of a click on a vault. `switched`: the page loads again with that folder. `busy`: a change began to be
 * written while the browser asked for the folder; the page stays (leaving it would cut the change off).
 */
export type SwitchResult = 'switched' | 'same' | 'denied' | 'gone' | 'busy';

type TabStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface FolderVaultsDeps {
  recent: Pick<RecentFolders, 'list'>;
  /** The id of the folder the page reads now (`null`: a folder the browser could not remember). */
  active: string | null;
  /** The tab's session storage. */
  tab: TabStorage;
  /** Load the page again, at the way in (without the fragment: no view or task of this vault goes along). */
  reload(): void;
  /** The permission of a stored folder now, and asking for it again; the page's (folder.ts), replaced in tests. */
  permissionOf?(handle: DirHandle): Promise<Access>;
  grantAccess?(handle: DirHandle): Promise<Access>;
  /** A change is being written to the folder now (asked again right before the page loads again). */
  writing?(): boolean;
  /**
   * How long the list of folders and the permission of one may take (`LOOK_WAIT_MS` when not given): a list the
   * browser does not hand out counts as empty, a permission it does not say as `prompt`.
   */
  waitMs?: number;
}

export class FolderVaults {
  private readonly deps: FolderVaultsDeps;

  constructor(deps: FolderVaultsDeps) {
    this.deps = deps;
  }

  /** The folders used before, the one used last first, with the access each has now (asked side by side). */
  async list(): Promise<FolderVault[]> {
    const entries = await this.entries();
    return Promise.all(
      entries.map(async (entry) => ({
        id: entry.id,
        name: entry.name,
        active: entry.id === this.deps.active,
        access: await this.accessOf(entry.handle),
      })),
    );
  }

  private get wait(): number {
    return this.deps.waitMs ?? LOOK_WAIT_MS;
  }

  /** The stored folders; none when the browser does not hand them out in time. A failure to read still throws. */
  private async entries(): Promise<Recent[]> {
    return within<Recent[]>(this.deps.recent.list(), this.wait, []);
  }

  /** The permission now, within the limit (`prompt` without an answer); a failure is no permission. */
  private async accessOf(handle: DirHandle): Promise<Access> {
    const of = this.deps.permissionOf ?? permissionOf;
    try {
      return await within(of(handle), this.wait, 'prompt');
    } catch {
      return 'denied';
    }
  }

  /**
   * From the click on a vault: get the access (asked of the browser inside the click when it dropped it), then load the
   * page again with that folder. The click is the user gesture `requestPermission` needs: nothing waits before it but
   * the look at the stored list and at the permission, as on the way in (`Entry.openRecent`).
   */
  async select(id: string): Promise<SwitchResult> {
    if (id === this.deps.active) return 'same';
    const entry = (await this.entries()).find((e) => e.id === id);
    if (!entry) return 'gone';
    const grant = this.deps.grantAccess ?? grantAccess;
    // Asking again is not limited: it waits for the person's answer in the browser's dialog.
    let access = await this.accessOf(entry.handle);
    try {
      if (access === 'prompt') access = await grant(entry.handle);
    } catch {
      access = 'denied';
    }
    if (access === 'gone') return 'gone';
    if (access !== 'granted') return 'denied';
    // The question of the browser can stay open for a while, and a change can begin meanwhile: asked again here, with
    // nothing that waits between this look and the reload.
    if (this.deps.writing?.()) return 'busy';
    try {
      this.deps.tab.setItem(SWITCH_KEY, id);
    } catch {
      // A tab that keeps nothing: the next page shows the way in, where the folder is one click.
    }
    this.deps.reload();
    return 'switched';
  }
}

/** The folder the page before asked to open (once: it is taken out), or `null`. */
export function takeSwitch(tab: TabStorage): string | null {
  try {
    const id = tab.getItem(SWITCH_KEY);
    tab.removeItem(SWITCH_KEY);
    return id !== null && id !== '' ? id : null;
  } catch {
    return null;
  }
}

/**
 * The keys of the preferences that belong to a vault: the filter, the order, the view (and the task open in it), the
 * named lists, the folded groups, the order of the graph, what the palette ranks (task ids among it) and the start
 * view. Everything else (language, theme, columns, sizes) is the person's, the same in every vault.
 */
export const VAULT_KEYS: readonly string[] = [
  'tasks-desktop.filter',
  'tasks-desktop.sort',
  'tasks-desktop.view',
  'tasks-desktop.view-open',
  'tasks-desktop.lists',
  'tasks-desktop.folds',
  'tasks-desktop.graph-order',
  'tasks-desktop.frecency',
  'tasks-desktop.defaults',
];

type Prefs = Pick<Storage, 'getItem' | 'setItem'>;
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The scope of a folder the browser could not remember (no id): one for all such folders, apart from the others. */
export const UNREMEMBERED = '-';

/** The key a preference of the vault `folder` is kept under. */
export function vaultKeyOf(key: string, folder: string): string {
  return `${key}@${folder}`;
}

/**
 * The preferences of the page for the vault `folder`: the keys of `VAULT_KEYS` are kept per folder, the rest as they
 * are. A folder the browser could not remember (`null`) keeps them under `UNREMEMBERED`.
 *
 * What the page kept before it kept them per vault (the plain keys) goes to the first vault opened after that, the
 * one it was most likely made in, and the plain keys go: no other vault ever reads them.
 */
export function vaultPrefs(prefs: Store, folder: string | null): Prefs {
  const scope = folder ?? UNREMEMBERED;
  try {
    for (const key of VAULT_KEYS) {
      const old = prefs.getItem(key);
      if (old === null) continue;
      if (prefs.getItem(vaultKeyOf(key, scope)) === null) prefs.setItem(vaultKeyOf(key, scope), old);
      prefs.removeItem(key);
    }
  } catch {
    // storage blocked: there is nothing to take over either
  }
  const scoped = (key: string) => (VAULT_KEYS.includes(key) ? vaultKeyOf(key, scope) : key);
  return {
    getItem: (key) => prefs.getItem(scoped(key)),
    setItem: (key, value) => prefs.setItem(scoped(key), value),
  };
}

/** A folder that is forgotten takes its preferences with it. */
export function forgetVaultPrefs(prefs: Pick<Storage, 'removeItem'>, folder: string): void {
  for (const key of VAULT_KEYS) prefs.removeItem(vaultKeyOf(key, folder));
}

/** The vault the page opened: the folder's id (`null`: not remembered) and its name. */
export interface OpenedVault {
  folder: string | null;
  name: string;
}

type VaultHook = (vault: OpenedVault) => void;
const hooks = new Set<VaultHook>();

/**
 * Be told of every vault the page opens (once per page: a switch loads the page again). The place for what hangs on
 * the vault besides its files, such as the calendars shown with it (task `fremde-kalender-ics-...`). A hook that throws
 * does not keep the others or the vault from opening.
 */
export function onVaultOpened(hook: VaultHook): () => void {
  hooks.add(hook);
  return () => {
    hooks.delete(hook);
  };
}

/** The page opened `vault`: tell the hooks. */
export function vaultOpened(vault: OpenedVault): void {
  for (const hook of [...hooks]) {
    try {
      hook(vault);
    } catch {
      // one hook's failure is its own
    }
  }
}
