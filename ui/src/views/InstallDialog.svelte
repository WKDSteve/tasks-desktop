<script lang="ts">
  import { closeOnBackdrop } from 'appkit-ui/backdrop';
  // The installation offered from the Help menu of a hub that is set up but does not run from the installed copy (a
  // vault from TASKS_VAULT, the downloaded program double-clicked): the install part of the setup card.
  import type { App } from '../lib/app.svelte';
  import { translate, type Key } from '../lib/i18n';
  import SetupCard from './SetupCard.svelte';

  let { app, open, onclose }: { app: App; open: boolean; onclose: () => void } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  let dialog: HTMLDialogElement | undefined = $state();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });
</script>

<dialog bind:this={dialog} use:closeOnBackdrop aria-label={t('setup.page.install_title')} {onclose}>
  <SetupCard {app} only="install" />
  <div class="actions">
    <button type="button" onclick={() => dialog?.close()}>{t('setup.page.close')}</button>
  </div>
</dialog>

<style>
  dialog {
    max-width: 32rem;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 1rem;
  }
</style>
