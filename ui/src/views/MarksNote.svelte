<script lang="ts">
  // The marked tasks of a view that is not the list: how many of them this view draws, and what can be done with them
  // here. Marks are made with `x` on the selected task and with Shift and a click; Export and the context menu take
  // the marked tasks this view draws. The bar that changes many tasks at once stays in the list, which this strip leads
  // to.
  import { tick } from 'svelte';
  import type { App } from '../lib/app.svelte';
  import { translate, type Key } from '../lib/i18n';

  let { app }: { app: App } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  const here = $derived(app.marksHere.length);
  const elsewhere = $derived(app.marks.length - here);

  async function toList(): Promise<void> {
    app.setView('list');
    await tick();
    document.querySelector<HTMLElement>('main')?.focus();
  }
  async function clear(): Promise<void> {
    app.clearMarks();
    // The strip's buttons are gone: the focus goes to the view, not to the page.
    await tick();
    document.querySelector<HTMLElement>('main')?.focus();
  }
</script>

<!-- Always in the tree, also when it says nothing (only hidden from the eye then), so that a screen reader has the
     region before it gets its text. -->
<div class="marks-note" class:on={app.marks.length > 0} role="group" aria-label={t('marks.note.label')} data-marks-note>
  <strong role="status"
    >{app.marks.length === 0 ? '' : elsewhere > 0 ? t('marks.note.here', { n: here, m: elsewhere }) : t('bulk.count', { n: here })}</strong
  >
  {#if app.marks.length > 0}
    <span class="muted">{t('marks.note.use')}</span>
    <button type="button" class="linkish" data-hint={t('hint.marks.to_list')} onclick={() => void toList()}>{t('marks.note.to_list')}</button>
    <button type="button" class="linkish" onclick={() => void clear()}>{t('bulk.clear')}</button>
  {/if}
</div>

<style>
  /* Out of sight while nothing is marked, but not out of the tree (see above). */
  .marks-note {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .marks-note.on {
    position: static;
    width: auto;
    height: auto;
    overflow: visible;
    clip-path: none;
    white-space: normal;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.3rem 0.8rem;
    margin: 0 0 0.5rem;
    padding: 0.35rem 0.6rem;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: var(--radius);
    font-size: 0.85rem;
  }
  .muted {
    color: var(--muted);
  }
  .linkish {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    cursor: pointer;
    font-size: inherit;
  }
</style>
