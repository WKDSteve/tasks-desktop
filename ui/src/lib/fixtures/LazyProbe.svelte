<script lang="ts">
  // What `Lazy` loads in its tests: a dialog whose state the page holds, as small as it gets.
  import type { App } from '../app.svelte';

  let { app, open, onclose }: { app: App; open: boolean; onclose: () => void } = $props();
</script>

<p data-testid="probe" lang={app.lang}>
  {open ? 'open' : 'closed'}
  <button type="button" onclick={() => onclose()}>close</button>
</p>
