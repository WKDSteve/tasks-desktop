<script lang="ts">
  // One entry of a checklist (tab Lists): ticked or open, its title, tags and day; opened, its text (Markdown, with the
  // pictures of its folder), its tags, its attachments (the ways of a task's: a file, a picture, also pasted, a board, a
  // recording), the way to a task of an area, and the delete. What changes goes through `ops` on the version shown
  // (`if_match`); the rules (the tags, the text below the frontmatter, the move into a task) are the engine's.
  import { untrack } from 'svelte';
  import Blocks from 'appkit-ui/Blocks.svelte';
  import { parseMarkdown } from 'appkit-ui/markdown';
  import type { App } from '../lib/app.svelte';
  import { AssetImages } from '../lib/assetImages.svelte';
  import { kindOfFile } from '../lib/capture';
  import { pastedImage, pastedName, tagsOfInput } from '../lib/checklistApp';
  import { dayOf } from '../lib/checklistExport';
  import type { ChecklistEntry } from '../lib/contract';
  import { translate, type Key } from '../lib/i18n';
  import { isAssetImage } from '../lib/images';
  import { isListsKey, listsText, type ListsKey } from '../lib/listsTexts';
  import { markHidden } from '../lib/text';
  import AssetImg from './AssetImg.svelte';
  import AttachBar from './AttachBar.svelte';

  let {
    app,
    entry,
    open,
    canWrite,
    ontoggle,
  }: { app: App; entry: ChecklistEntry; open: boolean; canWrite: boolean; ontoggle: () => void } = $props();
  const t = (key: Key | ListsKey, params: Record<string, string | number> = {}) =>
    isListsKey(key) ? listsText(app.lang, key, params) : translate(app.lang, key, params);

  let title = $state('');
  let tags = $state('');
  let text = $state('');
  let area = $state('');
  let asking = $state(false);
  // The fields take the entry as it is each time it is opened or written anew (another device, a write of this page).
  $effect(() => {
    void entry.etag;
    if (!open) return;
    untrack(() => {
      title = entry.title;
      tags = entry.tags.join(' ');
      text = entry.text;
      asking = false;
    });
  });
  const changed = $derived(
    title.trim() !== entry.title || tagsOfInput(tags).join(' ') !== entry.tags.join(' ') || text.trim() !== entry.text,
  );
  const areas = $derived(app.allAreaNames.toSorted());
  $effect(() => {
    if (area === '' && areas.length > 0) area = areas[0] ?? '';
  });

  // The pictures below `assets/` of an entry in its folder form, while it is open.
  let images = $state<AssetImages | null>(null);
  $effect(() => {
    const id = open && entry.folder ? entry.id : null;
    if (id === null) {
      images = null;
      return;
    }
    const store = new AssetImages((kind, of, file, held) => app.asset(kind, of, file, held), 'checklist', id, { recheckOnFront: true });
    images = store;
    return () => store.dispose();
  });
  $effect(() => {
    const store = images;
    const etag = entry.etag;
    const assets = entry.assets;
    untrack(() => store?.refresh(etag, assets));
  });
  const imageSource = $derived(images?.source(t('image.missing')));
  const blocks = $derived(open && entry.text !== '' ? parseMarkdown(entry.text, { assets: images !== null }) : []);
  const files = $derived(entry.assets ?? []);

  function toggleDone(): void {
    void app.write([{ op: 'entry_set', id: entry.id, done: !entry.done, if_match: entry.etag }]);
  }

  function save(event: SubmitEvent): void {
    event.preventDefault();
    if (!changed) return;
    const next = tagsOfInput(tags);
    void app.write([
      {
        op: 'entry_set',
        id: entry.id,
        if_match: entry.etag,
        ...(title.trim() !== entry.title ? { title: title.trim() } : {}),
        ...(next.join(' ') !== entry.tags.join(' ') ? { tags: next } : {}),
        ...(text.trim() !== entry.text ? { body: text } : {}),
      },
    ]);
  }

  /** A picture pasted into the text: an attachment of the entry (the text stays as it is). */
  function pasteText(event: ClipboardEvent): void {
    const image = pastedImage(event.clipboardData);
    if (image === null || !canWrite) return;
    event.preventDefault();
    void app.attachFile(entry.id, new File([image], pastedName(image, new Date()), { type: image.type }), kindOfFile(image));
  }

  async function promote(): Promise<void> {
    if (area === '') return;
    await app.write([{ op: 'entry_promote', id: entry.id, area, if_match: entry.etag, lang: app.lang }], { undoable: false });
  }

  function remove(): void {
    // Without attachments the engine gives the way back (Undo on the toast); with them it does not: asked first.
    if (files.length > 0 && !asking) {
      asking = true;
      return;
    }
    asking = false;
    void app.write([{ op: 'entry_delete', id: entry.id, if_match: entry.etag }], { undoable: files.length === 0 });
  }
</script>

<li class="entry" class:done={entry.done !== undefined} data-entry={entry.id}>
  <div class="row">
    <input
      type="checkbox"
      checked={entry.done !== undefined}
      disabled={!canWrite}
      aria-label={t('lists.done', { title: markHidden(entry.title) })}
      data-hint={t('lists.done.hint')}
      onchange={toggleDone}
      data-entry-done
    />
    <button
      type="button"
      class="title"
      aria-expanded={open}
      aria-label={t('lists.open_entry', { title: markHidden(entry.title) })}
      onclick={ontoggle}
      data-entry-open>{markHidden(entry.title)}</button
    >
    {#each entry.tags as tag (tag)}<span class="tag" data-entry-tag={tag}>#{markHidden(tag)}</span>{/each}
    {#if files.length > 0}<span class="files" data-entry-files>📎 {t('lists.attachments', { n: files.length })}</span>{/if}
    <span class="day">{dayOf(entry.created)}{entry.done ? ` · ${t('entry.done_on', { day: entry.done })}` : ''}</span>
  </div>
  {#if open}
    <div class="detail" data-entry-detail>
      {#if blocks.length > 0}
        <div class="prose" data-entry-text><Blocks {blocks} headingBase={3} images={imageSource} /></div>
      {/if}
      <form class="edit" onsubmit={save}>
        <label class="field" data-hint={t('entry.title.hint')}>
          <span>{t('entry.title')}</span>
          <input bind:value={title} maxlength="300" required spellcheck="true" disabled={!canWrite} data-entry-title />
        </label>
        <label class="field" data-hint={t('entry.tags.hint')}>
          <span>{t('entry.tags')}</span>
          <input bind:value={tags} spellcheck="false" disabled={!canWrite} data-entry-tags />
        </label>
        <label class="field wide" data-hint={t('entry.text.hint')}>
          <span>{t('entry.text')}</span>
          <textarea bind:value={text} rows="6" maxlength="20000" spellcheck="true" disabled={!canWrite} onpaste={pasteText} data-entry-body></textarea>
        </label>
        <p class="actions">
          <button type="submit" disabled={!canWrite || !changed} data-entry-save>{t('entry.save')}</button>
          <button type="button" onclick={ontoggle}>{t('entry.close')}</button>
        </p>
      </form>

      <section class="files-of" aria-label={t('entry.files')}>
        <h3>{t('entry.files')}</h3>
        {#if files.length === 0}
          <p class="muted">{t('entry.no_files')}</p>
        {:else}
          <ul>
            {#each files as file (file)}
              <li data-entry-file={file}>
                {#if images && isAssetImage(file)}
                  <AssetImg {images} {file} alt={file} missing={t('image.missing')} size={96} />
                {/if}
                <code translate="no">{markHidden(file)}</code>
              </li>
            {/each}
          </ul>
        {/if}
        {#if canWrite}<AttachBar {app} id={entry.id} owner="checklist" />{/if}
      </section>

      {#if canWrite}
        <div class="actions" role="group" aria-label={t('entry.promote')}>
          <label class="field" data-hint={t('entry.promote.hint')}>
            <span>{t('entry.promote.area')}</span>
            <select bind:value={area} data-entry-area>
              {#each areas as a (a)}<option value={a}>{a}</option>{/each}
            </select>
          </label>
          <button type="button" disabled={area === ''} onclick={() => void promote()} data-entry-promote>{t('entry.promote.go')}</button>
          {#if asking}
            <span role="alert">{t('entry.delete_ask', { title: markHidden(entry.title) })}</span>
            <button type="button" class="bad" onclick={remove} data-entry-delete-yes>{t('entry.delete_yes')}</button>
            <button type="button" onclick={() => (asking = false)}>{t('entry.delete_no')}</button>
          {:else}
            <button type="button" class="bad" onclick={remove} data-entry-delete>{t('entry.delete')}</button>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</li>

<style>
  .entry {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.3rem 0.5rem;
    background: var(--surface);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
  }
  .title {
    background: none;
    border: none;
    padding: 0;
    color: var(--text);
    font: inherit;
    text-align: start;
    cursor: pointer;
    flex: 1 1 12rem;
  }
  .done .title {
    text-decoration: line-through;
    color: var(--muted);
  }
  .tag,
  .files,
  .day {
    font-size: 0.8rem;
    color: var(--muted);
  }
  .tag {
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0 0.4rem;
  }
  .detail {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  .edit {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: end;
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
  .wide {
    flex: 1 1 100%;
  }
  .wide textarea {
    width: 100%;
    font-family: var(--mono, monospace);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.4rem;
    margin: 0;
  }
  .files-of h3 {
    font-size: 0.9rem;
    margin: 0 0 0.3rem;
  }
  .files-of ul {
    list-style: none;
    margin: 0 0 0.4rem;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .files-of li {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.8rem;
  }
  .muted {
    color: var(--muted);
    margin: 0 0 0.4rem;
  }
  .bad {
    border-color: var(--bad);
  }
</style>
