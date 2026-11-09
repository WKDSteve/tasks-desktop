// Dragging a row with a finger: HTML5 drag does not start on a touch screen, so the grip of a row follows its own
// pointer (touch or pen) and the places to drop on are found by the point the finger is on. The grip and the lookup of
// a place are the kit's (`appkit-ui/pointerDrag`); the places of this app (an area, the board) are here.

import type { PointSource } from 'appkit-ui/pointerDrag';

export {
  createGrip,
  farEnough,
  GRAB,
  placeAt,
  startsOnGrip,
  type PointerDragEvent,
  type PointSource,
} from 'appkit-ui/pointerDrag';

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
