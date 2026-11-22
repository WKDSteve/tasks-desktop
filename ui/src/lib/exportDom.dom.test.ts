// @vitest-environment jsdom
// The sheet for the printer as elements: the heads of the sheet, or those of a section that brings its own (a table of
// figures among others), and text only.
import { describe, expect, it } from 'vitest';
import { sheetElement } from './exportDom';

describe('sheetElement', () => {
  it('takes the heads of a section that has its own, else those of the sheet', () => {
    const page = sheetElement(
      document,
      {
        title: '<b>T</b>',
        facts: [],
        headers: ['Title'],
        sections: [{ rows: [['a']] }, { heading: 'Per week', headers: ['Week', 'Hours'], rows: [['Wk 47', '2']] }],
      },
      'sheet',
    );
    const heads = [...page.querySelectorAll('table')].map((table) => [...table.querySelectorAll('th')].map((th) => th.textContent));
    expect(heads).toEqual([['Title'], ['Week', 'Hours']]);
    expect(page.querySelector('h1')?.textContent).toBe('<b>T</b>');
    expect(page.querySelector('h2')?.textContent).toBe('Per week');
  });
});
