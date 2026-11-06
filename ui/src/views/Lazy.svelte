<script lang="ts">
  // A view or dialog that most sessions never open, loaded when it is first wanted (`when`), and kept from then on: a
  // dialog that goes away with its element would not give the focus back.
  import type { Component } from 'svelte';
  import type { App } from '../lib/app.svelte';

  let {
    app,
    load,
    when = true,
  }: { app: App; load: () => Promise<{ default: Component<{ app: App }> }>; when?: boolean } = $props();

  let Loaded = $state.raw<Component<{ app: App }> | null>(null);
  $effect(() => {
    if (!when || Loaded) return;
    void load().then((module) => {
      Loaded = module.default;
    });
  });
</script>

{#if Loaded}<Loaded {app} />{/if}
