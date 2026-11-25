// The Markdown reader of the kit (`appkit-ui/markdown`, markdown-it inside, about 100 kB) as a chunk of its own: the
// detail of a task reads its text with it, but the start of the page does not need it (its budget,
// tools/check-bundle-size.py, which also fails when the parser is back in the start). The page fetches the chunk when
// it is idle after its start (`preload` in App.svelte), so the first detail that is opened draws its text at once; until
// the chunk has come, the detail shows the text as it is written.
import { loader } from './loader';

export const loadMarkdown = loader(() => import('appkit-ui/markdown'));
