// The images below `assets/` of one container (a task, plan, project, path or meeting) as the page draws them: each
// file is read once with the session (`GET /api/tasks/asset`), kept as an address the page makes itself (`blob:`),
// and given back when the view that shows them goes (`dispose`). The markdown of the kit asks through `source`
// (`ImageSource`): undefined while a file loads, null when there is none, the address once it is there. The page
// never puts a path of the vault or an address of the text into an `<img>` (E12: an SVG is a picture, never markup).

import { SvelteMap } from 'svelte/reactivity';
import type { ImageSource } from 'appkit-ui/markdown';
import type { AssetOwner } from './api';

/** What the store needs: the read of one file (the App's `asset`). */
export type AssetLoader = (kind: AssetOwner, id: string, file: string) => Promise<Blob | null>;

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

  constructor(load: AssetLoader, kind: AssetOwner, id: string) {
    this.#load = load;
    this.kind = kind;
    this.id = id;
  }

  /** The address of `file`: undefined while it loads (the read starts on the first ask), null when there is none. */
  url(file: string): string | null | undefined {
    if (!this.#asked.has(file) && !this.#gone) {
      this.#asked.add(file);
      void this.#load(this.kind, this.id, file)
        .catch(() => null)
        .then((blob) => {
          if (this.#gone) return;
          const url = blob ? addressOf(blob) : null;
          if (url) this.#made.push(url);
          this.#urls.set(file, url);
        });
    }
    return this.#urls.get(file);
  }

  /** The way of the kit's markdown to these images, with the page's word for a missing one and its larger view. */
  source(missing: string, open?: ImageSource['open']): ImageSource {
    return { url: (file) => this.url(file), missing, ...(open ? { open } : {}) };
  }

  /** Give every address back: the view that showed them is gone. A read still on its way makes none. */
  dispose(): void {
    this.#gone = true;
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
