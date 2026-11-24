<script lang="ts">
  // "Paste an intent ...": what another app hands over (`wkd-intent/1`, lib/intent.ts), pasted into the field with
  // Ctrl+V or chosen as a file. The page does not read the clipboard by itself. *Check* asks the engine what the
  // intent would do; a finding opens the new-task form filled in, a task is shown, and a finding a task holds already
  // is offered to be opened. Nothing is written here.
  import { closeOnBackdrop } from 'appkit-ui/backdrop';
  import type { App } from '../lib/app.svelte';
  import { floating } from '../lib/floating';
  import { translate, type Key } from '../lib/i18n';
  import { INTENT_MAX_BYTES, type IntentOutcome } from '../lib/intent';

  let { app, open, onclose }: { app: App; open: boolean; onclose: () => void } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  let dialog: HTMLDialogElement | undefined = $state();
  let text = $state('');
  let busy = $state(false);
  let outcome = $state<IntentOutcome | null>(null);
  /** The name of the file that was read into the field, said so that the person sees where the text came from. */
  let fromFile = $state('');

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      text = '';
      outcome = null;
      fromFile = '';
      busy = false;
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  });

  async function check(): Promise<void> {
    if (busy) return;
    busy = true;
    outcome = null;
    try {
      outcome = await app.takeIntent(text);
    } finally {
      busy = false;
    }
  }

  /** A file the person chose: read as text into the field (never more than an intent may weigh), then checked. */
  async function chose(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    fromFile = file.name;
    if (file.size > INTENT_MAX_BYTES) {
      text = '';
      outcome = { kind: 'refused', problem: 'too_large' };
      return;
    }
    text = await file.text();
    await check();
  }

  const said = $derived.by((): { alert: boolean; text: string } | null => {
    if (outcome === null) return null;
    if (outcome.kind === 'refused') {
      if (outcome.problem) return { alert: true, text: t(`intent.problem.${outcome.problem}` as Key) };
      return { alert: true, text: t('intent.refused', { why: outcome.why ?? '' }) };
    }
    if (outcome.kind === 'not_found') return { alert: true, text: t('intent.not_found', { id: outcome.id }) };
    if (outcome.kind === 'exists') return { alert: false, text: t('intent.exists', { id: outcome.id }) };
    return null;
  });
</script>

<dialog
  bind:this={dialog}
  class="intent-dialog"
  use:floating={{ kind: 'intent', moveLabel: t('float.move'), moveHint: t('hint.float.move') }}
  use:closeOnBackdrop={{ closeable: () => text.trim() === '' }}
  aria-labelledby="intent-title"
  {onclose}
>
  {#if open}
    <form onsubmit={(e) => (e.preventDefault(), void check())}>
      <h2 id="intent-title">{t('intent.title')}</h2>
      <p class="muted">{t('intent.intro')}</p>
      <label data-hint={t('hint.form.intent.text')}>
        <span>{t('intent.text_label')}</span>
        <textarea bind:value={text} rows="8" spellcheck="false" autocomplete="off" disabled={busy}></textarea>
      </label>
      <label data-hint={t('hint.form.intent.file')}>
        <span>{t('intent.file_label')}</span>
        <input type="file" accept=".json,application/json" onchange={(e) => void chose(e)} disabled={busy} />
      </label>
      {#if fromFile !== ''}<p class="muted">{t('intent.from_file', { name: fromFile })}</p>{/if}
      {#if busy}
        <p role="status">{t('intent.checking')}</p>
      {:else if said}
        <p role={said.alert ? 'alert' : 'status'} class:refused={said.alert}>{said.text}</p>
      {/if}
      <div class="actions">
        {#if outcome?.kind === 'exists'}
          {@const id = outcome.id}
          <button type="button" class="primary" onclick={() => app.openIntentTask(id)}>{t('intent.open_existing')}</button>
        {/if}
        <button type="submit" class:primary={outcome?.kind !== 'exists'} disabled={busy || text.trim() === ''}>{t('intent.check')}</button>
        <button type="button" onclick={() => dialog?.close()}>{t('intent.close')}</button>
      </div>
    </form>
  {/if}
</dialog>

<style>
  .intent-dialog {
    width: min(40rem, 94vw);
  }
  form {
    display: grid;
    gap: 0.6rem;
  }
  h2,
  p {
    margin: 0;
  }
  label {
    display: grid;
    gap: 0.2rem;
  }
  textarea {
    width: 100%;
    font-family: var(--mono, monospace);
    font-size: 1rem;
    resize: vertical;
  }
  .refused {
    color: var(--warn);
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: flex-end;
  }
</style>
