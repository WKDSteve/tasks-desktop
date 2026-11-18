<script lang="ts">
  // The filter of the statistics: the filter bar of the list (FilterBar: search, quick filters, "More filters", the
  // chips), in a fold of its own. It is the one filter of the page, so what is chosen here holds in the list and the
  // other way round. Folded, one line says how many tasks are counted, and the strip of the other views (FilterNote)
  // names what is on. What only the list needs (the order, the areas set apart, the finished tasks below the list,
  // the saved lists, the export of the rows) is not here: the statistics count, they have no rows to order or export.
  import type { App } from '../lib/app.svelte';
  import { translate, type Key } from '../lib/i18n';
  import FilterBar from './FilterBar.svelte';
  import FilterNote from './FilterNote.svelte';

  let { app }: { app: App } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);
  const open = $derived(app.statsFilterOpen);
</script>

<section class="filter" aria-label={t('stats.filter')}>
  <div class="head">
    <button
      type="button"
      class="fold"
      aria-expanded={open}
      aria-controls="stats-filter-body"
      data-hint={t('hint.stats.filter')}
      onclick={() => app.setStatsFilterOpen(!open)}
      ><span class="chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>{t('stats.filter')}</button
    >
    <span class="muted" role="status" data-testid="stats-filter-count"
      >{t('stats.filter.count', { shown: app.shown.length, total: app.tasks.length })}</span
    >
  </div>
  {#if open}
    <div id="stats-filter-body" class="body">
      <FilterBar {app} />
    </div>
  {/if}
</section>
{#if !open}
  <FilterNote {app} />
{/if}

<style>
  .filter {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem 0.8rem;
    padding: 0.35rem 0.6rem;
    font-size: 0.9rem;
  }
  .fold {
    display: inline-flex;
    align-items: baseline;
    gap: 0.35rem;
    padding: 0.1rem 0.3rem;
    border: 0;
    border-radius: var(--radius);
    background: none;
    color: var(--text);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .chevron {
    color: var(--muted);
  }
  .body {
    border-top: 1px solid var(--border);
  }
  /* The last line of the bar is the edge of the card. */
  .body > :global(:last-child) {
    border-bottom: 0;
  }
</style>
