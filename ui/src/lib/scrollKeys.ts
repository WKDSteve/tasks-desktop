// The keys that scroll a task while the focus is outside the part that scrolls: on the buttons of the float's head, or
// nowhere in the window of a task. Inside that part, or in a field, the browser does what it always does.

const OWN_KEYS = 'input, textarea, select, [contenteditable], .detail-body';

/** How far a key scrolls a box of this height; null for any other key. */
export function scrollAmount(key: string, height: number): number | null {
  switch (key) {
    case 'ArrowDown':
      return 40;
    case 'ArrowUp':
      return -40;
    case 'PageDown':
      return height * 0.9;
    case 'PageUp':
      return -height * 0.9;
    default:
      return null;
  }
}

/** Scroll `body` for `event` when the key is for it. */
export function scrollByKey(event: KeyboardEvent, body: Element | null | undefined): void {
  if (!body || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.target instanceof Element && event.target.closest(OWN_KEYS)) return;
  const by = scrollAmount(event.key, body.clientHeight);
  if (by === null) return;
  event.preventDefault();
  body.scrollBy({ top: by });
}
