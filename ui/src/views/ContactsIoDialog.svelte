<script lang="ts">
  // The import and the export of contacts, one dialog (`app.contactsIo`). Import: a .vcf or .csv file picked here is read
  // as UTF-8 and sent to the engine as text (`contacts_import`), first as a dry run: the report says what would be made,
  // which records are duplicates (a mail a contact already holds: never overwritten) and what is not taken over; the
  // import runs only when the person confirms that report. Export: the engine writes the file text (`contacts_export`),
  // the browser saves it. No message here names a mail address or a number: the report names people by name and by the
  // number of their card or row. The logic is `lib/contactsIo.ts`, the words `lib/contactsIoTexts.ts`.
  import { untrack } from 'svelte';
  import { closeOnBackdrop } from 'appkit-ui/backdrop';
  import type { App } from '../lib/app.svelte';
  import { contactChoices } from '../lib/contacts';
  import { contactsAll } from '../lib/contactsApp';
  import {
    countsOf,
    EXPORT_DEFAULTS,
    inputKey,
    localDay,
    MAX_IMPORT_BYTES,
    previewImport,
    readPicked,
    runExport,
    runImport,
    type DelimiterChoice,
    type ExportForm,
    type ImportAnswer,
    type ImportInput,
  } from '../lib/contactsIo';
  import { contactsIoText, isContactsIoKey, type ContactsIoKey } from '../lib/contactsIoTexts';
  import type { ContactEntry, ContactImportReport } from '../lib/contract';
  import { areaLabel } from '../lib/filter';
  import { floating } from '../lib/floating';
  import { translate, type Key } from '../lib/i18n';
  import { markHidden } from '../lib/text';

  let { app }: { app: App } = $props();
  const t = (key: Key | ContactsIoKey, params: Record<string, string | number> = {}) =>
    isContactsIoKey(key) ? contactsIoText(app.lang, key, params) : translate(app.lang, key, params);

  let dialog: HTMLDialogElement | undefined = $state();
  const kind = $derived(app.contactsIo);

  const areas = $derived(
    [...app.allAreaNames]
      .map((name) => ({ value: name, label: app.shortAreas ? areaLabel(name, app.allAreaNames) : name, title: name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  );

  // ── import ──
  let area = $state('');
  let delimiter = $state<DelimiterChoice>('auto');
  /** The file read: its text and format, or why it cannot be imported. */
  let picked = $state<{ text: string; as: 'vcf' | 'csv' } | null>(null);
  let fileProblem = $state<ContactsIoKey | null>(null);
  /** The last answer of the engine and the input it holds for (a trial run, or the import itself). */
  let answer = $state<{ key: string; value: ImportAnswer } | null>(null);
  let trying = $state(false);
  let failed = $state(false);
  let busy = $state(false);
  const input = $derived<ImportInput | null>(
    picked && area ? { area, text: picked.text, as: picked.as, delimiter, lang: app.lang === 'de' ? 'de' : 'en' } : null,
  );
  const key = $derived(input ? inputKey(input) : '');
  const shown = $derived(answer && answer.key === key ? answer.value : null);
  const report = $derived<ContactImportReport | null>(shown?.kind === 'report' ? shown.report : null);
  const isDry = $derived(shown?.kind === 'report' && shown.dryRun);
  const canImport = $derived(
    input !== null && report !== null && isDry && report.created.length > 0 && !busy && !app.locked && !app.saving,
  );

  // ── export ──
  let form = $state<ExportForm>({ ...EXPORT_DEFAULTS });
  let contacts = $state<ContactEntry[]>([]);
  let exporting = $state(false);
  let exported = $state<{ key: ContactsIoKey; params: Record<string, string | number> } | null>(null);
  const choices = $derived(contactChoices(contacts));

  $effect(() => {
    if (!dialog) return;
    if (kind !== null && !dialog.open) {
      area = app.contactArea;
      delimiter = 'auto';
      picked = null;
      fileProblem = null;
      answer = null;
      failed = false;
      form = { ...EXPORT_DEFAULTS };
      exported = null;
      dialog.showModal();
    }
    if (kind === null && dialog.open) dialog.close();
  });

  // An area the list does not offer (none yet when the dialog opened, or gone) is the first one it offers.
  $effect(() => {
    if (kind === 'import' && areas.length > 0 && !areas.some((a) => a.value === area)) area = areas[0]!.value;
  });

  // The filters of the export offer what the contacts have (their organisations, tags and areas).
  $effect(() => {
    if (kind !== 'export') return;
    const abort = new AbortController();
    contactsAll(app, abort.signal)
      .then((all) => {
        if (!abort.signal.aborted) contacts = all.items;
      })
      .catch(() => {});
    return () => abort.abort();
  });

  // The trial run follows the input (the file, the area, the delimiter): nothing is written.
  $effect(() => {
    const snapshot = input ? ($state.snapshot(input) as ImportInput) : null;
    if (kind !== 'import' || snapshot === null) return;
    const k = inputKey(snapshot);
    // the answer is read without following it: setting it must not start (and abort) this run again
    if (untrack(() => answer?.key) === k) return;
    const abort = new AbortController();
    trying = true;
    failed = false;
    previewImport(app, snapshot, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted) answer = { key: k, value };
      })
      .catch(() => {
        if (!abort.signal.aborted) failed = true;
      })
      .finally(() => {
        if (!abort.signal.aborted) trying = false;
      });
    return () => abort.abort();
  });

  async function pick(event: Event): Promise<void> {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    picked = null;
    fileProblem = null;
    answer = null;
    if (!file) return;
    const read = await readPicked(file);
    if (read.kind === 'ok') picked = { text: read.text, as: read.as };
    else fileProblem = `io.import.${read.kind}` as ContactsIoKey;
  }

  async function confirmImport(): Promise<void> {
    if (!canImport || input === null) return;
    busy = true;
    const snapshot = $state.snapshot(input) as ImportInput;
    try {
      const value = await runImport(app, snapshot);
      if (value) answer = { key: inputKey(snapshot), value };
    } finally {
      busy = false;
    }
  }

  async function saveExport(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (exporting) return;
    exporting = true;
    exported = null;
    try {
      const outcome = await runExport(app, $state.snapshot(form) as ExportForm, localDay(new Date()), document);
      exported =
        outcome.kind === 'saved'
          ? { key: 'io.export.saved', params: { n: outcome.count, name: outcome.name } }
          : { key: outcome.kind === 'empty' ? 'io.export.empty' : 'io.export.blocked', params: {} };
    } catch {
      exported = { key: 'io.failed', params: {} };
    } finally {
      exporting = false;
    }
  }

  const nameOf = (name: string | undefined) => (name ? markHidden(name) : t('io.report.unnamed'));
</script>

<dialog
  bind:this={dialog}
  class="contacts-io"
  use:floating={{ kind: 'contacts-io', moveLabel: t('float.move'), moveHint: t('hint.float.move') }}
  use:closeOnBackdrop={{ closeable: () => !busy }}
  aria-labelledby="contacts-io-title"
  onclose={() => app.closeContactsIo()}
>
  {#if kind === 'import'}
    <div data-contacts-import>
      <h2 id="contacts-io-title">{t('io.import.title')}</h2>
      <p class="intro">{t('io.import.intro')}</p>
      <label data-hint={t('io.import.file.hint')}>
        <span>{t('io.import.file')}</span>
        <input type="file" accept=".vcf,.vcard,.csv,text/vcard,text/csv" onchange={pick} data-io-file />
      </label>
      <p class="muted">{t('io.import.encoding')}</p>
      <div class="row">
        <label data-hint={t('io.import.area.hint')}>
          <span>{t('io.import.area')}</span>
          <select bind:value={area} required data-io-area>
            {#each areas as a (a.value)}<option value={a.value} title={a.title}>{a.label}</option>{/each}
          </select>
        </label>
        {#if picked?.as === 'csv'}
          <label data-hint={t('io.import.delimiter.hint')}>
            <span>{t('io.import.delimiter')}</span>
            <select bind:value={delimiter} data-io-delimiter>
              {#each ['auto', 'comma', 'semicolon', 'tab'] as const as d (d)}<option value={d}>{t(`io.delimiter.${d}`)}</option>{/each}
            </select>
          </label>
        {/if}
      </div>

      <div class="status" role="status" data-io-status>
        {#if fileProblem}
          <p class="bad">{t(fileProblem, { kb: Math.floor(MAX_IMPORT_BYTES / 1000) })}</p>
        {:else if trying}
          <p class="muted">{t('io.import.trying')}</p>
        {:else if failed}
          <p class="bad">{t('io.failed')}</p>
        {:else if shown?.kind === 'refused'}
          <p class="bad" data-io-refused>{t('io.import.refused', { message: shown.message })}</p>
        {:else if report}
          <p data-io-summary>{t(isDry ? 'io.import.would' : 'io.import.made', countsOf(report))}</p>
          {#if isDry && report.created.length === 0}<p class="warn">{t('io.import.nothing')}</p>{/if}
        {/if}
      </div>

      {#if report}
        <div class="report" data-io-report>
          {#if report.created.length > 0}
            <h3>{isDry ? t('io.report.created') : t('io.report.created_done')}</h3>
            <ul data-io-created>
              {#each report.created as r (r.index)}<li>{t('io.report.row_created', { index: r.index, name: nameOf(r.name), id: r.id })}</li>{/each}
            </ul>
          {/if}
          {#if report.duplicates.length > 0}
            <h3>{t('io.report.duplicates')}</h3>
            <ul data-io-duplicates>
              {#each report.duplicates as r (r.index)}<li>{t('io.report.row_duplicate', { index: r.index, name: nameOf(r.name), of: r.of })}</li>{/each}
            </ul>
          {/if}
          {#if report.refused.length > 0}
            <h3>{t('io.report.refused')}</h3>
            <ul data-io-refused-list>
              {#each report.refused as r (r.index)}<li>{t('io.report.row_refused', { index: r.index, name: nameOf(r.name), reason: r.reason })}</li>{/each}
            </ul>
          {/if}
          {#if report.problems.length > 0}
            <h3>{t('io.report.problems')}</h3>
            <ul data-io-problems>
              {#each report.problems as r, i (i)}<li>{t('io.report.row_problem', { index: r.index, name: nameOf(r.name), text: r.text })}</li>{/each}
            </ul>
          {/if}
          {#if report.messages.length > 0}
            <h3>{t('io.report.messages')}</h3>
            <ul data-io-messages>
              {#each report.messages as m, i (i)}<li>{m}</li>{/each}
            </ul>
          {/if}
        </div>
      {/if}

      <div class="actions">
        <button type="button" data-hint={t('io.close.hint')} onclick={() => app.closeContactsIo()} data-io-close>{t('io.close')}</button>
        {#if isDry}
          <button type="button" class="primary" disabled={!canImport} data-hint={t('io.import.run.hint')} onclick={confirmImport} data-io-run>
            {t('io.import.run', { n: report?.created.length ?? 0 })}
          </button>
        {/if}
      </div>
    </div>
  {:else if kind === 'export'}
    <form onsubmit={saveExport} data-contacts-export>
      <h2 id="contacts-io-title">{t('io.export.title')}</h2>
      <p class="intro">{t('io.export.intro')}</p>
      <fieldset>
        <legend>{t('io.export.format')}</legend>
        <label class="choice" data-hint={t('io.export.vcf.hint')}>
          <input type="radio" name="contacts-io-format" value="vcf" bind:group={form.format} data-io-format="vcf" />
          <span>{t('io.export.vcf')}</span>
        </label>
        <label class="choice" data-hint={t('io.export.csv.hint')}>
          <input type="radio" name="contacts-io-format" value="csv" bind:group={form.format} data-io-format="csv" />
          <span>{t('io.export.csv')}</span>
        </label>
      </fieldset>
      {#if form.format === 'vcf'}
        <label data-hint={t('io.export.version.hint')}>
          <span>{t('io.export.version')}</span>
          <select bind:value={form.version} data-io-version>
            <option value="4">4.0</option>
            <option value="3">3.0</option>
          </select>
        </label>
      {:else}
        <label data-hint={t('io.export.delimiter.hint')}>
          <span>{t('io.export.delimiter')}</span>
          <select bind:value={form.delimiter} data-io-export-delimiter>
            {#each ['semicolon', 'comma', 'tab'] as const as d (d)}<option value={d}>{t(`io.delimiter.${d}`)}</option>{/each}
          </select>
        </label>
        <label class="choice" data-hint={t('io.export.bom.hint')}>
          <input type="checkbox" bind:checked={form.bom} data-io-bom />
          <span>{t('io.export.bom')}</span>
        </label>
        <label class="choice" data-hint={t('io.export.raw.hint')}>
          <input type="checkbox" bind:checked={form.raw} data-io-raw />
          <span>{t('io.export.raw')}</span>
        </label>
        <p class="muted">{t('io.export.encoding')}</p>
      {/if}
      <div class="row">
        <label data-hint={t('io.export.area.hint')}>
          <span>{t('io.export.area')}</span>
          <select bind:value={form.area} data-io-export-area>
            <option value="">{t('io.export.all')}</option>
            {#each areas as a (a.value)}<option value={a.value} title={a.title}>{a.label}</option>{/each}
          </select>
        </label>
        <label data-hint={t('io.export.tag.hint')}>
          <span>{t('io.export.tag')}</span>
          <select bind:value={form.tag} data-io-export-tag>
            <option value="">{t('io.export.all')}</option>
            {#each choices.tags as tag (tag)}<option value={tag}>{markHidden(tag)}</option>{/each}
          </select>
        </label>
        <label data-hint={t('io.export.org.hint')}>
          <span>{t('io.export.org')}</span>
          <select bind:value={form.org} data-io-export-org>
            <option value="">{t('io.export.all')}</option>
            {#each choices.orgs as org (org)}<option value={org}>{markHidden(org)}</option>{/each}
          </select>
        </label>
      </div>
      <div class="status" role="status" data-io-status>
        {#if exporting}
          <p class="muted">{t('io.export.saving')}</p>
        {:else if exported}
          <p class={exported.key === 'io.export.saved' ? '' : 'bad'} data-io-exported>{t(exported.key, exported.params)}</p>
        {/if}
      </div>
      <div class="actions">
        <button type="button" data-hint={t('io.close.hint')} onclick={() => app.closeContactsIo()} data-io-close>{t('io.close')}</button>
        <button type="submit" class="primary" disabled={exporting} data-hint={t('io.export.save.hint')} data-io-save>{t('io.export.save')}</button>
      </div>
    </form>
  {/if}
</dialog>

<style>
  dialog {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem 1.25rem;
    width: min(44rem, calc(100vw - 2rem));
    max-height: calc(100vh - 2rem);
    overflow: auto;
  }
  dialog::backdrop {
    background: var(--backdrop);
  }
  h2 {
    margin: 0 0 0.5rem;
    font-size: 1.1rem;
  }
  h3 {
    margin: 0.6rem 0 0.2rem;
    font-size: 0.95rem;
  }
  .intro {
    margin: 0 0 0.7rem;
    color: var(--muted);
  }
  label {
    display: grid;
    gap: 0.2rem;
    margin-bottom: 0.7rem;
  }
  label.choice {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.4rem;
  }
  fieldset {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    margin: 0 0 0.7rem;
    padding: 0.4rem 0.7rem 0.2rem;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }
  .row > label {
    flex: 1 1 11rem;
  }
  select,
  input[type='file'] {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.35rem 0.5rem;
    min-width: 0;
    font: inherit;
  }
  .status {
    min-height: 1.4rem;
    margin-bottom: 0.5rem;
    overflow-wrap: anywhere;
  }
  .status p,
  .muted {
    margin: 0 0 0.3rem;
  }
  .muted {
    color: var(--muted);
    font-size: 0.85rem;
  }
  .warn {
    color: var(--warn);
  }
  .bad {
    color: var(--bad);
  }
  .report {
    max-height: 16rem;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.2rem 0.7rem 0.5rem;
    margin-bottom: 0.7rem;
    font-size: 0.9rem;
  }
  .report ul {
    margin: 0;
    padding-left: 1.2rem;
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  button {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.3rem 0.7rem;
    cursor: pointer;
    font: inherit;
  }
  button.primary {
    border-color: var(--accent);
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
