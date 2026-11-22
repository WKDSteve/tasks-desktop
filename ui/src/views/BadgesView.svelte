<script lang="ts">
  // The badges of all learning paths (concept "Reiter Lernpläne" 8): every line of `## Level` of every path as a tile,
  // earned ones with the day the series of the learning figures saw them reached, open ones grey with a lock, a dashed
  // frame and what is missing, the next one of each path with a ring. What is reached and missing is the engine's
  // (`tasks.paths` with `levels`, capability `paths_levels`; WEB-13); lib/badges.ts orders and groups. A tile is a button
  // that opens its detail below its group (threshold, reward, the path); the tiles are one stop of the Tab key, the arrow
  // keys walk them. Only with the game on (gamification and `xp`).
  import { tick, untrack } from 'svelte';
  import type { App } from '../lib/app.svelte';
  import type { Key } from '../lib/i18n';
  import type { Paths, PathEntryLevel } from '../lib/contract';
  import Info from 'appkit-ui/Info.svelte';
  import LearnScopeNote from './LearnScopeNote.svelte';
  import { scopeOf } from '../lib/learnScope';
  import BadgeMedal from './BadgeMedal.svelte';
  import ItemIcon from './ItemIcon.svelte';
  import { AssetImages } from '../lib/assetImages.svelte';
  import { shownIcon } from '../lib/icons';
  import { markHidden } from '../lib/text';
  import { badgeTexts, type BadgeKey } from '../lib/badgeTexts';
  import {
    BADGE_FILTERS,
    BADGE_GROUPINGS,
    badgeImage,
    badgeTiles,
    dayDate,
    filterTiles,
    groupTiles,
    walkTiles,
    type BadgeFilter,
    type BadgeGroup,
    type BadgeGrouping,
    type BadgeTile,
  } from '../lib/badges';

  let { app }: { app: App } = $props();
  const t = (key: BadgeKey | Key, params: Record<string, string | number> = {}) => badgeTexts.t(app.lang, key, params);

  const usable = $derived(app.can('paths') && app.can('paths_levels'));
  const game = $derived(app.gamification && app.can('xp'));

  // The paths with their levels: read when the view opens, after every write and when the hub tells of a change.
  let doc = $state<Paths | null>(null);
  let problem = $state(false);
  let asked = 0;
  async function read(): Promise<void> {
    const mine = ++asked;
    try {
      const answer = await app.pathsWithLevels();
      if (mine !== asked) return;
      doc = answer;
      app.rememberPaths(answer.items);
      problem = false;
    } catch {
      if (mine !== asked) return;
      problem = true;
    }
  }
  $effect(() => {
    void app.writes;
    void app.snapshot?.rev;
    if (!usable || !game) return;
    untrack(() => void read());
  });

  let filter = $state<BadgeFilter>('all');
  let grouping = $state<BadgeGrouping>('path');
  // The paths of the areas the area filter of the page shows (lib/learnScope.ts).
  const scope = $derived(scopeOf(app));
  const tiles = $derived(badgeTiles(scope.keep(doc?.items ?? [])));
  const hiddenByScope = $derived(tiles.length === 0 && scope.active && badgeTiles(doc?.items ?? []).length > 0);
  const earned = $derived(tiles.filter((tile) => tile.earned).length);
  const groups = $derived(groupTiles(filterTiles(tiles, filter), grouping));
  const flat = $derived(groups.flatMap((g) => g.tiles));
  const anyUndated = $derived(tiles.some((tile) => tile.earned && tile.level.reached_on === undefined));

  // One store of pictures per path that names a badge below `assets/badges/`; given back when it is gone or the view goes.
  const imagePaths = $derived([...new Set(tiles.filter((tile) => badgeImage(tile) !== null).map((tile) => tile.path))].sort().join('\n'));
  let images = $state<ReadonlyMap<string, AssetImages>>(new Map());
  $effect(() => {
    const ids = imagePaths === '' ? [] : imagePaths.split('\n');
    const stores = new Map(ids.map((id) => [id, new AssetImages((kind, owner, file, held) => app.asset(kind, owner, file, held), 'path', id)] as const));
    images = stores;
    return () => {
      for (const store of stores.values()) store.dispose();
    };
  });
  // A path read again: a badge put into its folder since is read again.
  $effect(() => {
    const stores = images;
    const items = doc?.items ?? [];
    untrack(() => {
      for (const entry of items) stores.get(entry.id)?.refresh(entry.etag, entry.assets);
    });
  });

  // Dates as the language writes them; a day of the series is a day, not a moment (dayDate: noon UTC).
  const locale = $derived(app.lang === 'de' ? 'de-DE' : 'en-GB');
  const shortDay = $derived(new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', timeZone: 'UTC' }));
  const longDay = $derived(new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }));
  const monthName = $derived(new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }));
  const short = (day: string): string => {
    const date = dayDate(day);
    return date ? shortDay.format(date) : day;
  };
  const long = (day: string): string => {
    const date = dayDate(day);
    return date ? longDay.format(date) : day;
  };

  const levelName = (level: PathEntryLevel): string =>
    level.name ? markHidden(level.name) : level.kind === 'done' ? t('badges.path_done') : t('badges.level', { n: level.number ?? level.ref });
  /** What the tile says of its state, in words (the symbol beside it is only a picture of it). */
  function stateText(tile: BadgeTile): string {
    const level = tile.level;
    if (tile.earned) return level.reached_on ? t('badges.state.earned_on', { date: short(level.reached_on) }) : t('badges.state.earned');
    if (level.missing_xp !== undefined) return t('badges.state.missing_xp', { n: level.missing_xp });
    if (level.missing_percent !== undefined) return t('badges.state.missing_percent', { n: level.missing_percent });
    if (level.kind === 'done') return t('badges.state.at_done');
    return t('badges.state.open');
  }
  function thresholdText(level: PathEntryLevel): string {
    if (level.kind === 'done') return t('badges.threshold.done');
    if (level.threshold === undefined) return '—';
    return level.kind === 'xp' ? t('badges.threshold.xp', { n: level.threshold }) : t('badges.threshold.percent', { n: level.threshold });
  }
  function groupTitle(group: BadgeGroup): string {
    if (group.kind === 'path') return markHidden(tiles.find((tile) => tile.path === group.id)?.pathTitle ?? group.id ?? '');
    if (group.kind === 'month') {
      const date = dayDate(`${group.id}-01`);
      return date ? monthName.format(date) : (group.id ?? '');
    }
    return group.kind === 'undated' ? t('badges.group.undated') : t('badges.group.open');
  }
  const pathTitle = (id: string): string => markHidden(doc?.items.find((p) => p.id === id)?.title ?? id);
  const groupIcon = (group: BadgeGroup) => {
    const entry = group.kind === 'path' ? doc?.items.find((p) => p.id === group.id) : undefined;
    return entry ? shownIcon({ kind: 'path', id: entry.id, ...(entry.icon ? { icon: entry.icon } : {}) }) : null;
  };

  // One stop of the Tab key over all tiles: the one last focused, else the first.
  let focusKey = $state<string | null>(null);
  const tabStop = $derived(focusKey !== null && flat.some((tile) => tile.key === focusKey) ? focusKey : (flat[0]?.key ?? null));
  let root = $state<HTMLElement | null>(null);
  const tileElement = (key: string): HTMLElement | null =>
    root?.querySelector<HTMLElement>(`[data-badge="${CSS.escape(key)}"]`) ?? null;
  /** The tiles in one row of a grid, from its columns as drawn (1 where nothing is drawn, as in a test). */
  function columns(key: string): number {
    const grid = tileElement(key)?.closest('ul');
    if (!grid) return 1;
    const template = getComputedStyle(grid).gridTemplateColumns;
    const n = template ? template.split(' ').filter((part) => part !== '').length : 1;
    return Math.max(1, n);
  }
  async function focusTile(key: string): Promise<void> {
    focusKey = key;
    await tick();
    const el = tileElement(key);
    el?.focus();
    el?.scrollIntoView({ block: 'nearest' });
  }
  function onTileKey(e: KeyboardEvent, tile: BadgeTile): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape' && open !== null) {
      e.preventDefault();
      open = null;
      return;
    }
    const at = flat.findIndex((x) => x.key === tile.key);
    const next = walkTiles(
      e.key,
      at,
      groups.map((g) => g.tiles.length),
      columns(tile.key),
    );
    if (next === null) return;
    e.preventDefault();
    const target = flat[next];
    if (target) void focusTile(target.key);
  }

  // The tile whose detail is open (below its group).
  let open = $state<string | null>(null);
  const openTile = $derived(open === null ? null : (flat.find((tile) => tile.key === open) ?? null));
  function toggle(tile: BadgeTile): void {
    focusKey = tile.key;
    open = open === tile.key ? null : tile.key;
  }
  async function closeDetail(): Promise<void> {
    const key = open;
    open = null;
    if (key !== null) await focusTile(key);
  }
  /** Esc anywhere in the detail closes it, the focus back on its tile (an action: the detail is no control itself). */
  function closesOnEscape(node: HTMLElement) {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      void closeDetail();
    };
    node.addEventListener('keydown', onKey);
    return { destroy: () => node.removeEventListener('keydown', onKey) };
  }

  // The ring of the next badge: a circle of radius 40 (r = 40, circumference 2πr).
  const RING = 2 * Math.PI * 40;
</script>

{#snippet lock()}
  <svg class="lock" viewBox="0 0 12 14" width="11" height="13" aria-hidden="true"
    ><path d="M3 6V4a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6" /><rect x="1" y="6" width="10" height="7" rx="1.5" fill="currentColor" /></svg
  >
{/snippet}


<section class="badges" aria-label={t('nav.badges')} bind:this={root}>
  <header class="head">
    <h2>{t('nav.badges')}</h2>
    <Info hint={t('badges.intro')} label={t('hint.about', { what: t('nav.badges') })} />
  </header>

  {#if !game}
    <p class="none" role="note">{t('badges.off')}</p>
  {:else if !usable}
    <p class="none" role="note">{t('badges.old_engine')}</p>
  {:else if problem && doc === null}
    <p class="none" role="alert">{t('badges.failed')} <button type="button" onclick={() => void read()}>{t('paths.retry')}</button></p>
  {:else if doc === null}
    <p class="none" role="status">{t('badges.reading')}</p>
  {:else if hiddenByScope}
    <LearnScopeNote {app} {scope} />
  {:else if tiles.length === 0}
    <div class="empty" data-badges-empty>
      <p>{t('badges.none')}</p>
      <p class="none">{t('badges.none_how')}</p>
      <pre><code>## Level

{t('badges.none_example')}</code></pre>
      <button type="button" onclick={() => app.setView('paths')}>{t('badges.open_paths')}</button>
    </div>
  {:else}
    <div class="bar">
      <p class="count" data-badges-count>{t('badges.count', { earned, total: tiles.length })}</p>
      <fieldset class="choice" data-hint={t('hint.form.badges.filter')}>
        <legend class="sr">{t('badges.filter')}</legend>
        {#each BADGE_FILTERS as value (value)}
          <label><input type="radio" name="badges-filter" {value} bind:group={filter} data-badges-filter={value} />{t(`badges.filter.${value}`)}</label>
        {/each}
      </fieldset>
      <fieldset class="choice" data-hint={t('hint.form.badges.group')}>
        <legend>{t('badges.group')}</legend>
        {#each BADGE_GROUPINGS as value (value)}
          <label><input type="radio" name="badges-group" {value} bind:group={grouping} data-badges-group={value} />{t(`badges.group.${value}`)}</label>
        {/each}
      </fieldset>
    </div>
    {#if anyUndated}<p class="note" role="note">{t('badges.no_series')}</p>{/if}

    {#if flat.length === 0}
      <p class="none" role="status">{t('badges.filtered_none', { filter: t(`badges.filter.${filter}`) })}</p>
    {/if}
    {#each groups as group (group.key)}
      {@const icon = groupIcon(group)}
      <section class="group" aria-labelledby="badge-group-{group.key}">
        <h3 id="badge-group-{group.key}">
          {#if icon}<ItemIcon {app} shown={icon} />{/if}
          {groupTitle(group)}
        </h3>
        <ul class="grid" aria-label={t('badges.grid', { title: groupTitle(group) })}>
          {#each group.tiles as tile (tile.key)}
            <li>
              <button
                type="button"
                class="tile"
                class:earned={tile.earned}
                class:next={tile.next}
                tabindex={tile.key === tabStop ? 0 : -1}
                aria-expanded={open === tile.key}
                aria-controls={open === tile.key ? 'badge-detail' : undefined}
                data-badge={tile.key}
                data-badge-state={tile.earned ? 'earned' : 'open'}
                onclick={() => toggle(tile)}
                onfocus={() => (focusKey = tile.key)}
                onkeydown={(e) => onTileKey(e, tile)}
              >
                <span class="art">
                  <BadgeMedal {tile} images={images.get(tile.path)} size={64} />
                  {#if tile.next && tile.progress !== undefined}
                    <svg class="ring" viewBox="0 0 92 92" aria-hidden="true"
                      ><circle class="track" cx="46" cy="46" r="40" /><circle
                        class="done"
                        cx="46"
                        cy="46"
                        r="40"
                        stroke-dasharray="{(RING * tile.progress) / 100} {RING}"
                        transform="rotate(-90 46 46)"
                      /></svg
                    >
                  {/if}
                  {#if !tile.earned}<span class="locked">{@render lock()}</span>{/if}
                </span>
                <span class="name">{levelName(tile.level)}</span><span class="sr">,</span>
                {#if group.kind !== 'path'}<span class="path">{markHidden(tile.pathTitle)}</span><span class="sr">,</span>{/if}
                <span class="state"
                  ><span aria-hidden="true">{tile.earned ? '✓' : '○'}</span>
                  {stateText(tile)}{#if tile.next && tile.progress !== undefined}<span class="sr">,</span> · {t('badges.state.progress', { n: tile.progress })}{/if}</span
                >
              </button>
            </li>
          {/each}
        </ul>
        {#if openTile !== null && group.tiles.some((tile) => tile.key === openTile.key)}
          {@const level = openTile.level}
          <div id="badge-detail" class="detail" role="region" aria-labelledby="badge-detail-title" tabindex="-1" use:closesOnEscape data-badge-detail>
            <BadgeMedal tile={openTile} images={images.get(openTile.path)} size={96} />
            <div class="facts">
              <h4 id="badge-detail-title">{t('badges.detail', { level: levelName(level) })}</h4>
              <dl>
                <dt>{t('badges.detail.state')}</dt>
                <dd>
                  <span aria-hidden="true">{openTile.earned ? '✓' : '○'}</span>
                  {openTile.earned && level.reached_on ? t('badges.state.earned_on', { date: long(level.reached_on) }) : stateText(openTile)}
                </dd>
                <dt>{t('badges.detail.threshold')}</dt>
                <dd>{thresholdText(level)}</dd>
                <dt>{t('badges.detail.reward')}</dt>
                <dd data-badge-reward>
                  {#if level.reward}
                    {markHidden(level.reward)}
                    <span class="muted"
                      >({level.given
                        ? level.given_on
                          ? t('badges.reward.given_on', { date: long(level.given_on) })
                          : t('badges.reward.given')
                        : t('badges.reward.open')})</span
                    >
                  {:else}{t('badges.reward.none')}{/if}
                </dd>
                <dt>{t('badges.detail.path')}</dt>
                <dd>{pathTitle(openTile.path)}</dd>
              </dl>
              <p class="actions">
                <button type="button" onclick={() => app.openPath(openTile.path)} data-badge-open-path>{t('badges.open_path')}</button>
                <button type="button" onclick={() => void closeDetail()}>{t('badges.close')}</button>
              </p>
            </div>
          </div>
        {/if}
      </section>
    {/each}
  {/if}
</section>

<style>
  .badges {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 0;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  h2 {
    margin: 0;
    font-size: 1.1rem;
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin: 0.4rem 0 0.3rem;
    font-size: 0.95rem;
  }
  h4 {
    margin: 0 0 0.3rem;
    font-size: 1rem;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .none,
  .note,
  .muted {
    color: var(--muted);
  }
  .none,
  .note,
  .count {
    margin: 0;
  }
  .count {
    font-weight: 700;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.4rem;
  }
  .empty p {
    margin: 0;
  }
  pre {
    margin: 0;
    padding: 0.4rem 0.6rem;
    background: var(--surface-2);
    border-radius: var(--radius);
    max-width: 100%;
    overflow-x: auto;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
  }
  .choice {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.2rem 0.6rem;
    margin: 0;
  }
  .choice legend:not(.sr) {
    float: left;
    color: var(--muted);
  }
  .choice label {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, 140px);
    gap: 0.75rem;
  }
  .tile {
    box-sizing: border-box;
    width: 140px;
    min-height: 160px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 0.5rem 0.4rem;
    background: var(--surface);
    color: var(--text);
    border: 1px dashed var(--muted);
    border-radius: var(--radius);
    cursor: pointer;
    font: inherit;
    text-align: center;
  }
  .tile.earned {
    border: 2px solid var(--ok);
  }
  .tile:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .tile[aria-expanded='true'] {
    background: var(--surface-2);
  }
  .art {
    position: relative;
    display: grid;
    place-items: center;
    width: 92px;
    height: 92px;
  }
  .ring {
    position: absolute;
    inset: 0;
    width: 92px;
    height: 92px;
  }
  .ring circle {
    fill: none;
    stroke-width: 5;
  }
  .ring .track {
    stroke: var(--surface-2);
  }
  .ring .done {
    stroke: var(--accent);
  }
  .locked {
    position: absolute;
    top: 4px;
    right: 4px;
    color: var(--text);
  }
  .name {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .path {
    font-size: 0.85em;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .state {
    font-size: 0.85em;
    color: var(--muted);
  }
  .tile.earned .state {
    color: var(--ok);
    font-weight: 600;
  }
  .detail {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: flex-start;
    margin-top: 0.6rem;
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    max-width: 40rem;
  }
  .facts {
    flex: 1 1 16rem;
    min-width: 0;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.2rem 0.8rem;
    margin: 0;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 0.6rem 0 0;
  }
  button:not(.tile) {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.2rem 0.6rem;
    min-height: 2rem;
    cursor: pointer;
  }
  @media (max-width: 600px) {
    .grid {
      grid-template-columns: 1fr;
    }
    .tile {
      width: 100%;
      min-height: 0;
      flex-direction: row;
      text-align: start;
      flex-wrap: wrap;
    }
    .detail {
      flex-direction: column;
    }
  }
  @media (forced-colors: active) {
    .ring .done {
      stroke: Highlight;
    }
    .ring .track {
      stroke: CanvasText;
    }
    .tile.earned {
      border-color: CanvasText;
    }
  }
</style>
