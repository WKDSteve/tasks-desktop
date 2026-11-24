<script lang="ts">
  // The form of a contact, new or changed: one dialog. While the person types, the engine is asked for a dry run
  // (`contact_new`, `contact_set`): it names the file the contact would get or says why it would refuse it (never with an
  // address or a number in the words), so the rules are not written a second time here. Esc and a click beside the
  // dialog do not throw a changed form away unasked: the dialog asks first. A change is made on the version the form
  // was opened on; a change by someone else in between ends in the conflict center, not in an overwrite. The words are
  // the chunk's (lib/contactsTexts.ts).
  import { closeOnBackdrop } from 'appkit-ui/backdrop';
  import type { App } from '../lib/app.svelte';
  import { isDirty, MAX_LIST, splitList, type ContactForm, type ContactPreview } from '../lib/contacts';
  import { previewContact, saveContact } from '../lib/contactsApp';
  import { contactsText, isContactsKey, type ContactsKey } from '../lib/contactsTexts';
  import type { ContactEntry } from '../lib/contract';
  import { areaLabel } from '../lib/filter';
  import { floating } from '../lib/floating';
  import { translate, type Key } from '../lib/i18n';

  let { app }: { app: App } = $props();
  const t = (key: Key | ContactsKey, params: Record<string, string | number> = {}) =>
    isContactsKey(key) ? contactsText(app.lang, key, params) : translate(app.lang, key, params);

  let dialog: HTMLDialogElement | undefined = $state();
  let form = $state<ContactForm | null>(null);
  /** The form as it was opened, to know what was touched. */
  let opened = $state<ContactForm | null>(null);
  /** The contact being changed, as the engine has it now (the form's keys are judged against it). */
  let before = $state<ContactEntry | null>(null);
  let answer = $state<{ key: string; value: ContactPreview } | null>(null);
  let asking = $state(false);
  let busy = $state(false);
  const formKey = $derived(JSON.stringify(form));
  const preview = $derived<ContactPreview | null>(answer && answer.key === formKey ? answer.value : null);
  const isNew = $derived(form !== null && form.id === undefined);
  const dirty = $derived(form !== null && opened !== null && isDirty(form, opened));
  const zones = $derived(Intl.supportedValuesOf('timeZone'));
  const tooMany = $derived(form !== null && (splitList(form.emails).length > MAX_LIST || splitList(form.phones).length > MAX_LIST));

  const areas = $derived(
    [...app.allAreaNames]
      .map((name) => ({ value: name, label: app.shortAreas ? areaLabel(name, app.allAreaNames) : name, title: name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  );

  $effect(() => {
    if (!dialog) return;
    if (app.contactDraft !== null && !dialog.open) {
      form = { ...($state.snapshot(app.contactDraft) as ContactForm) };
      opened = { ...form };
      before = null;
      answer = null;
      asking = false;
      dialog.showModal();
    }
    if (app.contactDraft === null && dialog.open) dialog.close();
  });

  // A contact to change is read once: the form's keys are judged against what the engine has now.
  $effect(() => {
    const id = app.contactDraft?.id;
    if (id === undefined) return;
    const abort = new AbortController();
    app
      .readContact(id, abort.signal)
      .then((doc) => {
        if (!abort.signal.aborted) before = doc.contact;
      })
      .catch(() => {});
    return () => abort.abort();
  });

  // The dry run follows the form, a moment after the last key; an answer for an older form is dropped.
  $effect(() => {
    if (app.contactDraft === null || form === null) return;
    const snapshot = $state.snapshot(form) as ContactForm;
    const was = before;
    if (snapshot.name.trim() === '' || snapshot.area === '') return;
    if (snapshot.id !== undefined && was === null) return;
    const key = JSON.stringify(snapshot);
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      const value = await previewContact(app, snapshot, was, abort.signal);
      if (!abort.signal.aborted) answer = { key, value };
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  });

  const canSave = $derived(
    form !== null && form.name.trim() !== '' && form.area !== '' && !tooMany && preview?.kind !== 'refused' && (isNew || before !== null),
  );

  /** Leave the form: at once when nothing was touched, else after the person said so. */
  function leave(): void {
    if (dirty) asking = true;
    else app.closeContactForm();
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy || app.saving || form === null || !canSave) return;
    busy = true;
    try {
      await saveContact(app, $state.snapshot(form) as ContactForm, before);
    } finally {
      busy = false;
    }
  }
</script>

<dialog
  bind:this={dialog}
  class="contact-form"
  use:floating={{ kind: 'contact-form', moveLabel: t('float.move'), moveHint: t('hint.float.move') }}
  use:closeOnBackdrop={{ closeable: () => !dirty }}
  aria-labelledby="contact-form-title"
  oncancel={(event) => {
    // Esc: a form that was touched is not thrown away without a word.
    if (dirty) {
      event.preventDefault();
      asking = true;
    }
  }}
  onclose={() => app.closeContactForm()}
>
  {#if form}
    <form onsubmit={submit}>
      <h2 id="contact-form-title">{isNew ? t('contactform.new') : t('contactform.edit')}</h2>
      <label data-hint={t('contactform.name.hint')}>
        <span>{t('contactform.name')}</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input spellcheck="true" type="text" bind:value={form.name} maxlength="300" required autofocus data-contact-name />
      </label>
      <label data-hint={t('contactform.area.hint')}>
        <span>{t('contactform.area')}</span>
        <select bind:value={form.area} required disabled={!isNew} data-contact-area>
          {#each areas as a (a.value)}<option value={a.value} title={a.title}>{a.label}</option>{/each}
        </select>
      </label>
      <div class="row">
        <label data-hint={t('contactform.org.hint')}>
          <span>{t('contactform.org')}</span>
          <input spellcheck="true" type="text" bind:value={form.org} maxlength="300" data-contact-org />
        </label>
        <label data-hint={t('contactform.role.hint')}>
          <span>{t('contactform.role')}</span>
          <input spellcheck="true" type="text" bind:value={form.role} maxlength="300" data-contact-role />
        </label>
      </div>
      <label data-hint={t('contactform.emails.hint')}>
        <span>{t('contactform.emails')} <small>({t('contactform.list_hint')})</small></span>
        <input spellcheck="false" type="text" bind:value={form.emails} maxlength="2000" autocomplete="off" data-contact-emails />
      </label>
      <label data-hint={t('contactform.phones.hint')}>
        <span>{t('contactform.phones')} <small>({t('contactform.list_hint')})</small></span>
        <input spellcheck="false" type="text" bind:value={form.phones} maxlength="2000" autocomplete="off" data-contact-phones />
      </label>
      <div class="row">
        <label data-hint={t('contactform.tz.hint')}>
          <span>{t('contactform.tz')}</span>
          <input spellcheck="false" type="text" bind:value={form.tz} maxlength="100" list="contact-zones" autocomplete="off" data-contact-tz />
          <datalist id="contact-zones">{#each zones as zone (zone)}<option value={zone}></option>{/each}</datalist>
        </label>
        <label data-hint={t('contactform.tags.hint')}>
          <span>{t('contactform.tags')} <small>({t('contactform.list_hint')})</small></span>
          <input spellcheck="false" type="text" bind:value={form.tags} maxlength="500" data-contact-tags />
        </label>
      </div>
      {#if isNew}
        <label data-hint={t('contactform.notes.hint')}>
          <span>{t('contactform.notes')}</span>
          <textarea spellcheck="true" bind:value={form.notes} rows="4" maxlength="20000" data-contact-notes></textarea>
        </label>
      {/if}

      <p class="preview" role="status" aria-live="polite">
        {#if preview?.kind === 'ok' && preview.changed}
          {t('contactform.will', { id: preview.id })}
        {:else if preview?.kind === 'ok'}
          <span class="muted">{t('contactform.unchanged')}</span>
        {:else if preview?.kind === 'refused'}
          <span class="bad" data-contact-refused>{preview.message}</span>
        {:else if preview?.kind === 'unknown' && form.name.trim() !== ''}
          <span class="warn">{t('contactform.unknown')}</span>
        {/if}
      </p>

      {#if asking}
        <div class="ask" role="group" aria-label={t('contactform.discard')} data-contact-discard-ask>
          <p role="alert">{t('contactform.discard_ask')}</p>
          <div class="actions">
            <button type="button" onclick={() => (asking = false)} data-contact-keep>{t('contactform.keep')}</button>
            <button type="button" class="danger" onclick={() => app.closeContactForm()} data-contact-discard>{t('contactform.discard')}</button>
          </div>
        </div>
      {/if}

      <div class="actions">
        <button type="button" onclick={leave} data-contact-cancel>{t('contactform.cancel')}</button>
        <button type="submit" class="primary" disabled={busy || app.locked || !canSave} data-contact-save>
          {isNew ? t('contactform.create') : t('contactform.save')}
        </button>
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
    width: min(40rem, calc(100vw - 2rem));
    max-height: calc(100vh - 2rem);
    overflow: auto;
  }
  dialog::backdrop {
    background: var(--backdrop);
  }
  h2 {
    margin: 0 0 0.75rem;
    font-size: 1.1rem;
  }
  label {
    display: grid;
    gap: 0.2rem;
    margin-bottom: 0.7rem;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }
  .row > label {
    flex: 1 1 12rem;
  }
  input[type='text'],
  select,
  textarea {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.35rem 0.5rem;
    min-width: 0;
    font: inherit;
  }
  .preview {
    min-height: 1.4rem;
    margin: 0 0 0.7rem;
    font-size: 0.85rem;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .muted {
    color: var(--muted);
  }
  .warn {
    color: var(--warn);
  }
  .bad {
    color: var(--bad);
  }
  .ask {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.4rem 0.6rem;
    margin-bottom: 0.7rem;
  }
  .ask p {
    margin: 0 0 0.4rem;
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
  button.danger {
    border-color: var(--bad);
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
