// The way in of the web variant: choose a folder or take one used before, get the permission back after a restart, read
// the vault into the engine's file system. A small state machine without a DOM; the page (WebEntry.svelte) draws its
// state and calls its methods from clicks.

import {
  grantAccess,
  LOOK_WAIT_MS,
  permissionOf,
  pickFolder,
  pickerSupport,
  oneLine,
  within,
  type DirHandle,
  type PickerWindow,
  type Recent,
  type RecentFolders,
} from './folder.ts';
import { inputFolderSupport, pickFolderByInput, type InputDocument } from 'appkit-web/folder-input';
import { NoAreasError, readVaultFolder, VaultLimitError, type DirHandleLike, type Skipped } from './vault-files.ts';

export type Access = 'granted' | 'prompt' | 'denied' | 'gone';

export interface RecentView {
  id: string;
  name: string;
  access: Access;
}

/**
 * Why the last attempt did not lead into a vault. `detail` is a short plain line of the browser or the reader; for
 * `no_areas_below` it is the name of the folder inside the chosen one that looks like the vault, for `switch_allow` the
 * name of the folder the switch asked for.
 */
export interface Notice {
  code:
    | 'cancelled'
    | 'empty'
    | 'no_paths'
    | 'blocked'
    | 'failed'
    | 'denied'
    | 'gone'
    | 'limit'
    | 'no_areas'
    | 'no_areas_below'
    /** A switch in the menu asked for this folder, and the browser wants to be asked again; `detail` is its name. */
    | 'switch_allow'
    /** The list of the folders used before could not be read, or the browser did not hand it out in time. */
    | 'recent_failed';
  detail?: string;
}

export type EntryState =
  | { step: 'starting' }
  | { step: 'unsupported'; reason: 'missing' | 'insecure' }
  /** `readOnly`: this browser has no folder picker (Firefox, Safari), the folder is read through an input and not written. */
  | { step: 'choose'; recent: RecentView[]; notice: Notice | null; readOnly: boolean }
  | { step: 'opening'; name: string }
  /**
   * `folder` is the id the folders used before give this one (`null`: the browser could not keep it): what the page keeps
   * for this folder alone, its list cache, is named by it. The engine's `vault.id` is the name of the mount point and is
   * the same for every folder, so it cannot tell two folders apart.
   */
  | { step: 'open'; name: string; files: number; skipped: Skipped[]; folder: string | null; readOnly: boolean };

export interface MountedVault {
  files: number;
  skipped: Skipped[];
}

export interface EntryDeps {
  win: PickerWindow;
  recent: RecentFolders;
  /**
   * Read the folder and put it into the engine; the page passes `mountFolder` over its worker client. `readOnly`: the
   * folder came through an input, it has no handle to write to.
   */
  open(handle: DirHandleLike, readOnly: boolean): Promise<MountedVault>;
  now(): number;
  /**
   * A folder used before was forgotten: the page drops what it kept for it besides the handle (its list cache). It is a
   * convenience like the list of folders: a failure must not keep the folder in the list.
   */
  forgotten?(id: string): Promise<void>;
  /**
   * The folder the page before asked to open (a switch in the menu "Project", web/vault-switch.ts), taken out once. It
   * is opened without a click when the browser still grants the access; otherwise the start page shows it as usual.
   */
  pending?(): string | null;
  /**
   * How long a look that should be quick may take (the list of folders used before, the permission of each); then the
   * list counts as unreadable and a folder as one to ask for. `LOOK_WAIT_MS` when not given; tests pass a short one.
   */
  waitMs?: number;
}

/** Read a folder and mount it at `root` of the engine's file system. */
export async function mountFolder(
  client: { mount(root: string, files: Map<string, Uint8Array>): Promise<number> },
  root: string,
  handle: DirHandleLike,
): Promise<MountedVault> {
  const vault = await readVaultFolder(handle);
  const files = await client.mount(root, vault.files);
  return { files, skipped: vault.skipped };
}

export class Entry {
  // Plain fields, no parameter properties: Node runs this file by stripping the types, without a build.
  private readonly deps: EntryDeps;
  private current: EntryState = { step: 'starting' };
  private readonly listeners = new Set<(state: EntryState) => void>();
  // Whether the folder is chosen through an input (no picker in this browser); decided by `start`.
  private readOnly = false;
  // A dialog of the input is open: a second click must not open another one (and read a second vault).
  private picking = false;

  constructor(deps: EntryDeps) {
    this.deps = deps;
  }

  get state(): EntryState {
    return this.current;
  }

  subscribe(listener: (state: EntryState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private set(state: EntryState): void {
    this.current = state;
    for (const listener of [...this.listeners]) listener(state);
  }

  /** The first look: can this page choose a folder, and which ones were used before. */
  async start(notice: Notice | null = null): Promise<void> {
    const support = pickerSupport(this.deps.win);
    // No picker, but an input that takes a folder: the vault can be read, not written (stage 1 of the other browsers).
    if (support === 'missing' && inputFolderSupport(this.deps.win.document)) {
      this.readOnly = true;
      this.set({ step: 'choose', recent: [], notice, readOnly: true });
      return;
    }
    this.readOnly = false;
    if (support !== 'ok') {
      this.set({ step: 'unsupported', reason: support });
      return;
    }
    const pending = this.deps.pending?.() ?? null;
    const wait = this.deps.waitMs ?? LOOK_WAIT_MS;
    // The list of folders used before is a convenience: one that cannot be read, or that the browser does not hand out
    // (IndexedDB unanswered), leaves the start page with the picker and a line that says so, never on "starting".
    let entries: Recent[];
    try {
      const listed = await within<Recent[] | null>(this.deps.recent.list(), wait, null);
      if (listed === null) throw new Error('timeout');
      entries = listed;
    } catch {
      entries = [];
      notice ??= { code: 'recent_failed' };
    }
    // Asked side by side: each look has its own limit, so the start page waits for one limit, not one per folder.
    const recent: RecentView[] = await Promise.all(
      entries.map(async (entry) => ({ id: entry.id, name: entry.name, access: await permissionOf(entry.handle, wait) })),
    );
    const chosen = pending === null ? undefined : entries.find((e) => e.id === pending);
    // The switch asked for the access inside its click; a folder that lost it meanwhile (or is gone) waits on the start
    // page, with its state, for a click of its own.
    if (chosen && recent.find((r) => r.id === chosen.id)?.access === 'granted') return this.enter(chosen.handle, false);
    if (pending !== null && notice === null) {
      const access = recent.find((r) => r.id === pending)?.access;
      if (access === undefined || access === 'gone') notice = { code: 'gone' };
      else if (access === 'denied') notice = { code: 'denied' };
      // The browser wants a click of its own before it hands the folder out again: say which folder the click opens,
      // the general line "Allow access" in its row does not say that the switch is still under way.
      else if (access === 'prompt') notice = { code: 'switch_allow', detail: chosen?.name ?? '' };
    }
    this.set({ step: 'choose', recent, notice, readOnly: false });
  }

  /** From the click on "Choose folder". */
  async pick(): Promise<void> {
    if (this.readOnly) {
      if (this.picking) return;
      this.picking = true;
      try {
        return await this.pickByInput();
      } finally {
        this.picking = false;
      }
    }
    const result = await pickFolder(this.deps.win);
    if (result.kind === 'cancelled') return this.start({ code: 'cancelled' });
    if (result.kind === 'blocked') return this.start({ code: 'blocked', detail: result.message });
    if (result.kind === 'failed') return this.start({ code: 'failed', detail: result.message });
    await this.enter(result.handle, false);
  }

  private async pickByInput(): Promise<void> {
    // Still inside the click: nothing that waits comes before the input is opened.
    const result = await pickFolderByInput(this.deps.win.document as InputDocument);
    if (result.kind === 'cancelled') return this.start({ code: 'cancelled' });
    if (result.kind === 'empty') return this.start({ code: 'empty' });
    if (result.kind === 'no_paths') return this.start({ code: 'no_paths' });
    if (result.kind === 'failed') return this.start({ code: 'failed', detail: result.message });
    await this.enter(result.folder, true);
  }

  /** From the click on a folder used before. Asks for the permission first when the browser dropped it. */
  async openRecent(id: string): Promise<void> {
    const wait = this.deps.waitMs ?? LOOK_WAIT_MS;
    const listed = await within<Recent[] | null>(this.deps.recent.list(), wait, null).catch(() => null);
    if (listed === null) return this.start({ code: 'recent_failed' });
    const entry = listed.find((e) => e.id === id);
    if (!entry) return this.start();
    // The click is the user gesture `requestPermission` needs: nothing that waits comes before it but these two looks,
    // each within its limit (Chrome keeps the gesture for some seconds).
    let access = await permissionOf(entry.handle, wait);
    if (access === 'prompt') access = await grantAccess(entry.handle);
    if (access === 'gone') return this.start({ code: 'gone' });
    if (access !== 'granted') return this.start({ code: 'denied' });
    await this.enter(entry.handle, false);
  }

  async forget(id: string): Promise<void> {
    await this.deps.recent.forget(id);
    try {
      await this.deps.forgotten?.(id);
    } catch {
      // the folder is out of the list; what the page kept for it is a miss at worst
    }
    await this.start();
  }

  private async enter(handle: DirHandleLike, readOnly: boolean): Promise<void> {
    this.set({ step: 'opening', name: handle.name });
    try {
      const mounted = await this.deps.open(handle, readOnly);
      // The list of folders used before is a convenience: a browser that cannot keep it (a private window, a full
      // quota, a handle that does not clone) must not keep the person out of a vault that was read. A folder read
      // through an input has no handle to keep: it is asked for again on every visit and keeps no list of its own.
      let folder: string | null = null;
      if (!readOnly) {
        try {
          folder = (await this.deps.recent.remember(handle as DirHandle, this.deps.now())).id;
        } catch {
          // the next start simply does not list this folder
        }
      }
      this.set({ step: 'open', name: handle.name, files: mounted.files, skipped: mounted.skipped, folder, readOnly });
    } catch (error) {
      const name = typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
      if (error instanceof VaultLimitError) return this.start({ code: 'limit', detail: error.message });
      if (error instanceof NoAreasError) {
        return this.start(error.below ? { code: 'no_areas_below', detail: error.below } : { code: 'no_areas' });
      }
      if (name === 'NotFoundError') return this.start({ code: 'gone' });
      if (name === 'NotAllowedError' || name === 'SecurityError') return this.start({ code: 'denied' });
      return this.start({ code: 'failed', detail: oneLine(error) });
    }
  }
}
