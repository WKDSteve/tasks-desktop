// The tasks a view shows, in the order it shows them, read from the page: every element a task can be marked on names
// its task (`data-mark-id`). A Shift click marks along this order (`App.markClick`), whatever the view is.

/** The ids of the tasks drawn in the main area, top to bottom as the document has them; each once. */
export function shownMarkIds(root: ParentNode = document): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const el of root.querySelectorAll<HTMLElement>('main [data-mark-id]')) {
    const id = el.dataset['markId'];
    if (id !== undefined && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/** What `markGesture` needs of the page: `App.markClick`. */
export interface Marker {
  markClick(event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, id: string, order: readonly string[]): boolean;
}

/** How long after a release with Ctrl or Shift a click on the same element is still that gesture. */
const SAME_GESTURE_MS = 700;

/**
 * An element that stands for a task (a row, a card, an entry) marks it on a click with Ctrl, Cmd or Shift, and opens
 * nothing then. The mark is made when the button is released: Chrome sends no `click` for a Ctrl+click on an element
 * that can be dragged (a card of the board), only the press and the release. Where the click does come (Shift, or an
 * element that cannot be dragged) it belongs to the same gesture and is stopped here, before the element's own click
 * opens the task. A click with a modifier that had no release before it (a key, a script) marks as well. The element
 * names its task in `data-mark-id`.
 */
export function markGesture(node: HTMLElement, marker: Marker): { update(next: Marker): void; destroy(): void } {
  let app = marker;
  let handledAt = -Infinity;
  const modified = (e: MouseEvent): boolean => e.ctrlKey || e.metaKey || e.shiftKey;
  const mark = (e: MouseEvent): void => {
    const id = node.dataset['markId'];
    if (id !== undefined) app.markClick(e, id, shownMarkIds());
  };
  const release = (e: MouseEvent): void => {
    if (e.button !== 0 || !modified(e)) return;
    // The grip of a card is the start of a drag by a finger, not a click on the task.
    if (e.target instanceof Element && e.target.closest('.grip')) return;
    mark(e);
    handledAt = e.timeStamp;
  };
  const click = (e: MouseEvent): void => {
    // A plain click is never part of the gesture, however soon it comes after a release with Ctrl (which may have had
    // no click of its own): it opens the task.
    const sameGesture = e.timeStamp - handledAt < SAME_GESTURE_MS;
    handledAt = -Infinity;
    if (!modified(e)) return;
    if (!sameGesture) mark(e);
    e.preventDefault();
    e.stopPropagation();
  };
  node.addEventListener('mouseup', release);
  node.addEventListener('click', click, true);
  return {
    update(next) {
      app = next;
    },
    destroy() {
      node.removeEventListener('mouseup', release);
      node.removeEventListener('click', click, true);
    },
  };
}
