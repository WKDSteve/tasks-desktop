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

/** How long after a release with Shift a click on the same element is still that gesture. */
const SAME_GESTURE_MS = 700;

/** A click that marks: Shift alone (Ctrl or Cmd with a click opens the task in a new tab, lib/taskApart.ts). */
const marks = (e: MouseEvent): boolean => e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;

/** The grip of a card starts a drag by a finger; it is no click on the task. */
const onGrip = (e: Event): boolean => e.target instanceof Element && e.target.closest('.grip') !== null;

/**
 * An element that stands for a task (a row, a card, an entry) marks it on a click with Shift, and opens nothing then.
 * The mark is made when the button is released on the element it was pressed on (a press elsewhere, or a drag that
 * ended here, marks nothing): a click is not sent for every such release (an element that can be dragged), and where it
 * comes it belongs to the same gesture and is stopped here, before the element's own click opens the task. The element
 * names its task in `data-mark-id`.
 */
export function markGesture(node: HTMLElement, marker: Marker): { update(next: Marker): void; destroy(): void } {
  let app = marker;
  let pressed = false;
  let handledAt = -Infinity;
  const mark = (e: MouseEvent): void => {
    const id = node.dataset['markId'];
    if (id !== undefined) app.markClick(e, id, shownMarkIds());
  };
  const press = (e: MouseEvent): void => {
    pressed = e.button === 0 && marks(e) && !onGrip(e);
  };
  const release = (e: MouseEvent): void => {
    const mine = pressed;
    pressed = false;
    if (!mine || e.button !== 0 || !marks(e) || onGrip(e)) return;
    mark(e);
    handledAt = e.timeStamp;
  };
  const click = (e: MouseEvent): void => {
    // A plain click is never part of the gesture, however soon it comes after a release with Shift: it opens the task.
    const sameGesture = e.timeStamp - handledAt < SAME_GESTURE_MS;
    handledAt = -Infinity;
    if (!marks(e) || onGrip(e)) return;
    if (!sameGesture) mark(e);
    e.preventDefault();
    e.stopPropagation();
  };
  node.addEventListener('mousedown', press);
  node.addEventListener('mouseup', release);
  node.addEventListener('click', click, true);
  return {
    update(next) {
      app = next;
    },
    destroy() {
      node.removeEventListener('mousedown', press);
      node.removeEventListener('mouseup', release);
      node.removeEventListener('click', click, true);
    },
  };
}
