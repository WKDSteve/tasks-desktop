import { describe, expect, it } from 'vitest';
import { areaAt, boardTargetAt, calendarTargetAt } from './pointerDrag';

// The grip and the lookup of a place (`createGrip`, `farEnough`, `placeAt`, `startsOnGrip`) are tested in appkit's ui-kit.
describe('the place of the calendar under a finger', () => {
  /** An element inside a day (`day`), inside the list without a date (`loose`), or in neither. */
  const at = (day: string | null, loose = false): Element =>
    ({
      closest: (sel: string) =>
        sel === '[data-day]' && day !== null ? { getAttribute: () => day } : sel === '[data-loose]' && loose ? {} : null,
    }) as unknown as Element;

  it('is the day the point is in, before the list around it', () => {
    expect(calendarTargetAt({ elementFromPoint: () => at('2026-11-18') }, 0, 0)).toEqual({ kind: 'day', day: '2026-11-18' });
    expect(calendarTargetAt({ elementFromPoint: () => at('2026-11-18', true) }, 0, 0)).toEqual({ kind: 'day', day: '2026-11-18' });
  });

  it('is the list of the tasks without a date, and nothing anywhere else or off the page', () => {
    expect(calendarTargetAt({ elementFromPoint: () => at(null, true) }, 0, 0)).toEqual({ kind: 'loose' });
    expect(calendarTargetAt({ elementFromPoint: () => at(null) }, 0, 0)).toBeNull();
    expect(calendarTargetAt({ elementFromPoint: () => null }, 0, 0)).toBeNull();
  });
});

/** An element that answers `closest` for the places to drop, as the document does. */
function place(area: string | null, inside = false): Element {
  const own = { getAttribute: (n: string) => (n === 'data-area' ? area : null) };
  return { closest: (sel: string) => (sel === '[data-area]' && (area !== null || inside) ? (area === null ? null : own) : null) } as unknown as Element;
}

describe('the place under a finger', () => {
  it('is the area of the place the point is on, or of the one it is inside', () => {
    const doc = { elementFromPoint: (x: number) => (x === 1 ? place('other') : x === 2 ? place(null) : null) };
    expect(areaAt(doc, 1, 0)).toBe('other');
    expect(areaAt(doc, 2, 0)).toBeNull();
    expect(areaAt(doc, 3, 0)).toBeNull();
  });

  it('is none for an empty name', () => {
    expect(areaAt({ elementFromPoint: () => place('') }, 0, 0)).toBeNull();
  });
});

/** An element of the board: `closest` finds the first of its own attributes or of the ones it is inside. */
function node(attrs: Record<string, string>, parent: Element | null = null, rect = { top: 10, height: 20 }): Element {
  const self: Record<string, unknown> = {
    getAttribute: (n: string) => attrs[n] ?? null,
    getBoundingClientRect: () => rect,
    closest: (sel: string) => {
      const name = sel.slice(1, -1);
      return name in attrs ? self : parent ? (parent as unknown as { closest: (s: string) => Element | null }).closest(sel) : null;
    },
  };
  return self as unknown as Element;
}

describe('the place of the board under a finger', () => {
  const column = node({ 'data-column': 'doing' });
  const card = node({ 'data-card': 'a/b', 'data-card-column': 'open' }, node({ 'data-column': 'open' }), { top: 100, height: 40 });
  const done = node({ 'data-donezone': '' });
  const doc = (el: Element | null) => ({ elementFromPoint: () => el });

  it('is a card with its column and place, a column, the strip for finishing, or nothing', () => {
    expect(boardTargetAt(doc(card), 0, 0)).toEqual({ kind: 'card', id: 'a/b', column: 'open', top: 100, height: 40 });
    expect(boardTargetAt(doc(column), 0, 0)).toEqual({ kind: 'column', column: 'doing' });
    expect(boardTargetAt(doc(done), 0, 0)).toEqual({ kind: 'done' });
    expect(boardTargetAt(doc(node({})), 0, 0)).toBeNull();
    expect(boardTargetAt(doc(null), 0, 0)).toBeNull();
  });
});
