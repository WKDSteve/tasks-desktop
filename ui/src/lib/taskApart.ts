// A task opened in a new tab, the way a link opens: a middle click, Ctrl+click or Cmd+click on a task (a row, a card,
// a node: whatever the page declared as a task target for its context menu, lib/context.ts) opens the same page in a
// new tab that shows that task alone, with the session of this tab (route.ts, `App.openTaskApart`). The cards stay
// what they are (buttons, rows with their keys); one listener on the window finds the task under the pointer.

import { targetChain } from 'appkit-ui/contextmenu';

/** What has a click of its own inside a task: a link, a field, a mark. */
const OWN = 'a[href], input, textarea, select, label, [contenteditable="true"]';

/** The task a pointer event is on: the innermost target around it, when that is a task; null otherwise. */
export function taskUnder(target: EventTarget | null): string | null {
  if (!(target instanceof Element) || target.closest(OWN) !== null) return null;
  const inner = targetChain(target).chain[0];
  return inner?.kind === 'task' && typeof inner.id === 'string' ? inner.id : null;
}

/** What the listener needs of the app. */
export interface ApartApp {
  readonly canDetach: boolean;
  openTaskApart(id: string): void;
}

/** The part of the window the listener works on. */
export interface ApartWindow {
  addEventListener(type: 'mousedown' | 'auxclick' | 'click', listener: (event: MouseEvent) => void, capture?: boolean): void;
  removeEventListener(type: 'mousedown' | 'auxclick' | 'click', listener: (event: MouseEvent) => void, capture?: boolean): void;
}

/** Listen for the ways a task opens apart. Returns the function that stops it. */
export function installTaskApart(app: ApartApp, win: ApartWindow): () => void {
  const onDown = (event: MouseEvent): void => {
    // The middle button would start the browser's autoscroll.
    if (event.button === 1 && app.canDetach && taskUnder(event.target) !== null) event.preventDefault();
  };
  const onAux = (event: MouseEvent): void => {
    if (event.button !== 1 || !app.canDetach) return;
    const id = taskUnder(event.target);
    if (id === null) return;
    event.preventDefault();
    app.openTaskApart(id);
  };
  // Before the task's own click (which selects it or opens its float): the capture phase.
  const onClick = (event: MouseEvent): void => {
    if (event.button !== 0 || !(event.ctrlKey || event.metaKey) || event.altKey || !app.canDetach) return;
    const id = taskUnder(event.target);
    if (id === null) return;
    event.preventDefault();
    event.stopPropagation();
    app.openTaskApart(id);
  };
  win.addEventListener('mousedown', onDown, true);
  win.addEventListener('auxclick', onAux);
  win.addEventListener('click', onClick, true);
  return () => {
    win.removeEventListener('mousedown', onDown, true);
    win.removeEventListener('auxclick', onAux);
    win.removeEventListener('click', onClick, true);
  };
}
