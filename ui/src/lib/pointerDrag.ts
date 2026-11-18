// Dragging a row with a finger: HTML5 drag does not start on a touch screen, so the grip of a row follows its own
// pointer (touch or pen) and the places to drop on are found by the point the finger is on. The grip and the lookup of
// a place are the kit's (`appkit-ui/pointerDrag`); the places of this app (an area, the board) are here.

import {
  createGrip as kitGrip,
  farEnough,
  startsOnGrip,
  type PointerDragEvent,
  type PointSource,
} from 'appkit-ui/pointerDrag';

export { farEnough, GRAB, placeAt, startsOnGrip, type PointerDragEvent, type PointSource } from 'appkit-ui/pointerDrag';

/** The touch a grip is held by, from its `pointerdown` to the end of the drag. */
interface Held {
  pointerId: number;
  el: Element;
  x: number;
  y: number;
  /** The browser was told that this touch is no gesture of its own (the `touchstart` was taken). */
  taken: boolean;
  drop: () => void;
}

/**
 * The kit's grip, and the touch that holds it taken from the browser. A finger that lifts while it still moves (a
 * flick) is the start of a fling to Chrome, although the grip scrolls nothing (`touch-action: none`), and a tap while
 * that fling runs only stops it: no click, for up to about two seconds after the drop (measured 2026-11-18: 12 of 12
 * taps lost after a flick, none when the finger rested before it lifted or the `touchstart` was taken). A `touchstart`
 * that is taken makes no gesture at all. It makes no click either, so a tap on the grip (the finger did not go `GRAB`
 * far) is told as the click it would have been: whatever listens for one (the card that selects, the hint popup) hears
 * it as before. A pen sends no touch events; its click is the browser's.
 */
export function createGrip(
  sink: () => ((event: PointerDragEvent) => void) | undefined,
  blocked: () => boolean,
): (e: PointerEvent, id: string, phase: PointerDragEvent['phase']) => void {
  const grip = kitGrip(sink, blocked);
  let held: Held | null = null;
  return (e, id, phase) => {
    const el = e.currentTarget as Element | null;
    if (phase === 'start' && startsOnGrip(e.pointerType) && typeof el?.addEventListener === 'function') {
      held?.drop();
      // The `touchstart` of this touch comes after its `pointerdown`, to the same element.
      const take = (touch: Event): void => {
        if (!touch.cancelable) return;
        touch.preventDefault();
        now.taken = true;
      };
      const now: Held = { pointerId: e.pointerId, el, x: e.clientX, y: e.clientY, taken: false, drop: () => el.removeEventListener('touchstart', take) };
      el.addEventListener('touchstart', take, { passive: false, once: true });
      held = now;
    }
    grip(e, id, phase);
    // Only the finger that holds the grip ends its hold: a second finger that lifts elsewhere is not this touch.
    if ((phase === 'end' || phase === 'cancel') && held !== null && held.pointerId === e.pointerId) {
      const was = held;
      held = null;
      was.drop();
      if (phase === 'end' && was.taken && !farEnough(was, { x: e.clientX, y: e.clientY })) {
        was.el.dispatchEvent(
          new PointerEvent('click', {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerType: e.pointerType,
            pointerId: e.pointerId,
            clientX: e.clientX,
            clientY: e.clientY,
          }),
        );
      }
    }
  };
}

/** The area whose place to drop is under the point, if any (a place carries `data-area`). */
export function areaAt(doc: PointSource, x: number, y: number): string | null {
  const place = doc.elementFromPoint(x, y)?.closest('[data-area]');
  const area = place?.getAttribute('data-area');
  return area === undefined || area === null || area === '' ? null : area;
}

/** What a point of the board is over. */
export type BoardTarget =
  | { kind: 'card'; id: string; column: string; top: number; height: number }
  | { kind: 'column'; column: string }
  | { kind: 'done' };

/** The card, the column or the strip for finishing that the point is on (a card carries `data-card` and `data-card-column`). */
export function boardTargetAt(doc: PointSource, x: number, y: number): BoardTarget | null {
  const el = doc.elementFromPoint(x, y);
  if (!el) return null;
  const card = el.closest('[data-card]');
  const id = card?.getAttribute('data-card');
  const cardColumn = card?.getAttribute('data-card-column');
  if (card && id && cardColumn) {
    const rect = card.getBoundingClientRect();
    return { kind: 'card', id, column: cardColumn, top: rect.top, height: rect.height };
  }
  if (el.closest('[data-donezone]')) return { kind: 'done' };
  const column = el.closest('[data-column]')?.getAttribute('data-column');
  return column ? { kind: 'column', column } : null;
}

/** What a point of the calendar is over: a day of the grid, or the list of the tasks without a date. */
export type CalendarTarget = { kind: 'day'; day: string } | { kind: 'loose' };

/** The day or the list without a date that the point is on (a day carries `data-day`, the list `data-loose`). */
export function calendarTargetAt(doc: PointSource, x: number, y: number): CalendarTarget | null {
  const el = doc.elementFromPoint(x, y);
  if (!el) return null;
  const day = el.closest('[data-day]')?.getAttribute('data-day');
  if (day) return { kind: 'day', day };
  return el.closest('[data-loose]') ? { kind: 'loose' } : null;
}
