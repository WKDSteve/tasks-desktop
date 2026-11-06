<script lang="ts">
  // A view or dialog that most sessions never open, loaded when it is first wanted (`when`), and kept from then on: a
  // dialog that goes away with its element would not give the focus back.
  import type { Component } from 'svelte';
  import type { App } from '../lib/app.svelte';
  import { translate } from '../lib/i18n';

  let {
    app,
    load,
    when = true,
  }: { app: App; load: () => Promise<{ default: Component<{ app: App }> }>; when?: boolean } = $props();

  let Loaded = $state.raw<Component<{ app: App }> | null>(null);
  // The hub may have been stopped or replaced since the page came (the name of a chunk is that of its build): only
  // loading the page anew helps, and the page says so instead of staying empty.
  let failed = $state(false);
  $effect(() => {
    if (!when || Loaded) return;
    load().then(
      (module) => {
        Loaded = module.default;
      },
      () => {
        failed = true;
      },
    );
  });
</script>

{#if Loaded}
  <Loaded {app} />
{:else if failed}
  <p class="failed" role="alert">
    {translate(app.lang, 'lazy.failed')}
    <button type="button" onclick={() => location.reload()}>{translate(app.lang, 'lazy.reload')}</button>
  </p>
{/if}

<style>
  .failed {
    margin: 1rem;
    color: var(--text);
  }
  .failed button {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.2rem 0.6rem;
    cursor: pointer;
  }
</style>
