// Numbers that change all the time or are compared line by line keep one width (`tabular-nums`), so that a column of
// hours or a zoom value does not tremble. The kit does it for tables and `.num`; these are the places of this page
// that are no table: the hour axis and the time of a meeting in the grid, the zoom of the path map and of the board.

import { describe, expect, it } from 'vitest';
import board from './views/BoardEditor.svelte?raw';
import map from './views/PathMapView.svelte?raw';
import grid from './views/TimeGrid.svelte?raw';

/** The declarations of the rule whose selector list ends with `selector` (the last selector before the brace). */
function declarations(source: string, selector: string): string {
  const open = source.search(new RegExp('^\\s+' + selector.replace(/[.]/g, '\\.') + '\\s*\\{', 'm'));
  if (open < 0) return '';
  const from = source.indexOf('{', open);
  return source.slice(from, source.indexOf('}', from));
}

describe('tabular-nums where numbers change or are compared', () => {
  it.each([
    ['hour axis', grid, '.hours span'],
    ['time of a meeting', grid, '.time'],
    ['zoom of the path map', map, '.zoom output'],
    ['zoom of the board', board, '.page'],
  ])('%s', (_name, source, selector) => {
    expect(declarations(source, selector)).toContain('font-variant-numeric: tabular-nums');
  });

  it('the zoom button of the board shares the rule of the page number', () => {
    expect(board).toMatch(/\.zoom-fit,\s*\.page\s*\{/);
  });
});
