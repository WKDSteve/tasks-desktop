<script lang="ts">
  // One card of the statistics: a head with its name that folds the card (remembered per card, part of the layout of
  // the view), and two buttons in the head, there for the pointer over the card, for the focus inside it and always on
  // a touch screen (as the x of a tile): the card alone in a new window, and a menu to print it or export it (its
  // tables as CSV or Markdown, its drawing as SVG). A window of one card shows it unfolded, without either.
  import type { Snippet } from 'svelte';
  import { flushSync } from 'svelte';
  import type { App } from '../lib/app.svelte';
  import { translate, type Key } from '../lib/i18n';
  import type { StatsCard } from '../lib/statsCards';
  import { CARD_FILES, cardFileName, cardText, type CardFormat, type CardTable } from '../lib/statsExport';
  import { printCard } from '../lib/statsSvg';

  let {
    app,
    card,
    title,
    tables,
    svg,
    drawnTables = false,
    head,
    children,
    section = $bindable(),
  }: {
    app: App;
    card: StatsCard;
    title: string;
    /** The tables of the card as they are exported. */
    tables: () => CardTable[];
    /** The drawing of the card as an SVG file; left out while the card draws none (the menu then offers no SVG). */
    svg?: () => string | null;
    /** The tables are read from the drawn body (the headline numbers): a folded card has none to export. */
    drawnTables?: boolean;
    /** More of the head, after the name (a hint, a way back). */
    head?: Snippet;
    children: Snippet;
    section?: HTMLElement | undefined;
  } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  const alone = $derived(app.statsCard === card);
  const open = $derived(alone || !app.statsFolded.includes(card));
  const id = $derived(`stats-${card}`);
  // A folded card draws no body: nothing of it to print, and no tables where they are read from the drawing.
  const tablesOffered = $derived(open || !drawnTables);

  let menuOpen = $state(false);
  let details: HTMLDetailsElement | undefined = $state();
  let summary: HTMLElement | undefined = $state();

  function close(): void {
    menuOpen = false;
    summary?.focus();
  }

  function put(format: CardFormat, how: 'save' | 'copy'): void {
    close();
    const text = cardText(title, tables(), format, app.csvSeparator);
    void app.putCardText(cardFileName(card, app.today, format), text, CARD_FILES[format].type, how);
  }

  function saveSvg(): void {
    close();
    const text = svg?.() ?? null;
    if (text === null) return;
    void app.putCardText(cardFileName(card, app.today, 'svg'), text, CARD_FILES.svg.type, 'save');
  }

  function print(): void {
    // the menu is drawn closed first: the dialog blocks the page and would show it open on paper
    flushSync(() => (menuOpen = false));
    summary?.focus();
    if (!section || !printCard(document, window, section)) app.sayPrintFailed();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || !menuOpen) return;
    e.preventDefault();
    close();
  }

  /** A press or a focus elsewhere closes the menu. */
  function closeOutside(e: Event): void {
    if (menuOpen && details && e.target instanceof Node && !details.contains(e.target)) menuOpen = false;
  }
</script>

<svelte:document onpointerdown={closeOutside} onfocusin={closeOutside} />

<section class="card" class:folded={!open} class:menu-open={menuOpen} data-card={card} aria-labelledby={id} bind:this={section}>
  <div class="cardhead">
    <h2 class="title">
      {#if alone}
        <span class="eyebrow" id={id}>{title}</span>
      {:else}
        <button
          type="button"
          class="fold"
          id={id}
          aria-expanded={open}
          aria-controls="{id}-body"
          data-hint={t('hint.stats.card.fold')}
          onclick={() => app.setStatsCardOpen(card, !open)}
          ><span class="chevron" aria-hidden="true">{open ? '▾' : '▸'}</span><span class="eyebrow">{title}</span></button
        >
      {/if}
    </h2>
    {@render head?.()}
    <div class="tools">
      {#if app.canDetach && !alone}
        <button
          type="button"
          class="tool"
          data-tool="window"
          aria-label={t('stats.card.window', { card: title })}
          data-hint={t('hint.stats.card.window')}
          onclick={() => app.openCardApart(card)}><span aria-hidden="true">⧉</span></button
        >
      {/if}
      {#if tablesOffered}
        <details class="menu" bind:open={menuOpen} bind:this={details}>
          <summary
            class="tool"
            data-tool="menu"
            aria-label={t('stats.card.menu', { card: title })}
            data-hint={t('hint.stats.card.menu')}
            bind:this={summary}
            onkeydown={onKey}><span aria-hidden="true">⤓</span></summary
          >
          <div class="popup" role="group" aria-label={t('stats.card.menu', { card: title })}>
            {#if open}
              <button type="button" data-out="print" onkeydown={onKey} onclick={print}>{t('stats.card.print')}</button>
            {/if}
            <button type="button" data-out="csv" onkeydown={onKey} onclick={() => put('csv', 'save')}>{t('export.save', { format: 'CSV' })}</button>
            <button type="button" data-out="markdown" onkeydown={onKey} onclick={() => put('markdown', 'save')}
              >{t('export.save', { format: 'Markdown' })}</button
            >
            <button type="button" data-out="copy" onkeydown={onKey} onclick={() => put('markdown', 'copy')}
              >{t('export.copy', { format: 'Markdown' })}</button
            >
            {#if svg && open}
              <button type="button" data-out="svg" onkeydown={onKey} onclick={saveSvg}>{t('export.save', { format: 'SVG' })}</button>
            {/if}
          </div>
        </details>
      {/if}
    </div>
  </div>
  {#if open}
    <div id="{id}-body" class="body">
      {@render children()}
    </div>
  {/if}
</section>

<style>
  .card {
    position: relative;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.5rem 1rem 0.9rem;
  }
  .card.folded {
    padding-bottom: 0.5rem;
  }
  .cardhead {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    min-height: 1.8rem;
  }
  .title {
    margin: 0;
    font-size: inherit;
  }
  .fold {
    display: inline-flex;
    align-items: baseline;
    gap: 0.35rem;
    padding: 0.1rem 0.3rem 0.1rem 0;
    border: 0;
    border-radius: var(--radius);
    background: none;
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  .chevron {
    color: var(--muted);
  }
  .eyebrow {
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .fold:hover .eyebrow {
    color: var(--text);
  }
  .body {
    margin-top: 0.4rem;
  }
  /* The buttons of the head: there for the pointer over the card and for the focus inside it. A touch screen has no
     pointer to rest on the card, and a device with a finger and a mouse may be used with the finger: always there. */
  .tools {
    margin-inline-start: auto;
    display: flex;
    align-items: center;
    gap: 0.2rem;
    opacity: 0;
  }
  .card:hover .tools,
  .card:focus-within .tools,
  .card.menu-open .tools {
    opacity: 1;
  }
  @media (hover: none), (any-pointer: coarse) {
    .tools {
      opacity: 1;
    }
  }
  .tool {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.6rem;
    min-height: 1.6rem;
    padding: 0 0.3rem;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: none;
    color: var(--muted);
    font: inherit;
    line-height: 1;
    cursor: pointer;
    list-style: none;
  }
  .tool::-webkit-details-marker {
    display: none;
  }
  .tool:hover,
  .tool:focus-visible,
  .menu[open] > .tool {
    border-color: var(--border);
    color: var(--text);
    background: var(--surface-2);
  }
  .menu {
    position: relative;
  }
  .popup {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 20;
    display: flex;
    flex-direction: column;
    width: max-content;
    min-width: 11rem;
    padding: 0.25rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
  }
  .popup button {
    text-align: left;
    background: none;
    border: none;
    border-radius: var(--radius);
    color: var(--text);
    font: inherit;
    padding: 0.3rem 0.5rem;
    cursor: pointer;
  }
  .popup button:hover,
  .popup button:focus-visible {
    background: var(--surface-2);
  }

  /* One card on paper (lib/statsSvg.ts printCard): everything that neither holds it nor is in it is left off, and so
     are its buttons. The theme is the light one while the dialog is open. */
  @media print {
    :global(html.print-card body *:not(:has([data-print-card])):not([data-print-card]):not([data-print-card] *)) {
      display: none !important;
    }
    :global(html.print-card [data-print-card] .tools) {
      display: none !important;
    }
    :global(html.print-card [data-print-card]) {
      border: 0;
      break-inside: avoid;
    }
  }
</style>
