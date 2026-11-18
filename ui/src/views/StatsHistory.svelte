<script lang="ts">
  // The history of one figure of the overview: a line over a period the person chooses. The series is the engine's
  // (`tasks.history`: it writes the figures down per day and area); the page asks for the window and draws it. Reached
  // from the statistics, and from a number of the overview, which opens it with its figure chosen. It follows the field
  // of "Cut up by": where the series counts the open tasks per value of that field (status, readiness), the open tasks
  // are drawn as bands stacked per value, in the colours of the bars; a value is taken out and back by its entry in
  // the legend. The numbers behind the drawing are a table for a screen reader only (and the export of the card).
  import { tick, untrack } from 'svelte';
  import type { App } from '../lib/app.svelte';
  import type { History } from '../lib/contract';
  import { translate, type Key } from '../lib/i18n';
  import { bucketsOf } from '../lib/stats';
  import type { CardTable } from '../lib/statsExport';
  import {
    askFor,
    AREAS_MAX,
    changeOf,
    chartOf,
    emptyReason,
    HISTORY_METRICS,
    HISTORY_PERIODS,
    isSplitDim,
    seriesOf,
    splitOf,
    splitSeriesOf,
    stackChartOf,
    sumHistories,
    windowOf,
    type HistoryMetric,
    type HistoryPeriod,
    type SeriesPoint,
  } from '../lib/statsHistory';
  import { svgFileOf } from '../lib/statsSvg';
  import { bucketLabel, bucketName } from '../lib/statsWords';
  import Info from 'appkit-ui/Info.svelte';
  import StatsCard from './StatsCard.svelte';

  let {
    app,
    classOf = (bucket: string) => (bucketsOf(app.statsDim).includes(bucket) ? `v-${bucket}` : 'other'),
  }: {
    app: App;
    /** The class that colours a value of the field of "Cut up by" (the bars' and the legend's); by default its own. */
    classOf?: (bucket: string) => string;
  } = $props();
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

  const dim = $derived(app.statsDim);
  const fieldName = $derived(t(`stats.dim.${dim}` as Key));
  const split = $derived(splitOf(dim, prefs.metric));
  /** The values taken out of the drawing by their entry in the legend; forgotten when the field changes. */
  let hidden = $state.raw<ReadonlySet<string>>(new Set());
  $effect(() => {
    void dim;
    hidden = new Set();
  });
  const parts = $derived(doc && split === 'split' && isSplitDim(dim) ? splitSeriesOf(doc, dim, bucketsOf(dim)) : null);

  // One line: the figure; split: the sum of the values shown (what the top edge of the bands stands for).
  const series = $derived.by((): SeriesPoint[] => {
    if (!doc) return [];
    if (!parts) return seriesOf(doc, prefs.metric);
    return parts.points.map((p) => ({
      day: p.day,
      recorded: p.recorded,
      value: p.values === null ? null : parts.buckets.filter((b) => !hidden.has(b)).reduce((sum, b) => sum + (p.values?.[b] ?? 0), 0),
    }));
  });
  const empty = $derived(doc ? emptyReason(doc, prefs.metric) : null);
  const change = $derived(changeOf(series));

  // the frame of the drawing, in the units of its viewBox; the margins hold the numbers and the days
  const W = 720;
  const H = 200;
  const LEFT = 44;
  const TOP = 10;
  const BOTTOM = 24;
  const chart = $derived(chartOf(series, W - LEFT - 12, H - TOP - BOTTOM));
  const stack = $derived(parts ? stackChartOf(parts, hidden, W - LEFT - 12, H - TOP - BOTTOM) : null);
  const ticks = $derived(stack ? stack.ticks : chart.ticks);
  /** Where a point of the line stands: on the top edge of the bands when they are drawn (their scale starts at 0). */
  const dotY = (dot: { y: number; value: number }): number =>
    stack && stack.layers.length > 0 ? Math.round((H - TOP - BOTTOM) * (1 - dot.value / stack.max) * 10) / 10 : dot.y;
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
  const label = (bucket: string): string => bucketLabel(app.lang, dim, bucket);
  const dayHead = $derived(t(frame.resolution === 'week' ? 'stats.history.week' : 'stats.history.day'));

  /** The numbers behind the drawing, as the screen reader's table and the export have them. */
  const table = $derived.by((): CardTable => {
    const value = (n: number | null | undefined, recorded: boolean): string =>
      n === null || n === undefined ? '–' : `${shown(n)}${recorded ? '' : ` (${t('stats.history.carried')})`}`;
    if (parts) {
      const buckets = parts.buckets.filter((b) => !hidden.has(b));
      return {
        title: t('stats.history.by', { what: metricName('open'), field: fieldName }),
        headers: [dayHead, ...buckets.map(label), t('stats.total')],
        rows: parts.points.map((p, i) => [
          p.day,
          ...buckets.map((b) => (p.values === null ? '–' : shown(p.values[b] ?? 0))),
          value(series[i]?.value, p.recorded),
        ]),
      };
    }
    return { title: metricName(prefs.metric), headers: [dayHead, metricName(prefs.metric)], rows: series.map((p) => [p.day, value(p.value, p.recorded)]) };
  });
  const chartName = $derived(
    parts
      ? t('stats.history.chart_by', { what: metricName('open'), field: fieldName, since: frame.since, until: frame.until })
      : t('stats.history.chart', { what: metricName(prefs.metric), since: frame.since, until: frame.until }),
  );

  function choose(patch: Partial<typeof prefs>): void {
    app.setStatsHistory({ ...prefs, ...patch });
  }

  function toggle(bucket: string): void {
    const next = new Set(hidden);
    if (next.has(bucket)) next.delete(bucket);
    else next.add(bucket);
    hidden = next;
  }

  async function record(): Promise<void> {
    recording = true;
    const ok = await app.recordHistory();
    recording = false;
    if (ok) again += 1;
  }

  let svgEl: SVGSVGElement | undefined = $state();
  function svgFile(): string | null {
    return svgEl ? svgFileOf(svgEl, section ? getComputedStyle(section).backgroundColor : 'transparent', chartName) : null;
  }

  // opened from a number of the overview: the section comes into view (unfolded) and takes the focus
  let section: HTMLElement | undefined = $state();
  $effect(() => {
    if (app.historyShown === 0 || !section) return;
    const el = section;
    // once per opening: a later visit of the statistics by the menu or Back stays where it is
    app.historyShown = 0;
    if (app.statsFolded.includes('history')) app.setStatsCardOpen('history', true);
    void tick().then(() => {
      el.scrollIntoView({ block: 'start' });
      el.querySelector<HTMLElement>('select')?.focus();
    });
  });
</script>

{#if app.can('history')}
  <StatsCard {app} card="history" title={t('stats.history')} tables={() => (doc && !empty && !problem ? [table] : [])} svg={svgFile} bind:section>
    {#snippet head()}
      <Info hint={t('hint.stats.history')} label={t('hint.about', { what: t('stats.history') })} />
      {#if app.historyFrom}
        <button type="button" class="linkish back" data-hint={t('hint.stats.history.back')} onclick={() => app.backFromHistory()}
          >{t('stats.history.back')}</button
        >
      {/if}
    {/snippet}
    <div class="history">
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
              <button type="button" class="start" disabled={recording} data-hint={t('hint.stats.history.record')} onclick={() => void record()}
                >{t('stats.history.record')}</button
              >
            {/if}
          </div>
        {:else if empty === 'before-series'}
          <p class="empty" data-history-empty="before-series">{t('stats.history.before', { day: doc.first ?? '' })}</p>
        {:else}
          {#if split === 'metric'}
            <p class="note" data-history-split="metric">
              {t('stats.history.split_open', { field: fieldName })}
              <button type="button" class="linkish" data-hint={t('hint.stats.history.split_open')} onclick={() => choose({ metric: 'open' })}
                >{t('stats.history.split_open_do', { field: fieldName })}</button
              >
            </p>
          {:else if split === 'none'}
            <p class="note" data-history-split="none">{t('stats.history.split_none', { field: fieldName })}</p>
          {/if}
          <p class="summary" role="status">
            <strong>{parts ? t('stats.history.by', { what: metricName('open'), field: fieldName }) : metricName(prefs.metric)}</strong>
            {#if change}
              <span data-history-change
                >{t('stats.history.change', { from: shown(change.from), to: shown(change.to), delta: `${change.delta > 0 ? '+' : ''}${shown(change.delta)}` })}</span
              >
            {/if}
          </p>
          {#if parts}
            <ul class="legend dim-{dim}" aria-label={t('stats.history.legend')} data-history-legend>
              {#each parts.buckets as bucket (bucket)}
                <li>
                  <button
                    type="button"
                    class="entry"
                    data-bucket={bucketName(bucket)}
                    aria-pressed={!hidden.has(bucket)}
                    data-hint={t('hint.stats.history.legend')}
                    onclick={() => toggle(bucket)}
                    ><span class="swatch {classOf(bucket)}" aria-hidden="true"></span>{label(bucket)}</button
                  >
                </li>
              {/each}
            </ul>
          {/if}
          <svg class="chart dim-{dim}" class:stale={loading} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={chartName} bind:this={svgEl}>
            <g transform={`translate(${LEFT} ${TOP})`}>
              {#each ticks as tick (tick.value)}
                <line class="grid" x1="0" x2={W - LEFT - 12} y1={tick.y} y2={tick.y} />
                <text class="axis" x="-6" y={tick.y} text-anchor="end" dominant-baseline="middle">{shown(tick.value)}</text>
              {/each}
              {#if stack}
                {#each stack.layers as layer (layer.bucket)}
                  <path class="layer {classOf(layer.bucket)}" data-layer={bucketName(layer.bucket)} d={layer.area}>
                    <title>{label(layer.bucket)}</title>
                  </path>
                  <path class="layer-line {classOf(layer.bucket)}" d={layer.line} />
                {/each}
              {:else}
                <path class="area" d={chart.area} />
                <path class="line" d={chart.line} />
              {/if}
              {#each chart.dots as dot (dot.day)}
                {#if chart.dots.length <= 62}
                  <circle class="dot" class:carried={!dot.recorded} cx={dot.x} cy={dotY(dot)} r="3">
                    <title>{dot.day}: {shown(dot.value)}{dot.recorded ? '' : ` (${t('stats.history.carried')})`}</title>
                  </circle>
                {/if}
              {/each}
              {#each dayLabels as label (label.day)}
                <text class="axis" x={label.x} y={H - TOP - BOTTOM + 16} text-anchor={label.anchor}>{label.day}</text>
              {/each}
            </g>
          </svg>
          <!-- The numbers of the drawing, for a screen reader: not shown. -->
          <!-- A table keeps the width of its cells whatever is set on it: the box around it is what is hidden. -->
          <div class="sr-only">
            <table data-history-numbers>
              <caption>{table.title}</caption>
              <thead>
                <tr>
                  {#each table.headers as head, i (i)}
                    <th scope="col">{head}</th>
                  {/each}
                </tr>
              </thead>
              <tbody>
                {#each table.rows as row (row[0])}
                  <tr>
                    {#each row as cell, i (i)}
                      {#if i === 0}<th scope="row">{cell}</th>{:else}<td>{cell}</td>{/if}
                    {/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
        {#if doc.incomplete.length > 0}
          <p class="muted" data-history-incomplete>{t('stats.history.incomplete', { n: doc.incomplete.length })}</p>
        {/if}
      {/if}
    </div>
  </StatsCard>
{/if}

<style>
  .history {
    display: grid;
    gap: 0.5rem;
  }
  /* The colours of both buttons are the tokens': a button without them takes the browser's own, which the dark scheme
     of the page does not match (grey on grey). */
  .linkish {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }
  .linkish:hover {
    text-decoration: underline;
  }
  .back {
    margin-inline-start: 0.5rem;
  }
  .start {
    padding: 0.35rem 0.75rem;
    border: 1px solid var(--accent);
    border-radius: 0.4rem;
    background: var(--accent);
    color: var(--accent-text);
    font: inherit;
    cursor: pointer;
  }
  .start:hover {
    background: var(--accent-hover);
  }
  .start:disabled {
    cursor: default;
    opacity: 0.6;
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
  .note {
    margin: 0;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .legend {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 0.8rem;
  }
  .entry {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.1rem 0.4rem;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .entry:hover {
    border-color: var(--line);
  }
  /* A value taken out of the drawing: its colour is dimmed, the name keeps its contrast. */
  .entry[aria-pressed='false'] .swatch {
    opacity: 0.25;
  }
  .entry[aria-pressed='false'] {
    text-decoration: line-through;
  }
  .swatch {
    flex: none;
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 2px;
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
  .layer {
    opacity: 0.85;
  }
  .layer-line {
    stroke-width: 1.5;
    stroke-linejoin: round;
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
  .problem {
    color: var(--bad);
  }
</style>
