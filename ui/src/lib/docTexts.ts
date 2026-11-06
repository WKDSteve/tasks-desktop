// The text of the project's documents, bundled at build time (they read without a network, and the build is the same as
// the text of this commit). A module of its own: the page loads it when the documentation is opened.
import type { DocEntry } from 'appkit-ui/docs';
import { entriesOf } from './docTitles';

const files = import.meta.glob(['../../../README.md', '../../../docs/*.md'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export const DOCS: DocEntry[] = entriesOf(files);
