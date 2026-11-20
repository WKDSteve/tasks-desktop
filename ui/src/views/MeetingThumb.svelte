<script lang="ts">
  // The small picture of a meeting (cover, else its old `image`): read once with the session and kept as an address the
  // page makes itself. A meeting without a picture, or one the hub cannot give, shows nothing.
  import type { App } from '../lib/app.svelte';
  import type { MeetingEntry } from '../lib/contract';
  import { coverOf } from '../lib/meetings';

  let { app, meeting, size = 16 }: { app: App; meeting: Pick<MeetingEntry, 'id' | 'image' | 'updated'>; size?: number } = $props();

  // One reading per meeting and picture, for as long as the page lives (the pictures are small).
  const known = new Map<string, Promise<string | null>>();
  let src = $state<string | null>(null);
  const wanted = $derived(coverOf(meeting as typeof meeting & { cover?: string }));

  $effect(() => {
    const id = meeting.id;
    const key = `${id}|${String(wanted)}|${String(meeting.updated ?? '')}`;
    if (wanted === undefined) {
      src = null;
      return;
    }
    let live = true;
    let asked = known.get(key);
    if (!asked) {
      asked = app.meetingThumb(id).then((blob) => {
        try {
          return blob ? URL.createObjectURL(blob) : null;
        } catch {
          return null;
        }
      });
      known.set(key, asked);
    }
    void asked.then((url) => {
      if (live) src = url;
    });
    return () => {
      live = false;
    };
  });
</script>

{#if src}<img class="thumb" {src} alt="" width={size} height={size} data-meeting-thumb />{/if}

<style>
  .thumb {
    flex: none;
    object-fit: cover;
    border-radius: 2px;
    vertical-align: middle;
  }
</style>
