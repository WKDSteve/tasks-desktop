<script lang="ts">
  // Bars of the learning series (concept "Reiter Lernpläne" 3 and 6): a bar per day, week or month of the points
  // learned (--chart-1), with the points seen stacked on top (--chart-2, hatched) where asked, and the running sum as a
  // line (--chart-3, dashed). The drawing is a picture only; the same figures are a table, read by a screen reader
  // always and shown instead of the drawing with "As table". A bar of days not begun or before the series draws
  // nothing and says so in the table; a bar from the finished tasks alone (before the series) is outlined and marked
  // "incomplete". Text only from the page's words and numbers.
  import type { App } from '../lib/app.svelte';
  import type { Key } from '../lib/i18n';
  import { learnOverviewTexts as texts, type LearnOverviewKey } from '../lib/learnOverviewTexts';
  import { isoWeek, type Bar, type Bucket } from '../lib/learnPeriod';

  let {
    app,
    id,
    bars,
    bucket,
    caption,
    game,
    seen = false,
    line = null,
    lineLabel = '',
    short = false,
  }: {
    app: App;
    /** Unique on the page: names the table and the switch. */
    id: string;
    bars: readonly Bar[];
    bucket: Bucket;
    caption: string;
    /** Gamification on: the table has the XP. */
    game: boolean;
    /** Stack the points seen on the points learned. */
    seen?: boolean;
    /** A running sum per bar, drawn as a line (null: no point there). */
    line?: readonly (number | null)[] | null;
    lineLabel?: string;
    /** Weekday names for the bars of days (a week), else the day of the month. */
    short?: boolean;
  } = $props();
  const t = (key: LearnOverviewKey | Key, params: Record<string, string | number> = {}) => texts.t(app.lang, key, params);

  let asTable = $state(false);

  const locale = $derived(app.lang === 'de' ? 'de-DE' : 'en-GB');
  const weekday = $derived(new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }));
  const monthShort = $derived(new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }));
  const longDay = $derived(new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }));
  const monthLong = $derived(new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }));
  const number = $derived(new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }));
  const at = (day: string): Date => new Date(`${day}T12:00:00Z`);

  /** The word under a bar. */
  function label(bar: Bar): string {
    if (bucket === 'month') return monthShort.format(at(bar.since));
    if (bucket === 'week') return t('bars.week', { n: isoWeek(bar.since) });
    return short ? weekday.format(at(bar.since)) : String(Number(bar.since.slice(8, 10)));
  }
  /** The name of a bar in the table: the day, the week with its days, the month. */
  function name(bar: Bar): string {
    if (bucket === 'month') return monthLong.format(at(bar.since));
    if (bucket === 'week') return `${t('bars.week', { n: isoWeek(bar.since) })} (${longDay.format(at(bar.since))} – ${longDay.format(at(bar.until))})`;
    return longDay.format(at(bar.since));
  }

  const today = $derived(app.today);
  const top = $derived(Math.max(1, ...bars.map((b) => (b.figures ? Math.max(0, b.figures.learned) + (seen ? Math.max(0, b.figures.seen) : 0) : 0))));
  const lineTop = $derived(Math.max(1, ...(line ?? []).map((v) => v ?? 0)));
  const points = $derived(
    (line ?? [])
      .map((v, i) => (v === null ? null : `${((i + 0.5) / bars.length) * 100},${100 - (Math.max(0, v) / lineTop) * 100}`))
      .filter((p): p is string => p !== null)
      .join(' '),
  );
  const showNumbers = $derived(bars.length <= 14);
  const height = (n: number): string => `${(Math.max(0, n) / top) * 100}%`;
  const missing = (bar: Bar): string => (bar.since > today ? t('bars.not_yet') : t('bars.unknown'));
</script>

<div class="bars-card">
  <div class="bars-head">
    <p class="bars-caption" id="{id}-caption">{caption}</p>
    <button type="button" class="link" aria-pressed={asTable} aria-controls="{id}-table" data-hint={t('bars.hint.table')} onclick={() => (asTable = !asTable)}
      >{asTable ? t('bars.as_chart') : t('bars.as_table')}</button
    >
  </div>
  {#if !asTable}
    <div class="chart" aria-hidden="true" data-bars={bars.length}>
      <div class="cols" style:--n={bars.length}>
        {#each bars as bar (bar.since)}
          <div class="col" class:partial={bar.partial} class:empty={bar.figures === null} title={bar.figures ? t('bars.bar', { label: name(bar), n: bar.figures.learned }) : `${name(bar)}: ${missing(bar)}`}>
            <div class="stack">
              {#if bar.figures}
                {#if showNumbers}<span class="num">{bar.figures.learned}</span>{/if}
                {#if seen && bar.figures.seen > 0}<span class="seg seen" style:block-size={height(bar.figures.seen)}></span>{/if}
                <span class="seg learned" style:block-size={height(bar.figures.learned)}></span>
              {/if}
            </div>
            <span class="tick">{label(bar)}</span>
          </div>
        {/each}
      </div>
      {#if points !== ''}
        <svg class="line" viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false"><polyline points={points} vector-effect="non-scaling-stroke" /></svg>
      {/if}
    </div>
    <p class="legend" aria-hidden="true">
      <span><span class="key learned"></span> {t('bars.col.learned')}</span>
      {#if seen}<span><span class="key seen"></span> {t('bars.col.seen')}</span>{/if}
      {#if line}<span><span class="key line-key"></span> {lineLabel}</span>{/if}
      {#if bars.some((b) => b.partial)}<span><span class="key partial-key"></span> {t('bars.partial')}</span>{/if}
    </p>
  {/if}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (a region that scrolls sideways is reached by the keyboard) -->
  <div class="scroll" class:sr-only={!asTable} id="{id}-table" role="region" aria-labelledby="{id}-caption" tabindex={asTable ? 0 : -1}>
    <table>
      <caption class="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{t(bucket === 'month' ? 'bars.col.month' : bucket === 'week' ? 'bars.col.week' : 'bars.col.day')}</th>
          <th scope="col" class="num-col">{t('bars.col.learned')}</th>
          <th scope="col" class="num-col">{t('bars.col.seen')}</th>
          {#if game}<th scope="col" class="num-col">{t('bars.col.xp')}</th>{/if}
          <th scope="col" class="num-col">{t('bars.col.hours')}</th>
          {#if line}<th scope="col" class="num-col">{lineLabel}</th>{/if}
        </tr>
      </thead>
      <tbody>
        {#each bars as bar, i (bar.since)}
          <tr data-bar={bar.since}>
            <th scope="row">{name(bar)}{#if bar.partial}{` (${t('bars.partial')})`}{/if}</th>
            {#if bar.figures}
              <td class="num-col">{bar.figures.learned}</td>
              <td class="num-col">{bar.figures.seen}</td>
              {#if game}<td class="num-col">{bar.figures.xp}</td>{/if}
              <td class="num-col">{bar.partial ? '–' : number.format(bar.figures.done_h)}</td>
              {#if line}<td class="num-col">{line[i] ?? '–'}</td>{/if}
            {:else}
              <td colspan={(game ? 4 : 3) + (line ? 1 : 0)}>{missing(bar)}</td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .bars-card {
    display: grid;
    gap: 0.4rem;
    min-inline-size: 0;
  }
  .bars-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .bars-caption {
    margin: 0;
    color: var(--muted);
    font-size: 0.9em;
  }
  .chart {
    position: relative;
    block-size: 8rem;
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(var(--n), minmax(0, 1fr));
    gap: 2px;
    block-size: 100%;
    align-items: end;
  }
  .col {
    display: grid;
    grid-template-rows: 1fr auto;
    block-size: 100%;
    min-inline-size: 0;
  }
  .stack {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: stretch;
    min-block-size: 0;
  }
  .seg {
    display: block;
    min-block-size: 0;
  }
  .seg.learned {
    background: var(--chart-1);
  }
  .seg.seen {
    background: repeating-linear-gradient(45deg, var(--chart-2) 0 3px, transparent 3px 6px);
    outline: 1px solid var(--chart-2);
    outline-offset: -1px;
  }
  .partial .seg {
    background: transparent;
    outline: 2px dashed var(--chart-1);
    outline-offset: -2px;
  }
  .num {
    text-align: center;
    font-size: 0.75em;
    color: var(--text);
  }
  .tick {
    overflow: hidden;
    text-align: center;
    font-size: 0.75em;
    color: var(--muted);
    white-space: nowrap;
    text-overflow: clip;
  }
  .line {
    position: absolute;
    inset: 0 0 1.2em 0;
    inline-size: 100%;
    block-size: calc(100% - 1.2em);
    overflow: visible;
    pointer-events: none;
  }
  .line polyline {
    fill: none;
    stroke: var(--chart-3);
    stroke-width: 2;
    stroke-dasharray: 5 3;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
    margin: 0;
    font-size: 0.85em;
    color: var(--muted);
  }
  .key {
    display: inline-block;
    inline-size: 0.9em;
    block-size: 0.9em;
    vertical-align: -0.1em;
  }
  .key.learned {
    background: var(--chart-1);
  }
  .key.seen {
    background: repeating-linear-gradient(45deg, var(--chart-2) 0 2px, transparent 2px 4px);
    outline: 1px solid var(--chart-2);
  }
  .key.line-key {
    block-size: 0;
    border-block-start: 2px dashed var(--chart-3);
    vertical-align: middle;
  }
  .key.partial-key {
    outline: 2px dashed var(--chart-1);
    outline-offset: -2px;
  }
  .scroll {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    inline-size: 100%;
    font-size: 0.9em;
  }
  th,
  td {
    padding: 0.2rem 0.5rem;
    border-block-end: 1px solid var(--line);
    text-align: start;
  }
  .num-col {
    text-align: end;
    font-variant-numeric: tabular-nums;
  }
  .sr-only {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .link {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    text-decoration: underline;
    text-align: start;
  }
</style>
