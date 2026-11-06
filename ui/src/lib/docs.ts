// The documents of the project that the Help menu opens: the readme and the files of `docs/`. The menu needs only their
// names (`DOC_LIST`, put in at build time); the text comes with `loadDocs`, when the documentation is opened.
import type { DocEntry } from 'appkit-ui/docs';

export const REPO_URL = 'https://github.com/WKDSteve/tasks-desktop';
export const LICENSE = { name: 'MIT', url: `${REPO_URL}/blob/main/LICENSE` } as const;

export { entriesOf, titleOf } from './docTitles';

/** The documents without their text: what the Help menu lists. */
export const DOC_LIST: DocEntry[] = __DOC_INDEX__.map((d) => ({ ...d, text: '' }));

/** The documents with their text. */
export async function loadDocs(): Promise<DocEntry[]> {
  return (await import('./docTexts')).DOCS;
}
