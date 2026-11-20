<script lang="ts">
  // The large picture of an item (`cover:`) in its head: read from the item's folder like every asset, larger on a
  // click, the page's word when the file is missing. Its own store, given back when the item changes or the head goes.
  import { onDestroy } from 'svelte';
  import type { App } from '../lib/app.svelte';
  import type { AssetOwner } from '../lib/api';
  import { AssetImages } from '../lib/assetImages.svelte';
  import { translate } from '../lib/i18n';
  import AssetImg from './AssetImg.svelte';
  import ImageViewer from './ImageViewer.svelte';

  let { app, kind, id, file, title }: { app: App; kind: AssetOwner; id: string; file: string; title: string } = $props();
  const t = (key: Parameters<typeof translate>[1], params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  let store: AssetImages | null = null;
  const images = $derived.by(() => {
    if (store && store.kind === kind && store.id === id) return store;
    store?.dispose();
    store = new AssetImages((k, i, f) => app.asset(k, i, f), kind, id);
    return store;
  });
  onDestroy(() => store?.dispose());
  let viewing = $state<{ url: string; alt: string } | null>(null);
</script>

{#if file.startsWith('assets/')}
  <div class="cover" data-cover={kind}>
    <AssetImg {images} {file} alt={t('image.cover_of', { title })} missing={t('image.missing')} onopen={(url, alt) => (viewing = { url, alt })} />
  </div>
  <ImageViewer image={viewing} close={() => (viewing = null)} label={{ close: t('image.close'), view: t('image.view') }} />
{/if}

<style>
  .cover {
    margin: 0.4rem 0;
  }
  .cover :global(img) {
    max-height: 10rem;
    border-radius: var(--radius);
  }
</style>
