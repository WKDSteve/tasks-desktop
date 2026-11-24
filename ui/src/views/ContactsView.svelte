<script lang="ts">
  // All contacts, by name, with a search and the filters organisation, tag and area. The engine reads them
  // (`contactsAll`); the search and the filters are `lib/contacts.ts`. A row opens the contact page, `n` makes a new
  // contact. A contact is a person of a third party: the list shows what the person is (name, organisation, role, tags),
  // never a mail address or a number. The words are the chunk's (lib/contactsTexts.ts).
  import type { App } from '../lib/app.svelte';
  import { contactChoices, filterContacts, NO_CONTACT_FILTER, type ContactFilter } from '../lib/contacts';
  import { contactsAll } from '../lib/contactsApp';
  import { contactsText, isContactsKey, type ContactsKey } from '../lib/contactsTexts';
  import type { ContactEntry } from '../lib/contract';
  import { translate, type Key } from '../lib/i18n';
  import { chordWatch } from '../lib/keymap';
  import Info from 'appkit-ui/Info.svelte';
  import { markHidden } from '../lib/text';

  let { app }: { app: App } = $props();
  const t = (key: Key | ContactsKey, params: Record<string, string | number> = {}) =>
    isContactsKey(key) ? contactsText(app.lang, key, params) : translate(app.lang, key, params);

  let found = $state<ContactEntry[]>([]);
  let total = $state(0);
  let phase = $state<'loading' | 'ready' | 'failed'>('loading');
  let filter = $state<ContactFilter>({ ...NO_CONTACT_FILTER });

  // Read again when a write or a new snapshot came.
  $effect(() => {
    void app.writes;
    void app.snapshot?.rev;
    if (!app.canContacts) {
      found = [];
      phase = 'ready';
      return;
    }
    const abort = new AbortController();
    contactsAll(app, abort.signal)
      .then((all) => {
        if (abort.signal.aborted) return;
        found = all.items;
        total = all.total;
        phase = 'ready';
      })
      .catch(() => {
        if (abort.signal.aborted) return;
        phase = 'failed';
      });
    return () => abort.abort();
  });

  const choices = $derived(contactChoices(found));
  const shown = $derived(filterContacts(found, filter));
  const canNew = $derived(app.canMakeContacts && !app.locked);

  const ofChord = chordWatch();
  function onKey(event: KeyboardEvent): void {
    if (ofChord(event) || event.defaultPrevented) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target === null || target.closest('input, select, textarea, [contenteditable="true"]') !== null) return;
    // a dialog on top (a contact page, a form) has the keys
    if (document.querySelector('dialog[open]') !== null) return;
    if (event.key.toLowerCase() === 'n' && canNew) {
      event.preventDefault();
      app.openContactForm();
    }
  }
</script>

<!-- The key n is the view's wherever the focus is on the page (the list may be empty: nothing in it to focus). -->
<svelte:window onkeydown={onKey} />
<section class="contacts" aria-label={t('nav.contacts')}>
  <header class="head">
    <h2>{t('contacts.title')}</h2>
    <Info hint={t('contacts.intro')} label={t('hint.about', { what: t('nav.contacts') })} />
    {#if canNew}
      <button type="button" data-contacts-new data-hint={t('contacts.intro')} onclick={() => app.openContactForm()}>
        {t('contacts.new')}
      </button>
    {/if}
  </header>

  <div class="bar" role="group" aria-label={t('contacts.filters')}>
    <label class="field" data-hint={t('contacts.search.hint')}>
      <span>{t('contacts.search')}</span>
      <input spellcheck="false" type="search" bind:value={filter.text} data-contacts-search />
    </label>
    <label class="field" data-hint={t('contacts.org.hint')}>
      <span>{t('contacts.org')}</span>
      <select bind:value={filter.org} data-contacts-org>
        <option value="">{t('contacts.org.all')}</option>
        {#each choices.orgs as org (org)}<option value={org}>{org}</option>{/each}
      </select>
    </label>
    <label class="field" data-hint={t('contacts.tag.hint')}>
      <span>{t('contacts.tag')}</span>
      <select bind:value={filter.tag} data-contacts-tag>
        <option value="">{t('contacts.tag.all')}</option>
        {#each choices.tags as tag (tag)}<option value={tag}>{tag}</option>{/each}
      </select>
    </label>
    <label class="field" data-hint={t('contacts.area.hint')}>
      <span>{t('contacts.area')}</span>
      <select bind:value={filter.area} data-contacts-area>
        <option value="">{t('contacts.area.all')}</option>
        {#each choices.areas as area (area)}<option value={area}>{area}</option>{/each}
      </select>
    </label>
  </div>

  {#if phase === 'loading'}
    <p class="none" role="status">{t('contacts.loading')}</p>
  {:else if phase === 'failed'}
    <p class="none" role="alert">{t('contacts.failed')}</p>
  {:else if found.length === 0}
    <p class="none">{t('contacts.none')}</p>
  {:else if shown.length === 0}
    <p class="none" data-contacts-empty>{t('contacts.none_filtered')}</p>
  {:else}
    {#if total > found.length}<p class="note" data-contacts-cut>{t('contacts.cut', { n: found.length, total })}</p>{/if}
    <p class="note" data-contacts-count>{t('contacts.count', { n: shown.length })}</p>
    <ul>
      {#each shown as c (c.id)}
        <li>
          <button type="button" class="contact" data-contact={c.id} onclick={() => app.openContact(c.id)}>
            <span class="name">{markHidden(c.name)}</span>
            {#if c.org || c.role}<span class="who">{[c.org, c.role].filter((x) => x).map((x) => markHidden(x ?? '')).join(' · ')}</span>{/if}
            {#if c.tags.length > 0}<span class="tags">{c.tags.map((x) => markHidden(x)).join(', ')}</span>{/if}
            <span class="area">{c.area}</span>
            {#if !c.valid}<span class="mark" data-contact-broken>{t('contacts.broken')}</span>{/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .contacts {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 0;
  }
  .head,
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.8rem;
  }
  h2 {
    margin: 0;
  }
  .field {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  button,
  input[type='search'],
  select {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0.25rem 0.6rem;
  }
  button {
    cursor: pointer;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  button.contact {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.2rem 0.8rem;
    width: 100%;
    text-align: left;
    background: transparent;
    border: 0;
    border-bottom: 1px solid var(--line);
    border-radius: 0;
    padding: 0.4rem 0.5rem;
    /* a finger needs room on a phone */
    min-height: 2.5rem;
  }
  button.contact:hover {
    background: var(--surface-2);
  }
  .name {
    flex: 1 1 10rem;
    font-weight: 600;
  }
  .who {
    flex: 1 1 10rem;
    color: var(--muted);
  }
  .tags,
  .area,
  .none,
  .note {
    color: var(--muted);
    font-size: 0.85rem;
    margin: 0;
  }
  .mark {
    padding: 0 0.35rem;
    border: 1px solid var(--warn);
    border-radius: var(--radius);
    font-size: 0.8rem;
  }
</style>
