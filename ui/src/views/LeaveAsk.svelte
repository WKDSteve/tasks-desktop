<script lang="ts">
  // The question of a dialog that holds something typed: discard it, or go on. Shown by `leaveGuard` when the person
  // pressed Escape; the focus goes to "Keep editing", the safe answer.
  import { onMount } from 'svelte';
  import type { App } from '../lib/app.svelte';
  import { translate } from '../lib/i18n';

  let { app, ondiscard, onkeep }: { app: App; ondiscard: () => void; onkeep: () => void } = $props();
  let keep: HTMLButtonElement | undefined = $state();
  // The field that had the focus gets it back on "Keep editing": Escape must reach the dialog again.
  const opener = typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);
  onMount(() => keep?.focus());
  const keepEditing = (): void => {
    onkeep();
    if (opener?.isConnected) opener.focus();
  };
</script>

<p class="leave-ask" role="alert">
  {translate(app.lang, 'leave.confirm')}
  <button type="button" onclick={ondiscard}>{translate(app.lang, 'leave.discard')}</button>
  <button type="button" class="primary" bind:this={keep} onclick={keepEditing}>{translate(app.lang, 'leave.keep')}</button>
</p>

<style>
  .leave-ask {
    margin: 0 0 0.5rem;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-2);
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 0.6rem;
    align-items: center;
  }
</style>
