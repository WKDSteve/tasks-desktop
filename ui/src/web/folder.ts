// The folder the person works in, in the web variant: choosing it (File System Access API), the folders used before
// (their handles in IndexedDB), and the permission to read them, which the browser asks again after a restart.
//
// The code is the kit's (appkit-web/folder); this names what is the tasks page's own: the mode it asks for, the id the
// picker remembers its start folder under, and the database its handles are kept in. Every local file shares the origin
// file://, so another app's page (testing-web) keeps its handles in a database of its own name, never in this one.

import {
  grantAccess as kitGrantAccess,
  permissionOf as kitPermissionOf,
  pickFolder as kitPickFolder,
  type AccessMode,
  type DirHandle,
  type PermissionState,
  type PickerWindow,
  type PickResult,
} from 'appkit-web/folder';

export {
  displayName,
  idbKeyValue,
  MAX_RECENT,
  oneLine,
  pickerSupport,
  RecentFolders,
  type AccessMode,
  type DirHandle,
  type KeyValue,
  type PermissionState,
  type PickerWindow,
  type PickResult,
  type Recent,
  type Support,
} from 'appkit-web/folder';

/** The mode asked for. `readwrite` from the start, so that writing (step 8) does not ask a second time. */
export const MODE: AccessMode = 'readwrite';
/** The picker remembers the last folder per id and starts there. */
export const PICKER_ID = 'tasks-web-vault';
/** The database of the folders used before (the store in it: `handles`). */
export const HANDLES_DB = 'tasks-web';

/** Ask the person for a folder. Must run inside a click: the browser refuses the picker without one. */
export function pickFolder(win: PickerWindow): Promise<PickResult> {
  return kitPickFolder(win, { id: PICKER_ID, mode: MODE });
}

/** Ask for a folder that is only read: the snapshots in the plugin checkouts. */
export function pickReadOnlyFolder(win: PickerWindow): Promise<PickResult> {
  return kitPickFolder(win, { id: 'tasks-checkouts', mode: 'read' });
}

/**
 * How long the browser gets to answer a look that should be quick: the permission of a stored folder, the list of the
 * folders used before. Chrome was seen to leave `queryPermission` of a stored handle unanswered for good (2026-11-19);
 * without a limit the way in stayed on "starting" with nothing to click.
 */
export const LOOK_WAIT_MS = 2000;

/**
 * `promise`, or `fallback` once `ms` have passed without an answer. A promise that rejects still rejects (inside the
 * limit). The timer is cleared when the answer comes first.
 */
export function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * The permission a stored handle has now; `gone` when the folder does not exist any more. A browser that does not
 * answer within `waitMs` is taken to want to be asked (`prompt`): the folder's row then offers "Allow access", whose
 * click asks with `requestPermission`.
 */
export function permissionOf(handle: DirHandle, waitMs: number = LOOK_WAIT_MS): Promise<PermissionState | 'gone'> {
  return within(kitPermissionOf(handle, MODE), waitMs, 'prompt');
}

/** Ask for the permission again. Must run inside a click (the first thing the click handler does). */
export function grantAccess(handle: DirHandle): Promise<PermissionState | 'gone'> {
  return kitGrantAccess(handle, MODE);
}
