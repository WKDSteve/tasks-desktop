<script lang="ts">
  // "The vault in numbers": the headline numbers and one tile per field with how the tasks spread over its values.
  // Every tile can be taken out of the view with the x in its corner (shown on hover and focus, always on a touch
  // screen); the choice at the top right, there as soon as a tile is hidden, brings tiles back and hides them. What
  // is counted comes from the view (`StatsView`), the spread per field is the same counting as "Cut up by"
  // (`lib/stats.ts`). The colours of the stacks are the view's (`.stats :global` there): this component lives in it.
  import { tick } from 'svelte';
  import Info from 'appkit-ui/Info.svelte';
  import MultiSelect from 'appkit-ui/MultiSelect.svelte';
  import type { App } from '../lib/app.svelte';
  import type { TaskEntry } from '../lib/contract';
  import { formatNumber, translate, type Key } from '../lib/i18n';
  import { cutOf, figureFilter, filterFor, STAT_DIMS, statsOf, type Figure, type StatDim, type StatFigures } from '../lib/stats';
  import { dimOf, dimTile, numberTile, shownTiles, withShown, withTile, type NumberTile, type TileId } from '../lib/statsTiles';
  import { bucketClass, bucketLabel, bucketName, dimHint } from '../lib/statsWords';

  let {
    app,
    tasks,
    figures,
    finished,
    effort,
    onfinished,
  }: {
    app: App;
    /** The tasks the filter keeps: what every tile counts. */
    tasks: readonly TaskEntry[];
    figures: StatFigures;
    /** What the engine counted as finished in the last 30 days; null without an answer. */
    finished: { total: number } | null;
    /** The engine's figure of the effort; null without one. */
    effort: { days: number; low?: number; high?: number; without: number; waiting?: boolean } | null;
    onfinished: () => void;
  } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);
  const days = (n: number) => formatNumber(app.lang, Math.round(n * 10) / 10);

  const FIGURE_KEYS: Record<Figure, Key> = {
    open: 'stats.open',
    ready: 'stats.ready',
    doing: 'stats.doing',
    blocked: 'stats.blocked',
    quickWins: 'stats.quick_wins',
    noEffort: 'stats.no_effort',
  };
  // The numbers there are now: one the engine did not give (quick wins, finished, effort) has no tile.
  const counted = $derived(
    (Object.keys(FIGURE_KEYS) as Figure[]).flatMap((f) => {
      const n = figures[f];
      return n === undefined ? [] : [{ figure: f, id: numberTile(f), label: t(FIGURE_KEYS[f]), n }];
    }),
  );
  const numberLabel = (name: NumberTile): string =>
    name === 'finished' ? t('stats.finished30') : name === 'effort' ? t('stats.effort') : t(FIGURE_KEYS[name]);
  const available = $derived<TileId[]>([
    ...counted.map((c) => c.id),
    ...(finished ? [numberTile('finished')] : []),
    ...(effort ? [numberTile('effort')] : []),
    ...STAT_DIMS.map(dimTile),
  ]);
  const shown = $derived(shownTiles(app.statsTiles, available));
  const hidden = $derived(available.length - shown.length);
  const isShown = (id: TileId): boolean => shown.includes(id);
  /** The name of a tile: the number's, or "By <field>" (an effort is a number and a field). */
  function tileLabel(id: TileId): string {
    const dim = dimOf(id);
    return dim ? t('stats.tile.dim', { field: t(`stats.dim.${dim}` as Key) }) : numberLabel(id.slice(2) as NumberTile);
  }

  // The spread per field, only for the tiles that are shown. The values of a field with many are named from the tasks
  // counted here.
  const spreads = $derived(
    STAT_DIMS.filter((dim) => isShown(dimTile(dim))).map((dim) => {
      const cut = cutOf(tasks, dim, app.projectOf);
      const stats = statsOf(tasks, cut);
      return { dim, id: dimTile(dim), cut, buckets: stats.buckets, totals: stats.totals };
    }),
  );
  const fieldName = (dim: StatDim): string => t(`stats.dim.${dim}` as Key);

  let root: HTMLElement | undefined = $state();
  // The choice stays while the person is in it: ticking the last hidden tile must not take it from under the pointer.
  // A press of the pointer counts like the focus: not every browser gives a button or a box the focus on a click.
  let inPick = $state(false);
  let pick: HTMLElement | undefined = $state();
  function leftPick(to: EventTarget | null): void {
    if (to instanceof Node && pick && !pick.contains(to)) inPick = false;
  }
  /**
   * Take a tile out of the view. The x that had the focus is gone: the focus goes to the x of the tile that took its
   * place (the next one can be hidden right away), else to the choice that brings tiles back. The page does not
   * scroll for it: the person stays where the tile was.
   */
  async function hide(id: TileId): Promise<void> {
    const crosses = (): HTMLButtonElement[] => [...(root?.querySelectorAll<HTMLButtonElement>('.tile .hide') ?? [])];
    const at = crosses().findIndex((x) => x.closest('[data-tile]')?.getAttribute('data-tile') === id);
    app.setStatsTiles(withTile(app.statsTiles, id, false));
    await tick();
    const left = crosses();
    const next = left[Math.min(Math.max(at, 0), left.length - 1)] ?? root?.querySelector<HTMLButtonElement>('.pick button');
    next?.focus({ preventScroll: true });
  }
</script>

<svelte:window onpointerdown={(e) => leftPick(e.target)} />

{#snippet cross(id: TileId)}
  <button
    type="button"
    class="hide"
    aria-label={t('stats.tile.hide', { tile: tileLabel(id) })}
    data-hint={t('hint.stats.tile.hide')}
    onclick={() => void hide(id)}><span aria-hidden="true">×</span></button
  >
{/snippet}

<div class="tiles" bind:this={root}>
  <div class="headline">
    <h2 id="stats-figures" class="eyebrow">{t('stats.figures')}</h2>
    <Info hint={t('hint.stats')} label={t('hint.about', { what: t('nav.stats') })} />
    {#if hidden > 0 || inPick}
      <!-- The listeners only note that the person is in the choice; the box itself is not interactive. -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="pick"
        bind:this={pick}
        onfocusin={() => (inPick = true)}
        onpointerdown={() => (inPick = true)}
        onfocusout={(e) => leftPick(e.relatedTarget)}
      >
        <span class="hidden-n" data-testid="tiles-hidden">{t('stats.tiles.hidden', { n: hidden })}</span>
        <MultiSelect
          label={t('stats.tiles')}
          hint={t('hint.stats.tiles')}
          note={t('stats.tiles.note')}
          options={available.map((id) => ({ value: id, label: tileLabel(id) }))}
          selected={shown}
          onchange={(next) => app.setStatsTiles(withShown(app.statsTiles, available, next))}
          clearLabel={t('stats.tiles.reset')}
          resetLabel={t('stats.tiles.reset')}
          searchLabel={t('multi.search')}
        />
      </div>
    {/if}
  </div>
  <ul class="figures">
    {#each counted as f (f.figure)}
      {#if isShown(f.id)}
        <li class="tile" data-tile={f.id}>
          {#if figureFilter(app.filter, f.figure, figures)}
            <button
              type="button"
              class="figure"
              data-figure={f.figure}
              data-hint={t('hint.stats.tile.number')}
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
          {@render cross(f.id)}
        </li>
      {/if}
    {/each}
    {#if finished && isShown('n:finished')}
      <li class="tile" data-tile="n:finished">
        <button
          type="button"
          class="figure"
          data-figure="finished"
          data-hint={t('hint.stats.tile.finished')}
          aria-label={t('stats.open_finished', { n: finished.total })}
          onclick={onfinished}
        >
          <span class="label">{t('stats.finished30')}</span>
          <span class="n">{finished.total}</span>
        </button>
        {@render cross('n:finished')}
      </li>
    {/if}
    {#if effort && isShown('n:effort')}
      <li class="tile" data-tile="n:effort">
        <div class="figure" class:waiting={effort.waiting} aria-busy={effort.waiting ? 'true' : undefined} data-figure="effort" data-hint={t('hint.stats.effort')}>
          <span class="label">{t('stats.effort')}</span>
          <span class="n">{t('stats.days_n', { n: days(effort.days) })}</span>
          {#if effort.low !== undefined && effort.high !== undefined}
            <span class="sub">{t('stats.range', { low: days(effort.low), high: days(effort.high) })}</span>
          {/if}
          {#if effort.without > 0}
            <span class="sub">{t('stats.without', { n: effort.without })}</span>
          {/if}
        </div>
        {@render cross('n:effort')}
      </li>
    {/if}
  </ul>
  {#if spreads.length > 0}
    <ul class="spreads">
      {#each spreads as s (s.dim)}
        <li class="tile spread dim-{s.dim}" data-tile={s.id} data-hint={dimHint(app.lang, s.dim)}>
          <span class="label" id="stats-tile-{s.dim}">{tileLabel(s.id)}</span>
          {#if s.buckets.length === 0}
            <span class="sub">{t('stats.tile.empty')}</span>
          {:else}
            <!-- The bar repeats the numbers below for the eye. -->
            <div class="mini" aria-hidden="true">
              {#each s.buckets as bucket (bucket)}
                <span class="seg {bucketClass(s.cut, bucket)}" style:flex-grow={s.totals[bucket]}></span>
              {/each}
            </div>
            <ul class="values" aria-labelledby="stats-tile-{s.dim}">
              {#each s.buckets as bucket (bucket)}
                <li>
                  <button
                    type="button"
                    class="value"
                    data-bucket={bucketName(bucket)}
                    aria-label={t('stats.open_value', {
                      field: fieldName(s.dim),
                      bucket: bucketLabel(app.lang, s.dim, bucket),
                      n: s.totals[bucket] ?? 0,
                    })}
                    onclick={() => app.openStatsInList(filterFor(app.filter, s.cut, bucket, null, tasks))}
                  >
                    <span class="swatch {bucketClass(s.cut, bucket)}" aria-hidden="true"></span>
                    <span class="name">{bucketLabel(app.lang, s.dim, bucket)}</span>
                    <span class="count">{s.totals[bucket]}</span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
          {@render cross(s.id)}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .headline {
    display: flex;
    flex-wrap: wrap;
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
  /* The choice of the tiles: in the corner at the top right of the section. */
  .pick {
    margin-left: auto;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
  }
  .hidden-n {
    color: var(--muted);
  }
  .figures,
  .spreads {
    list-style: none;
    margin: 0.6rem 0;
    padding: 0;
    display: grid;
    gap: 0.6rem;
  }
  .figures {
    grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
  }
  .spreads {
    grid-template-columns: repeat(auto-fill, minmax(min(13rem, 100%), 1fr));
    align-items: start;
  }
  .tile {
    position: relative;
    min-width: 0;
  }
  .figure,
  .spread {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-2);
    color: var(--text);
  }
  .figure {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.2rem;
    padding: 0.6rem 0.8rem;
    cursor: pointer;
  }
  div.figure {
    cursor: default;
  }
  /* The figure of the tasks before, while the one for the tasks of now is asked: said by the edge of the tile, not by
     paler text (a dimmed number falls below the contrast a text needs). */
  .figure.waiting {
    border-style: dashed;
  }
  button.figure:hover {
    border-color: var(--accent);
  }
  .figure {
    text-align: left;
  }
  .label {
    color: var(--muted);
  }
  /* The x of the tile is in the corner beside the name of a field (the name of a number is short and keeps its line). */
  .spread .label {
    padding-right: 1.2rem;
  }
  .sub {
    color: var(--muted);
    font-size: 0.85em;
  }
  .figure .n {
    font-size: 1.6em;
    font-variant-numeric: tabular-nums;
  }
  .spread {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.6rem 0.8rem;
  }
  .mini {
    display: flex;
    gap: 2px;
    height: 0.6rem;
  }
  .seg {
    flex-basis: 0;
    min-width: 3px;
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
  .values {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .value {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.1rem 0.2rem;
    border: 0;
    border-radius: var(--radius);
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .value:hover {
    background: var(--surface);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    font-variant-numeric: tabular-nums;
    color: var(--accent);
  }
  .swatch {
    flex: none;
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 2px;
  }
  /* The x of a tile: in its corner, there for the pointer over the tile and for the focus inside it. A touch screen
     has no pointer to rest on a tile, and a device with a finger and a mouse may be used with the finger: the x is
     always there. */
  .hide {
    position: absolute;
    top: 0.2rem;
    right: 0.2rem;
    min-width: 1.5rem;
    min-height: 1.5rem;
    padding: 0;
    border: 0;
    border-radius: var(--radius);
    background: none;
    color: var(--muted);
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
    opacity: 0;
  }
  .tile:hover .hide,
  .tile:focus-within .hide {
    opacity: 1;
  }
  @media (hover: none), (any-pointer: coarse) {
    .hide {
      opacity: 1;
    }
  }
  .hide:hover,
  .hide:focus-visible {
    color: var(--text);
    background: var(--surface);
  }
</style>
