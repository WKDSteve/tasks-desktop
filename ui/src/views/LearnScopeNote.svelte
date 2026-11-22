<script lang="ts">
  // The area filter of the page leaves a view of the tab "Lernpläne" nothing to show (lib/learnScope.ts): said in words,
  // with a button that takes the areas out of the filter (only those: the other parts of the filter stay).
  import type { App } from '../lib/app.svelte';
  import type { LearnScope } from '../lib/learnScope';
  import { learnScopeTexts, type LearnScopeKey } from '../lib/learnScopeTexts';
  import { markHidden } from '../lib/text';

  let { app, scope }: { app: App; scope: LearnScope } = $props();

  const t = (key: LearnScopeKey, params: Record<string, string | number> = {}) => learnScopeTexts.text(app.lang, key, params);
  const areas = $derived(markHidden(scope.names.join(', ')));

  function clear(event: MouseEvent): void {
    // The note goes with the filter: the focus goes to the view it stood in, not to the end of the page.
    const view = (event.currentTarget as HTMLElement).closest<HTMLElement>('[tabindex="-1"]');
    app.filter = { ...app.filter, areas: [] };
    view?.focus({ preventScroll: true });
  }
</script>

<div class="scope-note">
  <p>{t('learnscope.hidden', { areas })}</p>
  <button type="button" onclick={clear}>{t('learnscope.clear')}</button>
</div>

<style>
  .scope-note {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 1rem;
    background: var(--surface);
    border: 1px dashed var(--border);
    border-radius: var(--radius);
  }
  .scope-note p {
    margin: 0;
  }
  button {
    background: var(--accent);
    color: var(--accent-text);
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    padding: 0.25rem 0.6rem;
    min-height: 2rem;
    font: inherit;
    cursor: pointer;
  }
</style>
