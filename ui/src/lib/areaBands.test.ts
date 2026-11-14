import { describe, expect, it } from 'vitest';
import { AREA_COLOURS, areaColour, areaLayout, areaRuns, areaTotals, groupedByArea } from './areaBands';

const of = (...areas: string[]) => areas.map((area, i) => ({ area, id: `${area}/t${i}` }));

describe('areaLayout', () => {
  it('shows nothing for no task and for one area', () => {
    expect(areaLayout([])).toBe('none');
    expect(areaLayout(of('a', 'a', 'a'))).toBe('none');
  });

  it('gives heads only when the order keeps every area together', () => {
    expect(areaLayout(of('a', 'a', 'b', 'c', 'c'))).toBe('groups');
    expect(areaLayout(of('b', 'a'))).toBe('groups');
  });

  it('gives bands as soon as one area comes back after another', () => {
    expect(areaLayout(of('a', 'b', 'a'))).toBe('bands');
    expect(areaLayout(of('a', 'a', 'b', 'c', 'b'))).toBe('bands');
  });
});

describe('areaRuns', () => {
  it('cuts the list where the area changes and keeps its order', () => {
    const runs = areaRuns(of('a', 'a', 'b', 'a'));
    expect(runs.map((r) => [r.area, r.tasks.length])).toEqual([
      ['a', 2],
      ['b', 1],
      ['a', 1],
    ]);
    expect(runs[0]?.tasks.map((t) => t.id)).toEqual(['a/t0', 'a/t1']);
  });

  it('is empty for no task', () => {
    expect(areaRuns([])).toEqual([]);
  });
});

describe('groupedByArea', () => {
  it('keeps the areas together in the order of their first task, and the order inside each area', () => {
    const tasks = of('b', 'a', 'b', 'c', 'a');
    const grouped = groupedByArea(tasks);
    expect(grouped.map((t) => t.id)).toEqual(['b/t0', 'b/t2', 'a/t1', 'a/t4', 'c/t3']);
    expect(areaLayout(grouped)).toBe('groups');
  });

  it('is the same list when the order keeps the areas together already', () => {
    const together = of('a', 'a', 'b');
    expect(groupedByArea(together)).toBe(together);
    const one = of('a', 'a');
    expect(groupedByArea(one)).toBe(one);
  });
});

describe('areaTotals', () => {
  it('counts the tasks of each area', () => {
    expect([...areaTotals(of('a', 'b', 'a'))]).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
  });
});

describe('areaColour', () => {
  it('is one of the colours, and the same for the same name whatever else there is', () => {
    const names = ['lib.nvim', 'tasks.nvim', 'tasks-desktop', 'ALL', 'wkdbook-tasks.nvim', '', 'ä-bereich'];
    for (const name of names) {
      const colour = areaColour(name);
      expect(colour).toBeGreaterThanOrEqual(1);
      expect(colour).toBeLessThanOrEqual(AREA_COLOURS);
      expect(areaColour(name)).toBe(colour);
    }
    // Pinned: a change of the hash would recolour every area of every person.
    expect(names.map(areaColour)).toMatchInlineSnapshot(`
      [
        5,
        8,
        1,
        5,
        6,
        6,
        7,
      ]
    `);
  });

  it('uses more than one colour', () => {
    const seen = new Set(Array.from({ length: 40 }, (_, i) => areaColour(`area-${i}`)));
    expect(seen.size).toBeGreaterThan(4);
  });
});
