<script lang="ts">
  // The icon of an item as the inheritance found it (`shownIcon`): an emoji as text, an asset as a small `<img>` of
  // its owner's folder. Decorative: the title next to it says what the item is, so it is hidden from a screen reader.
  import type { App } from '../lib/app.svelte';
  import type { AssetOwner } from '../lib/api';
  import { AssetImages } from '../lib/assetImages.svelte';
  import type { ShownIcon } from '../lib/icons';
  import AssetImg from './AssetImg.svelte';

  let { app, shown, size = 16 }: { app: App; shown: ShownIcon | null; size?: number } = $props();

  // One store per owner of an asset icon; given back when the icon is no asset any more, the owner changes or the row
  // goes (the cleanup of the effect).
  const owner = $derived(shown && shown.icon.kind === 'asset' ? `${shown.owner.kind}|${shown.owner.id}` : null);
  let images = $state<AssetImages | null>(null);
  $effect(() => {
    const key = owner;
    if (key === null) {
      images = null;
      return;
    }
    const cut = key.indexOf('|');
    const store = new AssetImages((k, i, f) => app.asset(k, i, f), key.slice(0, cut) as AssetOwner, key.slice(cut + 1));
    images = store;
    return () => store.dispose();
  });
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
