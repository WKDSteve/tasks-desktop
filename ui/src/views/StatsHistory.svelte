<script lang="ts">
  // The history of one figure of the overview: a line over a period the person chooses, the same numbers as a table
  // for the keyboard and a screen reader. The series is the engine's (`tasks.history`: it writes the figures down per
  // day and area); the page asks for the window and draws it. Reached from the statistics, and from a number of the
  // overview, which opens it with its figure chosen.
  import { tick, untrack } from 'svelte';
  import type { App } from '../lib/app.svelte';
  import type { History } from '../lib/contract';
  import { translate, type Key } from '../lib/i18n';
  import {
    askFor,
    AREAS_MAX,
    changeOf,
    chartOf,
    emptyReason,
    HISTORY_METRICS,
    HISTORY_PERIODS,
    seriesOf,
    sumHistories,
    windowOf,
    type HistoryMetric,
    type HistoryPeriod,
  } from '../lib/statsHistory';
  import Info from 'appkit-ui/Info.svelte';

  let { app }: { app: App } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  const prefs = $derived(app.statsHistory);
  const frame = $derived(windowOf(prefs.period, app.today, { since: prefs.since, until: prefs.until }));
  const ask = $derived(askFor(app.filter.areas));
  // asked again when the window, the areas or the vault change (a write may have added a row)
  const askKey = $derived(`${frame.since}|${frame.until}|${frame.resolution}|${ask.areas.join(',')}|${app.snapshot?.rev ?? ''}`);

  let doc = $state.raw<History | null>(null);
  let problem = $state('');
  let loading = $state(false);
  let recording = $state(false);
  /** Counted up after a row was written: the series is read again. */
  let again = $state(0);

  $effect(() => {
    void askKey;
    void again;
    if (!app.can('history') || app.phase !== 'ready') return;
    const abort = new AbortController();
    // only the key is a reason to ask again: `frame` and `ask` are new objects whenever anything of the filter or the
    // choice changes (a key in the search, another figure), with the same window and areas in them
    const { since, until, resolution } = untrack(() => frame);
    const areas = untrack(() => ask.areas);
    loading = true;
    Promise.all(areas.map((area) => app.history({ ...(area !== undefined ? { area } : {}), since, until, resolution }, abort.signal)))
      .then((docs) => {
        if (abort.signal.aborted) return;
        doc = sumHistories(docs);
        problem = '';
        loading = false;
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        problem = error instanceof Error ? error.message : String(error);
        loading = false;
      });
    return () => abort.abort();
  });

  // a history that exists is kept going while it is looked at: the figures of today, once per state of the vault
  $effect(() => {
    if (doc?.first === undefined) return;
    void app.snapshot?.rev;
    void app.keepHistory().then((rows) => {
      if (rows > 0) again += 1;
    });
  });

  const series = $derived(doc ? seriesOf(doc, prefs.metric) : []);
  const empty = $derived(doc ? emptyReason(doc, prefs.metric) : null);
  const change = $derived(changeOf(series));

  // the frame of the drawing, in the units of its viewBox; the margins hold the numbers and the days
  const W = 720;
  const H = 200;
  const LEFT = 44;
  const TOP = 10;
  const BOTTOM = 24;
  const chart = $derived(chartOf(series, W - LEFT - 12, H - TOP - BOTTOM));
  const dayLabels = $derived.by(() => {
    if (series.length === 0) return [];
    const picks = series.length < 3 ? [0, series.length - 1] : [0, Math.floor((series.length - 1) / 2), series.length - 1];
    return [...new Set(picks)].map((i) => ({
      day: series[i]?.day ?? '',
      x: series.length === 1 ? (W - LEFT - 12) / 2 : (i / (series.length - 1)) * (W - LEFT - 12),
      anchor: i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle',
    }));
  });

  const metricName = (metric: HistoryMetric): string => t(`stats.history.metric.${metric}` as Key);
  const shown = (n: number): string => String(Math.round(n * 100) / 100);

  function choose(patch: Partial<typeof prefs>): void {
    app.setStatsHistory({ ...prefs, ...patch });
  }

  async function record(): Promise<void> {
    recording = true;
    const ok = await app.recordHistory();
    recording = false;
    if (ok) again += 1;
  }

  // opened from a number of the overview: the section comes into view and takes the focus
  let section: HTMLElement | undefined = $state();
  $effect(() => {
    if (app.historyShown === 0 || !section) return;
    const el = section;
    // once per opening: a later visit of the statistics by the menu or Back stays where it is
    app.historyShown = 0;
    void tick().then(() => {
      el.scrollIntoView({ block: 'start' });
      el.querySelector<HTMLElement>('select')?.focus();
    });
  });
</script>

{#if app.can('history')}
  <section class="card history" aria-labelledby="stats-history" bind:this={section}>
    <div class="headline">
      <h3 id="stats-history" class="eyebrow">{t('stats.history')}</h3>
      <Info hint={t('hint.stats.history')} label={t('hint.about', { what: t('stats.history') })} />
      {#if app.historyFrom}
        <button type="button" class="linkish back" data-hint={t('hint.stats.history.back')} onclick={() => app.backFromHistory()}
          >{t('stats.history.back')}</button
        >
      {/if}
    </div>
    <div class="bar">
      <label class="field" data-hint={t('hint.form.stats.history.metric')}
        >{t('stats.history.figure')}
        <select value={prefs.metric} data-history-metric onchange={(e) => choose({ metric: e.currentTarget.value as HistoryMetric })}>
          {#each HISTORY_METRICS as metric (metric)}
            <option value={metric}>{metricName(metric)}</option>
          {/each}
        </select>
      </label>
      <label class="field" data-hint={t('hint.form.stats.history.period')}
        >{t('done.period')}
        <select value={prefs.period} data-history-period onchange={(e) => choose({ period: e.currentTarget.value as HistoryPeriod })}>
          {#each HISTORY_PERIODS as period (period)}
            <option value={period}>{t(`stats.history.period.${period}` as Key)}</option>
          {/each}
        </select>
      </label>
      {#if prefs.period === 'custom'}
        <label class="field" data-hint={t('hint.form.period.from')}
          >{t('done.from')} <input type="date" value={prefs.since} oninput={(e) => choose({ since: e.currentTarget.value })} /></label
        >
        <label class="field" data-hint={t('hint.form.period.to')}
          >{t('done.to')} <input type="date" value={prefs.until} oninput={(e) => choose({ until: e.currentTarget.value })} /></label
        >
      {/if}
      <span class="muted">{frame.since} – {frame.until}</span>
    </div>
    <div class="muted" role="status">{loading ? t('state.loading') : ''}</div>
    {#if ask.whole}
      <p class="muted">{t('stats.history.whole', { n: AREAS_MAX })}</p>
    {/if}
    {#if problem}
      <p class="problem" role="alert">{problem}</p>
    {:else if doc}
      {#if empty === 'no-series'}
        <div class="empty" data-history-empty="no-series">
          <p>{t('stats.history.none')}</p>
          {#if !app.readOnly}
            <button type="button" disabled={recording} data-hint={t('hint.stats.history.record')} onclick={() => void record()}
              >{t('stats.history.record')}</button
            >
          {/if}
        </div>
      {:else if empty === 'before-series'}
        <p class="empty" data-history-empty="before-series">{t('stats.history.before', { day: doc.first ?? '' })}</p>
      {:else}
        <p class="summary" role="status">
          <strong>{metricName(prefs.metric)}</strong>
          {#if change}
            <span data-history-change>{t('stats.history.change', { from: shown(change.from), to: shown(change.to), delta: `${change.delta > 0 ? '+' : ''}${shown(change.delta)}` })}</span>
          {/if}
        </p>
        <svg class="chart" class:stale={loading} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('stats.history.chart', { what: metricName(prefs.metric), since: frame.since, until: frame.until })}>
          <g transform={`translate(${LEFT} ${TOP})`}>
            {#each chart.ticks as tick (tick.value)}
              <line class="grid" x1="0" x2={W - LEFT - 12} y1={tick.y} y2={tick.y} />
              <text class="axis" x="-6" y={tick.y} text-anchor="end" dominant-baseline="middle">{shown(tick.value)}</text>
            {/each}
            <path class="area" d={chart.area} />
            <path class="line" d={chart.line} />
            {#each chart.dots as dot (dot.day)}
              {#if chart.dots.length <= 62}
                <circle class="dot" class:carried={!dot.recorded} cx={dot.x} cy={dot.y} r="3">
                  <title>{dot.day}: {shown(dot.value)}{dot.recorded ? '' : ` (${t('stats.history.carried')})`}</title>
                </circle>
              {/if}
            {/each}
            {#each dayLabels as label (label.day)}
              <text class="axis" x={label.x} y={H - TOP - BOTTOM + 16} text-anchor={label.anchor}>{label.day}</text>
            {/each}
          </g>
        </svg>
        <details class="numbers">
          <summary>{t('stats.history.table')}</summary>
          <table>
            <thead>
              <tr>
                <th scope="col">{t(frame.resolution === 'week' ? 'stats.history.week' : 'stats.history.day')}</th>
                <th scope="col" class="num">{metricName(prefs.metric)}</th>
              </tr>
            </thead>
            <tbody>
              {#each series as point (point.day)}
                <tr>
                  <th scope="row">{point.day}</th>
                  <td class="num"
                    >{point.value === null ? '–' : shown(point.value)}{#if point.value !== null && !point.recorded}
                      <span class="muted">({t('stats.history.carried')})</span>{/if}</td
                  >
                </tr>
              {/each}
            </tbody>
          </table>
        </details>
      {/if}
      {#if doc.incomplete.length > 0}
        <p class="muted" data-history-incomplete>{t('stats.history.incomplete', { n: doc.incomplete.length })}</p>
      {/if}
    {/if}
  </section>
{/if}

<style>
  .history {
    display: grid;
    gap: 0.5rem;
  }
  .headline {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .back {
    margin-inline-start: auto;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.75rem;
  }
  .field {
    display: grid;
    gap: 0.15rem;
    font-size: 0.85rem;
  }
  .summary {
    margin: 0;
    display: flex;
    gap: 0.75rem;
    align-items: baseline;
  }
  .chart {
    width: 100%;
    height: auto;
    max-height: 18rem;
  }
  .chart.stale {
    opacity: 0.55;
  }
  .grid {
    stroke: var(--line);
    stroke-width: 1;
  }
  .axis {
    fill: var(--muted);
    font-size: 11px;
  }
  .line {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .area {
    fill: var(--accent);
    opacity: 0.12;
  }
  .dot {
    fill: var(--accent);
    stroke: var(--surface);
    stroke-width: 1.5;
  }
  .dot.carried {
    fill: var(--surface);
    stroke: var(--accent);
  }
  .empty {
    margin: 0;
    padding: 0.75rem;
    border: 1px dashed var(--line);
    border-radius: 0.4rem;
    color: var(--muted);
  }
  .empty p {
    margin: 0 0 0.5rem;
  }
  .numbers table {
    border-collapse: collapse;
    margin-top: 0.4rem;
  }
  .numbers th,
  .numbers td {
    padding: 0.15rem 0.75rem 0.15rem 0;
    text-align: start;
    font-weight: normal;
  }
  .numbers .num {
    text-align: end;
    font-variant-numeric: tabular-nums;
  }
  .problem {
    color: var(--bad);
  }
</style>
