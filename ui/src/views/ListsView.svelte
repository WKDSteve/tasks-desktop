<script lang="ts">
  // The tab Lists: quick lists of short entries, several per vault (a folder `_list-<slug>/` each), the one shown chosen
  // above. A line typed and Enter adds an entry at the top (a `#word` becomes a tag, the engine's rule); a picture pasted
  // into the field becomes an entry with that picture. The filter (words, tag, days, state) is the engine's
  // (`tasks.checklist`); the page shows what comes back and exports it (Markdown, CSV, the printer, a PNG where the page
  // can draw one). An entry opens in place (`ChecklistItem`): its text, tags, attachments, the way to a task.
  import { untrack } from 'svelte';
  import Info from 'appkit-ui/Info.svelte';
  import type { App } from '../lib/app.svelte';
  import type { ChecklistDocument, Checklists } from '../lib/contract';
  import { translate, type Key } from '../lib/i18n';
  import { isListsKey, listsText, type ListsKey } from '../lib/listsTexts';
  import {
    addOps,
    checklistAll,
    checklistQuery,
    filtering,
    NO_CHECKLIST_FILTER,
    pastedImage,
    pastedName,
    type ChecklistFilter,
  } from '../lib/checklistApp';
  import { checklistCsv, checklistFileName, checklistMarkdown, checklistSheet, type ChecklistWords } from '../lib/checklistExport';
  import { csvSeparatorFor } from '../lib/export';
  import { markHidden } from '../lib/text';
  import ChecklistItem from './ChecklistItem.svelte';

  let { app }: { app: App } = $props();
  const t = (key: Key | ListsKey, params: Record<string, string | number> = {}) =>
    isListsKey(key) ? listsText(app.lang, key, params) : translate(app.lang, key, params);

  type ListInfo = Checklists['items'][number];
  let lists = $state<ListInfo[]>([]);
  let phase = $state<'loading' | 'ready' | 'failed'>('loading');
  let doc = $state<ChecklistDocument | null>(null);
  /** The entries shown: the first page of the filter, and the pages "Show more" read after it. */
  let entries = $state<ChecklistDocument['items']>([]);
  let nextOffset = $state<number | undefined>(undefined);
  let filter = $state<ChecklistFilter>({ ...NO_CHECKLIST_FILTER });
  /** The words of the search as they are asked: a pause in typing, not every key, reads the list again. */
  let asked = $state('');
  let openEntry = $state<string | null>(null);
  let line = $state('');
  let adding = $state(false);
  let form = $state<'new' | 'rename' | null>(null);
  let formTitle = $state('');
  let formInput: HTMLInputElement | undefined = $state();
  let note = $state('');

  const current = $derived(
    app.checklistOpen !== null && lists.some((l) => l.id === app.checklistOpen) ? app.checklistOpen : (lists[0]?.id ?? null),
  );
  const currentList = $derived(lists.find((l) => l.id === current) ?? null);
  const canWrite = $derived(!app.readOnly && !app.locked);

  // The lists, read again when a write, a new snapshot or a change on disk of a list came.
  $effect(() => {
    void app.writes;
    void app.snapshot?.rev;
    void app.outsideTick;
    const abort = new AbortController();
    app.env.hub
      .checklists(abort.signal)
      .then((answer) => {
        if (abort.signal.aborted) return;
        lists = answer.items;
        phase = 'ready';
      })
      .catch(() => {
        if (!abort.signal.aborted) phase = 'failed';
      });
    return () => abort.abort();
  });

  // The words of the search are asked a moment after the last key.
  $effect(() => {
    const words = filter.q;
    const timer = setTimeout(() => (asked = words), 250);
    return () => clearTimeout(timer);
  });

  // The entries of the list shown through the filter, read again after a write or a change on disk. The words of the
  // search are read as `asked` only (a pause in typing), never as `filter.q`: each key would read the list again.
  let generation = 0;
  $effect(() => {
    void app.writes;
    void app.snapshot?.rev;
    void app.outsideTick;
    const id = current;
    const { tag, since, until, state } = filter;
    const query: ChecklistFilter = { q: asked, tag, since, until, state };
    const mine = ++generation;
    loadingMore = false;
    if (id === null) {
      doc = null;
      entries = [];
      nextOffset = undefined;
      return;
    }
    const abort = new AbortController();
    app.env.hub
      .checklist(checklistQuery(id, query), abort.signal)
      .then((answer) => {
        if (abort.signal.aborted || mine !== generation) return;
        doc = answer;
        entries = answer.items;
        nextOffset = answer.next_offset;
        shownQuery = query;
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          doc = null;
          entries = [];
        }
      });
    return () => abort.abort();
  });

  // The menu's "New list" opens the form here.
  $effect(() => {
    if (!app.checklistAsk) return;
    untrack(() => {
      app.checklistAsk = false;
      openForm('new');
    });
  });

  /** The query the entries shown were read with: "Show more" reads the next page of that one, not of the filter now. */
  let shownQuery = $state<ChecklistFilter | null>(null);
  let loadingMore = $state(false);

  /** The next page of what is shown. An answer that comes after the list or the filter changed is dropped. */
  async function more(): Promise<void> {
    if (current === null || nextOffset === undefined || shownQuery === null || loadingMore) return;
    const mine = generation;
    const id = current;
    loadingMore = true;
    try {
      const answer = await app.env.hub.checklist(checklistQuery(id, shownQuery, { offset: nextOffset }));
      if (mine !== generation) return;
      const seen = new Set(entries.map((e) => e.id));
      entries = [...entries, ...answer.items.filter((e) => !seen.has(e.id))];
      nextOffset = answer.next_offset;
    } catch {
      if (mine === generation) note = t('lists.failed');
    } finally {
      if (mine === generation) loadingMore = false;
    }
  }

  function choose(id: string): void {
    app.checklistOpen = id;
    openEntry = null;
    filter = { ...NO_CHECKLIST_FILTER };
  }

  function openForm(kind: 'new' | 'rename'): void {
    form = kind;
    formTitle = kind === 'rename' ? (currentList?.title ?? '') : '';
    queueMicrotask(() => formInput?.focus());
  }

  async function submitForm(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const title = formTitle.trim();
    if (title === '' || form === null) return;
    if (form === 'rename' && current !== null) {
      await app.write([{ op: 'checklist_set', id: current, title }]);
    } else {
      const result = await app.write([{ op: 'checklist_new', title }]);
      const made = result?.results[0];
      if (made?.ok && made.id) app.checklistOpen = made.id;
    }
    form = null;
  }

  async function deleteList(): Promise<void> {
    if (current === null || (currentList?.total ?? 0) > 0) return;
    const result = await app.write([{ op: 'checklist_delete', id: current }]);
    if (result?.results[0]?.ok) app.checklistOpen = null;
  }

  /** Add the typed line; with `picture`, the new entry gets it attached. A vault without a list gets its first one. */
  async function add(title: string, picture: File | null = null): Promise<void> {
    if (title.trim() === '' || adding) return;
    adding = true;
    try {
      const { ops, list } = addOps(current, title, t('lists.first'), app.lang);
      const result = await app.write(ops);
      const made = result?.results.at(-1);
      if (!made?.ok || !made.id) return;
      line = '';
      app.checklistOpen = list;
      if (picture) await app.attachFile(made.id, picture, 'image');
    } finally {
      adding = false;
    }
  }

  function submitLine(event: SubmitEvent): void {
    event.preventDefault();
    void add(line);
  }

  /** A picture pasted into the field: an entry with that picture (the line typed so far is its title). */
  function pasteLine(event: ClipboardEvent): void {
    const image = pastedImage(event.clipboardData);
    if (image === null || !canWrite) return;
    event.preventDefault();
    const at = new Date();
    const title = line.trim() !== '' ? line : t('lists.pasted', { time: at.toLocaleString(app.lang) });
    void add(title, new File([image], pastedName(image, at), { type: image.type }));
  }

  // ── export ─────────────────────────────────────────────────────────────
  function words(): ChecklistWords {
    const parts = [
      asked.trim() !== '' ? `"${asked.trim()}"` : '',
      filter.tag !== '' ? `#${filter.tag}` : '',
      filter.since !== '' || filter.until !== '' ? `${filter.since || '…'} – ${filter.until || '…'}` : '',
      filter.state !== 'all' ? t(`lists.state.${filter.state}`) : '',
    ].filter((p) => p !== '');
    return {
      title: t('lists.col.title'),
      made: t('lists.col.made'),
      done: t('lists.col.done'),
      tags: t('lists.col.tags'),
      text: t('lists.col.text'),
      filter: parts.length > 0 ? t('lists.sheet.filter', { filter: parts.join(', ') }) : '',
    };
  }

  async function exportAs(kind: 'markdown' | 'csv' | 'print' | 'png'): Promise<void> {
    if (current === null || currentList === null) return;
    note = '';
    try {
      const { items } = await checklistAll(app, current, { ...filter, q: asked });
      if (items.length === 0) {
        note = t('lists.export.empty');
        return;
      }
      const w = words();
      const day = app.today;
      if (kind === 'markdown' || kind === 'csv') {
        const text =
          kind === 'markdown'
            ? checklistMarkdown(currentList.title, items, w)
            : checklistCsv(items, w, csvSeparatorFor(app.env.preferredLanguages[0]));
        const saved = app.env.out.save(
          checklistFileName(current, day, kind === 'markdown' ? 'md' : 'csv'),
          text,
          kind === 'markdown' ? 'text/markdown;charset=utf-8' : 'text/csv;charset=utf-8',
        );
        note = saved ? t('lists.export.done', { n: items.length }) : t('lists.export.failed');
        return;
      }
      const sheet = checklistSheet(currentList.title, items, w);
      if (kind === 'print') {
        if (!app.env.out.print(sheet)) note = t('lists.export.failed');
        return;
      }
      const result = await app.env.out.png?.(sheet, checklistFileName(current, day, 'png'));
      note =
        result === 'saved'
          ? t('lists.export.done', { n: items.length })
          : result === 'too_long'
            ? t('lists.export.too_long')
            : t('lists.export.failed');
    } catch {
      note = t('lists.export.failed');
    }
  }
</script>

<section class="lists" aria-label={t('nav.lists')} data-lists>
  <header class="head">
    <h2>{t('lists.title')}</h2>
    <Info hint={t('lists.intro')} label={t('hint.about', { what: t('nav.lists') })} />
    {#if lists.length > 0}
      <label class="field" data-hint={t('lists.choose.hint')}>
        <span>{t('lists.choose')}</span>
        <select value={current ?? ''} onchange={(e) => choose(e.currentTarget.value)} data-lists-choose>
          {#each lists as l (l.id)}
            <option value={l.id}>{t('lists.option', { title: markHidden(l.title), open: l.open })}</option>
          {/each}
        </select>
      </label>
    {/if}
    <span class="tools">
      <button type="button" data-lists-new data-hint={t('lists.new.hint')} disabled={!canWrite} onclick={() => openForm('new')}>{t('lists.new')}</button>
      {#if currentList}
        <button type="button" data-lists-rename data-hint={t('lists.rename.hint')} disabled={!canWrite} onclick={() => openForm('rename')}
          >{t('lists.rename')}</button
        >
        <button
          type="button"
          data-lists-delete
          data-hint={t('lists.delete.hint')}
          disabled={!canWrite || currentList.total > 0}
          onclick={() => void deleteList()}>{t('lists.delete')}</button
        >
        <details class="export" data-lists-export>
          <summary data-hint={t('lists.export.hint')}>{t('lists.export')}</summary>
          <div class="menu" role="group" aria-label={t('lists.export')}>
            <button type="button" data-export="markdown" onclick={() => void exportAs('markdown')}>{t('lists.export.markdown')}</button>
            <button type="button" data-export="csv" onclick={() => void exportAs('csv')}>{t('lists.export.csv')}</button>
            <button type="button" data-export="print" onclick={() => void exportAs('print')}>{t('lists.export.print')}</button>
            {#if app.canPng}
              <button type="button" data-export="png" onclick={() => void exportAs('png')}>{t('lists.export.png')}</button>
            {/if}
          </div>
        </details>
      {/if}
    </span>
  </header>

  {#if form}
    <form class="listform" onsubmit={(e) => void submitForm(e)} data-lists-form={form}>
      <label class="field" data-hint={t('lists.name.hint')}>
        <span>{t(form === 'new' ? 'lists.new.name' : 'lists.rename.name')}</span>
        <input bind:this={formInput} bind:value={formTitle} maxlength="300" required spellcheck="true" />
      </label>
      <button type="submit" disabled={!canWrite || formTitle.trim() === ''}>{t(form === 'new' ? 'lists.new.make' : 'lists.rename.save')}</button>
      <button type="button" onclick={() => (form = null)}>{t('lists.new.cancel')}</button>
    </form>
  {/if}

  {#if note !== ''}<p class="note" role="status" data-lists-note>{note}</p>{/if}

  {#if phase === 'loading'}
    <p class="none" role="status">{t('lists.loading')}</p>
  {:else if phase === 'failed'}
    <p class="none" role="alert">{t('lists.failed')}</p>
  {:else}
    <!-- A form: Enter in the field sends it, also with an input method (the browser holds the Enter that ends a
         composition back from the form). -->
    <form class="add" onsubmit={submitLine} data-lists-add>
      <label class="field grow" data-hint={t('lists.add.hint')}>
        <span>{t('lists.add')}</span>
        <input
          bind:value={line}
          maxlength="300"
          spellcheck="true"
          autocomplete="off"
          disabled={!canWrite}
          onpaste={pasteLine}
          data-lists-line
        />
      </label>
      <button type="submit" disabled={!canWrite || adding || line.trim() === ''}>{t('lists.add.button')}</button>
    </form>

    {#if lists.length === 0}
      <p class="none" data-lists-none>{t('lists.none', { title: t('lists.first') })}</p>
    {:else}
      <div class="bar" role="group" aria-label={t('lists.filters')}>
        <label class="field" data-hint={t('lists.search.hint')}>
          <span>{t('lists.search')}</span>
          <input type="search" spellcheck="false" bind:value={filter.q} data-lists-search />
        </label>
        <label class="field" data-hint={t('lists.tag.hint')}>
          <span>{t('lists.tag')}</span>
          <select bind:value={filter.tag} data-lists-tag>
            <option value="">{t('lists.tag.all')}</option>
            {#each doc?.tags ?? [] as tg (tg.tag)}<option value={tg.tag}>{t('lists.tag.option', { tag: markHidden(tg.tag), n: tg.count })}</option>{/each}
          </select>
        </label>
        <label class="field" data-hint={t('lists.since.hint')}>
          <span>{t('lists.since')}</span>
          <input type="date" bind:value={filter.since} data-lists-since />
        </label>
        <label class="field" data-hint={t('lists.until.hint')}>
          <span>{t('lists.until')}</span>
          <input type="date" bind:value={filter.until} data-lists-until />
        </label>
        <label class="field" data-hint={t('lists.state.hint')}>
          <span>{t('lists.state')}</span>
          <select bind:value={filter.state} data-lists-state>
            <option value="all">{t('lists.state.all')}</option>
            <option value="open">{t('lists.state.open')}</option>
            <option value="done">{t('lists.state.done')}</option>
          </select>
        </label>
        {#if filtering(filter)}
          <button type="button" onclick={() => (filter = { ...NO_CHECKLIST_FILTER })} data-lists-reset>{t('lists.reset')}</button>
        {/if}
      </div>

      {#if doc}
        <p class="note" data-lists-count>{t('lists.count', { n: doc.matching, total: doc.total })}</p>
        {#if entries.length === 0}
          <p class="none" data-lists-empty>{t(doc.total === 0 ? 'lists.empty' : 'lists.empty_filtered')}</p>
        {:else}
          <ul class="entries">
            {#each entries as e (e.id)}
              <ChecklistItem
                {app}
                entry={e}
                open={openEntry === e.id}
                {canWrite}
                ontoggle={() => (openEntry = openEntry === e.id ? null : e.id)}
              />
            {/each}
          </ul>
          {#if nextOffset !== undefined}
            <button type="button" disabled={loadingMore} onclick={() => void more()} data-lists-more>{t('lists.more')}</button>
          {/if}
        {/if}
      {/if}
    {/if}
  {/if}
</section>

<style>
  .lists {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.5rem 0.75rem;
    max-width: 64rem;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.5rem;
  }
  .head h2 {
    margin: 0;
    font-size: 1.1rem;
  }
  .tools {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin-inline-start: auto;
  }
  .field {
    display: inline-flex;
    flex-direction: column;
    gap: 0.15rem;
    font-size: 0.85rem;
  }
  .field span {
    color: var(--muted);
  }
  .grow {
    flex: 1 1 18rem;
  }
  .grow input {
    width: 100%;
  }
  .add,
  .listform,
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.5rem;
  }
  .export {
    position: relative;
  }
  .export summary {
    cursor: pointer;
    padding: 0.2rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-2);
    list-style: none;
  }
  .export .menu {
    position: absolute;
    inset-inline-end: 0;
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.3rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    min-width: 12rem;
  }
  .entries {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .note,
  .none {
    margin: 0;
    color: var(--muted);
    font-size: 0.9rem;
  }
</style>
