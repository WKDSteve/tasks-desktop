import { describe, expect, it } from 'vitest';
import { imageName, linkTitle, marked, narrowed, snippet, type NoteItem } from './learnNotes';
import { isLearnNotesKey, learnNotesText } from './learnNotesTexts';

const item = (path: string, state: NoteItem['state']) => ({ path, state }) as NoteItem;

describe('notes and sources', () => {
  it('marks every hit without case and keeps the text as written', () => {
    expect(marked('Lua und LUA', 'lua')).toEqual([
      { text: 'Lua', hit: true },
      { text: ' und ', hit: false },
      { text: 'LUA', hit: true },
    ]);
    expect(marked('nothing here', 'x')).toEqual([{ text: 'nothing here', hit: false }]);
    expect(marked('abc', '  ')).toEqual([{ text: 'abc', hit: false }]);
    // A letter whose lower case is longer (İ) would move the places: no marks then, never wrong ones.
    expect(marked('İstanbul', 'stan')).toEqual([{ text: 'İstanbul', hit: false }]);
  });

  it('cuts a long note around the first hit with … where it was cut, a short one stays whole', () => {
    expect(snippet('short note', 'x')).toEqual({ text: 'short note', cut: false });
    expect(snippet('line one\nline two', '')).toEqual({ text: 'line one line two', cut: true });
    const long = `${'a'.repeat(300)} needle ${'b'.repeat(300)}`;
    const s = snippet(long, 'needle', 100);
    expect(s.cut).toBe(true);
    expect(s.text.startsWith('…')).toBe(true);
    expect(s.text.endsWith('…')).toBe(true);
    expect(s.text).toContain('needle');
    expect(snippet(long, '', 100).text.startsWith('aaa')).toBe(true);
  });

  it('narrows by the paths of a competence and by state', () => {
    const items = [item('a/x', 'open'), item('a/y', 'learned'), item('a/z', 'open')];
    expect(narrowed(items, { paths: null, state: '' })).toEqual(items);
    expect(narrowed(items, { paths: new Set(['a/x', 'a/y']), state: '' })).toEqual([items[0], items[1]]);
    expect(narrowed(items, { paths: null, state: 'open' })).toEqual([items[0], items[2]]);
  });

  it('takes the title of a label that is one link, and the name of an image', () => {
    expect(linkTitle('[Manual](https://lua.org/manual)')).toBe('Manual');
    expect(linkTitle('Read [this](https://x.test) first')).toBeNull();
    expect(imageName('assets/images/map.png')).toBe('map.png');
  });

  it('has its words in both languages', () => {
    expect(isLearnNotesKey('learnnotes.title')).toBe(true);
    expect(learnNotesText('de', 'learnnotes.no_hit', { text: 'x' })).toBe('Nichts passt zu „x“.');
  });
});
