<script lang="ts">
  // The view "Notes & sources" of the tab Lernpläne (concept "Reiter Lernpläne" 11): the notes, links and images of the
  // learning points of all paths. The engine searches (`tasks.learn_notes` with `query` and `kind`, capability
  // `learn_notes`; WEB-13); the page narrows by path (asked of the engine), competence and state (of the list it got)
  // and marks the hits. A note is untrusted Markdown: cut as text with its hits marked, and whole through the kit's
  // Markdown reader on "more". A link shows its domain and title; an image a small preview, read only once the hit comes
  // into sight and only as an image (the store of its path, as in the view of the paths), larger on a click. A hit
  // is a button: Enter (or a click) opens the point in the view of the paths. `/` puts the focus into the search.
  import { untrack } from 'svelte';
  import type { App } from '../lib/app.svelte';
  import { translate, type Key } from '../lib/i18n';
  import { isLearnNotesKey, learnNotesText, type LearnNotesKey } from '../lib/learnNotesTexts';
  import type { Competences, LearnNotes, PathEntry } from '../lib/contract';
  import Info from 'appkit-ui/Info.svelte';
  import LearnScopeNote from './LearnScopeNote.svelte';
  import { scopeOf } from '../lib/learnScope';
  import Blocks from 'appkit-ui/Blocks.svelte';
  import { hostOf, parseMarkdown } from 'appkit-ui/markdown';
  import { markHidden } from '../lib/text';
  import { AssetImages } from '../lib/assetImages.svelte';
  import AssetImg from './AssetImg.svelte';
  import ImageViewer from './ImageViewer.svelte';
  import { labelText, openableLink, pointRef } from '../lib/paths';
  import { imageName, linkTitle, marked, narrowed, NOTE_STATES, snippet, tooLong, type NoteItem, type NoteKind, type NoteState } from '../lib/learnNotes';

  let { app }: { app: App } = $props();
  // The words of the view come with its chunk (lib/learnNotesTexts.ts); the others are the page's.
  const t = (key: Key | LearnNotesKey, params: Record<string, string | number> = {}) =>
    isLearnNotesKey(key) ? learnNotesText(app.lang, key, params) : translate(app.lang, key, params);

  const KINDS: readonly NoteKind[] = ['', 'note', 'link', 'image'];
  /** How long the page waits after the last key before it asks the engine. */
  const TYPING_MS = 250;

  const usable = $derived(app.can('learn_notes') && app.can('path'));

  let doc = $state<LearnNotes | null>(null);
  let problem = $state(false);
  let reading = $state(false);
  let typed = $state('');
  let query = $state('');
  let kind = $state<NoteKind>('');
  let path = $state('');
  let competence = $state('');
  let noteState = $state<NoteState | ''>('');
  let withDone = $state(false);
  let searchBox: HTMLInputElement | undefined = $state();
  // The paths for the filter (titles, the competences each serves) and the competences (titles).
  let paths = $state<readonly PathEntry[]>([]);
  let competences = $state<Competences | null>(null);
  // The hits whose whole note is shown, by `path#index`.
  let whole = $state<ReadonlySet<string>>(new Set());

  // The area filter of the page (lib/learnScope.ts): the engine searches the paths of its areas.
  const scope = $derived(scopeOf(app));
  const asking = $derived(JSON.stringify(scope.query));
  // A filter the hub cannot be asked for (a name with a blank, too many names): the engine answers for all areas and
  // the page narrows. The engine's limit then cut before the filter did, and its figures are of all areas.
  const narrowedHere = $derived(scope.active && Object.keys(scope.query).length === 0);
  let asked = 0;
  async function read(): Promise<void> {
    const mine = ++asked;
    // Too long for the engine: said, not asked (the list stays as it was for the search before).
    if (tooLong(query)) {
      reading = false;
      return;
    }
    reading = true;
    try {
      const answer = await app.learnNotes({
        ...(query.trim() !== '' ? { q: query } : {}),
        ...(kind !== '' ? { kind } : {}),
        ...(path !== '' ? { path } : {}),
        ...(withDone ? { include_done: true } : {}),
        ...scope.query,
      });
      if (mine !== asked) return;
      doc = answer;
      problem = false;
    } catch {
      if (mine !== asked) return;
      problem = true;
    } finally {
      if (mine === asked) reading = false;
    }
  }
  $effect(() => {
    void app.writes;
    void app.snapshot?.rev;
    void query;
    void kind;
    void path;
    void withDone;
    void asking;
    if (!usable) return;
    untrack(() => void read());
  });
  // The lists of the filters: read with the view, again after a write; an answer to an older read is dropped.
  let listsAsked = 0;
  $effect(() => {
    void app.writes;
    if (!usable) return;
    untrack(() => {
      const mine = ++listsAsked;
      void app
        .paths()
        .then((d) => {
          if (mine === listsAsked) paths = d.items;
        })
        .catch(() => undefined);
      if (app.can('competences'))
        void app
          .competences()
          .then((d) => {
            if (mine === listsAsked) competences = d;
          })
          .catch(() => undefined);
    });
  });

  // The search text goes to the engine once typing pauses.
  let timer: ReturnType<typeof setTimeout> | undefined;
  function onType(): void {
    clearTimeout(timer);
    timer = setTimeout(() => (query = typed), TYPING_MS);
  }
  $effect(() => () => clearTimeout(timer));

  const served = (p: PathEntry): readonly string[] => p.competence ?? [];
  const servesCompetence = $derived(
    competence === '' ? null : new Set(paths.filter((p) => served(p).includes(competence)).map((p) => p.id)),
  );
  // A name the hub cannot be asked for: the page narrows what the engine found in all areas.
  const shown = $derived(doc ? narrowed(scope.keep(doc.items), { paths: servesCompetence, state: noteState }) : []);
  const competenceChoices = $derived(
    (competences?.items ?? []).filter((c) => scope.keep(paths).some((p) => served(p).includes(c.id))).toSorted((a, b) => a.title.localeCompare(b.title)),
  );
  const pathChoices = $derived(scope.keep(paths).toSorted((a, b) => a.title.localeCompare(b.title)));
  const keyOf = (item: NoteItem): string => `${item.path}#${item.index}`;
  const crumbs = (item: NoteItem): string =>
    t('learnnotes.crumbs', { path: markHidden(item.title), stage: markHidden(labelText({ label: item.stage_label })), point: markHidden(labelText(item)) });
  const filtered = $derived(competence !== '' || noteState !== '' || path !== '' || kind !== '' || withDone);

  function toggleWhole(item: NoteItem): void {
    const k = keyOf(item);
    const next = new Set(whole);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    whole = next;
  }

  // The images of the hits: one store per path (its folder), made when a hit of it is first in sight, given back when
  // the view goes. A hit is read only once it comes near the visible part of the page (no observer: at once).
  const stores = new Map<string, AssetImages>();
  function storeOf(id: string): AssetImages {
    let store = stores.get(id);
    if (!store) {
      store = new AssetImages((k, owner, file, held) => app.asset(k, owner, file, held), 'path', id);
      stores.set(id, store);
    }
    return store;
  }
  $effect(() => () => {
    for (const store of stores.values()) store.dispose();
    stores.clear();
  });
  let inSight = $state<ReadonlySet<string>>(new Set());
  function sight(node: HTMLElement, key: string) {
    const show = () => {
      if (!inSight.has(key)) inSight = new Set(inSight).add(key);
    };
    if (typeof IntersectionObserver === 'undefined') {
      show();
      return {};
    }
    const watch = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        show();
        watch.disconnect();
      },
      { rootMargin: '200px' },
    );
    watch.observe(node);
    return { destroy: () => watch.disconnect() };
  }
  // An image, larger (a click on its preview).
  let viewing = $state<{ url: string; alt: string } | null>(null);

  /** `/` puts the focus into the search, unless a field or a dialog has the keys. */
  function onWindowKey(event: KeyboardEvent): void {
    if (event.key !== '/' || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"], dialog')) return;
    event.preventDefault();
    searchBox?.focus();
  }
</script>

<svelte:window onkeydown={onWindowKey} />

{#snippet hits(text: string)}{#each marked(text, query) as part, i (i)}{#if part.hit}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}{/snippet}

<section class="learnnotes" aria-labelledby="learnnotes-title">
  <header class="intro">
    <div class="head">
      <h2 id="learnnotes-title">{t('learnnotes.title')}</h2>
      <Info hint={t('learnnotes.intro')} label={t('hint.about', { what: t('learnnotes.title') })} />
    </div>
  </header>

  {#if !usable}
    <p class="none">{t('learnnotes.no_engine')}</p>
  {:else}
    <search class="tools">
      <label class="field grow" data-hint={t('learnnotes.hint.search')}
        ><span class="sr-only">{t('learnnotes.search')}</span>
        <input spellcheck="false"
          type="search"
          bind:this={searchBox}
          bind:value={typed}
          oninput={onType}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              clearTimeout(timer);
              query = typed;
            }
          }}
          placeholder={t('learnnotes.search_placeholder')}
          aria-keyshortcuts="/"
          maxlength="200"
        /></label
      >
      <fieldset class="kinds" data-hint={t('learnnotes.hint.kind')}>
        <legend class="sr-only">{t('learnnotes.kind')}</legend>
        {#each KINDS as k (k)}
          <label class="kind"><input type="radio" name="learnnotes-kind" value={k} bind:group={kind} />{t(k === '' ? 'learnnotes.kind.all' : `learnnotes.kind.${k}`)}</label>
        {/each}
      </fieldset>
      <label class="field" data-hint={t('learnnotes.hint.path')}
        >{t('learnnotes.path')}
        <select bind:value={path}>
          <option value="">{t('learnnotes.path.all')}</option>
          {#each pathChoices as p (p.id)}<option value={p.id}>{markHidden(p.title)}</option>{/each}
        </select></label
      >
      {#if competenceChoices.length > 0}
        <label class="field" data-hint={t('learnnotes.hint.competence')}
          >{t('learnnotes.competence')}
          <select bind:value={competence}>
            <option value="">{t('learnnotes.competence.all')}</option>
            {#each competenceChoices as c (c.id)}<option value={c.id}>{markHidden(c.title)}</option>{/each}
          </select></label
        >
      {/if}
      <label class="field" data-hint={t('learnnotes.hint.state')}
        >{t('learnnotes.state')}
        <select bind:value={noteState}>
          <option value="">{t('learnnotes.state.all')}</option>
          {#each NOTE_STATES as s (s)}<option value={s}>{t(`learnnotes.state.${s}`)}</option>{/each}
        </select></label
      >
      <label class="check" data-hint={t('learnnotes.hint.done')}><input type="checkbox" bind:checked={withDone} />{t('learnnotes.done')}</label>
    </search>

    {#if tooLong(typed)}
      <p class="note" role="alert">{t('learnnotes.too_long')}</p>
    {:else if problem && doc}
      <p class="note" role="alert">{t('learnnotes.failed')} <button type="button" class="link" onclick={() => void read()}>{t('learnnotes.retry')}</button></p>
    {/if}
    {#if problem && !doc}
      <div class="empty" role="alert">
        <p>{t('learnnotes.failed')}</p>
        <button type="button" onclick={() => void read()}>{t('learnnotes.retry')}</button>
      </div>
    {:else if !doc}
      <p class="none" role="status">{t('learnnotes.reading')}</p>
    {:else}
      <p class="count" role="status">
        {#if reading}{t('learnnotes.reading')}{:else}{shown.length === 1 ? t('learnnotes.count_one') : t('learnnotes.count', { n: shown.length })}{/if}
      </p>
      {#if doc.incomplete.length > 0}
        <p class="note" role="note">{t('learnnotes.incomplete', { list: doc.incomplete.map(markHidden).join(', ') })}</p>
      {/if}
      {#if shown.length === 0}
        <!-- Under the area filter the note says why; the way to a first note stays below it, for a vault that has none. -->
        {#if query.trim() === '' && !filtered && scope.active}<LearnScopeNote {app} {scope} />{/if}
        {#if doc.truncated && narrowedHere}<p class="note" role="note" data-truncated>{t('learnnotes.truncated_scope')}</p>{/if}
        <div class="empty">
          {#if query.trim() !== ''}
            <p>{t('learnnotes.no_hit', { text: markHidden(query.trim()) })}</p>
          {:else if filtered}
            <p>{t('learnnotes.no_hit_filtered')}</p>
          {:else}
            <p><strong>{t('learnnotes.none')}</strong></p>
            <p>{t('learnnotes.none_how')}</p>
            <button type="button" class="primary" onclick={() => app.setView('paths')}>{t('learnnotes.to_paths')}</button>
          {/if}
        </div>
      {:else}
        <ul class="hits" aria-label={t('learnnotes.list', { n: shown.length })}>
          {#each shown as item (keyOf(item))}
            {@const point = markHidden(labelText(item))}
            {@const link = openableLink(item.link)}
            {@const title = item.link ? linkTitle(item.label) : null}
            {@const cut = item.note ? snippet(item.note, query) : null}
            {@const isWhole = whole.has(keyOf(item))}
            <li data-path={item.path} data-point={pointRef(item)} data-state={item.state}>
              {#if item.path_done}
                <!-- The view of the paths shows the open paths only: a finished one is not opened there. -->
                <p class="open done">
                  <span class="crumbs"
                    >{markHidden(item.title)} <span aria-hidden="true">›</span> {markHidden(labelText({ label: item.stage_label }))} <span aria-hidden="true">›</span></span
                  >
                  <span class="point">{@render hits(point)}</span>
                </p>
              {:else}
                <button type="button" class="open" aria-label={t('learnnotes.open', { crumbs: crumbs(item) })} onclick={() => app.openPath(item.path, pointRef(item))}>
                  <span class="crumbs"
                    >{markHidden(item.title)} <span aria-hidden="true">›</span> {markHidden(labelText({ label: item.stage_label }))} <span aria-hidden="true">›</span></span
                  >
                  <span class="point">{@render hits(point)}</span>
                </button>
              {/if}
              <span class="tags">
                <span class="state {item.state}">{t(`learnnotes.state.${item.state}`)}</span>
                {#if item.path_done}<span class="sub">· {t('learnnotes.path_done')}</span>{/if}
              </span>
              {#if item.note && cut}
                {#if isWhole}
                  <div class="whole prose"><Blocks blocks={parseMarkdown(item.note)} headingBase={3} /></div>
                {:else}
                  <p class="snippet">{@render hits(markHidden(cut.text))}</p>
                {/if}
                {#if cut.cut}
                  <button type="button" class="link" aria-expanded={isWhole} aria-label={t('learnnotes.more_of', { point })} onclick={() => toggleWhole(item)}
                    >{t(isWhole ? 'learnnotes.less' : 'learnnotes.more')}</button
                  >
                {/if}
              {/if}
              {#if link}
                <p class="source">
                  <span class="sub">{t('learnnotes.link')}:</span>
                  <a href={link} target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer"
                    ><strong>{@render hits(hostOf(link) ?? link)}</strong>{#if title}{' — '}{@render hits(markHidden(title))}{/if}</a
                  >
                </p>
              {/if}
              {#if item.image}
                {@const image = item.image}
                <div class="image" use:sight={keyOf(item)}>
                  {#if inSight.has(keyOf(item))}
                    <AssetImg
                      images={storeOf(item.path)}
                      file={image}
                      alt={labelText(item) || imageName(image)}
                      missing={t('image.missing')}
                      onopen={(url, alt) => (viewing = { url, alt })}
                    />
                  {/if}
                  <span class="sub">{t('learnnotes.image', { name: markHidden(imageName(image)) })}</span>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
        {#if doc.truncated && narrowedHere}
          <p class="note" role="note" data-truncated>{t('learnnotes.truncated_scope')}</p>
        {:else if doc.truncated}
          <p class="note" data-truncated>{t('learnnotes.truncated', { shown: doc.items.length, total: doc.total })}</p>
        {/if}
      {/if}
    {/if}
  {/if}
</section>

<ImageViewer image={viewing} close={() => (viewing = null)} label={{ close: t('image.close'), view: t('image.view') }} />

<style>
  .learnnotes {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.5rem 0;
  }
  .intro .head,
  .tools,
  .kinds,
  .tags {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  h2,
  p {
    margin: 0;
  }
  .none,
  .sub,
  .count,
  .note,
  .crumbs {
    color: var(--muted);
  }
  .field,
  .check,
  .kind {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .grow {
    flex: 1 1 16rem;
  }
  .grow input {
    inline-size: 100%;
  }
  .kinds {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.15rem 0.5rem;
    margin: 0;
  }
  select,
  input[type='search'] {
    font: inherit;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.2rem 0.4rem;
  }
  .hits {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .hits > li {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.6rem 0.75rem;
  }
  .open {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    align-items: baseline;
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    color: var(--text);
    text-align: start;
    cursor: pointer;
  }
  .open.done {
    cursor: default;
    margin: 0;
  }
  .open.done .point {
    text-decoration: none;
  }
  .open .point {
    font-weight: 600;
    text-decoration: underline;
    overflow-wrap: anywhere;
  }
  .open:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  mark {
    background: var(--mark);
    color: var(--text);
    border-radius: 2px;
    text-decoration: underline;
  }
  .snippet,
  .whole {
    overflow-wrap: anywhere;
  }
  .whole :global(p) {
    margin: 0.2rem 0;
  }
  .image {
    display: flex;
    align-items: flex-end;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .image :global(img) {
    max-block-size: 6rem;
    max-inline-size: 12rem;
    object-fit: contain;
    border-radius: var(--radius);
  }
  .source a {
    color: var(--accent);
    overflow-wrap: anywhere;
  }
  .state.learned {
    color: var(--ok);
  }
  .state.open,
  .state.blocked,
  .state.dropped {
    color: var(--muted);
  }
  .state.seen,
  .state.partial {
    color: var(--accent);
  }
  button.primary,
  .empty button {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.25rem 0.6rem;
    min-height: 2rem;
    font: inherit;
    cursor: pointer;
  }
  button.primary {
    background: var(--accent);
    color: var(--accent-text);
    border-color: var(--accent);
  }
  .link {
    align-self: flex-start;
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
    text-decoration: underline;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 1rem;
    background: var(--surface);
    border: 1px dashed var(--border);
    border-radius: var(--radius);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  @media (forced-colors: active) {
    mark {
      background: Highlight;
      color: HighlightText;
    }
  }
</style>
