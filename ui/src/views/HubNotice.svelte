<script lang="ts">
  // The hub of this page is gone, or another one runs in its place (`App.hubState`): a quiet line that says how to go
  // on. A page in a browser cannot start a program; it can only say how, and connect again by itself. The region is
  // always there, so that a screen reader is told when the line appears.
  import type { App } from '../lib/app.svelte';
  import { translate, type Key } from '../lib/i18n';

  let { app }: { app: Pick<App, 'lang' | 'hubState' | 'hasDrafts'> } = $props();
  const t = (key: Key) => translate(app.lang, key);
</script>

<div role="status" class="hub-notice" class:shown={app.hubState !== 'here'}>
  {#if app.hubState === 'gone'}
    <p>{t('hub.gone')} <code translate="no">tasks-desktop start --open</code></p>
    <p>{t('hub.gone.then')}</p>
  {:else if app.hubState === 'replaced'}
    <p>{t('hub.replaced')} <code translate="no">tasks-desktop link</code></p>
  {/if}
  {#if app.hubState !== 'here' && app.hasDrafts}
    <p class="unsaved">{t('hub.unsaved')}</p>
  {/if}
</div>

<style>
  .hub-notice.shown {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.4rem 0.75rem;
    margin: 0 0 1rem;
    color: var(--warn);
  }
  p {
    margin: 0.15rem 0;
  }
  code {
    color: var(--text);
    user-select: all;
  }
  .unsaved {
    font-weight: 600;
  }
</style>
