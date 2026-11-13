import { describe, expect, it } from 'vitest';
import type { PlanCompareRow } from './contract';
import {
  areasOf,
  nextSort,
  parseCompareSort,
  pickRows,
  serializeCompareSort,
  sortRows,
  statusesOf,
  widest,
} from './planCompare';

/** A row as the engine gives it, with the figures a case sets. */
function row(id: string, over: Partial<PlanCompareRow> & { open?: number; days?: number; high?: number } = {}): PlanCompareRow {
  const { open = 0, days = 0, high, ...rest } = over;
  return {
    id,
    title: id,
    stages: 0,
    tasks: { open, done: 0, ready: 0, decision: 0, waiting: 0, stuck: 0, freed: 0, parked: 0 },
    progress: 0,
    effort: { open_days: days, open_low: days, open_high: days, done_days: 0, open_without: 0 },
    path: { days: 0, unknown_effort: 0 },
    weekly_done: [0, 0, 0, 0],
    ...(high === undefined ? {} : { forecast_weeks: { low: 1, high } }),
    ...rest,
  };
}

const ids = (rows: PlanCompareRow[]) => rows.map((r) => r.id);

describe('the comparison of plans', () => {
  const rows = [
    row('a/small', { open: 2, days: 1, high: 2, last_done: '2026-01-01' }),
    row('a/big', { open: 9, days: 12, high: 8, project: 'a/proj' }),
    row('a/none', { open: 0, days: 0 }),
    row('a/mid', { open: 5, days: 4, high: 3, project: 'a/proj', last_done: '2026-02-01' }),
  ];

  it('sorts by a figure of the engine, the largest first, and back', () => {
    expect(ids(sortRows(rows, { key: 'effort', desc: true }))).toEqual(['a/big', 'a/mid', 'a/small', 'a/none']);
    expect(ids(sortRows(rows, { key: 'open', desc: false }))).toEqual(['a/none', 'a/small', 'a/mid', 'a/big']);
  });

  it('puts a plan without a forecast or a finish last in either direction', () => {
    expect(ids(sortRows(rows, { key: 'forecast', desc: true }))).toEqual(['a/big', 'a/mid', 'a/small', 'a/none']);
    expect(ids(sortRows(rows, { key: 'forecast', desc: false }))).toEqual(['a/small', 'a/mid', 'a/big', 'a/none']);
    expect(ids(sortRows(rows, { key: 'last_done', desc: true })).slice(0, 2)).toEqual(['a/mid', 'a/small']);
    expect(ids(sortRows(rows, { key: 'last_done', desc: false })).slice(2)).toEqual(['a/big', 'a/none']);
  });

  it('keeps the order of the engine among equal rows', () => {
    const same = [row('a/x', { days: 1 }), row('a/y', { days: 1 }), row('a/z', { days: 1 })];
    expect(ids(sortRows(same, { key: 'effort', desc: true }))).toEqual(['a/x', 'a/y', 'a/z']);
  });

  it('turns a column round on a second click and starts another with its first direction', () => {
    expect(nextSort({ key: 'effort', desc: true }, 'effort')).toEqual({ key: 'effort', desc: false });
    expect(nextSort({ key: 'effort', desc: true }, 'title')).toEqual({ key: 'title', desc: false });
    expect(nextSort({ key: 'title', desc: false }, 'path')).toEqual({ key: 'path', desc: true });
  });

  it('picks the plans of a project and the chosen ones; a chosen plan that is gone is ignored', () => {
    expect(ids(pickRows(rows, '', []))).toEqual(ids(rows));
    expect(ids(pickRows(rows, 'a/proj', []))).toEqual(['a/big', 'a/mid']);
    expect(ids(pickRows(rows, '', ['a/small', 'a/gone']))).toEqual(['a/small']);
    expect(ids(pickRows(rows, 'a/proj', ['a/small']))).toEqual([]);
  });

  it('sorts by the average value, the largest first, and by the best prio, 1 first; a plan without one comes last', () => {
    const worth = [
      row('a/low', { value: { sum: 4, avg: 2, without: 0 }, prio: 3 }),
      row('a/bare', { value: { sum: 0, without: 2 } }),
      row('a/high', { value: { sum: 9, avg: 4.5, without: 1 }, prio: 1 }),
      row('a/old'),
    ];
    expect(ids(sortRows(worth, { key: 'value', desc: true }))).toEqual(['a/high', 'a/low', 'a/bare', 'a/old']);
    expect(ids(sortRows(worth, { key: 'value', desc: false }))).toEqual(['a/low', 'a/high', 'a/bare', 'a/old']);
    expect(nextSort({ key: 'effort', desc: true }, 'prio')).toEqual({ key: 'prio', desc: false });
    expect(ids(sortRows(worth, { key: 'prio', desc: false }))).toEqual(['a/high', 'a/low', 'a/bare', 'a/old']);
    expect(parseCompareSort('value:desc')).toEqual({ key: 'value', desc: true });
  });

  it('picks the plans of the chosen areas and statuses; a row of an older engine names no area and matches none', () => {
    const plans = [
      row('a/one', { areas: ['a', 'b'], status: 'doing' }),
      row('b/two', { areas: ['b'], status: 'planning', project: 'a/proj' }),
      row('c/three', { areas: ['c'], status: 'parked' }),
      row('d/old', { status: 'doing' }),
    ];
    const none = { areas: [], statuses: [] };
    expect(ids(pickRows(plans, '', [], none))).toEqual(ids(plans));
    expect(ids(pickRows(plans, '', [], { areas: ['b'], statuses: [] }))).toEqual(['a/one', 'b/two']);
    expect(ids(pickRows(plans, '', [], { areas: ['a', 'c'], statuses: [] }))).toEqual(['a/one', 'c/three']);
    expect(ids(pickRows(plans, '', [], { areas: [], statuses: ['doing'] }))).toEqual(['a/one', 'd/old']);
    expect(ids(pickRows(plans, '', [], { areas: ['b'], statuses: ['planning', 'parked'] }))).toEqual(['b/two']);
    expect(ids(pickRows(plans, 'a/proj', [], { areas: ['b'], statuses: [] }))).toEqual(['b/two']);
    expect(ids(pickRows(plans, '', ['a/one'], { areas: ['c'], statuses: [] }))).toEqual([]);
    expect(areasOf(plans)).toEqual(['a', 'b', 'c']);
    expect(statusesOf(plans)).toEqual(['planning', 'doing', 'parked']);
    expect(statusesOf([row('x/y', { status: 'odd' }), row('x/z', { status: 'doing' }), row('x/n')])).toEqual(['doing', 'odd']);
  });

  it('measures the bars against the largest open effort', () => {
    expect(widest(rows)).toBe(12);
    expect(widest([])).toBe(0);
  });

  it('remembers the sort and falls back on anything it does not know', () => {
    expect(parseCompareSort(serializeCompareSort({ key: 'path', desc: false }))).toEqual({ key: 'path', desc: false });
    expect(parseCompareSort('colour:desc')).toEqual({ key: 'effort', desc: true });
    expect(parseCompareSort(null)).toEqual({ key: 'effort', desc: true });
  });
});
