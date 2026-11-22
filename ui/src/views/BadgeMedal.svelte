<script lang="ts">
  // The picture of a badge (concept "Reiter Lernpläne" 2): the path's image below `assets/badges/` (only as an image,
  // AssetImg), grey and faded while the level is open; without one, or while it loads, a neutral medal with the number
  // of the level (a tick for the line of the whole path). Decorative: the words beside it say level and state.
  import AssetImg from './AssetImg.svelte';
  import type { AssetImages } from '../lib/assetImages.svelte';
  import { badgeImage, type BadgeTile } from '../lib/badges';

  let { tile, images, size }: { tile: BadgeTile; images: AssetImages | undefined; size: number } = $props();
  const file = $derived(badgeImage(tile));
  const drawn = $derived(file !== null && images !== undefined && Boolean(images.url(file)));
</script>

<span class="medal" class:earned={tile.earned} style:--size="{size}px" data-medal>
  {#if drawn && file !== null && images !== undefined}
    <AssetImg {images} {file} alt="" {size} cls="badge-img" />
  {:else}
    <span class="coin" aria-hidden="true">{tile.level.kind === 'done' ? '✓' : (tile.level.number ?? tile.level.ref)}</span>
  {/if}
</span>

<style>
  .medal {
    display: grid;
    place-items: center;
    flex: none;
    width: var(--size);
    height: var(--size);
  }
  .coin {
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    border-radius: 50%;
    background: var(--surface-2);
    border: 2px solid var(--muted);
    color: var(--muted);
    font-weight: 700;
    font-size: calc(var(--size) / 4);
  }
  .medal.earned .coin {
    border-color: var(--ok);
    color: var(--ok);
  }
  .medal:not(.earned) :global(.badge-img) {
    filter: grayscale(1);
    opacity: 0.55;
  }
  @media (forced-colors: active) {
    .coin,
    .medal.earned .coin {
      border-color: CanvasText;
      color: CanvasText;
    }
  }
</style>
