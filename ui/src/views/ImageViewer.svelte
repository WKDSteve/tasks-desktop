<script lang="ts">
  // An image of a text, larger: a modal dialog with the picture (the `blob:` address the page made) and its
  // description; Escape, the close button or a click beside the picture closes it, and the focus goes back.
  import { tick } from 'svelte';

  let { image, close, label }: { image: { url: string; alt: string } | null; close: () => void; label: { close: string; view: string } } = $props();

  let dialog: HTMLDialogElement | undefined = $state();

  $effect(() => {
    const d = dialog;
    if (!d) return;
    if (image && !d.open) {
      void tick().then(() => {
        try {
          d.showModal();
        } catch {
          // jsdom has no modal dialogs; the content is still there
        }
      });
    } else if (!image && d.open) d.close();
  });
</script>

<dialog
  bind:this={dialog}
  class="viewer"
  aria-label={image ? `${label.view}: ${image.alt}` : label.view}
  onclose={() => {
    if (image) close();
  }}
  onclick={(e) => {
    if (e.target === dialog) close();
  }}
>
  {#if image}
    <figure>
      <img src={image.url} alt={image.alt} data-viewer-image />
      {#if image.alt}<figcaption>{image.alt}</figcaption>{/if}
    </figure>
    <button type="button" class="close" onclick={close}>{label.close}</button>
  {/if}
</dialog>

<style>
  .viewer {
    max-width: min(92vw, 1400px);
    max-height: 92vh;
    padding: 0.8rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
  }
  .viewer::backdrop {
    background: var(--backdrop);
  }
  figure {
    margin: 0;
  }
  img {
    display: block;
    max-width: 100%;
    max-height: 80vh;
    margin: 0 auto;
  }
  figcaption {
    margin-top: 0.4rem;
    color: var(--muted);
  }
  .close {
    margin-top: 0.6rem;
  }
</style>
