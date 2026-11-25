import { describe, expect, it } from 'vitest';
import { addOps, checklistQuery, filtering, firstListId, NO_CHECKLIST_FILTER, pastedImage, pastedName, tagsOfInput } from './checklistApp';

describe('the work of the tab Lists', () => {
  it('asks only for the parts of the filter that filter something', () => {
    expect(checklistQuery('_list-a', NO_CHECKLIST_FILTER)).toEqual({ id: '_list-a' });
    expect(checklistQuery('_list-a', { q: '  sap  ', tag: 'ai', since: '2026-01-01', until: '', state: 'open' }, { offset: 100 })).toEqual({
      id: '_list-a',
      q: 'sap',
      tag: 'ai',
      since: '2026-01-01',
      state: 'open',
      offset: 100,
    });
    expect(filtering(NO_CHECKLIST_FILTER)).toBe(false);
    expect(filtering({ ...NO_CHECKLIST_FILTER, q: ' ' })).toBe(false);
    expect(filtering({ ...NO_CHECKLIST_FILTER, state: 'done' })).toBe(true);
  });

  it('adds an entry to the list shown, or makes the first list in the same request', () => {
    expect(addOps('_list-a', 'Ticket #sap', 'Schnellliste', 'de')).toEqual({
      list: '_list-a',
      ops: [{ op: 'entry_add', list: '_list-a', title: 'Ticket #sap' }],
    });
    expect(addOps(null, 'Erstes', 'Schnellliste', 'de')).toEqual({
      list: '_list-schnellliste',
      ops: [
        { op: 'checklist_new', title: 'Schnellliste', id: '_list-schnellliste' },
        { op: 'entry_add', list: '_list-schnellliste', title: 'Erstes' },
      ],
    });
    expect(firstListId('en')).toBe('_list-quick-list');
  });

  it('reads the tags typed into the field of an entry', () => {
    expect(tagsOfInput(' #SAP, hiva  ai,ai ')).toEqual(['sap', 'hiva', 'ai']);
    expect(tagsOfInput('')).toEqual([]);
  });

  it('takes the first picture of a paste and names it by the time', () => {
    const text = new File(['x'], 'a.txt', { type: 'text/plain' });
    const png = new File(['x'], 'image.png', { type: 'image/png' });
    expect(pastedImage({ files: [text, png] as unknown as FileList })).toBe(png);
    expect(pastedImage({ files: [text] as unknown as FileList })).toBeNull();
    expect(pastedImage(null)).toBeNull();
    const at = new Date(2026, 10, 25, 9, 5, 7);
    expect(pastedName(png, at)).toBe('pasted-20261125-090507.png');
    expect(pastedName(new File(['x'], 'image', { type: 'image/jpeg' }), at)).toBe('pasted-20261125-090507.jpg');
    expect(pastedName(new File(['x'], 'image', { type: 'image/svg+xml' }), at)).toBe('pasted-20261125-090507.svgxml');
  });
});
