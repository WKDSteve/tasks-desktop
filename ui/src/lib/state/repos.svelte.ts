// The repo tiles of this device: the document of the hub, one change at a time, and what came of it. A part of the
// state of the page of its own. The page works out the next order with the pure functions of `../repos` and hands it
// here; this sends it on the state read and draws what the hub answered (the hub is the one writer of the file).

import { ApiError } from '../api';
import { saveBody, type HubRepos, type RepoGroup } from '../repos';

/** What the tiles need of the page around it. */
export interface ReposHost {
  repos(): Promise<HubRepos>;
  repoAdd(body: { path: string; name?: string; group: string }): Promise<HubRepos>;
  repoSave(body: { rev: string; groups: RepoGroup[]; names: Record<string, string> }): Promise<HubRepos>;
}

/** How the tiles stand: not read yet, read, this hub keeps none, or the hub did not answer. */
export type ReposRead = 'idle' | 'ready' | 'unavailable' | 'failed';

export class ReposState {
  /** The document as the hub gave it last; `null` until read. */
  doc = $state.raw<HubRepos | null>(null);
  read = $state<ReposRead>('idle');
  /** A change is on its way: no second one beside it. */
  saving = $state(false);
  /** Why the last change was not made, in the hub's words (`stale`: the tiles changed meanwhile, read again). */
  problem = $state<string | null>(null);
  private seq = 0;

  constructor(private readonly host: ReposHost) {}

  /** Read the document; an answer that was overtaken by a newer read or a write is dropped. */
  async load(): Promise<void> {
    this.seq += 1;
    const seq = this.seq;
    try {
      const doc = await this.host.repos();
      if (seq !== this.seq) return;
      this.doc = doc;
      this.read = 'ready';
    } catch (error) {
      if (seq !== this.seq) return;
      this.read = error instanceof ApiError && error.code === 'repos_unavailable' ? 'unavailable' : 'failed';
    }
  }

  /** One change: what it answered becomes the document; a refusal is said, and a clash of states reads it again. */
  private async change(send: () => Promise<HubRepos>): Promise<boolean> {
    if (this.saving) return false;
    this.saving = true;
    this.seq += 1;
    try {
      this.doc = await send();
      this.problem = null;
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'stale') {
        this.problem = 'stale';
        this.saving = false;
        await this.load();
        return false;
      }
      this.problem = error instanceof ApiError ? error.message : 'failed';
      return false;
    } finally {
      this.saving = false;
    }
  }

  /** A folder as a tile of a group (its name from the folder unless one is given). */
  add(path: string, group: string, name?: string): Promise<boolean> {
    const body = { path, group, ...(name !== undefined && name.trim() !== '' ? { name: name.trim() } : {}) };
    return this.change(() => this.host.repoAdd(body));
  }

  /** The groups as the page worked them out, and new names, on the state read. */
  save(groups: readonly RepoGroup[], names: Record<string, string> = {}): Promise<boolean> {
    const doc = this.doc;
    if (!doc) return Promise.resolve(false);
    return this.change(() => this.host.repoSave(saveBody(doc, groups, names)));
  }
}
