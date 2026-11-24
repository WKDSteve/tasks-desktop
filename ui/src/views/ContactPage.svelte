<script lang="ts">
  // The page of one contact: the data (area, organisation, role, mail addresses and phone numbers as links that write or
  // call, time zone, tags), the text and the notes, with Change and Delete. A contact is a person of a third party: the
  // addresses and numbers are shown as the data they are, to the person who keeps them, and appear in no message of the
  // page; a link's label names the person, not the address. Delete asks, then removes the file; Undo brings it back
  // through the engine's inverse. The words are the chunk's (lib/contactsTexts.ts).
  import { closeOnBackdrop } from 'appkit-ui/backdrop';
  import type { App } from '../lib/app.svelte';
  import { formOfContact, mailHref, telHref } from '../lib/contacts';
  import { deleteContact } from '../lib/contactsApp';
  import { contactsText, isContactsKey, type ContactsKey } from '../lib/contactsTexts';
  import type { ContactDocument } from '../lib/contract';
  import { floating } from '../lib/floating';
  import { translate, type Key } from '../lib/i18n';
  import { markHidden } from '../lib/text';

  let { app }: { app: App } = $props();
  const t = (key: Key | ContactsKey, params: Record<string, string | number> = {}) =>
    isContactsKey(key) ? contactsText(app.lang, key, params) : translate(app.lang, key, params);

  let dialog: HTMLDialogElement | undefined = $state();
  let doc = $state<ContactDocument | null>(null);
  let failed = $state<'gone' | 'failed' | null>(null);
  let asking = $state(false);

  const id = $derived(app.contactOpen);
  const c = $derived(doc?.contact ?? null);
  const canWrite = $derived(app.canMakeContacts && !app.locked);

  $effect(() => {
    if (!dialog) return;
    if (id !== null && !dialog.open) dialog.showModal();
    if (id === null && dialog.open) dialog.close();
  });

  // Read the contact when it is opened, after each write (`app.writes`) and when the vault changed.
  $effect(() => {
    const which = id;
    void app.writes;
    void app.snapshot?.rev;
    if (which === null) {
      doc = null;
      failed = null;
      asking = false;
      return;
    }
    const abort = new AbortController();
    app
      .readContact(which, abort.signal)
      .then((read) => {
        if (abort.signal.aborted) return;
        doc = read;
        failed = null;
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        failed = (error as { code?: string })?.code === 'not_found' ? 'gone' : 'failed';
      });
    return () => abort.abort();
  });

  async function remove(): Promise<void> {
    if (!c) return;
    asking = false;
    await deleteContact(app, c);
  }
</script>

<dialog
  bind:this={dialog}
  class="contact-page"
  use:floating={{ kind: 'contact-page', moveLabel: t('float.move'), moveHint: t('hint.float.move') }}
  use:closeOnBackdrop={{ closeable: () => true }}
  aria-labelledby="contact-page-title"
  onclose={() => app.closeContact()}
>
  {#if failed !== null}
    <p role="alert" data-contact-failed>{failed === 'gone' ? t('contact.gone') : t('contact.failed')}</p>
    <div class="actions"><button type="button" onclick={() => app.closeContact()}>{t('contact.close')}</button></div>
  {:else if !doc || !c}
    <p role="status">{t('contact.loading')}</p>
  {:else}
    <header>
      <h2 id="contact-page-title">{markHidden(c.name)}</h2>
      {#if c.org || c.role}
        <p class="muted" data-contact-who>{[c.org, c.role].filter((x) => x).map((x) => markHidden(x ?? '')).join(' · ')}</p>
      {/if}
    </header>

    {#if !c.valid}
      <div class="problems" role="status" data-contact-problems>
        <strong>{t('contact.problems')}</strong>
        <ul>
          {#each c.problems as p (p.code + p.msg)}<li>{p.msg}</li>{/each}
        </ul>
      </div>
    {/if}

    <dl>
      <dt>{t('contact.area')}</dt>
      <dd>{c.area}</dd>
      {#if c.emails.length > 0}
        <dt>{t('contact.mail')}</dt>
        <dd data-contact-mails>
          {#each c.emails as email (email)}
            {@const href = mailHref(email)}
            {#if href}
              <a {href} aria-label={t('contact.write_to', { name: c.name })} data-contact-mail>{email}</a>
            {:else}
              <span data-contact-mail>{email}</span>
            {/if}
          {/each}
        </dd>
      {/if}
      {#if c.phones.length > 0}
        <dt>{t('contact.phone')}</dt>
        <dd data-contact-phones>
          {#each c.phones as phone (phone)}
            {@const href = telHref(phone)}
            {#if href}
              <a {href} aria-label={t('contact.call', { name: c.name })} data-contact-phone>{phone}</a>
            {:else}
              <span data-contact-phone>{phone}</span>
            {/if}
          {/each}
        </dd>
      {/if}
      {#if c.tz}
        <dt>{t('contact.tz')}</dt>
        <dd>{c.tz}</dd>
      {/if}
      {#if c.tags.length > 0}
        <dt>{t('contact.tags')}</dt>
        <dd>{c.tags.map((x) => markHidden(x)).join(', ')}</dd>
      {/if}
      <dt>{t('contact.file')}</dt>
      <dd class="muted" translate="no">{c.file}</dd>
    </dl>

    <h3>{t('contact.notes')}</h3>
    {#if doc.notes !== ''}
      <p class="text" data-contact-notes>{doc.notes}</p>
    {:else}
      <p class="muted">{t('contact.notes_none')}</p>
    {/if}
    {#if c.summary !== ''}
      <h3>{t('contact.text')}</h3>
      <p class="text" data-contact-text>{c.summary}</p>
    {/if}
    {#if canWrite}<p class="muted small">{t('contact.notes_file')}</p>{/if}

    {#if doc.history !== undefined}
      <h3>{t('contact.history')}</h3>
      {#if doc.history.length === 0}
        <p class="muted" data-contact-history-none>{t('contact.history_none')}</p>
      {:else}
        <ul class="history" data-contact-history>
          {#each doc.history as h (h.id)}
            <li>
              <button
                type="button"
                class="link"
                aria-label={t('contact.history_open', { title: h.title })}
                onclick={() => {
                  app.closeContact();
                  app.openMeeting(h.id);
                }}>{markHidden(h.title)}</button
              >
              <span class="muted">{[h.date, h.role ? markHidden(h.role) : ''].filter((x) => x).join(' · ')}</span>
            </li>
          {/each}
        </ul>
        {#if doc.history_truncated}<p class="muted small">{t('contact.history_cut')}</p>{/if}
      {/if}
    {/if}

    {#if asking}
      <div class="ask" role="alertdialog" aria-label={t('contact.delete')} data-contact-ask>
        <p>{t('contact.delete_ask', { name: c.name })}</p>
        <div class="actions">
          <button type="button" onclick={() => (asking = false)}>{t('contact.delete_no')}</button>
          <button type="button" class="danger" onclick={remove} disabled={app.saving} data-contact-delete-yes>{t('contact.delete_yes')}</button>
        </div>
      </div>
    {/if}

    <div class="actions">
      {#if canWrite}
        <button type="button" onclick={() => app.openContactDraft(formOfContact(c))} disabled={app.saving} data-contact-edit>{t('contact.edit')}</button>
        <button type="button" onclick={() => (asking = true)} disabled={app.saving || asking} data-contact-delete>{t('contact.delete')}</button>
      {/if}
      <button type="button" onclick={() => app.closeContact()} data-contact-close>{t('contact.close')}</button>
    </div>
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
    margin: 0 0 0.3rem;
    font-size: 1.15rem;
    overflow-wrap: anywhere;
  }
  h3 {
    font-size: 0.95rem;
    margin: 0.9rem 0 0.3rem;
  }
  header p {
    margin: 0 0 0.25rem;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.3rem 1rem;
    margin: 0.6rem 0;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem 0.8rem;
    overflow-wrap: anywhere;
  }
  /* a link a finger can hit */
  dd a {
    display: inline-block;
    min-height: 1.6rem;
    padding: 0.1rem 0;
  }
  .muted {
    color: var(--muted);
  }
  .history {
    list-style: none;
    padding: 0;
    margin: 0 0 0.5rem;
  }
  .history li {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
  }
  .history .link {
    background: none;
    border: 0;
    padding: 0.25rem 0;
    color: var(--accent);
    text-decoration: underline;
    cursor: pointer;
    text-align: left;
  }
  .small {
    font-size: 0.8rem;
  }
  .text {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .problems {
    border: 1px solid var(--warn);
    border-radius: var(--radius);
    padding: 0.4rem 0.6rem;
    margin: 0.5rem 0;
  }
  .problems ul {
    margin: 0.2rem 0 0;
    padding-left: 1.1rem;
  }
  .ask {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.4rem 0.6rem;
    margin: 0.6rem 0;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.8rem;
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
  button.danger {
    border-color: var(--bad);
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
