import { describe, expect, it } from 'vitest';
import { make } from './appDouble';
import type { History, HistoryPoint } from './contract';
import { COUNT_KEYS } from './counts';
import {
  AREAS_MAX,
  askFor,
  changeOf,
  chartOf,
  DAILY_MAX,
  defaultHistoryPrefs,
  emptyReason,
  HISTORY_METRICS,
  isDefaultHistory,
  metricOfTile,
  metricValue,
  parseHistoryPrefs,
  seriesOf,
  sumHistories,
  TILE_METRIC,
  windowOf,
} from './statsHistory';

const level = (day: string, open: number, ready: number, extra: Partial<HistoryPoint> = {}): HistoryPoint => ({
  day,
  recorded: true,
  done: 0,
  created: 0,
  open,
  by_status: { open: open - 1, doing: 1, blocked: 0, decision: 0, parked: 0 },
  by_state: { ready, decision: 0, waiting: open - ready, stuck: 0, freed: 0, parked: 0 },
  with_effort: 1,
  with_value: 2,
  effort_days: 1.5,
  value: 6,
  ...extra,
});
const bare = (day: string, extra: Partial<HistoryPoint> = {}): HistoryPoint => ({ day, recorded: false, done: 0, created: 0, ...extra });
const doc = (points: HistoryPoint[], extra: Partial<History> = {}): History =>
  ({
    kind: 'tasks.history',
    since: points[0]?.day ?? '2026-01-01',
    until: points[points.length - 1]?.day ?? '2026-01-01',
    resolution: 'day',
    points,
    incomplete: [],
    ...extra,
  }) as History;

describe('the figure of a tile', () => {
  it('is one table: the numbers of the overview that have a history name their figure', () => {
    expect(metricOfTile('ready')).toBe('ready');
    expect(metricOfTile('estimated')).toBe('withValue');
    expect(metricOfTile('doing')).toBe('doing');
    expect(metricOfTile('blocked')).toBe('blocked');
  });

  it('names only figures there are, and only numbers the overview has', () => {
    for (const [tile, metric] of Object.entries(TILE_METRIC)) {
      expect(COUNT_KEYS as readonly string[]).toContain(tile);
      expect(HISTORY_METRICS as readonly string[]).toContain(metric);
    }
  });

  it('is null for a number without a history: it offers none and a click goes nowhere', () => {
    expect(metricOfTile('no-such-tile')).toBeNull();
  });
});

describe('the figure of a point', () => {
  const p = level('2026-01-02', 5, 3, { done: 2, created: 4 });
  it('reads the levels from the fields the engine counted', () => {
    expect(metricValue(p, 'open')).toBe(5);
    expect(metricValue(p, 'ready')).toBe(3);
    expect(metricValue(p, 'waiting')).toBe(2);
    expect(metricValue(p, 'doing')).toBe(1);
    expect(metricValue(p, 'blocked')).toBe(0);
    expect(metricValue(p, 'withValue')).toBe(2);
    expect(metricValue(p, 'withEffort')).toBe(1);
    expect(metricValue(p, 'value')).toBe(6);
    expect(metricValue(p, 'effortDays')).toBe(1.5);
  });

  it('knows no level of a day before the series, but what the files say about it', () => {
    const before = bare('2026-01-01', { done: 1, created: 3 });
    expect(metricValue(before, 'ready')).toBeNull();
    expect(metricValue(before, 'open')).toBeNull();
    expect(metricValue(before, 'done')).toBe(1);
    expect(metricValue(before, 'created')).toBe(3);
  });
});

describe('the window of a period', () => {
  it('reaches back from today, both days included', () => {
    expect(windowOf('7d', '2026-03-10', { since: '', until: '' })).toEqual({ since: '2026-03-04', until: '2026-03-10', resolution: 'day' });
    expect(windowOf('30d', '2026-03-10', { since: '', until: '' }).since).toBe('2026-02-09');
    expect(windowOf('90d', '2026-03-10', { since: '', until: '' })).toMatchObject({ since: '2025-12-11', resolution: 'day' });
  });

  it('is drawn by week when it is longer than the days that fit a line', () => {
    expect(windowOf('year', '2026-03-10', { since: '', until: '' })).toEqual({ since: '2025-03-11', until: '2026-03-10', resolution: 'week' });
    const edge = windowOf('custom', '2026-12-31', { since: '2026-01-01', until: '2026-04-30' });
    expect(edge.resolution).toBe('day');
    expect(DAILY_MAX).toBe(120);
    expect(windowOf('custom', '2026-12-31', { since: '2026-01-01', until: '2026-05-01' }).resolution).toBe('week');
  });

  it('takes the days of the person as they are, and the last 30 days while they are no window', () => {
    expect(windowOf('custom', '2026-03-10', { since: '2026-01-05', until: '2026-01-20' })).toMatchObject({ since: '2026-01-05', until: '2026-01-20' });
    const fallback = { since: '2026-02-09', until: '2026-03-10', resolution: 'day' };
    expect(windowOf('custom', '2026-03-10', { since: '', until: '' })).toEqual(fallback);
    expect(windowOf('custom', '2026-03-10', { since: '2026-02', until: '2026-03-01' })).toEqual(fallback);
    expect(windowOf('custom', '2026-03-10', { since: '2026-03-05', until: '2026-03-01' })).toEqual(fallback);
  });
});

describe('the remembered choice', () => {
  it('comes back as it was written', () => {
    const prefs = { metric: 'withValue', period: 'custom', since: '2026-01-01', until: '2026-02-01' } as const;
    expect(parseHistoryPrefs(JSON.stringify(prefs))).toEqual(prefs);
    expect(isDefaultHistory(prefs)).toBe(false);
    expect(isDefaultHistory(defaultHistoryPrefs())).toBe(true);
  });

  it('is the first choice for anything that is none', () => {
    for (const raw of [null, '', 'x', '[]', '7', '{"metric":"colour","period":"decade","since":"soon","until":5}']) {
      expect(parseHistoryPrefs(raw)).toEqual(defaultHistoryPrefs());
    }
  });
});

describe('what the engine is asked for the areas of the filter', () => {
  it('is the whole vault without a choice, one question per area with one', () => {
    expect(askFor([])).toEqual({ areas: [undefined], whole: false });
    expect(askFor(['pub', 'alpha'])).toEqual({ areas: ['alpha', 'pub'], whole: false });
  });

  it('is the whole vault again for more areas than are added up, and says so', () => {
    const many = Array.from({ length: AREAS_MAX + 1 }, (_, i) => `a${i}`);
    expect(askFor(many)).toEqual({ areas: [undefined], whole: true });
    expect(askFor(many.slice(1)).areas).toHaveLength(AREAS_MAX);
  });
});

describe('the histories of several areas', () => {
  it('are one: the points of a day added up, the first day the earliest', () => {
    const a = doc([bare('2026-01-01', { created: 1 }), level('2026-01-02', 4, 2, { done: 1 })], { area: 'a', first: '2026-01-02', last: '2026-01-02' });
    const b = doc([level('2026-01-01', 2, 1, { created: 2, recorded: false }), level('2026-01-02', 3, 3)], {
      area: 'b',
      first: '2025-12-30',
      last: '2026-01-02',
      incomplete: ['x:1: no JSON object'],
    });
    const sum = sumHistories([a, b]);
    expect(sum?.area).toBeUndefined();
    expect(sum?.first).toBe('2025-12-30');
    expect(sum?.incomplete).toEqual(['x:1: no JSON object']);
    // the first day: one area has no row yet and adds nothing, the other is there
    expect(sum?.points[0]).toMatchObject({ day: '2026-01-01', open: 2, created: 3, recorded: false });
    expect(sum?.points[1]).toMatchObject({ day: '2026-01-02', open: 7, done: 1, with_value: 4, value: 12, effort_days: 3, recorded: true });
    expect(sum?.points[1]?.by_state).toMatchObject({ ready: 5, waiting: 2 });
    expect(sum?.points[1]?.by_status).toMatchObject({ doing: 2, open: 5 });
  });

  it('leave the documents they were made of as they were', () => {
    const a = doc([level('2026-01-02', 4, 2)]);
    const b = doc([level('2026-01-02', 3, 3)]);
    sumHistories([a, b]);
    expect(a.points[0]?.open).toBe(4);
  });

  it('are the one document when there is one, and nothing when there is none', () => {
    const a = doc([level('2026-01-02', 4, 2)]);
    expect(sumHistories([a])).toBe(a);
    expect(sumHistories([])).toBeNull();
  });
});

describe('the line', () => {
  const series = seriesOf(doc([bare('2026-01-01'), level('2026-01-02', 4, 2), level('2026-01-03', 4, 6, { recorded: false }), level('2026-01-04', 4, 10)]), 'ready');

  it('has a point per known day and none before the series', () => {
    expect(series.map((p) => p.value)).toEqual([null, 2, 6, 10]);
    const chart = chartOf(series, 300, 100);
    expect(chart.dots.map((d) => d.day)).toEqual(['2026-01-02', '2026-01-03', '2026-01-04']);
    expect(chart.dots.map((d) => d.x)).toEqual([100, 200, 300]);
    expect(chart.dots[1]?.recorded).toBe(false);
  });

  it('stands on zero and ends on a round number at or above the highest value', () => {
    const chart = chartOf(series, 300, 100);
    expect(chart.min).toBe(0);
    expect(chart.max).toBeGreaterThanOrEqual(10);
    expect(chart.ticks[0]).toEqual({ value: 0, y: 100 });
    expect(chart.ticks[chart.ticks.length - 1]?.y).toBe(0);
    expect(chart.line.startsWith('M100 ')).toBe(true);
    expect(chart.area.endsWith('Z')).toBe(true);
  });

  it('leaves zero when the values sit far above it, so a small change can be seen', () => {
    const high = [900, 905, 910].map((value, i) => ({ day: `2026-01-0${i + 1}`, value, recorded: true }));
    const chart = chartOf(high, 300, 100);
    expect(chart.min).toBeGreaterThan(0);
    expect(chart.min).toBeLessThanOrEqual(900);
    expect(chart.max).toBeGreaterThanOrEqual(910);
  });

  it('breaks at a day without a value', () => {
    const gap = [1, null, 3, 4].map((value, i) => ({ day: `2026-01-0${i + 1}`, value, recorded: true }));
    expect(chartOf(gap, 300, 100).line.match(/M/g)).toHaveLength(2);
  });

  it('draws one point in the middle, a flat line in a frame that has a height, and nothing without a value', () => {
    expect(chartOf([{ day: '2026-01-01', value: 5, recorded: true }], 300, 100).dots[0]?.x).toBe(150);
    const flat = chartOf([0, 0].map((value, i) => ({ day: `2026-01-0${i + 1}`, value, recorded: true })), 300, 100);
    expect(flat.max).toBeGreaterThan(flat.min);
    expect(chartOf([{ day: '2026-01-01', value: null, recorded: false }], 300, 100)).toMatchObject({ line: '', dots: [], ticks: [] });
  });

  it('says how far the figure moved between its first and last known day', () => {
    expect(changeOf(series)).toEqual({ from: 2, to: 10, delta: 8 });
    expect(changeOf(series.slice(0, 2))).toBeNull();
    expect(changeOf([])).toBeNull();
  });
});

describe('why there is no line', () => {
  it('a vault without a series, a window before it, or nothing', () => {
    expect(emptyReason(doc([bare('2026-01-01')]), 'ready')).toBe('no-series');
    expect(emptyReason(doc([bare('2026-01-01')], { first: '2026-02-01', last: '2026-02-01' }), 'ready')).toBe('before-series');
    expect(emptyReason(doc([level('2026-01-02', 4, 2)], { first: '2026-01-02', last: '2026-01-02' }), 'ready')).toBeNull();
  });

  it('never for what the files say about every day', () => {
    expect(emptyReason(doc([bare('2026-01-01')]), 'done')).toBeNull();
  });
});

describe('the way to the history and back', () => {
  it('opens the statistics with the figure of the number, keeps the filter, and goes back scrolled as before', async () => {
    const m = make({ token: 't' });
    m.hub.capabilities = [...(m.hub.capabilities ?? []), 'history'];
    await m.app.start(null);
    m.app.setView('today');
    m.app.filter = { ...m.app.filter, areas: ['pub'] };
    m.app.openHistory('withValue', 240);
    expect(m.app.view).toBe('stats');
    expect(m.app.statsHistory.metric).toBe('withValue');
    expect(m.app.filter.areas).toEqual(['pub']);
    expect(m.app.historyFrom).toEqual({ view: 'today', scroll: 240 });
    expect(m.app.historyShown).toBe(1);
    expect(m.prefs.get('tasks-desktop.stats-history')).toContain('withValue');

    m.app.backFromHistory();
    expect(m.app.view).toBe('today');
    expect(m.app.todayScroll).toBe(240);
    expect(m.app.historyFrom).toBeNull();
    expect(m.app.filter.areas).toEqual(['pub']);
    m.app.stop();
  });

  it('goes nowhere with an engine that keeps no history', async () => {
    const m = make({ token: 't' });
    await m.app.start(null);
    m.app.setView('today');
    m.app.openHistory('ready', 0);
    expect(m.app.view).toBe('today');
    expect(m.app.historyFrom).toBeNull();
    m.app.stop();
  });

  it('keeps a history going once per state of the vault, quietly, and never while the vault is only shown', async () => {
    const m = make({ token: 't' });
    m.hub.capabilities = [...(m.hub.capabilities ?? []), 'history'];
    await m.app.start(null);
    const before = m.hub.sent.length;
    m.hub.next_ops = { kind: 'tasks.result', ok: true, dry_run: false, results: [{ n: 1, op: 'history_record', ok: true, outcome: 'changed', changed_ids: [], rows: 3 }] } as never;
    expect(await m.app.keepHistory()).toBe(3);
    expect(m.hub.sent.slice(before).map((r) => r.ops.map((op) => op.op))).toEqual([['history_record']]);
    // the same state of the vault: nothing is asked again
    expect(await m.app.keepHistory()).toBe(0);
    expect(m.hub.sent).toHaveLength(before + 1);
    expect(m.app.toast).toBeNull();
    m.app.stop();

    const shown = make({ token: 't', readOnly: true });
    shown.hub.capabilities = [...(shown.hub.capabilities ?? []), 'history'];
    await shown.app.start(null);
    expect(await shown.app.keepHistory()).toBe(0);
    expect(shown.hub.sent).toHaveLength(0);
    shown.app.stop();
  });

  it('counts the choice of the history as a change of the layout of the statistics, and resets it', async () => {
    const m = make({ token: 't' });
    await m.app.start(null);
    expect(m.app.layoutChanged('stats')).toBe(false);
    m.app.setStatsHistory({ ...m.app.statsHistory, period: 'year' });
    expect(m.app.layoutChanged('stats')).toBe(true);
    m.app.resetLayout('stats');
    expect(m.app.statsHistory).toEqual(defaultHistoryPrefs());
    m.app.stop();
  });
});
