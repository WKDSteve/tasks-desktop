<script lang="ts">
  // The icon of an item as the inheritance found it (`shownIcon`): an emoji as text, an asset as a small `<img>` of
  // its owner's folder. Decorative: the title next to it says what the item is, so it is hidden from a screen reader.
  import { onDestroy } from 'svelte';
  import type { App } from '../lib/app.svelte';
  import { AssetImages } from '../lib/assetImages.svelte';
  import type { ShownIcon } from '../lib/icons';
  import AssetImg from './AssetImg.svelte';

  let { app, shown, size = 16 }: { app: App; shown: ShownIcon | null; size?: number } = $props();

  // One store per owner the icon came from; given back when the owner changes or the row goes.
  let store: AssetImages | null = null;
  const images = $derived.by(() => {
    if (!shown || shown.icon.kind !== 'asset') return null;
    const { kind, id } = shown.owner;
    if (store && store.kind === kind && store.id === id) return store;
    store?.dispose();
    store = new AssetImages((k, i, f) => app.asset(k, i, f), kind, id);
    return store;
  });
  onDestroy(() => store?.dispose());
</script>

{#if shown}
  {#if shown.icon.kind === 'emoji'}
    <span class="icon" aria-hidden="true" data-icon={shown.from}>{shown.icon.value}</span>
  {:else if images}
    <span class="icon" aria-hidden="true" data-icon={shown.from}><AssetImg {images} file={shown.icon.value} alt="" {size} /></span>
  {/if}
{/if}

<style>
  .icon {
    display: inline-flex;
    align-items: center;
    flex: none;
    margin-right: 0.25em;
  }
</style>
