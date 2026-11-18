<script lang="ts">
  // The statistics of the vault, one card under the other below the filter: the headline numbers, a bar per area cut
  // up by one field (the choice of the field stands over the bars), the history of a figure (cut up by the same field
  // where the series of the engine counts it), and the numbers of the bars as a table. A card folds, opens alone in
  // a window and is printed or exported (StatsCard). A window of one card (`app.statsCard`) shows that card alone.
  // Only the tasks the filter keeps are counted; every number and every part of a bar opens its tasks in the
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
  import Info from 'appkit-ui/Info.svelte';
  import type { CardTable } from '../lib/statsExport';
  import { barsSvgOf } from '../lib/statsSvg';
  import FilterNote from './FilterNote.svelte';
  import StatsCard from './StatsCard.svelte';
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
  const shows = (card: 'chart' | 'history' | 'table' | 'figures'): boolean => app.statsCard === null || app.statsCard === card;
  const figuresDrawn = $derived(shows('figures') && (app.statsCard === 'figures' || !app.statsFolded.includes('figures')));
  const source = $derived(
    app.can('estimate') && figuresDrawn && tileShown(app.statsTiles, 'n:effort') ? effortSource(tasks, app.tasks) : null,
  );
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

  // What a card exports: the names of the areas that may not leave the app (their class) are not written into a file.
  const exportArea = (area: string): string => (app.areaMayLeave(area) ? nameOf(area) : t('stats.card.hidden_area'));
  function areaTable(withFinished: boolean): CardTable[] {
    const fin = withFinished ? finished : null;
    const headers = [
      t('stats.area'),
      t('stats.total'),
      ...stats.buckets.map((b) => bucketLabel(app.statsDim, b)),
      ...(fin ? [t('stats.finished30')] : []),
    ];
    const rows = stats.rows.map((row) => [
      exportArea(row.area),
      String(row.total),
      ...stats.buckets.map((b) => String(row.counts[b] ?? 0)),
      ...(fin ? [String(fin.counts[row.area] ?? 0)] : []),
    ]);
    rows.push([
      t('stats.all_areas'),
      String(stats.total),
      ...stats.buckets.map((b) => String(stats.totals[b] ?? 0)),
      ...(fin ? [String(fin.total)] : []),
    ]);
    return [{ title: t('stats.card.by', { field: t(`stats.dim.${app.statsDim}` as Key) }), headers, rows }];
  }
  let chartEl: HTMLElement | undefined = $state();
  let chartCard: HTMLElement | undefined = $state();
  let figuresCard: HTMLElement | undefined = $state();
  const backgroundOf = (el: HTMLElement | undefined): string => (el ? getComputedStyle(el).backgroundColor : 'transparent');
  function chartSvg(): string | null {
    return chartEl ? barsSvgOf(chartEl, backgroundOf(chartCard), t('stats.chart')) : null;
  }
  /** The headline numbers and the tiles of the fields as they are shown. */
  function figuresTables(): CardTable[] {
    const root = figuresCard;
    if (!root) return [];
    const text = (el: Element | null): string => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const numbers = [...root.querySelectorAll('.figures .figure')].map((el) => [
      text(el.querySelector('.label')),
      [...el.querySelectorAll('.n, .sub')].map(text).join(' · '),
    ]);
    const spreads = [...root.querySelectorAll('.spreads .spread')].flatMap((tile) =>
      [...tile.querySelectorAll('.value')].map((v) => [
        text(tile.querySelector(':scope > .label')),
        text(v.querySelector('.name')),
        text(v.querySelector('.count')),
      ]),
    );
    return [
      { title: t('stats.figures'), headers: [t('stats.card.figure'), t('stats.card.number')], rows: numbers },
      ...(spreads.length > 0
        ? [{ title: t('stats.card.fields'), headers: [t('stats.card.field'), t('stats.card.value'), t('stats.card.number')], rows: spreads }]
        : []),
    ];
  }
</script>

<div class="stats">
  {#if app.statsCard === null}
    <StatsFilter {app} />
  {:else}
    <!-- A window of one card: what the filter keeps is named, the whole statistics are one press away. -->
    <div class="alone">
      <FilterNote {app} />
      <button type="button" class="linkish" data-hint={t('hint.stats.card.all')} onclick={() => app.showAllStats()}
        >{t('stats.card.all')}</button
      >
    </div>
  {/if}

  {#if shows('figures')}
    <StatsCard {app} card="figures" title={t('stats.figures')} tables={figuresTables} bind:section={figuresCard}>
      {#snippet head()}
        <Info hint={t('hint.stats')} label={t('hint.about', { what: t('nav.stats') })} />
      {/snippet}
      <StatsTiles {app} {tasks} {figures} {finished} {effort} onfinished={openFinished} />
    </StatsCard>
  {/if}

  {#if shows('chart')}
    <StatsCard {app} card="chart" title={t('stats.chart')} tables={() => areaTable(false)} svg={chartSvg} bind:section={chartCard}>
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
      {#if legend.rows.length === 0}
        <p class="muted" role="status">{t('stats.empty')}</p>
      {:else}
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
        <!-- The bars repeat the table "The numbers per area" for the eye; their buttons are for the pointer and out of
             the tab order. -->
        <div class="chart dim-{app.statsDim}" aria-hidden="true" bind:this={chartEl}>
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
      {/if}
    </StatsCard>
  {/if}

  {#if shows('history')}
    <StatsHistory {app} classOf={bucketClass} />
  {/if}

  {#if shows('table') && legend.rows.length > 0}
    <StatsCard {app} card="table" title={t('stats.table')} tables={() => areaTable(true)}>
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
    </StatsCard>
  {/if}
</div>

<style>
  .stats {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .alone {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 1rem;
  }
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
    margin-bottom: 0.4rem;
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
    /* Every coloured part paints with the colour its value gives it: a box its ground, a band of the history its fill
       and a line its stroke. */
    .seg,
    .swatch {
      background: var(--seg, var(--muted));
    }
    .layer {
      fill: var(--seg, var(--muted));
      stroke: none;
    }
    .layer-line {
      fill: none;
      stroke: var(--seg, var(--muted));
    }
    /* The colours of the stacks: each comes from a token, a shade by mixing it with the surface. A value without a
       meaning of its own takes a series of the palette (--chart-*); a meaning colour (--ok, --warn, --bad) is kept for
       what is good, waits for a decision or is in trouble, so it does not stand for a mere kind (the accent of the app
       can be close to one of them in hue). The legend names every value. */
    .none {
      --seg: var(--line);
    }
    .other {
      --seg: var(--muted);
    }
    .dim-status .v-doing {
      --seg: var(--chart-1);
    }
    .dim-status .v-open {
      --seg: var(--chart-2);
    }
    .dim-status .v-decision {
      --seg: var(--warn);
    }
    .dim-status .v-blocked {
      --seg: var(--bad);
    }
    .dim-status .v-parked {
      --seg: var(--muted);
    }
    .dim-effort .v-XS {
      --seg: color-mix(in srgb, var(--accent) 30%, var(--surface));
    }
    .dim-effort .v-S {
      --seg: color-mix(in srgb, var(--accent) 50%, var(--surface));
    }
    .dim-effort .v-M {
      --seg: color-mix(in srgb, var(--accent) 70%, var(--surface));
    }
    .dim-effort .v-L {
      --seg: color-mix(in srgb, var(--accent) 85%, var(--text));
    }
    .dim-effort .v-XL {
      --seg: color-mix(in srgb, var(--accent) 60%, var(--text));
    }
    .dim-effort .v-days {
      --seg: var(--warn);
    }
    .dim-kind .v-feature {
      --seg: var(--chart-1);
    }
    .dim-kind .v-task {
      --seg: var(--chart-2);
    }
    .dim-kind .v-bug {
      --seg: var(--bad);
    }
    .dim-kind .v-idea {
      --seg: var(--chart-3);
    }
    .dim-kind .v-research {
      --seg: var(--chart-4);
    }
    .dim-prio .v-1 {
      --seg: color-mix(in srgb, var(--accent) 60%, var(--text));
    }
    .dim-prio .v-2 {
      --seg: var(--accent);
    }
    .dim-prio .v-3 {
      --seg: color-mix(in srgb, var(--accent) 60%, var(--surface));
    }
    .dim-prio .v-4 {
      --seg: color-mix(in srgb, var(--accent) 30%, var(--surface));
    }
    .dim-state .v-ready {
      --seg: var(--ok);
    }
    .dim-state .v-decision {
      --seg: var(--warn);
    }
    .dim-state .v-waiting {
      --seg: var(--chart-2);
    }
    .dim-state .v-stuck {
      --seg: var(--bad);
    }
    .dim-state .v-freed {
      --seg: color-mix(in srgb, var(--ok) 50%, var(--surface));
    }
    .dim-state .v-parked,
    .dim-state .v-unknown {
      --seg: var(--muted);
    }
    .dim-actor .v-me {
      --seg: var(--chart-1);
    }
    .dim-actor .v-pair {
      --seg: var(--chart-3);
    }
    .dim-actor .v-cdx {
      --seg: var(--chart-2);
    }
    .dim-value .v-5 {
      --seg: color-mix(in srgb, var(--accent) 60%, var(--text));
    }
    .dim-value .v-4 {
      --seg: var(--accent);
    }
    .dim-value .v-3 {
      --seg: color-mix(in srgb, var(--accent) 70%, var(--surface));
    }
    .dim-value .v-2 {
      --seg: color-mix(in srgb, var(--accent) 50%, var(--surface));
    }
    .dim-value .v-1 {
      --seg: color-mix(in srgb, var(--accent) 30%, var(--surface));
    }
    .dim-severity .v-critical {
      --seg: var(--bad);
    }
    .dim-severity .v-high {
      --seg: color-mix(in srgb, var(--bad) 55%, var(--warn));
    }
    .dim-severity .v-medium {
      --seg: var(--warn);
    }
    .dim-severity .v-low {
      --seg: var(--chart-2);
    }
    /* The values of a field the tasks name freely (category, scope, tag, plan, phase, project) have no meaning the page
       knows: the most frequent take the series of the palette in their order, the next four the same hues mixed with
       the surface. */
    .s-0 {
      --seg: var(--chart-1);
    }
    .s-1 {
      --seg: var(--chart-2);
    }
    .s-2 {
      --seg: var(--chart-3);
    }
    .s-3 {
      --seg: var(--chart-4);
    }
    .s-4 {
      --seg: var(--chart-5);
    }
    .s-5 {
      --seg: var(--chart-6);
    }
    .s-6 {
      --seg: color-mix(in srgb, var(--chart-1) 50%, var(--surface));
    }
    .s-7 {
      --seg: color-mix(in srgb, var(--chart-2) 50%, var(--surface));
    }
    .s-8 {
      --seg: color-mix(in srgb, var(--chart-3) 50%, var(--surface));
    }
    .s-9 {
      --seg: color-mix(in srgb, var(--chart-4) 50%, var(--surface));
    }
  }
</style>
