<script lang="ts">
  import { closeOnBackdrop } from 'appkit-ui/backdrop';
  import { floating } from '../lib/floating';
  // Updating the page of the web variant (a file opened from disk): which build this is, and the lines that bring a
  // newer one (lib/update.ts). The page cannot fetch it or start a program; the start script of tasks-web pulls.
  import type { App } from '../lib/app.svelte';
  import type { About } from '../lib/about';
  import { translate, type Key } from '../lib/i18n';
  import { folderOf, updateLines } from '../lib/update';

  let { app, open, onclose }: { app: App; open: boolean; onclose: () => void } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  let dialog: HTMLDialogElement | undefined = $state();
  const folder = $derived(open ? folderOf(location.href) : null);
  const lines = $derived(folder === null ? null : updateLines(folder));
  const ways = $derived(
    lines === null
      ? []
      : [
          { id: 'script', line: lines.script },
          { id: 'git', line: lines.git },
        ],
  );
  let about = $state.raw<About | null>(null);

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });
  // The build is read when the dialog opens (the engine of the page answers it).
  $effect(() => {
    if (!open) return;
    let gone = false;
    app.readAbout().then(
      (doc) => {
        if (!gone) about = doc;
      },
      () => {
        // Without it the dialog still gives the lines.
      },
    );
    return () => {
      gone = true;
    };
  });

  async function copy(line: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(line);
      app.tell('ok', 'update.copied');
    } catch {
      app.tell('error', 'shortcut.copy_failed');
    }
  }
</script>

<dialog
  bind:this={dialog}
  use:floating={{ kind: 'update', moveLabel: t('float.move'), moveHint: t('hint.float.move') }}
  use:closeOnBackdrop
  aria-labelledby="update-title"
  onclose={() => {
    if (open) onclose();
  }}
>
  <h2 id="update-title">{t('update.title')}</h2>
  <p class="build" data-testid="update-build">
    {#if about}
      {t('update.build', { version: about.version, build: about.build ?? t('update.build_local') })}
    {:else}
      {t('state.loading')}
    {/if}
  </p>
  <p class="muted">{t('update.intro')}</p>
  {#if ways.length > 0}
    {#each ways as way (way.id)}
      <section aria-labelledby="update-{way.id}">
        <h3 id="update-{way.id}">{t(`update.${way.id}.title` as Key)}</h3>
        <p>{t(`update.${way.id}.body` as Key)}</p>
        <div class="line">
          <input type="text" readonly value={way.line} aria-label={t(`update.${way.id}.title` as Key)} />
          <button type="button" onclick={() => void copy(way.line)}>{t('shortcut.copy')}</button>
        </div>
      </section>
    {/each}
    <p class="warn" role="note">{t('update.after')}</p>
  {:else}
    <p>{t('update.no_folder')}</p>
  {/if}
  <div class="actions">
    <button type="button" class="primary" onclick={() => onclose()}>{t('shortcut.close')}</button>
  </div>
</dialog>

<style>
  dialog {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem 1.25rem;
    width: min(38rem, calc(100vw - 2rem));
  }
  dialog::backdrop {
    background: var(--backdrop);
  }
  h2 {
    margin: 0 0 0.5rem;
    font-size: 1.1rem;
  }
  h3 {
    margin: 0.9rem 0 0.3rem;
    font-size: 0.95rem;
  }
  p {
    margin: 0 0 0.5rem;
  }
  .build {
    font-family: var(--mono);
    font-size: 0.85rem;
  }
  .muted {
    color: var(--muted);
  }
  .warn {
    color: var(--warn);
    font-size: 0.85rem;
  }
  .line {
    display: flex;
    gap: 0.5rem;
    margin: 0 0 0.5rem;
  }
  .line input {
    flex: 1;
    min-width: 0;
    font-family: var(--mono);
    font-size: 0.8rem;
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.3rem 0.4rem;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.8rem;
  }
  button {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.35rem 0.8rem;
    cursor: pointer;
  }
  .primary {
    border-color: var(--accent);
  }
</style>
