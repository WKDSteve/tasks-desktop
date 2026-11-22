import { describe, expect, it } from 'vitest';
import { NO_AREA } from './areaGroups';
import { learnQuery } from './api';
import { learnScope } from './learnScope';

const rows = [{ area: 'lib.nvim' }, { area: 'ops' }, { area: 'ALL' }];

describe('learnScope', () => {
  it('without a filter keeps everything and asks with nothing', () => {
    const s = learnScope([], []);
    expect(s.active).toBe(false);
    expect(s.query).toEqual({});
    expect(s.keep(rows)).toBe(rows);
    expect(s.has('anything')).toBe(true);
  });

  it('one name (an area or a group) is the engine `area`; the list keeps the areas it means', () => {
    const s = learnScope(['tools'], ['lib.nvim', 'ops']);
    expect(s.query).toEqual({ area: 'tools' });
    expect(s.keep(rows).map((r) => r.area)).toEqual(['lib.nvim', 'ops']);
    expect(s.has('ALL')).toBe(false);
  });

  it('several names are `areas`, joined by a slash, and go to the hub as such', () => {
    const s = learnScope(['lib.nvim', 'ALL'], ['lib.nvim', 'ALL']);
    expect(s.query).toEqual({ areas: 'lib.nvim/ALL' });
    expect(learnQuery({ include_done: true, ...s.query })).toBe('?include_done=1&areas=lib.nvim/ALL');
  });

  it('a name the hub refuses (a blank, an umlaut) asks for all areas; the list is narrowed by the page', () => {
    const s = learnScope(['Mein Bereich'], ['Mein Bereich']);
    expect(s.query).toEqual({});
    expect(s.keep([{ area: 'Mein Bereich' }, { area: 'ops' }])).toEqual([{ area: 'Mein Bereich' }]);
  });

  it('more names than the hub takes in one value: asked for all areas, too', () => {
    const many = Array.from({ length: 40 }, (_, i) => `area-${i}`);
    expect(learnScope(many, many).query).toEqual({});
  });

  it('only empty groups: empty, nothing kept', () => {
    const s = learnScope(['nobody'], [NO_AREA]);
    expect(s.empty).toBe(true);
    expect(s.keep(rows)).toEqual([]);
  });
});
