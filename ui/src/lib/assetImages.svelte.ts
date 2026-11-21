// The images below `assets/` of one container (a task, plan, project, path or meeting) as the page draws them: each
// file is read once with the session (`GET /api/tasks/asset`), kept as an address the page makes itself (`blob:`),
// and given back when the view that shows them goes (`dispose`). The markdown of the kit asks through `source`
// (`ImageSource`): undefined while a file loads, null when there is none, the address once it is there. The page
// never puts a path of the vault or an address of the text into an `<img>` (E12: an SVG is a picture, never markup).
// A file replaced by hand under the same name is no event of the vault: the store asks again with the tag of the
// bytes it holds when the window comes back to the front and when the container changes (`recheck`); the same bytes
// answer `'same'` (a 304 of the hub) and the picture stays as it is.

import { SvelteMap } from 'svelte/reactivity';
import type { ImageSource } from 'appkit-ui/markdown';
import type { AssetAnswer, AssetOwner } from './api';

/** What the store needs: the read of one file (the App's `asset`), with the tag it holds when it asks again. */
export type AssetLoader = (kind: AssetOwner, id: string, file: string, held?: string) => Promise<AssetAnswer>;

/** A window that comes to the front more often than this is not asked again (focus and visibility come together). */
const RECHECK_GAP_MS = 1000;

/** The address of a blob, or null when the browser makes none (a test without `URL.createObjectURL`). */
function addressOf(blob: Blob): string | null {
  try {
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

export class AssetImages {
  readonly kind: AssetOwner;
  readonly id: string;
  #load: AssetLoader;
  #urls = new SvelteMap<string, string | null>();
  #asked = new Set<string>();
  #made: string[] = [];
  #gone = false;
  /** The tag of the bytes behind each address (the hub's ETag), and the files whose read is on its way. */
  #tags = new Map<string, string>();
  #reading = new Set<string>();
  #lastRecheck = -Infinity;
  #onFront: (() => void) | null = null;

  /**
   * `recheckOnFront`: ask again when the window comes back to the front (a view with a few large pictures; not the
   * icon of every row of a list, which would ask once per row).
   */
  constructor(load: AssetLoader, kind: AssetOwner, id: string, opts: { recheckOnFront?: boolean } = {}) {
    this.#load = load;
    this.kind = kind;
    this.id = id;
    if (opts.recheckOnFront && typeof window !== 'undefined' && typeof document !== 'undefined') {
      const onFront = () => {
        if (document.visibilityState === 'hidden') return;
        const now = Date.now();
        if (now - this.#lastRecheck < RECHECK_GAP_MS) return;
        this.#lastRecheck = now;
        this.recheck();
      };
      this.#onFront = onFront;
      window.addEventListener('focus', onFront);
      document.addEventListener('visibilitychange', onFront);
    }
  }

  /** The version of the container last told (`refresh`), and the files it listed then. */
  #version: string | null = null;
  #listed = new Set<string>();

  /** The address of `file`: undefined while it loads (the read starts on the first ask), null when there is none. */
  url(file: string): string | null | undefined {
    if (!this.#asked.has(file) && !this.#gone) {
      this.#asked.add(file);
      this.#read(file);
    }
    return this.#urls.get(file);
  }

  /**
   * The container was read again: its version (`etag`) and, where the engine names them, the files of its folder. When
   * either changed, every file asked is asked again (`recheck`): a missing one is read, one listed now and not before
   * (put into the folder after it was first shown) is read whole, the others with their tag, so a change of the text
   * moves no image that stayed the same. The first call only notes the version.
   */
  refresh(etag: string | undefined, assets?: readonly string[]): void {
    if (this.#gone) return;
    const listed = new Set(assets ?? []);
    const version = `${etag ?? ''}\n${[...listed].sort().join('\n')}`;
    if (this.#version === null || version === this.#version) {
      this.#version = version;
      this.#listed = listed;
      return;
    }
    const before = this.#listed;
    this.#version = version;
    this.#listed = listed;
    for (const file of this.#asked) {
      const added = listed.has(file) && !before.has(file);
      this.#read(file, !added);
    }
  }

  /**
   * Ask again for every file shown: a missing one is read, one with a tag only if its bytes changed (a file replaced
   * by hand under the same name). The window coming to the front calls this; a read still on its way is not doubled.
   */
  recheck(): void {
    if (this.#gone) return;
    for (const file of this.#asked) this.#read(file, true);
  }

  /**
   * Read `file`; its address replaces the one before, which is given back. `ifChanged`: with the tag held, so the same
   * bytes leave the address as it is.
   */
  #read(file: string, ifChanged = false): void {
    if (this.#reading.has(file)) return;
    this.#reading.add(file);
    const held = ifChanged ? this.#tags.get(file) : undefined;
    void this.#load(this.kind, this.id, file, held)
      .catch(() => null)
      .then((answer) => {
        this.#reading.delete(file);
        if (this.#gone || answer === 'same') return;
        const url = answer ? addressOf(answer.blob) : null;
        if (url) this.#made.push(url);
        if (answer?.tag) this.#tags.set(file, answer.tag);
        else this.#tags.delete(file);
        const old = this.#urls.get(file);
        this.#urls.set(file, url);
        if (old && old !== url) this.#giveBack(old);
      });
  }

  #giveBack(url: string): void {
    this.#made = this.#made.filter((u) => u !== url);
    try {
      URL.revokeObjectURL(url);
    } catch {
      // nothing to give back in a page without blob addresses
    }
  }

  /** The way of the kit's markdown to these images, with the page's word for a missing one and its larger view. */
  source(missing: string, open?: ImageSource['open']): ImageSource {
    return { url: (file) => this.url(file), missing, ...(open ? { open } : {}) };
  }

  /** Give every address back: the view that showed them is gone. A read still on its way makes none. */
  dispose(): void {
    this.#gone = true;
    if (this.#onFront) {
      window.removeEventListener('focus', this.#onFront);
      document.removeEventListener('visibilitychange', this.#onFront);
      this.#onFront = null;
    }
    for (const url of this.#made) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // nothing to give back in a page without blob addresses
      }
    }
    this.#made = [];
  }
}
