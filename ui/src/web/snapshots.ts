// The text snapshots of the test sheets in the web variant. The hub reads them from the folder of the plugin checkouts
// (`crates/tasks-hub/src/snapshots.rs`); here there is no hub, so the person gives that folder once, read-only, for this
// page. The rules of a name are the hub's: `<repo>/TESTS/__snapshots__/...<name>.snap`, plain parts only, at most 256 KiB.

import { ApiError } from '../lib/api';
import { validAreaName } from './hub';

export const MAX_SNAPSHOT_BYTES = 256 * 1024;

/** What a folder of the browser has to offer here. */
export interface SnapshotDir {
  getDirectoryHandle(name: string): Promise<SnapshotDir>;
  getFileHandle(name: string): Promise<{ getFile(): Promise<Blob> }>;
}

/** The parts of a snapshot name, or null when it is none. */
export function snapshotParts(name: string): string[] | null {
  if (name === '' || name.length > 400 || name.includes('\\') || name.includes('\0')) return null;
  const parts = name.split('/');
  const plain = parts.every((p) => p !== '' && p !== '..' && !p.startsWith('.') && !p.includes(':'));
  if (!plain || parts.length < 4 || !validAreaName(parts[0] ?? '')) return null;
  if (parts[1] !== 'TESTS' || parts[2] !== '__snapshots__' || !name.endsWith('.snap')) return null;
  return parts;
}

/** The text of the snapshot `name` below `root`. A refusal is an `ApiError`, with the code the hub would answer. */
export async function readSnapshot(root: SnapshotDir, name: string): Promise<string> {
  const parts = snapshotParts(name);
  if (!parts) throw new ApiError(400, 'bad_name', 'not a snapshot name');
  const file = parts[parts.length - 1] ?? '';
  try {
    let dir = root;
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    const blob = await (await dir.getFileHandle(file)).getFile();
    if (blob.size > MAX_SNAPSHOT_BYTES) throw new ApiError(413, 'too_large', 'the snapshot is too large');
    return await blob.text();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(404, 'not_found', 'the snapshot is not there');
  }
}

/** The folder of the checkouts, for as long as this page lives. */
export class CheckoutFolder {
  #root: SnapshotDir | null = null;

  constructor(private readonly pick: () => Promise<SnapshotDir | null>) {}

  /** Ask the person for the folder (inside a click). Whether there is one now. */
  async choose(): Promise<boolean> {
    const chosen = await this.pick();
    if (chosen) this.#root = chosen;
    return this.#root !== null;
  }

  read(name: string): Promise<string> {
    if (!this.#root) return Promise.reject(new ApiError(409, 'no_checkouts', 'no folder of checkouts was given'));
    return readSnapshot(this.#root, name);
  }
}
