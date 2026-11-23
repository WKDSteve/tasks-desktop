<script lang="ts">
  // "Open in DocMap" at a task: loaded only for a task that may name a place in code (`Detail.svelte`), so the start of
  // the page does not carry it. The hub reads the places (a `code-ref` block, or a ref `<file>:<lines>`), finds the repo
  // among the tiles and says per place whether it opens, and the way (`app`: docmap-desktop, `page`: the generated page
  // of the repo in the browser, where docmap-desktop is not); a button shows only for a place the hub can open, so
  // nothing is dead (a web page, a repo that is no tile, neither docmap-desktop nor a page). A click names the task and
  // the number.
  import type { App } from '../lib/app.svelte';
  import type { DocmapPlaces } from '../lib/api';
  import { ApiError } from '../lib/api';

  let { app, task, text }: { app: App; task: { id: string; refs: readonly string[] }; text: string } = $props();
  // The words stand here, not in the language files: the start of the page does not carry them.
  const label = $derived(app.lang === 'de' ? 'In DocMap öffnen' : 'Open in DocMap');

  let found = $state<DocmapPlaces | null>(null);
  $effect(() => {
    const id = task.id;
    if (!(text.includes('code-ref') || task.refs.some((r) => /:\d/.test(r)))) {
      found = null;
      return;
    }
    // Asked again when the text or the refs of the task change.
    void text;
    void task.refs;
    let current = true;
    app.env.hub.docmapPlaces(id).then(
      (answer) => {
        if (current) found = answer;
      },
      () => {
        if (current) found = null;
      },
    );
    return () => {
      current = false;
    };
  });
  async function go(index: number): Promise<void> {
    try {
      await app.env.hub.openInDocmap(task.id, index);
    } catch (error) {
      app.say('error', 'editor.failed', { message: error instanceof ApiError ? error.message : '' });
    }
  }
  const openable = $derived(
    found ? found.places.map((place, index) => ({ place, index })).filter((entry) => entry.place.ok) : [],
  );
</script>

{#each openable as entry (entry.index)}
  <button
    type="button"
    class="open-editor"
    data-testid="open-docmap"
    data-way={entry.place.way}
    onclick={() => void go(entry.index)}>{openable.length === 1 ? label : `${label}: ${entry.place.label}`}</button
  >
{/each}
