<script lang="ts">
  // The statistics of the vault: the headline numbers, a bar per area cut up by one field, and the same numbers as a
  // table. Only the tasks the filter keeps are counted; every number and every part of a bar opens its tasks in the
  // list, an entry of the legend narrows the filter and stays here. The counting is `lib/stats.ts`; the bars are drawn for the eye and the table is what the keyboard and a
  // screen reader take (the bars repeat its buttons, out of the tab order).
  import type { App } from '../lib/app.svelte';
  import type { Estimate } from '../lib/contract';
  import { areaLabel, NONE } from '../lib/filter';
  import { rangeOf } from '../lib/finished';
  import { translate, type Key } from '../lib/i18n';
  import {
    chosenBuckets,
    cutOf,
    effortSource,
    figuresOf,
    filterFor,
    finishedPerArea,
    isMultiDim,
    OTHER,
    STAT_DIMS,
    STAT_SORTS,
    statsOf,
    toggledBucket,
    TOP,
    withoutDim,
  } from '../lib/stats';
  import { markHidden } from '../lib/text';
  import { bucketClass as classOf, bucketLabel as labelOfBucket, bucketName, dimHint as hintOfDim } from '../lib/statsWords';
  import type { StatDim } from '../lib/stats';
  import { tileShown } from '../lib/statsTiles';
  import StatsFilter from './StatsFilter.svelte';
  import StatsHistory from './StatsHistory.svelte';
  import StatsTiles from './StatsTiles.svelte';

  let { app }: { app: App } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  const tasks = $derived(app.shown);
  // The legend counts as if the field it cuts by had no choice: the values not chosen stay there, to be added.
  const legendTasks = $derived(app.tasksKeptBy(withoutDim(app.filter, app.statsDim)));
  // One cut for the bars, the legend and a click: which values of a field with many are named is settled once, from
  // the tasks of the legend, so a choice in it does not move a value into "further".
  const cut = $derived(cutOf(legendTasks, app.statsDim, app.projectOf));
  const stats = $derived(statsOf(tasks, cut, app.statsSort, (area) => nameOf(area)));
  const figures = $derived(figuresOf(tasks, app.quickWinSet));
  const legend = $derived(statsOf(legendTasks, cut, app.statsSort, (area) => nameOf(area)));
  const chosen = $derived(chosenBuckets(app.filter, cut));
  const widest = $derived(Math.max(1, ...stats.rows.map((r) => r.total)));

  const bucketLabel = (dim: StatDim, bucket: string): string => labelOfBucket(app.lang, dim, bucket);
  const bucketClass = (bucket: string): string => classOf(cut, bucket);
  const dimHint = (dim: StatDim): string => hintOfDim(app.lang, dim);
  const nameOf = (area: string) => areaLabel(area, app.allAreaNames);

  // The effort of the tasks the filter keeps is the engine's figure (WEB-13): asked again when they or the vault change.
  // Not asked while its tile is hidden: nobody reads the answer.
  const source = $derived(app.can('estimate') && tileShown(app.statsTiles, 'n:effort') ? effortSource(tasks, app.tasks) : null);
  const askKey = $derived(source?.from === 'engine' ? `${app.snapshot?.rev ?? ''}|${source.ids.join(',')}` : '');
  let asked = $state.raw<{ key: string; figure: Estimate } | null>(null);
  // The first figure is asked at once. A change of the tasks waits a moment before it asks: the search of the filter
  // bar changes them with every letter, and every question is one to the engine (stopping the request does not stop
  // the engine).
  const ASK_AFTER_MS = 300;
  let askedOnce = false;
  $effect(() => {
    const key = askKey;
    if (key === '' || source?.from !== 'engine') return;
    const ids = source.ids;
    const abort = new AbortController();
    const ask = (): void => {
      askedOnce = true;
      app.estimateOf(ids, abort.signal).then(
        (figure) => {
          if (!abort.signal.aborted) asked = { key, figure };
        },
        () => {
          // No figure: the number is left out, the rest of the view stands.
        },
      );
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (askedOnce) timer = setTimeout(ask, ASK_AFTER_MS);
    else ask();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      abort.abort();
    };
  });
  // Until the answer for the tasks of now is in, the figure of the tasks before stays (marked as waiting): a tile that
  // went and came with every letter typed would make the others jump.
  const effort = $derived.by((): { days: number; low?: number; high?: number; without: number; waiting?: boolean } | null => {
    if (source?.from === 'snapshot') {
      const all = app.snapshot?.estimate;
      return all ? { days: all.days, without: all.n_without_effort } : null;
    }
    if (source?.from !== 'engine' || asked === null) return null;
    const f = asked.figure;
    return { days: f.days, low: f.range.low, high: f.range.high, without: f.n_without_effort, waiting: asked.key !== askKey };
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
  function open(bucket: string | null, area: string | null): void {
    app.openStatsInList(filterFor(app.filter, cut, bucket, area, tasks));
  }
</script>

<div class="stats">
  <StatsFilter {app} />
  <section class="card head" aria-labelledby="stats-figures">
    <StatsTiles {app} {tasks} {figures} {finished} {effort} onfinished={openFinished} />
    <div class="bar">
      <div class="dims" role="group" aria-label={t('stats.by')}>
        <span class="muted">{t('stats.by')}</span>
        {#each STAT_DIMS as dim (dim)}
          <button
            type="button"
            class="dim"
            aria-pressed={app.statsDim === dim}
            data-dim={dim}
            data-hint={dimHint(dim)}
            onclick={() => app.setStats(dim, app.statsSort)}>{t(`stats.dim.${dim}` as Key)}</button
          >
        {/each}
      </div>
      <label class="sort" data-hint={t('hint.form.stats.sort')}>
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

  <StatsHistory {app} />

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
              data-bucket={bucketName(bucket)}
              aria-pressed={chosen.has(bucket)}
              aria-label={t('stats.legend_entry', { bucket: bucketLabel(app.statsDim, bucket), n: legend.totals[bucket] ?? 0 })}
              onclick={() => app.narrowStats(toggledBucket(app.filter, cut, bucket, legendTasks))}
            >
              <span class="swatch {bucketClass(bucket)}" aria-hidden="true"></span>{bucketLabel(app.statsDim, bucket)}
              <span class="muted">{legend.totals[bucket]}</span>
            </button>
          </li>
        {/each}
      </ul>
      {#if isMultiDim(app.statsDim)}
        <p class="note" data-note="multi">{t('stats.multi_note', { n: stats.total })}</p>
      {/if}
      {#if legend.totals[OTHER]}
        <p class="note" data-note="other">{t('stats.other_note', { n: TOP })}</p>
      {/if}
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
                    data-bucket={bucketName(bucket)}
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
  .note {
    margin: -0.4rem 0 0.8rem;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .swatch {
    flex: none;
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
  /* The row under the pointer, or the one a cell of which has the focus, stands out: across many columns the eye
     keeps its line. The head and the sums stay as they are. */
  tbody tr:hover,
  tbody tr:focus-within {
    background: var(--surface-2);
  }
  tfoot th,
  tfoot td {
    border-bottom: 0;
    border-top: 2px solid var(--line);
  }

  /* Global under the view: the tiles of the fields (StatsTiles) colour their stacks by the same classes. */
  .stats :global {
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
    .dim-actor .v-me {
      background: var(--chart-1);
    }
    .dim-actor .v-pair {
      background: var(--chart-3);
    }
    .dim-actor .v-cdx {
      background: var(--chart-2);
    }
    .dim-value .v-5 {
      background: color-mix(in srgb, var(--accent) 60%, var(--text));
    }
    .dim-value .v-4 {
      background: var(--accent);
    }
    .dim-value .v-3 {
      background: color-mix(in srgb, var(--accent) 70%, var(--surface));
    }
    .dim-value .v-2 {
      background: color-mix(in srgb, var(--accent) 50%, var(--surface));
    }
    .dim-value .v-1 {
      background: color-mix(in srgb, var(--accent) 30%, var(--surface));
    }
    .dim-severity .v-critical {
      background: var(--bad);
    }
    .dim-severity .v-high {
      background: color-mix(in srgb, var(--bad) 55%, var(--warn));
    }
    .dim-severity .v-medium {
      background: var(--warn);
    }
    .dim-severity .v-low {
      background: var(--chart-2);
    }
    /* The values of a field the tasks name freely (category, scope, tag, plan, phase, project) have no meaning the page
       knows: the most frequent take the series of the palette in their order, the next four the same hues mixed with
       the surface. */
    .s-0 {
      background: var(--chart-1);
    }
    .s-1 {
      background: var(--chart-2);
    }
    .s-2 {
      background: var(--chart-3);
    }
    .s-3 {
      background: var(--chart-4);
    }
    .s-4 {
      background: var(--chart-5);
    }
    .s-5 {
      background: var(--chart-6);
    }
    .s-6 {
      background: color-mix(in srgb, var(--chart-1) 50%, var(--surface));
    }
    .s-7 {
      background: color-mix(in srgb, var(--chart-2) 50%, var(--surface));
    }
    .s-8 {
      background: color-mix(in srgb, var(--chart-3) 50%, var(--surface));
    }
    .s-9 {
      background: color-mix(in srgb, var(--chart-4) 50%, var(--surface));
    }
  }
</style>
