<script lang="ts">
  // One image below `assets/` of a container, from the container's store (`AssetImages`): the picture once it is
  // there, its description while it loads, and the page's word for a missing one (or nothing, for a small icon). Only
  // the `blob:` address the store made is ever put into the `<img>` (drawableImageUrl of the kit).
  import { drawableImageUrl } from 'appkit-ui/image-url';
  import type { AssetImages } from '../lib/assetImages.svelte';
  import { markHidden } from '../lib/text';

  let {
    images,
    file,
    alt,
    missing,
    size,
    cls = '',
    onopen,
  }: {
    images: AssetImages;
    file: string;
    alt: string;
    /** The word for a missing image; without it a missing one shows nothing (an icon). */
    missing?: string;
    /** A square of this many pixels (an icon, a badge); without it the image keeps its size within the limits. */
    size?: number;
    cls?: string;
    onopen?: (url: string, alt: string) => void;
  } = $props();

  const url = $derived(drawableImageUrl(images.url(file)));
  const shownAlt = $derived(markHidden(alt));
</script>

{#if url === null}
  {#if missing}<span class="missing {cls}" data-asset-missing={file}>{missing}: {shownAlt || file.split('/').pop()}</span>{/if}
{:else if url !== undefined}
  {#if onopen}
    <button type="button" class="open {cls}" title={shownAlt} onclick={() => onopen(url, shownAlt)}
      ><img src={url} alt={shownAlt} width={size} height={size} class:sized={size !== undefined} data-asset={file} /></button
    >
  {:else}
    <img class={cls} class:sized={size !== undefined} src={url} alt={shownAlt} width={size} height={size} data-asset={file} />
  {/if}
{/if}

<style>
  img {
    max-width: 100%;
    max-height: 24rem;
    height: auto;
    vertical-align: middle;
  }
  img.sized {
    object-fit: contain;
    height: revert-layer;
  }
  .open {
    padding: 0;
    border: 0;
    background: none;
    cursor: zoom-in;
    max-width: 100%;
  }
  .missing {
    color: var(--muted);
    font-style: italic;
  }
</style>
