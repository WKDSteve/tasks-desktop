import { describe, expect, it } from 'vitest';
import type { LearnHistory, PathEntry } from './contract';
import { forecastWeeks, rowProjects, span, timeRows } from './learnTime';
import { isLearnTimeKey, learnTimeText } from './learnTimeTexts';

const hours = (planned_min: number, planned_max: number, done: number) => ({
  planned_min,
  planned_max,
  done,
  open_min: Math.max(0, planned_min - done),
  open_max: Math.max(0, planned_max - done),
});
const entry = (id: string, p: Partial<PathEntry> = {}) => ({ id, title: id, ...p }) as unknown as PathEntry;

describe('the learning time', () => {
  it('keeps the paths with hours, in the engine order, with the share of the plan and the hours over it', () => {
    const rows = timeRows(
      [entry('a/none'), entry('a/half', { hours: hours(8, 10, 5), project: 'a/p' }), entry('a/over', { hours: hours(4, 5, 8) }), entry('a/zero', { hours: hours(0, 0, 2) })],
      null,
    );
    expect(rows.map((r) => r.id)).toEqual(['a/half', 'a/over', 'a/zero']);
    expect(rows[0]).toMatchObject({ share: 0.5, over: 0, project: 'a/p' });
    expect(rows[1]).toMatchObject({ share: 1, over: 3 });
    // Done without a plan: a full bar, no overrun to name (there is no plan to be over).
    expect(rows[2]).toMatchObject({ share: 1, over: 0 });
    expect(rows[1]!.forecast).toBeUndefined();
  });

  it('takes the forecast of the series by path, and rounds the overrun to two places', () => {
    const history = { paths: [{ id: 'a/half', forecast_weeks: { hours_min: 1.2, hours_max: 2.6 } }] } as unknown as LearnHistory;
    const rows = timeRows([entry('a/half', { hours: hours(8, 10, 10.333) })], history);
    expect(rows[0]!.forecast).toEqual({ hours_min: 1.2, hours_max: 2.6 });
    expect(rows[0]!.over).toBe(0.33);
  });

  it('says the weeks as whole weeks up, the hours first, else the points; none without a forecast', () => {
    expect(forecastWeeks(undefined)).toBeNull();
    expect(forecastWeeks({})).toBeNull();
    expect(forecastWeeks({ hours_min: 1.2, hours_max: 2.6 })).toEqual({ min: 2, max: 3 });
    expect(forecastWeeks({ hours_max: 4, points: 9 })).toEqual({ min: 4, max: 4 });
    expect(forecastWeeks({ points: 0.4 })).toEqual({ min: 1, max: 1 });
  });

  it('writes a span as one number when its ends are the same', () => {
    const f = (n: number) => String(n);
    expect(span(8, 8, f)).toBe('8');
    expect(span(8, 10, f)).toBe('8–10');
  });

  it('lists the projects once, sorted', () => {
    expect(rowProjects([{ project: 'b/p' }, {}, { project: 'a/p' }, { project: 'b/p' }])).toEqual(['a/p', 'b/p']);
  });

  it('leaves {h=N} in a text as written', () => {
    expect(isLearnTimeKey('learntime.title')).toBe(true);
    expect(learnTimeText('de', 'learntime.none_how')).toContain('{h=N}');
    expect(learnTimeText('en', 'learntime.over', { n: 3 })).toBe('+3 h over the plan');
  });
});
