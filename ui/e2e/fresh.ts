// Is the hub binary of the run built from the interface in this checkout? Both pages count: the desktop one at `/`
// (`ui/dist`, `pnpm build`) and the phone one at `/m/` (`ui/dist-mobile`, `python tools/build-mobile.py`). A missing
// phone page otherwise shows only as a silent 404 in the six phone cases, after a full run.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The body the hub serves at `path`, or `null` when it answers with an error status. */
export type ServedPage = (path: string) => Promise<string | null>;

const PAGES = [
  {
    path: '/',
    file: ['ui', 'dist', 'index.html'],
    missing: 'ui/dist is not built: run `pnpm build` and `cargo build`',
    stale: 'the hub binary holds an older interface: run `cargo build` after `pnpm build`',
  },
  {
    path: '/m/',
    file: ['ui', 'dist-mobile', 'index.html'],
    missing: 'ui/dist-mobile is not built: run `python tools/build-mobile.py` and `cargo build`',
    stale:
      'the hub binary holds no or an older phone page: run `cargo build` after `python tools/build-mobile.py`',
  },
] as const;

/** What is wrong with the interface of the running hub, or `null` when both pages are the ones of `repo`. */
export async function interfaceProblem(repo: string, served: ServedPage): Promise<string | null> {
  for (const page of PAGES) {
    const file = join(repo, ...page.file);
    if (!existsSync(file)) return page.missing;
    const body = await served(page.path);
    if (body === null || body.trim() !== readFileSync(file, 'utf8').trim()) return page.stale;
  }
  return null;
}
