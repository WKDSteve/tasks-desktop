<script lang="ts">
  // The repo tiles of this device: repos as tiles in groups under titles of one's own. The hub keeps the file and
  // never names a path; a tile shows the image of its repo (read with the session, shown from a blob of the page) or
  // the first letter of its name. A click on a tile opens the tasks of its area; its menu copies it into another group,
  // takes it out of one, renames or deletes it, and opens its folder or Neovim in it on the machine of the hub.
  import { onDestroy } from 'svelte';
  import type { App } from '../lib/app.svelte';
  import { translate, type Key } from '../lib/i18n';
  import {
    groupAdded,
    groupMoved,
    groupRemoved,
    groupRenamed,
    initial,
    newId,
    repoRemoved,
    tileCopied,
    tileMoved,
    tileTaken,
    type RepoGroup,
  } from '../lib/repos';
  import TileGroups from './TileGroups.svelte';

  let { app }: { app: App } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);
  const rs = $derived(app.reposState);

  $effect(() => {
    void rs.load();
  });

  const doc = $derived(rs.doc);
  const groups = $derived(doc?.groups ?? []);
  const repo = (id: string) => doc?.repos[id];

  // The images: read once per tile with the session, shown from a blob address the page made itself.
  let images = $state<Record<string, string>>({});
  const asked = new Set<string>();
  $effect(() => {
    for (const [id, r] of Object.entries(doc?.repos ?? {})) {
      if (!r.image || asked.has(id)) continue;
      asked.add(id);
      void app.repoImage(id).then((blob) => {
        if (blob) images = { ...images, [id]: URL.createObjectURL(blob) };
      });
    }
  });
  onDestroy(() => {
    for (const url of Object.values(images)) URL.revokeObjectURL(url);
  });

  // What the last move did, for a screen reader.
  let said = $state('');

  async function move(id: string, from: string, to: string, index: number): Promise<void> {
    const next = tileMoved(groups, id, from, to, index);
    if (await rs.save(next)) {
      const group = next.find((g) => g.id === to);
      said = t('repos.moved', { name: repo(id)?.name ?? id, group: group?.title ?? '', n: index + 1 });
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-tile-group="${to}"][data-tile="${id}"]`)?.focus());
    }
  }

  // -- groups --
  let newTitle = $state('');
  let renaming = $state<string | null>(null);
  let renameTo = $state('');
  let removing = $state<string | null>(null);

  async function addGroup(): Promise<void> {
    if (newTitle.trim() === '') return;
    const id = newId((n) => crypto.getRandomValues(new Uint8Array(n)), (x) => groups.some((g) => g.id === x));
    if (await rs.save(groupAdded(groups, newTitle, id))) newTitle = '';
  }

  async function renameGroup(id: string): Promise<void> {
    if (renameTo.trim() === '') return;
    if (await rs.save(groupRenamed(groups, id, renameTo))) renaming = null;
  }

  // -- adding a repo --
  let path = $state('');
  let name = $state('');
  let into = $state('');
  $effect(() => {
    if (into === '' || !groups.some((g) => g.id === into)) into = groups[0]?.id ?? '';
  });

  async function choose(): Promise<void> {
    const chosen = await app.vaultsState.pick();
    if (chosen) path = chosen;
  }

  async function addRepo(): Promise<void> {
    if (path.trim() === '' || into === '') return;
    const sent = { path, name };
    // Cleared only when it is still what was sent: what the person typed meanwhile stays.
    if (await rs.add(path.trim(), into, name) && path === sent.path && name === sent.name) path = name = '';
  }

  // -- the menu of a tile --
  let menuOf = $state<{ id: string; group: string } | null>(null);
  let copyTo = $state('');
  let tileName = $state('');

  function openMenu(id: string, group: string): void {
    menuOf = { id, group };
    tileName = repo(id)?.name ?? '';
    copyTo = groups.find((g) => g.id !== group)?.id ?? '';
  }

  function open(id: string, group: string): void {
    const area = repo(id)?.area;
    if (area) app.openAreaInList(area);
    else openMenu(id, group);
  }

  async function act(run: () => Promise<boolean>): Promise<void> {
    if (await run()) menuOf = null;
  }
</script>

<section class="repos" aria-label={t('nav.repos')}>
  <h2>{t('nav.repos')}</h2>
  {#if rs.read === 'unavailable'}
    <p class="muted" role="status">{t('repos.unavailable')}</p>
  {:else if rs.read === 'failed'}
    <p class="muted" role="status">{t('repos.failed')}</p>
  {:else}
    {#if doc?.problem === 'invalid'}
      <p class="warn" role="status">{t('repos.invalid', { why: doc.message ?? '' })}</p>
    {/if}
    {#if rs.problem}
      <p class="warn" role="alert">{rs.problem === 'stale' ? t('repos.stale') : rs.problem}</p>
    {/if}
    <p class="sr-only" aria-live="polite">{said}</p>

    <div class="forms">
      <form onsubmit={(e) => (e.preventDefault(), void addGroup())}>
        <label><span>{t('repos.group.new')}</span><input type="text" bind:value={newTitle} maxlength="80" /></label>
        <button type="submit" disabled={rs.saving || newTitle.trim() === ''}>{t('repos.group.add')}</button>
      </form>
      {#if groups.length > 0}
        <form onsubmit={(e) => (e.preventDefault(), void addRepo())}>
          <label><span>{t('repos.add.path')}</span><input type="text" bind:value={path} maxlength="1024" /></label>
          <button type="button" onclick={() => void choose()}>{t('repos.add.choose')}</button>
          <label><span>{t('repos.add.name')}</span><input type="text" bind:value={name} maxlength="80" /></label>
          <label>
            <span>{t('repos.add.group')}</span>
            <select bind:value={into}>{#each groups as g (g.id)}<option value={g.id}>{g.title}</option>{/each}</select>
          </label>
          <button type="submit" disabled={rs.saving || path.trim() === ''}>{t('repos.add.save')}</button>
        </form>
      {:else if rs.read === 'ready'}
        <p class="muted">{t('repos.empty')}</p>
      {/if}
    </div>

    {#snippet head(group: RepoGroup, g: number)}
      {#if renaming === group.id}
        <form class="inline" onsubmit={(e) => (e.preventDefault(), void renameGroup(group.id))}>
          <label><span class="sr-only">{t('repos.group.title')}</span><input type="text" bind:value={renameTo} maxlength="80" /></label>
          <button type="submit" disabled={rs.saving}>{t('repos.group.rename.save')}</button>
          <button type="button" onclick={() => (renaming = null)}>{t('repos.cancel')}</button>
        </form>
      {:else}
        <h3>{group.title}</h3>
        <button type="button" onclick={() => ((renaming = group.id), (renameTo = group.title))}>{t('repos.group.rename')}</button>
        <button type="button" disabled={rs.saving || g === 0} onclick={() => void rs.save(groupMoved(groups, group.id, -1))}
          >{t('repos.group.up')}</button
        >
        <button type="button" disabled={rs.saving || g === groups.length - 1} onclick={() => void rs.save(groupMoved(groups, group.id, 1))}
          >{t('repos.group.down')}</button
        >
        {#if removing === group.id}
          <span role="group" aria-label={t('repos.group.remove.ask', { title: group.title })}>
            <span>{t('repos.group.remove.ask', { title: group.title })}</span>
            <button type="button" onclick={() => void rs.save(groupRemoved(groups, group.id)).then(() => (removing = null))}>{t('repos.yes')}</button>
            <button type="button" onclick={() => (removing = null)}>{t('repos.no')}</button>
          </span>
        {:else}
          <button type="button" disabled={rs.saving} onclick={() => (removing = group.id)}>{t('repos.group.remove')}</button>
        {/if}
      {/if}
    {/snippet}

    {#snippet tile(id: string, group: RepoGroup)}
      {@const r = repo(id)}
      <div class="tile">
        <button
          type="button"
          class="face"
          data-tile={id}
          data-tile-group={group.id}
          aria-label={r?.area ? t('repos.tile.open', { name: r.name, area: r.area }) : r?.name}
          onclick={() => open(id, group.id)}
        >
          {#if images[id]}<img src={images[id]} alt="" />{:else}<span class="initial" aria-hidden="true">{initial(r?.name ?? '')}</span>{/if}
          <span class="name">{r?.name}</span>
        </button>
        <button type="button" class="more" aria-label={t('repos.tile.menu', { name: r?.name ?? id })} onclick={() => openMenu(id, group.id)}>⋯</button>
        {#if menuOf?.id === id && menuOf.group === group.id}
          <div class="menu" role="group" aria-label={t('repos.tile.menu', { name: r?.name ?? id })}>
            <form class="inline" onsubmit={(e) => (e.preventDefault(), void act(() => rs.save(groups, { [id]: tileName.trim() })))}>
              <label><span>{t('repos.tile.name')}</span><input type="text" bind:value={tileName} maxlength="80" /></label>
              <button type="submit" disabled={rs.saving || tileName.trim() === ''}>{t('repos.tile.rename')}</button>
            </form>
            {#if groups.length > 1}
              <form class="inline" onsubmit={(e) => (e.preventDefault(), void act(() => rs.save(tileCopied(groups, id, copyTo))))}>
                <label>
                  <span>{t('repos.tile.copy_to')}</span>
                  <select bind:value={copyTo}>{#each groups.filter((g) => g.id !== group.id) as g (g.id)}<option value={g.id}>{g.title}</option>{/each}</select>
                </label>
                <button type="submit" disabled={rs.saving}>{t('repos.tile.copy')}</button>
              </form>
            {/if}
            <button type="button" disabled={rs.saving} onclick={() => void act(() => rs.save(tileTaken(groups, id, group.id)))}>{t('repos.tile.take')}</button>
            <button type="button" disabled={rs.saving} onclick={() => void act(() => rs.save(repoRemoved(groups, id)))}>{t('repos.tile.delete')}</button>
            <button type="button" onclick={() => void app.openRepo(id, 'folder')}>{t('repos.tile.folder')}</button>
            <button type="button" onclick={() => void app.openRepo(id, 'nvim')}>{t('repos.tile.nvim')}</button>
            <button type="button" onclick={() => (menuOf = null)}>{t('repos.cancel')}</button>
          </div>
        {/if}
      </div>
    {/snippet}

    <TileGroups {groups} label={t('nav.repos')} {tile} {head} busy={rs.saving} gripHint={t('repos.grip')} onmove={(id, from, to, index) => void move(id, from, to, index)} />
  {/if}
</section>

<style>
  .repos {
    display: grid;
    gap: 0.75rem;
  }
  /* The buttons of the page in the colours of the page (the system's own would not hold the contrast in dark). */
  .repos button:not(.face):not(.more) {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0.3rem 0.7rem;
    cursor: pointer;
  }
  .repos button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .repos input,
  .repos select {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0.25rem 0.4rem;
  }
  h2 {
    margin: 0;
    font-size: 1.1rem;
  }
  :global(.tile-groups) h3 {
    display: inline;
    margin: 0 0.5rem 0 0;
    font-size: 1rem;
  }
  .forms,
  .forms form,
  .inline {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: end;
  }
  label {
    display: grid;
    gap: 0.15rem;
    font-size: 0.85rem;
  }
  .muted {
    margin: 0;
    color: var(--muted);
  }
  .warn {
    margin: 0;
    color: var(--warn);
  }
  .tile {
    position: relative;
    display: grid;
    gap: 0.2rem;
  }
  .face {
    display: grid;
    justify-items: center;
    gap: 0.25rem;
    width: 7rem;
    padding: 0.5rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
  }
  .face img,
  .initial {
    width: 3rem;
    height: 3rem;
    object-fit: contain;
  }
  .initial {
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--surface-2);
    font-size: 1.4rem;
    font-weight: 600;
  }
  .name {
    font-size: 0.85rem;
    text-align: center;
    overflow-wrap: anywhere;
  }
  .more {
    position: absolute;
    top: 0.15rem;
    right: 0.15rem;
    border: none;
    background: none;
    color: var(--text);
    cursor: pointer;
  }
  .menu {
    position: absolute;
    z-index: 2;
    top: 100%;
    left: 0;
    display: grid;
    gap: 0.3rem;
    min-width: 14rem;
    padding: 0.5rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
