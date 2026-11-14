<script lang="ts">
  // The marked tasks of a view that is not the list: how many there are, and what can be done with them here. Marks
  // are made with `x` on the selected task, Ctrl+click and Shift+click; Export and the context menu take them. The
  // bar that changes many tasks at once stays in the list, which this strip leads to.
  import { tick } from 'svelte';
  import type { App } from '../lib/app.svelte';
  import { translate, type Key } from '../lib/i18n';

  let { app }: { app: App } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  async function toList(): Promise<void> {
    app.setView('list');
    await tick();
    document.querySelector<HTMLElement>('main')?.focus();
  }
  async function clear(): Promise<void> {
    app.clearMarks();
    // The strip is gone with its buttons: the focus goes to the view, not to the page.
    await tick();
    document.querySelector<HTMLElement>('main')?.focus();
  }
</script>

<!-- Always there, so a screen reader has the region before it gets its text. -->
<div class="marks-note" class:on={app.marks.length > 0} role="group" aria-label={t('marks.note.label')} data-marks-note>
  <strong role="status">{app.marks.length > 0 ? t('bulk.count', { n: app.marks.length }) : ''}</strong>
  {#if app.marks.length > 0}
    <span class="muted">{t('marks.note.use')}</span>
    <button type="button" class="linkish" data-hint={t('hint.marks.to_list')} onclick={() => void toList()}>{t('marks.note.to_list')}</button>
    <button type="button" class="linkish" onclick={() => void clear()}>{t('bulk.clear')}</button>
  {/if}
</div>

<style>
  .marks-note {
    display: none;
  }
  .marks-note.on {
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
