// The buttons that attach a file to a task (`AttachBar`: the camera, the screen, the microphone, the board) as a chunk of
// their own: the detail of a task draws them, but the start of the page does not need them (its budget,
// tools/check-bundle-size.py). The page fetches the chunk when it is idle after its start (`preload` in App.svelte), so
// the first detail that is opened draws them at once.
import { loader } from './loader';

export const loadAttachBar = loader(() => import('./AttachBar.svelte'));
