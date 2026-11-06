// The titles of the project's documents and their order. Plain functions, also read by `vite.config.ts`, which puts the
// list into the page without the texts (the Help menu names the documents; their text is loaded when one is opened).
import type { DocEntry } from 'appkit-ui/docs';

/** The first level-one heading, else the name of the file: the title of a document in the list. */
export function titleOf(text: string, fallback: string): string {
  const m = /^#[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(text);
  return m?.[1] ?? fallback;
}

/** The documents in the order the menu shows them: the readme first, the rest by name. */
export function entriesOf(files: Readonly<Record<string, string>>): DocEntry[] {
  const entries = Object.entries(files).map(([path, text]) => {
    const id = (path.split('/').pop() ?? path).replace(/\.md$/i, '');
    return { id, title: titleOf(text, id), text };
  });
  return entries.sort((a, b) => (a.id === 'README' ? -1 : b.id === 'README' ? 1 : a.id.localeCompare(b.id)));
}
