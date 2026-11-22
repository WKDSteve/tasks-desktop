// The words of the competence map, apart from i18n so that they come with the map's chunk: both languages fill the same
// placeholders, and a key of the page is not taken for one of the map.
import { describe, expect, it } from 'vitest';
import { isPathMapKey, pathMapText } from './pathMapTexts';

describe('pathMapText', () => {
  it('fills the placeholders in both languages', () => {
    expect(pathMapText('en', 'pathmap.stage.waiting_on', { title: 'Basis' })).toBe('waits for Basis');
    expect(pathMapText('de', 'pathmap.stage.waiting_on', { title: 'Basis' })).toBe('wartet auf Basis');
    expect(pathMapText('de', 'pathmap.progress', { learned: 1, total: 2 })).toBe('1 von 2 gelernt');
  });

  it('knows its own keys only: the menu entry stays a word of the page', () => {
    expect(isPathMapKey('pathmap.legend')).toBe(true);
    expect(isPathMapKey('hint.form.pathmap.search')).toBe(true);
    expect(isPathMapKey('nav.pathmap')).toBe(false);
    expect(isPathMapKey('toString')).toBe(false);
  });

  it('names the same placeholders in English and German for every key', () => {
    const marks = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const keys = ['pathmap.no_match', 'pathmap.zoom', 'pathmap.column', 'pathmap.cycle', 'pathmap.req_item', 'pathmap.for_item', 'pathmap.map', 'pathmap.chain_only'] as const;
    for (const key of keys) expect(marks(pathMapText('de', key)), key).toEqual(marks(pathMapText('en', key)));
  });
});
