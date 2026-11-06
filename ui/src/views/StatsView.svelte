<script lang="ts">
  // The statistics of the vault: the headline numbers, a bar per area cut up by one field, and the same numbers as a
  // table. Only the tasks the filter keeps are counted; every number and every part of a bar opens its tasks in the
  // list, an entry of the legend narrows the filter and stays here. The counting is `lib/stats.ts`; the bars are drawn for the eye and the table is what the keyboard and a
  // screen reader take (the bars repeat its buttons, out of the tab order).
  import type { App } from '../lib/app.svelte';
  import type { Estimate } from '../lib/contract';
  import { areaLabel, NONE } from '../lib/filter';
  import { rangeOf } from '../lib/finished';
  import { formatNumber, translate, type Key } from '../lib/i18n';
  import {
    chosenBuckets,
    DAYS,
    effortSource,
    figureFilter,
    figuresOf,
    filterFor,
    finishedPerArea,
    STAT_DIMS,
    STAT_SORTS,
    statsOf,
    toggledBucket,
    withoutDim,
    type Figure,
    type StatDim,
  } from '../lib/stats';
  import { markHidden } from '../lib/text';
  import Info from 'appkit-ui/Info.svelte';
  import FilterNote from './FilterNote.svelte';

  let { app }: { app: App } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  const tasks = $derived(app.shown);
  const stats = $derived(statsOf(tasks, app.statsDim, app.statsSort, (area) => nameOf(area)));
  const figures = $derived(figuresOf(tasks, app.quickWinSet));
  // The legend counts as if the field it cuts by had no choice: the values not chosen stay there, to be added.
  const legendTasks = $derived(app.tasksKeptBy(withoutDim(app.filter, app.statsDim)));
  const legend = $derived(statsOf(legendTasks, app.statsDim, app.statsSort, (area) => nameOf(area)));
  const chosen = $derived(chosenBuckets(app.filter, app.statsDim));
  const widest = $derived(Math.max(1, ...stats.rows.map((r) => r.total)));

  const FIGURE_KEYS: Record<Figure, Key> = {
    open: 'stats.open',
    ready: 'stats.ready',
    doing: 'stats.doing',
    blocked: 'stats.blocked',
    quickWins: 'stats.quick_wins',
    noEffort: 'stats.no_effort',
  };
  const figureList = $derived(
    (Object.keys(FIGURE_KEYS) as Figure[]).flatMap((f) => {
      const n = figures[f];
      return n === undefined ? [] : [{ figure: f, label: t(FIGURE_KEYS[f]), n }];
    }),
  );

  /** The word of a stack: a status and a readiness in the page's words, "none" and "in days", else the value. */
  function bucketLabel(dim: StatDim, bucket: string): string {
    if (bucket === NONE) return t('stats.none');
    if (dim === 'effort' && bucket === DAYS) return t('stats.days');
    if (dim === 'status' || dim === 'state') {
      // a value this page has no word for shows as it is
      const key = `${dim}.${bucket}` as Key;
      const word = t(key);
      return word === key ? bucket : word;
    }
    if (dim === 'prio') return `P${bucket}`;
    return bucket;
  }
  /** The class that colours a stack (a value the page does not know is "other"). */
  function bucketClass(bucket: string): string {
    if (bucket === NONE) return 'none';
    return /^[A-Za-z0-9]+$/.test(bucket) ? `v-${bucket}` : 'other';
  }
  const nameOf = (area: string) => areaLabel(area, app.allAreaNames);

  // The effort of the tasks the filter keeps is the engine's figure (WEB-13): asked again when they or the vault change.
  const source = $derived(app.can('estimate') ? effortSource(tasks, app.tasks) : null);
  const askKey = $derived(source?.from === 'engine' ? `${app.snapshot?.rev ?? ''}|${source.ids.join(',')}` : '');
  let asked = $state.raw<{ key: string; figure: Estimate } | null>(null);
  $effect(() => {
    const key = askKey;
    if (key === '' || source?.from !== 'engine') return;
    const abort = new AbortController();
    app.estimateOf(source.ids, abort.signal).then(
      (figure) => {
        if (!abort.signal.aborted) asked = { key, figure };
      },
      () => {
        // No figure: the number is left out, the rest of the view stands.
      },
    );
    return () => abort.abort();
  });
  const effort = $derived.by((): { days: number; low?: number; high?: number; without: number } | null => {
    if (source?.from === 'snapshot') {
      const all = app.snapshot?.estimate;
      return all ? { days: all.days, without: all.n_without_effort } : null;
    }
    if (source?.from !== 'engine' || asked?.key !== askKey) return null;
    const f = asked.figure;
    return { days: f.days, low: f.range.low, high: f.range.high, without: f.n_without_effort };
  });
  // What was finished in the last 30 days comes from the engine too: a question of its own, asked again when the vault
  // changes. No answer: the number and the column stay away, the rest of the view stands.
  const period = $derived(rangeOf('30', app.today, { from: '', to: '' }));
  let finishedDoc = $state.raw<{ area: string; count: number }[] | null>(null);
  $effect(() => {
    if (!app.can('finished')) return;
    void app.snapshot?.rev;
    const abort = new AbortController();
    app.finished({ ...period, limit: 1 }, abort.signal).then(
      (doc) => {
        if (!abort.signal.aborted) finishedDoc = doc.stats.by_area;
      },
      () => {
        if (!abort.signal.aborted) finishedDoc = null;
      },
    );
    return () => abort.abort();
  });
  const finished = $derived(finishedDoc ? finishedPerArea(finishedDoc, app.matchAreas) : null);
  function openFinished(): void {
    app.setFinishedPrefs({ ...app.finishedPrefs, preset: '30' });
    app.finishedStartArea = app.finishedArea;
    app.setView('done');
  }
  const days = (n: number) => formatNumber(app.lang, Math.round(n * 10) / 10);

  function open(bucket: string | null, area: string | null): void {
    app.openStatsInList(filterFor(app.filter, app.statsDim, bucket, area, tasks));
  }
</script>

<div class="stats">
  <FilterNote {app} />
  <section class="card head" aria-labelledby="stats-figures">
    <div class="headline">
      <h2 id="stats-figures" class="eyebrow">{t('stats.figures')}</h2>
      <Info hint={t('hint.stats')} label={t('hint.about', { what: t('nav.stats') })} />
    </div>
    <ul class="figures">
      {#each figureList as f (f.figure)}
        <li>
          {#if figureFilter(app.filter, f.figure, figures)}
            <button
              type="button"
              class="figure"
              data-figure={f.figure}
              aria-label={t('stats.open_figure', { label: f.label, n: f.n })}
              onclick={() => {
                const filter = figureFilter(app.filter, f.figure, figures);
                if (filter) app.openStatsInList(filter);
              }}
            >
              <span class="label">{f.label}</span>
              <span class="n">{f.n}</span>
            </button>
          {:else}
            <!-- A number of none opens nothing. -->
            <div class="figure" data-figure={f.figure}>
              <span class="label">{f.label}</span>
              <span class="n">{f.n}</span>
            </div>
          {/if}
        </li>
      {/each}
      {#if finished}
        <li>
          <button
            type="button"
            class="figure"
            data-figure="finished"
            aria-label={t('stats.open_finished', { n: finished.total })}
            onclick={openFinished}
          >
            <span class="label">{t('stats.finished30')}</span>
            <span class="n">{finished.total}</span>
          </button>
        </li>
      {/if}
      {#if effort}
        <li>
          <div class="figure" data-figure="effort" data-hint={t('hint.stats.effort')}>
            <span class="label">{t('stats.effort')}</span>
            <span class="n">{t('stats.days_n', { n: days(effort.days) })}</span>
            {#if effort.low !== undefined && effort.high !== undefined}
              <span class="sub">{t('stats.range', { low: days(effort.low), high: days(effort.high) })}</span>
            {/if}
            {#if effort.without > 0}
              <span class="sub">{t('stats.without', { n: effort.without })}</span>
            {/if}
          </div>
        </li>
      {/if}
    </ul>
    <div class="bar">
      <div class="dims" role="group" aria-label={t('stats.by')}>
        <span class="muted">{t('stats.by')}</span>
        {#each STAT_DIMS as dim (dim)}
          <button
            type="button"
            class="dim"
            aria-pressed={app.statsDim === dim}
            onclick={() => app.setStats(dim, app.statsSort)}>{t(`stats.dim.${dim}` as Key)}</button
          >
        {/each}
      </div>
      <label class="sort">
        <span class="muted">{t('stats.sort')}</span>
        <select
          value={app.statsSort}
          onchange={(e) => app.setStats(app.statsDim, e.currentTarget.value as (typeof STAT_SORTS)[number])}
        >
          {#each STAT_SORTS as sort (sort)}
            <option value={sort}>{t(`stats.sort.${sort}` as Key)}</option>
          {/each}
        </select>
      </label>
    </div>
  </section>

  {#if legend.rows.length === 0}
    <p class="muted" role="status">{t('stats.empty')}</p>
  {:else}
    <section class="card" aria-labelledby="stats-chart">
      <h3 id="stats-chart" class="eyebrow">{t('stats.chart')}</h3>
      <ul class="legend dim-{app.statsDim}" class:narrowed={chosen.size > 0}>
        {#each legend.buckets as bucket (bucket)}
          <li>
            <button
              type="button"
              class="entry"
              data-bucket={bucket === NONE ? 'none' : bucket}
              aria-pressed={chosen.has(bucket)}
              aria-label={t('stats.legend_entry', { bucket: bucketLabel(app.statsDim, bucket), n: legend.totals[bucket] ?? 0 })}
              onclick={() => app.narrowStats(toggledBucket(app.filter, app.statsDim, bucket, legendTasks))}
            >
              <span class="swatch {bucketClass(bucket)}" aria-hidden="true"></span>{bucketLabel(app.statsDim, bucket)}
              <span class="muted">{legend.totals[bucket]}</span>
            </button>
          </li>
        {/each}
      </ul>
      <!-- The bars repeat the table below for the eye; their buttons are for the pointer and out of the tab order. -->
      <div class="chart dim-{app.statsDim}" aria-hidden="true">
        {#each stats.rows as row (row.area)}
          <button type="button" class="area" tabindex="-1" title={row.area} onclick={() => open(null, row.area)}
            >{markHidden(nameOf(row.area))}</button
          >
          <div class="track">
            <div class="stack" style:width="{(row.total / widest) * 100}%">
              {#each stats.buckets as bucket (bucket)}
                {#if row.counts[bucket]}
                  <button
                    type="button"
                    tabindex="-1"
                    class="seg {bucketClass(bucket)}"
                    data-bucket={bucket === NONE ? 'none' : bucket}
                    style:flex-grow={row.counts[bucket]}
                    title="{bucketLabel(app.statsDim, bucket)}: {row.counts[bucket]}"
                    onclick={() => open(bucket, row.area)}
                  ></button>
                {/if}
              {/each}
            </div>
          </div>
          <span class="total">{row.total}</span>
        {/each}
      </div>
    </section>

    <section class="card" aria-labelledby="stats-table">
      <h3 id="stats-table" class="eyebrow">{t('stats.table')}</h3>
      <!-- A wide table scrolls in its own box, which the keyboard can reach. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="scroll" tabindex="0">
        <table aria-labelledby="stats-table">
          <thead>
            <tr>
              <th scope="col">{t('stats.area')}</th>
              <th scope="col" class="num">{t('stats.total')}</th>
              {#each stats.buckets as bucket (bucket)}
                <th scope="col" class="num">{bucketLabel(app.statsDim, bucket)}</th>
              {/each}
              {#if finished}<th scope="col" class="num" data-col="finished">{t('stats.finished30')}</th>{/if}
            </tr>
          </thead>
          <tbody>
            {#each stats.rows as row (row.area)}
              <tr>
                <th scope="row">{markHidden(nameOf(row.area))}</th>
                <td class="num">
                  <button
                    type="button"
                    class="link"
                    aria-label={t('stats.open_area', { area: nameOf(row.area), n: row.total })}
                    onclick={() => open(null, row.area)}>{row.total}</button
                  >
                </td>
                {#each stats.buckets as bucket (bucket)}
                  <td class="num">
                    {#if row.counts[bucket]}
                      <button
                        type="button"
                        class="link"
                        aria-label={t('stats.open_cell', {
                          area: nameOf(row.area),
                          bucket: bucketLabel(app.statsDim, bucket),
                          n: row.counts[bucket] ?? 0,
                        })}
                        onclick={() => open(bucket, row.area)}>{row.counts[bucket]}</button
                      >
                    {:else}
                      <span class="muted">0</span>
                    {/if}
                  </td>
                {/each}
                {#if finished}<td class="num" data-col="finished">{finished.counts[row.area] ?? 0}</td>{/if}
              </tr>
            {/each}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{t('stats.all_areas')}</th>
              <td class="num">{stats.total}</td>
              {#each stats.buckets as bucket (bucket)}
                <td class="num">
                  <button
                    type="button"
                    class="link"
                    aria-label={t('stats.open_bucket', {
                      bucket: bucketLabel(app.statsDim, bucket),
                      n: stats.totals[bucket] ?? 0,
                    })}
                    onclick={() => open(bucket, null)}>{stats.totals[bucket]}</button
                  >
                </td>
              {/each}
              {#if finished}<td class="num" data-col="finished">{finished.total}</td>{/if}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  {/if}
</div>

<style>
  .stats {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.9rem 1rem;
  }
  .headline {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .eyebrow {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    margin: 0;
  }
  .link {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    cursor: pointer;
    font-variant-numeric: tabular-nums;
  }
  .link:hover {
    text-decoration: underline;
  }
  .figures {
    list-style: none;
    margin: 0.6rem 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
    gap: 0.6rem;
  }
  .figure {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.2rem;
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-2);
    color: var(--text);
    cursor: pointer;
  }
  div.figure {
    cursor: default;
  }
  button.figure:hover {
    border-color: var(--accent);
  }
  .figure .label {
    color: var(--muted);
  }
  .figure .sub {
    color: var(--muted);
    font-size: 0.85em;
  }
  .figure .n {
    font-size: 1.6em;
    font-variant-numeric: tabular-nums;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
  }
  .dims {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
  }
  .dim {
    padding: 0.15rem 0.6rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-2);
    color: var(--text);
    cursor: pointer;
  }
  .dim[aria-pressed='true'] {
    border-color: var(--accent);
    font-weight: 600;
  }
  .sort {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .legend {
    list-style: none;
    margin: 0.4rem 0 0.8rem;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 1rem;
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
    cursor: pointer;
  }
  .entry:hover {
    border-color: var(--line);
  }
  .entry[aria-pressed='true'] {
    border-color: var(--accent);
    font-weight: 600;
  }
  /* Only the colour is dimmed: the name and the number keep their contrast. */
  .narrowed .entry[aria-pressed='false'] .swatch {
    opacity: 0.35;
  }
  .swatch {
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 2px;
  }
  .chart {
    display: grid;
    grid-template-columns: minmax(6rem, max-content) minmax(0, 1fr) 2.5rem;
    align-items: center;
    gap: 0.3rem 0.6rem;
  }
  .area {
    border: 0;
    padding: 0;
    background: none;
    color: var(--text);
    text-align: right;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 16rem;
  }
  .area:hover {
    color: var(--accent-text);
    text-decoration: underline;
  }
  .track {
    min-width: 0;
  }
  .stack {
    display: flex;
    gap: 2px;
    height: 1.2rem;
    min-width: 4px;
  }
  .seg {
    flex-basis: 0;
    min-width: 3px;
    border: 0;
    padding: 0;
    cursor: pointer;
  }
  .seg:first-child {
    border-radius: 3px 0 0 3px;
  }
  .seg:last-child {
    border-radius: 0 3px 3px 0;
  }
  .seg:only-child {
    border-radius: 3px;
  }
  .seg:hover {
    outline: 2px solid var(--text);
    outline-offset: 1px;
  }
  .total {
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }
  .scroll {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th,
  td {
    padding: 0.25rem 0.6rem;
    border-bottom: 1px solid var(--line);
    text-align: left;
    white-space: nowrap;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  tfoot th,
  tfoot td {
    border-bottom: 0;
    border-top: 2px solid var(--line);
  }

  /* The colours of the stacks: each comes from a token, a shade by mixing it with the surface. A value without a
     meaning of its own takes a series of the palette (--chart-*); a meaning colour (--ok, --warn, --bad) is kept for
     what is good, waits for a decision or is in trouble, so it does not stand for a mere kind (the accent of the app
     can be close to one of them in hue). The legend names every value. */
  .none {
    background: var(--line);
  }
  .other {
    background: var(--muted);
  }
  .dim-status .v-doing {
    background: var(--chart-1);
  }
  .dim-status .v-open {
    background: var(--chart-2);
  }
  .dim-status .v-decision {
    background: var(--warn);
  }
  .dim-status .v-blocked {
    background: var(--bad);
  }
  .dim-status .v-parked {
    background: var(--muted);
  }
  .dim-effort .v-XS {
    background: color-mix(in srgb, var(--accent) 30%, var(--surface));
  }
  .dim-effort .v-S {
    background: color-mix(in srgb, var(--accent) 50%, var(--surface));
  }
  .dim-effort .v-M {
    background: color-mix(in srgb, var(--accent) 70%, var(--surface));
  }
  .dim-effort .v-L {
    background: color-mix(in srgb, var(--accent) 85%, var(--text));
  }
  .dim-effort .v-XL {
    background: color-mix(in srgb, var(--accent) 60%, var(--text));
  }
  .dim-effort .v-days {
    background: var(--warn);
  }
  .dim-kind .v-feature {
    background: var(--chart-1);
  }
  .dim-kind .v-task {
    background: var(--chart-2);
  }
  .dim-kind .v-bug {
    background: var(--bad);
  }
  .dim-kind .v-idea {
    background: var(--chart-3);
  }
  .dim-kind .v-research {
    background: var(--chart-4);
  }
  .dim-prio .v-1 {
    background: color-mix(in srgb, var(--accent) 60%, var(--text));
  }
  .dim-prio .v-2 {
    background: var(--accent);
  }
  .dim-prio .v-3 {
    background: color-mix(in srgb, var(--accent) 60%, var(--surface));
  }
  .dim-prio .v-4 {
    background: color-mix(in srgb, var(--accent) 30%, var(--surface));
  }
  .dim-state .v-ready {
    background: var(--ok);
  }
  .dim-state .v-decision {
    background: var(--warn);
  }
  .dim-state .v-waiting {
    background: var(--chart-2);
  }
  .dim-state .v-stuck {
    background: var(--bad);
  }
  .dim-state .v-freed {
    background: color-mix(in srgb, var(--ok) 50%, var(--surface));
  }
  .dim-state .v-parked,
  .dim-state .v-unknown {
    background: var(--muted);
  }
</style>
