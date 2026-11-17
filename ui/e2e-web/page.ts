// What the tests of the web variant share: the built file, the fixture vault as a fake folder, and the watch on what the
// page must never do (a request, a violation of its policy; the kit's, appkit-web/e2e).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
import { idbWrites, spyOnIndexedDb, violations, watchPage as watchKitPage, type IdbWrite, type Watch } from 'appkit-web/e2e';

const here = dirname(fileURLToPath(import.meta.url));
export const FILE = resolve(here, '..', 'dist-web', 'tasks.html');
export const FIXTURE = resolve(here, '..', '..', 'e2e', 'fixture', 'vault');

export function pageUrl(): string {
  if (!existsSync(FILE)) throw new Error(`${FILE} is not there: run "pnpm web:build" first`);
  return pathToFileURL(FILE).href;
}

/** The fixture vault: path relative to its root -> text. */
export function vaultFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files[relative(FIXTURE, path).replaceAll('\\', '/')] = readFileSync(path, 'utf8');
    }
  };
  walk(FIXTURE);
  return files;
}

/** Everything the page did that it must not have: a request outside the page, an error, a violation of its policy. */
export type { Watch, IdbWrite };

/** Watch the page from now on (appkit-web/e2e); the page itself is `tasks.html`. */
export function watchPage(page: Page): Promise<Watch> {
  return watchKitPage(page, { pageUrl: pageUrl() });
}

export { violations, spyOnIndexedDb, idbWrites };

/**
 * A `showDirectoryPicker` that hands out the vault as a folder, writable like the real ones: `values()` yields file and
 * folder handles, `getFile()` gives size, time and bytes, `getFileHandle`/`getDirectoryHandle` make entries,
 * `createWritable` commits on close, `removeEntry` deletes, `move` renames. The permission is `granted`.
 *
 * The test is the other program that works in the folder: `window.__disk` reads the files, and changes one as an
 * editor would (new text, newer time). `__setFile` is the same change.
 *
 * A folder is told by its name (`name`). A real handle comes back from IndexedDB as a handle of the same folder, so the
 * page knows it again after a reload and gives it the id it had; the structured clone of this fake keeps only `kind` and
 * `name`, so what the page reads from IndexedDB is made a handle of the folder of this name again.
 */
export async function fakePicker(page: Page, files: Record<string, string>, name = 'fixture-vault'): Promise<void> {
  await fakeFolders(page, { [name]: files }, name);
}

/**
 * Several folders, each a fake like `fakePicker`'s, told apart by their names. The picker hands out `first`, or the one
 * `pickNext` named last. `__disk` and `__setFile` work on `first`.
 *
 * The permission of a folder is `granted` until `dropAccess` takes it (a browser that was started again): then the folder
 * says `prompt`, and `requestPermission` gives it back only inside a click (transient user activation), as Chrome does,
 * and counts the question (`askedFor`). The state is kept in the page's localStorage, so it lives across reloads and the
 * page's own reload after a switch keeps the access it got.
 */
export async function fakeFolders(page: Page, folders: Record<string, Record<string, string>>, first: string): Promise<void> {
  await page.addInitScript(({ trees, firstName }: { trees: Record<string, Record<string, string>>; firstName: string }) => {
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    type FileNode = { kind: 'file'; name: string; bytes: Uint8Array; time: number };
    type DirNode = { kind: 'directory'; name: string; children: Map<string, FileNode | DirNode> };
    type Node = FileNode | DirNode;
    const roots = new Map<string, DirNode>();
    let clock = 1_700_000_000_000;
    const tick = () => (clock += 5000);

    const domError = (name: string, message: string): Error => Object.assign(new Error(message), { name });
    const walkTo = (top: DirNode, segments: string[], create: boolean): DirNode | null => {
      let at = top;
      for (const part of segments) {
        let next = at.children.get(part);
        if (!next) {
          if (!create) return null;
          next = { kind: 'directory', name: part, children: new Map() };
          at.children.set(part, next);
        }
        if (next.kind !== 'directory') return null;
        at = next;
      }
      return at;
    };
    const put = (top: DirNode, path: string, text: string) => {
      const parts = path.split('/');
      const dir = walkTo(top, parts.slice(0, -1), true) as DirNode;
      const name = parts[parts.length - 1] as string;
      dir.children.set(name, { kind: 'file', name, bytes: enc.encode(text), time: tick() });
    };
    for (const [rootName, tree] of Object.entries(trees)) {
      const top: DirNode = { kind: 'directory', name: rootName, children: new Map() };
      for (const [path, text] of Object.entries(tree)) put(top, path, text);
      roots.set(rootName, top);
    }
    const root = roots.get(firstName) as DirNode;
    const permKey = (name: string) => `__fake-perm:${name}`;
    const permission = (top: string) => (localStorage.getItem(permKey(top)) === 'prompt' ? 'prompt' : 'granted');

    const fileHandle = (parent: DirNode, node: FileNode): unknown => ({
      kind: 'file',
      name: node.name,
      getFile: async () => {
        const now = parent.children.get(node.name);
        if (!now || now.kind !== 'file') throw domError('NotFoundError', 'gone');
        const bytes = now.bytes;
        return { size: bytes.byteLength, lastModified: now.time, arrayBuffer: async () => bytes.slice().buffer };
      },
      createWritable: async () => {
        const chunks: Uint8Array[] = [];
        return {
          write: async (data: Uint8Array) => void chunks.push(Uint8Array.from(data)),
          close: async () => {
            // A test makes a write slow, to look at the page while it is under way.
            const wait = (window as unknown as { __slowClose?: number }).__slowClose;
            if (typeof wait === 'number' && wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
            const size = chunks.reduce((n, c) => n + c.byteLength, 0);
            const bytes = new Uint8Array(size);
            let at = 0;
            for (const chunk of chunks) {
              bytes.set(chunk, at);
              at += chunk.byteLength;
            }
            parent.children.set(node.name, { kind: 'file', name: node.name, bytes, time: tick() });
          },
          abort: async () => {},
        };
      },
      move: async (destination: { __node: DirNode }, name: string) => {
        const mine = parent.children.get(node.name);
        if (!mine) throw domError('NotFoundError', 'gone');
        parent.children.delete(node.name);
        destination.__node.children.set(name, { ...mine, name } as Node);
      },
    });
    // Only `kind` and `name` are data, the rest is not enumerable: like a real handle, this one can be put into IndexedDB
    // (structured clone copies the enumerable data and nothing else, a function among them would throw), which the page
    // does to remember the folder, and the cache of its list is named by that.
    const dirHandle = (node: DirNode, top: string): unknown => {
      const handle = { kind: 'directory', name: node.name };
      return Object.defineProperties(handle, Object.fromEntries(Object.entries(dirMembers(node, top)).map(([key, value]) => [key, { value }])));
    };
    const dirMembers = (node: DirNode, top: string): Record<string, unknown> => ({
      __node: node,
      queryPermission: async () => permission(top),
      requestPermission: async () => {
        if (permission(top) === 'granted') return 'granted';
        // Chrome asks only inside a click; without one the request fails.
        if (!navigator.userActivation.isActive) throw domError('SecurityError', 'User activation is required to request permissions.');
        localStorage.setItem(`__fake-asked:${top}`, String(Number(localStorage.getItem(`__fake-asked:${top}`) ?? '0') + 1));
        localStorage.removeItem(permKey(top));
        return 'granted';
      },
      isSameEntry: async (other: { __node?: unknown } | null) => other?.__node === node,
      async *values() {
        for (const child of [...node.children.values()]) yield child.kind === 'file' ? fileHandle(node, child) : dirHandle(child, top);
      },
      getFileHandle: async (name: string, opts?: { create?: boolean }) => {
        let child = node.children.get(name);
        if (!child) {
          if (!opts?.create) throw domError('NotFoundError', name);
          child = { kind: 'file', name, bytes: new Uint8Array(0), time: tick() };
          node.children.set(name, child);
        }
        if (child.kind !== 'file') throw domError('TypeMismatchError', name);
        return fileHandle(node, child);
      },
      getDirectoryHandle: async (name: string, opts?: { create?: boolean }) => {
        let child = node.children.get(name);
        if (!child) {
          if (!opts?.create) throw domError('NotFoundError', name);
          child = { kind: 'directory', name, children: new Map() };
          node.children.set(name, child);
        }
        if (child.kind !== 'directory') throw domError('TypeMismatchError', name);
        return dirHandle(child, top);
      },
      removeEntry: async (name: string, opts?: { recursive?: boolean }) => {
        const child = node.children.get(name);
        if (!child) throw domError('NotFoundError', name);
        if (child.kind === 'directory' && child.children.size > 0 && !opts?.recursive) throw domError('InvalidModificationError', name);
        node.children.delete(name);
      },
    });

    const files = (): Record<string, string> => {
      const out: Record<string, string> = {};
      const walk = (node: DirNode, prefix: string) => {
        for (const child of node.children.values()) {
          if (child.kind === 'file') out[prefix + child.name] = dec.decode(child.bytes);
          else walk(child, `${prefix}${child.name}/`);
        }
      };
      walk(root, '');
      return out;
    };
    const w = window as unknown as Record<string, unknown>;
    w['__disk'] = {
      files,
      write: (path: string, text: string) => put(root, path, text),
      remove: (path: string) => {
        const parts = path.split('/');
        walkTo(root, parts.slice(0, -1), false)?.children.delete(parts[parts.length - 1] as string);
      },
    };
    w['__setFile'] = (path: string, text: string) => put(root, path, text);
    w['showDirectoryPicker'] = async () => {
      const name = (w['__pickNext'] as string | undefined) ?? firstName;
      return dirHandle(roots.get(name) as DirNode, name);
    };

    // What the page reads back from its store of folders used before (`tasks-web` / `handles`) is made a handle of the
    // folder of that name again. Installed once; every call of this function (a later one wins) says which folder is there.
    w['__fakeRoots'] = Object.fromEntries([...roots].map(([name, top]) => [name, () => dirHandle(top, name)]));
    if (!w['__fakeRevive']) {
      w['__fakeRevive'] = true;
      const original = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'result') as PropertyDescriptor;
      Object.defineProperty(IDBRequest.prototype, 'result', {
        configurable: true,
        get(this: IDBRequest) {
          const value = (original.get as () => unknown).call(this);
          const here = w['__fakeRoots'] as Record<string, () => unknown>;
          const source = this.source as IDBObjectStore | null;
          if (!Array.isArray(value) || !source || source.name !== 'handles' || source.transaction.db.name !== 'tasks-web') return value;
          return value.map((item: { handle?: { kind?: string; name?: string; values?: unknown } }) =>
            item && item.handle && item.handle.kind === 'directory' && typeof item.handle.values !== 'function' && typeof item.handle.name === 'string' && Object.hasOwn(here, item.handle.name)
              ? { ...item, handle: (here[item.handle.name] as () => unknown)() }
              : item,
          );
        },
      });
    }
  }, { trees: folders, firstName: first });
}

/** The picker hands out the folder `name` from now on (one of `fakeFolders`). */
export async function pickNext(page: Page, name: string): Promise<void> {
  await page.evaluate((n) => void ((window as unknown as Record<string, unknown>)['__pickNext'] = n), name);
}

/** The browser was started again: the folders lose their permission and say `prompt`. */
export async function dropAccess(page: Page, names: string[]): Promise<void> {
  await page.evaluate((list) => {
    for (const n of list) localStorage.setItem(`__fake-perm:${n}`, 'prompt');
  }, names);
}

/** How often the page asked the browser for the folder `name` (inside a click). */
export async function askedFor(page: Page, name: string): Promise<number> {
  return page.evaluate((n) => Number(localStorage.getItem(`__fake-asked:${n}`) ?? '0'), name);
}

/**
 * Record whether `needle` was ever on the page, from now on and across reloads (a text that is there for a moment, such
 * as the first picture drawn from the cache, is gone by the time a test looks).
 */
export async function watchText(page: Page, needle: string): Promise<void> {
  await page.addInitScript((text: string) => {
    const w = window as unknown as { __sawText?: string[] };
    w.__sawText ??= [];
    const look = () => {
      if (document.body && document.body.innerText.includes(text) && !w.__sawText?.includes(text)) w.__sawText?.push(text);
    };
    new MutationObserver(look).observe(document, { subtree: true, childList: true, characterData: true });
  }, needle);
}

/** Whether the text was ever on the page since the last load (see `watchText`). */
export async function sawText(page: Page, needle: string): Promise<boolean> {
  return page.evaluate((text) => ((window as unknown as { __sawText?: string[] }).__sawText ?? []).includes(text), needle);
}

/** The files on the fake disk of the page: path -> text. */
export async function disk(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => (window as unknown as { __disk: { files(): Record<string, string> } }).__disk.files());
}

/** Another program writes a file of the folder (the text changes, the time moves on). */
export async function editOnDisk(page: Page, path: string, text: string): Promise<void> {
  await page.evaluate(([p, t]) => (window as unknown as { __disk: { write(p: string, t: string): void } }).__disk.write(p as string, t as string), [path, text]);
}

/**
 * Close the float of a task when one is open (by its Close button, in whatever language): it is modal, the page behind
 * it is not reached while it is.
 */
export async function closeFloat(page: Page): Promise<void> {
  const float = page.locator('dialog.peek[open]');
  // A float that closes by itself meanwhile (its task was finished) is closed too.
  for (let tries = 0; tries < 10 && (await float.count()) > 0; tries += 1) {
    await float
      .locator('button[data-close]')
      .click({ timeout: 1000 })
      .catch(() => undefined);
    await float.waitFor({ state: 'detached', timeout: 1000 }).catch(() => undefined);
  }
  if ((await float.count()) > 0) throw new Error('the float of the task did not close');
}

/** Choose the fake folder and wait until the app shows `ready` (by default a task of the fixture vault). */
export async function openVault(page: Page, files: Record<string, string>, ready = 'Eta tests'): Promise<void> {
  await fakePicker(page, files);
  await page.goto(pageUrl());
  await page.getByRole('button', { name: /Choose folder|Ordner wählen/ }).click();
  await page.getByText(ready).first().waitFor({ timeout: 30_000 });
}

/** What the page keeps of its list in IndexedDB now (`tasks-desktop` / `list` / `current`), or null. */
export async function storedList(page: Page): Promise<{ tasks: Array<{ id: string; area: string }>; folder?: string } | null> {
  return page.evaluate(async () => {
    const known = await indexedDB.databases();
    if (!known.some((d) => d.name === 'tasks-desktop')) return null;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('tasks-desktop');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!db.objectStoreNames.contains('list')) return null;
      return await new Promise((resolve, reject) => {
        const request = db.transaction('list').objectStore('list').get('current');
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });
}
