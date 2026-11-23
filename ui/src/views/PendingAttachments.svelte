<script lang="ts">
  // What a form that makes a task, a plan or a project attaches to it once it is made: files from this computer and
  // the image on the clipboard of the hub's machine (else its newest screenshot). Nothing is sent while the form is
  // open: the thing does not exist yet. `App.attachAll` sends them after it was made, one by one, each through the
  // hub's upload to the engine (`attach`), which makes a plain file the folder of its assets.
  import type { App } from '../lib/app.svelte';
  import { translate, type Key } from '../lib/i18n';

  let {
    app,
    files = $bindable([]),
    screenshot = $bindable(false),
  }: { app: App; files?: File[]; screenshot?: boolean } = $props();

  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);
  // The words of this part stand here, not in the language files: the start of the page does not carry them.
  const de = $derived(app.lang === 'de');
  const words = $derived({
    pending: de ? 'Nach dem Anlegen anhängen' : 'Attach once it is made',
    files: de ? 'Dateien von diesem Rechner' : 'Files from this computer',
    list: de ? 'Anzuhängende Dateien' : 'Files to attach',
  });
  const removeLabel = (name: string) => (de ? `${name} nicht anhängen` : `Do not attach ${name}`);

  function picked(input: HTMLInputElement): void {
    const chosen = [...(input.files ?? [])];
    input.value = '';
    // the same file twice is attached once
    const known = new Set(files.map((f) => `${f.name}\u0000${f.size}`));
    files = [...files, ...chosen.filter((f) => !known.has(`${f.name}\u0000${f.size}`))];
  }
</script>

{#if app.canAttach}
  <fieldset class="pending">
    <legend>{words.pending}</legend>
    <label class="file" data-hint={t('hint.form.task.files')}>
      <span>{words.files}</span>
      <input type="file" multiple onchange={(e) => picked(e.currentTarget)} />
    </label>
    {#if files.length > 0}
      <ul aria-label={words.list}>
        {#each files as file, i (`${file.name}-${file.size}-${i}`)}
          <li>
            <span class="name">{file.name}</span>
            <button
              type="button"
              aria-label={removeLabel(file.name)}
              onclick={() => (files = files.filter((_, j) => j !== i))}>×</button
            >
          </li>
        {/each}
      </ul>
    {/if}
    <label class="check" data-hint={t('hint.form.task.attach')}>
      <input type="checkbox" bind:checked={screenshot} />
      <span>{t('capture.attach')}</span>
    </label>
  </fieldset>
{/if}

<style>
  .pending {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.4rem 0.6rem 0.2rem;
    margin: 0 0 0.7rem;
  }
  legend {
    color: var(--muted);
    font-size: 0.85rem;
    padding: 0 0.3rem;
  }
  label {
    display: grid;
    gap: 0.2rem;
    margin-bottom: 0.5rem;
  }
  label.check {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  ul {
    list-style: none;
    margin: 0 0 0.5rem;
    padding: 0;
    display: grid;
    gap: 0.2rem;
  }
  li {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  .name {
    overflow-wrap: anywhere;
  }
  button {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0 0.45rem;
    cursor: pointer;
  }
</style>
