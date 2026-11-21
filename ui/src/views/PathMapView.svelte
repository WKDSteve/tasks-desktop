<script lang="ts">
  // The competence map of the learning paths (concept "Kompetenzkarte"): each path a box coloured by its stage, each
  // project a frame around its paths, each requirement (`requires`) an arrow from it to what builds on it, hard ones
  // solid with a filled head, soft ones dashed with an open one. Stage, waiting, met and the circles are the engine's
  // (`tasks.paths` with `include_done`, capability `requires`; WEB-13); lib/pathMap.ts lays them out. Read only: a box
  // opens its path, a frame's title its project. The boxes are buttons over a picture of the arrows (aria-hidden), one
  // stop of the Tab key (the arrow keys walk the chain); the list beside it says the same as a table.
  import { tick, untrack } from 'svelte';
  import type { App } from '../lib/app.svelte';
  import { translate, type Key } from '../lib/i18n';
  import type { PathEntry, Paths, PathStage } from '../lib/contract';
  import Info from 'appkit-ui/Info.svelte';
  import ItemIcon from './ItemIcon.svelte';
  import { shownIcon } from '../lib/icons';
  import { markHidden } from '../lib/text';
  import {
    besideBox,
    chainOf,
    dependentsOf,
    HEAD,
    layoutPathMap,
    linkedBoxes,
    readingOrder,
    softOpen,
    stageOf,
    type MapBox,
    type MapEdge,
    type MapProject,
  } from '../lib/pathMap';

  let { app }: { app: App } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  const usable = $derived(app.can('paths') && app.can('path'));
  const withRequires = $derived(app.can('requires'));
  const game = $derived(app.gamification && app.can('xp'));

  // The paths: read when the view opens, after every write and when the hub tells of a change (the snapshot's rev).
  let doc = $state<Paths | null>(null);
  let problem = $state(false);
  let asked = 0;
  async function read(): Promise<void> {
    const mine = ++asked;
    try {
      const answer = await app.pathsForMap();
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
    if (!usable) return;
    untrack(() => void read());
  });

  // The projects: the open ones of the snapshot, the finished ones a requirement names.
  const projects = $derived.by((): MapProject[] => [
    ...(app.snapshot?.projects ?? []).map((p) => ({
      id: p.id,
      title: p.title,
      ...(p.requires ? { requires: p.requires } : {}),
      ...(p.waiting_on ? { waiting_on: p.waiting_on } : {}),
      ...(p.status === 'parked' ? { parked: true } : {}),
    })),
    ...(doc?.done_projects ?? []).map((p) => ({ id: p.id, title: p.title, done: true })),
  ]);
  const openProjects = $derived(new Set((app.snapshot?.projects ?? []).map((p) => p.id)));
  const all = $derived(doc?.items ?? []);
  const paths = $derived(new Map(all.map((p) => [p.id, p] as const)));
  const titleOf = (id: string): string => paths.get(id)?.title ?? projects.find((p) => p.id === id)?.title ?? id;
  // The projects a path of the list belongs to, for the filter.
  const projectChoices = $derived(
    projects.filter((p) => all.some((path) => path.project === p.id)).toSorted((a, b) => a.title.localeCompare(b.title)),
  );

  // What is shown: the finished ones hidden on request, one project, or the chain of one box.
  let project = $state('');
  let chainOnly = $state<string | null>(null);
  const hideDone = $derived(app.pathMapHideDone);
  const shown = $derived(all.filter((p) => (!hideDone || stageOf(p) !== 'done') && (project === '' || p.project === project)));
  const hidden = $derived.by(() => {
    const keep = new Set(shown.map((p) => p.id));
    const out = new Set(all.filter((p) => !keep.has(p.id)).map((p) => p.id));
    for (const p of projects) if ((hideDone && p.done) || (project !== '' && p.id !== project)) out.add(p.id);
    return out;
  });
  const cycles = $derived(doc?.requires_cycles ?? []);

  // Zoom 50-150 %; below 70 % the boxes are small (symbol and title).
  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 1.5;
  let zoom = $state(1);
  const compact = $derived(zoom < 0.7);
  const baseMap = $derived(layoutPathMap({ paths: shown, projects, cycles, hidden, compact }));
  const map = $derived.by(() => {
    if (chainOnly === null || !baseMap.boxes.some((b) => b.key === chainOnly)) return baseMap;
    const chain = chainOf(baseMap, chainOnly);
    const out = new Set(hidden);
    for (const p of shown) if (!chain.has(`p:${p.id}`)) out.add(p.id);
    for (const p of projects) if (!chain.has(`j:${p.id}`)) out.add(p.id);
    for (const b of baseMap.boxes) if (b.kind === 'ghost' && !chain.has(b.key)) out.add(b.id);
    return layoutPathMap({ paths: shown.filter((p) => chain.has(`p:${p.id}`)), projects, cycles, hidden: out, compact });
  });
  const boxAt = $derived(new Map(map.boxes.map((b) => [b.key, b] as const)));
  const dependents = $derived(dependentsOf(all, projects));
  const anyRequires = $derived(all.some((p) => (p.requires ?? []).length > 0) || projects.some((p) => (p.requires ?? []).length > 0));

  // Map or list: chosen and kept; not chosen, a narrow window (under ~600 px) starts with the list.
  let width = $state(0);
  const mode = $derived(app.pathMapMode ?? (width > 0 && width < 600 ? 'list' : 'map'));

  // The chain shown strong: the box held (Space), else the one under the pointer, else the one with the focus.
  let hover = $state<string | null>(null);
  let held = $state<string | null>(null);
  let focusKey = $state<string | null>(null);
  // The box the search found.
  let found = $state<string | null>(null);
  const active = $derived([held, found, hover, focusKey].find((k) => k !== null && boxAt.has(k)) ?? null);
  const chain = $derived(active !== null ? chainOf(map, active) : null);
  const dim = (key: string) => chain !== null && !chain.has(key);
  const dimEdge = (e: MapEdge) => chain !== null && !(chain.has(e.from) && chain.has(e.to));

  // One stop of the Tab key: the box last focused, else the first in reading order.
  let lastFocused = $state<string | null>(null);
  const tabStop = $derived(lastFocused !== null && boxAt.has(lastFocused) ? lastFocused : (readingOrder(map)[0]?.key ?? null));
  const elements = new Map<string, HTMLElement>();
  function register(node: HTMLElement, key: string) {
    elements.set(key, node);
    return {
      update(next: string) {
        elements.delete(key);
        key = next;
        elements.set(key, node);
      },
      destroy() {
        if (elements.get(key) === node) elements.delete(key);
      },
    };
  }
  async function focusBox(key: string | null): Promise<void> {
    if (key === null) return;
    lastFocused = key;
    await tick();
    const el = elements.get(key);
    el?.focus();
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // Alt with the left or right key goes round the boxes the plain key chose among.
  let round: { side: 'left' | 'right'; list: string[]; at: number } | null = null;

  function open(box: MapBox, apart: boolean): void {
    if (box.kind !== 'path') return;
    if (apart && app.canDetach) app.openPathApart(box.id);
    else app.openPath(box.id);
  }

  function onBoxKey(e: KeyboardEvent, box: MapBox): void {
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    const handled = (): void => e.preventDefault();
    switch (e.key) {
      case 'Enter':
        handled();
        open(box, e.ctrlKey || e.metaKey);
        return;
      case ' ':
        handled();
        held = held === box.key ? null : box.key;
        return;
      case 'Escape':
        if (held === null && chainOnly === null && found === null) return;
        handled();
        held = null;
        found = null;
        if (chainOnly !== null) {
          chainOnly = null;
          void focusBox(box.key);
        }
        return;
      case 'f':
        if (!plain) return;
        handled();
        chainOnly = chainOnly === box.key ? null : box.key;
        void focusBox(box.key);
        return;
      case 'ArrowLeft':
      case 'ArrowRight': {
        if (e.ctrlKey || e.metaKey) return;
        handled();
        const side = e.key === 'ArrowLeft' ? 'left' : 'right';
        if (e.altKey && round !== null && round.side === side && round.list[round.at] === box.key && round.list.length > 1) {
          round.at = (round.at + 1) % round.list.length;
          void focusBox(round.list[round.at]!);
          return;
        }
        // Alt from a box the keys did not come to by a side step: the siblings of this one (what its neighbour links to).
        const list = linkedBoxes(map, box.key, side);
        if (list.length === 0) return;
        round = { side, list, at: 0 };
        void focusBox(list[0]!);
        return;
      }
      case 'ArrowUp':
      case 'ArrowDown':
        if (!plain) return;
        handled();
        void focusBox(besideBox(map, box.key, e.key === 'ArrowUp' ? 'up' : 'down'));
        return;
      case 'Home':
      case 'End': {
        if (!plain) return;
        handled();
        const order = readingOrder(map);
        void focusBox((e.key === 'Home' ? order[0] : order.at(-1))?.key ?? null);
        return;
      }
      case '/':
        handled();
        searchBox?.focus();
        return;
      case '+':
      case '=':
        handled();
        zoomTo(zoom + 0.1);
        return;
      case '-':
        handled();
        zoomTo(zoom - 0.1);
        return;
      case '0':
        if (!plain) return;
        handled();
        zoomTo(1);
        return;
    }
  }

  // Zoom, keeping the point under the pointer (or the middle) where it is.
  let scroller: HTMLDivElement | undefined = $state();
  function zoomTo(next: number, at?: { x: number; y: number }): void {
    const z = Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)) * 100) / 100;
    if (z === zoom) return;
    const el = scroller;
    const point = at ?? (el ? { x: el.clientWidth / 2, y: el.clientHeight / 2 } : { x: 0, y: 0 });
    const mx = el ? (el.scrollLeft + point.x) / zoom : 0;
    const my = el ? (el.scrollTop + point.y) / zoom : 0;
    zoom = z;
    void tick().then(() => {
      if (!el) return;
      el.scrollLeft = mx * z - point.x;
      el.scrollTop = my * z - point.y;
    });
  }
  // Fit the width of the map into the window (at least 50 %, at most 100 %).
  function fit(): void {
    const el = scroller;
    if (!el) return;
    const full = layoutPathMap({ paths: map === baseMap ? shown : shown.filter((p) => map.boxes.some((b) => b.id === p.id)), projects, cycles, hidden }).width;
    if (full <= 0) return;
    zoomTo(Math.min(1, el.clientWidth / full));
  }
  // A large map (25 boxes and more) starts fitted, once.
  let fitted = false;
  $effect(() => {
    if (fitted || mode !== 'map' || !scroller || baseMap.boxes.length === 0) return;
    fitted = true;
    if (baseMap.boxes.length >= 25) untrack(fit);
  });
  // Ctrl with the wheel zooms around the pointer (the page's own zoom stays); a listener that may prevent it.
  $effect(() => {
    const el = scroller;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomTo(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), { x: e.clientX - rect.left, y: e.clientY - rect.top });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });
  // Dragging the free space moves the map.
  let drag: { x: number; y: number; left: number; top: number; id: number } | null = null;
  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 || e.pointerType === 'touch' || !scroller) return;
    if ((e.target as Element).closest('button, a, input, select')) return;
    drag = { x: e.clientX, y: e.clientY, left: scroller.scrollLeft, top: scroller.scrollTop, id: e.pointerId };
    scroller.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.id || !scroller) return;
    scroller.scrollLeft = drag.left - (e.clientX - drag.x);
    scroller.scrollTop = drag.top - (e.clientY - drag.y);
  }
  function onPointerUp(e: PointerEvent): void {
    if (drag && e.pointerId === drag.id) drag = null;
  }

  // The search: the first box whose title holds the text is shown with its chain; Enter goes to it.
  let search = $state('');
  let searchBox: HTMLInputElement | undefined = $state();
  const match = $derived.by(() => {
    const text = search.trim().toLocaleLowerCase();
    if (text === '') return null;
    return readingOrder(map).find((b) => b.title.toLocaleLowerCase().includes(text))?.key ?? null;
  });
  $effect(() => {
    const key = match;
    found = key;
    if (key !== null) untrack(() => elements.get(key)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  });
  function onSearchKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && match !== null) {
      e.preventDefault();
      void focusBox(match);
    } else if (e.key === 'Escape' && search !== '') {
      e.preventDefault();
      search = '';
    }
  }

  // Words.
  const STAGE_SYMBOL: Record<PathStage, string> = { done: '✓', doing: '◐', waiting: '', idle: '○', parked: '‖' };
  function stageWord(entry: PathEntry): string {
    const stage = stageOf(entry);
    if (stage === 'waiting') {
      const on = (entry.waiting_on ?? []).map((w) => markHidden(titleOf(w.id)));
      return on.length > 0 ? t('pathmap.stage.waiting_on', { title: [...new Set(on)].join(', ') }) : t('pathmap.stage.waiting');
    }
    return t(`pathmap.stage.${stage}`);
  }
  const progressWord = (entry: PathEntry) => t('pathmap.progress', { learned: entry.progress.learned, total: entry.progress.total });
  function needsWords(entry: PathEntry): string[] {
    return (entry.requires ?? []).map((r) =>
      t('pathmap.req_item', {
        title: markHidden(titleOf(r.id)),
        gate: t(r.gate === 'hard' ? 'pathmap.hard' : 'pathmap.soft'),
        state: t(r.met ? 'pathmap.met' : 'pathmap.open'),
      }),
    );
  }
  function forWords(id: string): string[] {
    return (dependents.get(id) ?? []).map((d) => t('pathmap.for_item', { title: markHidden(titleOf(d.id)), gate: t(d.gate === 'hard' ? 'pathmap.hard' : 'pathmap.soft') }));
  }
  function boxName(box: MapBox): string {
    if (box.kind === 'ghost') return `${box.id}, ${t(box.ghost === 'unknown' ? 'pathmap.ghost.unknown' : 'pathmap.ghost.missing')}`;
    const entry = box.entry!;
    const parts = [markHidden(entry.title), stageWord(entry), progressWord(entry)];
    if (softOpen(entry)) parts.push(t('pathmap.soft_open'));
    const needs = needsWords(entry);
    const fors = forWords(entry.id);
    let name = parts.join(', ');
    if (needs.length > 0) name += `; ${t('pathmap.needs', { list: needs.join(', ') })}`;
    if (fors.length > 0) name += `; ${t('pathmap.for', { list: fors.join(', ') })}`;
    return name;
  }
  const levelWord = (entry: PathEntry): string | null =>
    game && entry.xp && entry.level && entry.level.level > 0
      ? `${t('paths.level', { n: entry.level.level })}${entry.level.name ? ` · ${markHidden(entry.level.name)}` : ''}`
      : null;
  const share = (entry: PathEntry) => (entry.progress.total > 0 ? Math.round((entry.progress.learned / entry.progress.total) * 100) : 0);
  const edgeColor = (e: MapEdge) => (e.bad ? 'bad' : e.met ? 'muted' : 'warn');

  // The list: one table per project (by title), the paths without one, the circle last.
  const groups = $derived.by(() => {
    const circled = new Set(baseMap.boxes.filter((b) => b.cycle).map((b) => b.id));
    const out: { key: string; title: string; rows: PathEntry[] }[] = [];
    const byProject = new Map<string, PathEntry[]>();
    const loose: PathEntry[] = [];
    const circle: PathEntry[] = [];
    for (const p of shown.toSorted((a, b) => a.title.localeCompare(b.title))) {
      if (circled.has(p.id)) circle.push(p);
      else if (p.project && projects.some((j) => j.id === p.project)) byProject.set(p.project, [...(byProject.get(p.project) ?? []), p]);
      else loose.push(p);
    }
    for (const [id, rows] of [...byProject].toSorted((a, b) => titleOf(a[0]).localeCompare(titleOf(b[0])))) out.push({ key: id, title: titleOf(id), rows });
    if (loose.length > 0) out.push({ key: '', title: t('pathmap.no_project'), rows: loose });
    if (circle.length > 0) out.push({ key: 'cycle', title: t('pathmap.cycle_group'), rows: circle });
    return out;
  });
</script>

{#snippet stageMark(stage: PathStage)}
  {#if stage === 'waiting'}
    <svg class="lock" viewBox="0 0 12 14" width="11" height="13" aria-hidden="true"
      ><path d="M3 6V4a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6" /><rect x="1" y="6" width="10" height="7" rx="1.5" fill="currentColor" /></svg
    >
  {:else}<span aria-hidden="true">{STAGE_SYMBOL[stage]}</span>{/if}
{/snippet}

<section class="pathmap" aria-label={t('nav.pathmap')} bind:clientWidth={width}>
  <header class="intro">
    <div class="head">
      <h2>{t('nav.pathmap')}</h2>
      <Info hint={t('pathmap.intro')} label={t('hint.about', { what: t('nav.pathmap') })} />
    </div>
  </header>

  {#if !usable}
    <p class="none">{t('paths.no_engine')}</p>
  {:else if problem && doc === null}
    <p class="none" role="alert">{t('pathmap.failed')} <button type="button" onclick={() => void read()}>{t('paths.retry')}</button></p>
  {:else if doc === null}
    <p class="none" role="status">{t('pathmap.reading')}</p>
  {:else if all.length === 0}
    <div class="empty">
      <p>{t('pathmap.none')}</p>
      <p class="none">{t('pathmap.none_how')}</p>
      <button type="button" onclick={() => app.setView('paths')}>{t('pathmap.open_paths')}</button>
    </div>
  {:else}
    <div class="bar">
      <fieldset class="mode">
        <legend class="sr">{t('pathmap.mode')}</legend>
        <label data-hint={t('hint.form.pathmap.mode')}><input type="radio" name="pathmap-mode" value="map" checked={mode === 'map'} onchange={() => app.setPathMapMode('map')} />{t('pathmap.mode.map')}</label>
        <label data-hint={t('hint.form.pathmap.mode')}><input type="radio" name="pathmap-mode" value="list" checked={mode === 'list'} onchange={() => app.setPathMapMode('list')} />{t('pathmap.mode.list')}</label>
      </fieldset>
      {#if projectChoices.length > 0}
        <label class="field" data-hint={t('hint.form.pathmap.project')}
          >{t('pathmap.project')}
          <select bind:value={project} data-pathmap-project>
            <option value="">{t('pathmap.project.all')}</option>
            {#each projectChoices as p (p.id)}<option value={p.id}>{markHidden(p.title)}</option>{/each}
          </select></label
        >
      {/if}
      <label class="check" data-hint={t('hint.form.pathmap.hide_done')}
        ><input type="checkbox" checked={hideDone} onchange={(e) => app.setPathMapHideDone(e.currentTarget.checked)} data-pathmap-hide-done />{t(
          'pathmap.hide_done',
        )}</label
      >
      <label class="field" data-hint={t('hint.form.pathmap.search')}
        ><span class="sr">{t('pathmap.search')}</span><input
          type="search"
          bind:this={searchBox}
          bind:value={search}
          placeholder={t('pathmap.search_placeholder')}
          onkeydown={onSearchKey}
          data-pathmap-search
        /></label
      >
      {#if mode === 'map'}
        <span class="zoom" role="group" aria-label={t('pathmap.zoom', { n: Math.round(zoom * 100) })}>
          <button type="button" aria-label={t('pathmap.zoom_out')} disabled={zoom <= MIN_ZOOM} onclick={() => zoomTo(zoom - 0.1)}>−</button>
          <output aria-live="polite">{Math.round(zoom * 100)} %</output>
          <button type="button" aria-label={t('pathmap.zoom_in')} disabled={zoom >= MAX_ZOOM} onclick={() => zoomTo(zoom + 0.1)}>+</button>
          <button type="button" onclick={fit}>{t('pathmap.fit')}</button>
        </span>
      {/if}
    </div>
    {#if search.trim() !== '' && match === null}<p class="none" role="status">{t('pathmap.no_match', { text: search.trim() })}</p>{/if}
    {#if !withRequires}
      <p class="note" role="note">{t('pathmap.old_engine')}</p>
    {:else if !anyRequires}
      <p class="note" role="note">{t('pathmap.no_requires')}</p>
    {/if}
    {#if chainOnly !== null && boxAt.has(chainOnly)}
      <p class="note">
        {t('pathmap.chain_only', { title: markHidden(boxAt.get(chainOnly)!.title) })}
        <button type="button" onclick={() => (chainOnly = null)}>{t('pathmap.chain_all')}</button>
      </p>
    {/if}

    {#if shown.length === 0 && hideDone && all.every((p) => stageOf(p) === 'done')}
      <div class="empty">
        <p>{t('pathmap.all_done')}</p>
        <button type="button" onclick={() => app.setPathMapHideDone(false)}>{t('pathmap.show_done')}</button>
      </div>
    {:else if mode === 'map'}
      <ul class="legend" aria-label={t('pathmap.legend')}>
        {#each ['done', 'doing', 'waiting', 'idle', 'parked'] as const as stage (stage)}
          <li class="stage {stage}">{@render stageMark(stage)} {t(`pathmap.stage.${stage}`)}</li>
        {/each}
        {#each [['hard', 'muted', 'pathmap.legend.hard_met'], ['hard', 'warn', 'pathmap.legend.hard_open'], ['soft', 'muted', 'pathmap.legend.soft_met'], ['soft', 'warn', 'pathmap.legend.soft_open'], ['hard', 'bad', 'pathmap.legend.bad']] as const as [gate, color, word] (word)}
          <li>
            <svg width="34" height="10" viewBox="0 0 34 10" aria-hidden="true"
              ><line x1="1" y1="5" x2="26" y2="5" class="edge {gate} {color}" />{#if gate === 'hard'}<path d="M24 1 L32 5 L24 9 z" class="head {color}" />{:else}<path
                  d="M25 1 L32 5 L25 9"
                  class="tip {color}"
                />{/if}</svg
            >
            {t(word)}
          </li>
        {/each}
      </ul>
      <p class="sr">{t('pathmap.keys')}</p>
      <div
        class="scroller"
        bind:this={scroller}
        role="group"
        aria-label={t('pathmap.map', { n: map.boxes.filter((b) => b.kind === 'path').length })}
        onpointerdown={onPointerDown}
        onpointermove={onPointerMove}
        onpointerup={onPointerUp}
        onpointercancel={onPointerUp}
        data-pathmap
      >
        <div class="canvas" style:width="{map.width * zoom}px" style:height="{map.height * zoom}px">
          <div class="plane" class:compact style:width="{map.width}px" style:height="{map.height}px" style:transform="scale({zoom})">
            {#each map.columnX as x, i (i)}
              <span class="column" aria-hidden="true" style:left="{x}px" style:top="{HEAD - 24}px" style:width="{map.boxW}px">{t('pathmap.column', { n: i + 1 })}</span>
            {/each}
            {#if map.cycleArea}
              {@const area = map.cycleArea}
              <div class="cycle" style:left="{area.x}px" style:top="{area.y}px" style:width="{area.w}px" style:height="{area.h}px" data-pathmap-cycle>
                {#each area.cycles as circle, i (i)}
                  <p>⟳ {t('pathmap.cycle', { chain: circle.map((id) => markHidden(titleOf(id))).join(' → ') })}</p>
                {/each}
                <p class="fix">{t('pathmap.cycle_fix')}</p>
              </div>
            {/if}
            {#each map.frames as frame (frame.key)}
              <div
                class="frame"
                class:done={frame.project.done}
                class:dim={dim(frame.key)}
                style:left="{frame.x}px"
                style:top="{frame.y}px"
                style:width="{frame.w}px"
                style:height="{frame.h}px"
                data-frame={frame.id}
              >
                {#if openProjects.has(frame.id)}
                  <button type="button" class="frame-title" onclick={() => app.openProject(frame.id)}>{markHidden(frame.title)}</button>
                {:else}
                  <span class="frame-title">{markHidden(frame.title)}{frame.project.done ? ` ✓` : ''}</span>
                {/if}
                {#if frame.members.length === 0}<span class="frame-empty">{t('pathmap.project_empty')}</span>{/if}
              </div>
            {/each}
            <svg class="edges" width={map.width} height={map.height} aria-hidden="true">
              <defs>
                {#each ['muted', 'warn', 'bad'] as color (color)}
                  <marker id="pathmap-hard-{color}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"
                    ><path d="M0 0 L10 5 L0 10 z" class="head {color}" /></marker
                  >
                  <marker id="pathmap-soft-{color}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"
                    ><path d="M1 1 L9 5 L1 9" class="tip {color}" /></marker
                  >
                {/each}
              </defs>
              {#each map.edges as edge (edge.key)}
                <path
                  d={edge.d}
                  class="edge {edge.gate} {edgeColor(edge)}"
                  class:dim={dimEdge(edge)}
                  marker-end="url(#pathmap-{edge.gate}-{edgeColor(edge)})"
                  data-edge={edge.key}
                />
              {/each}
            </svg>
            {#each map.boxes as box (box.key)}
              {@const entry = box.entry}
              {@const stage = entry ? stageOf(entry) : null}
              <button
                type="button"
                class="box {box.kind === 'ghost' ? 'ghost' : stage}"
                class:dim={dim(box.key)}
                class:found={found === box.key}
                style:left="{box.x}px"
                style:top="{box.y}px"
                style:width="{box.w}px"
                style:height="{box.h}px"
                tabindex={tabStop === box.key ? 0 : -1}
                aria-label={boxName(box)}
                aria-pressed={held === box.key ? 'true' : undefined}
                title={entry ? markHidden(entry.title) : box.id}
                data-box={box.id}
                data-stage={stage ?? 'ghost'}
                use:register={box.key}
                onclick={(e) => box.kind === 'path' && open(box, e.ctrlKey || e.metaKey)}
                onauxclick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    open(box, true);
                  }
                }}
                onmousedown={(e) => e.button === 1 && e.preventDefault()}
                onkeydown={(e) => onBoxKey(e, box)}
                onkeyup={(e) => e.key === ' ' && e.preventDefault()}
                onfocus={() => {
                  focusKey = box.key;
                  lastFocused = box.key;
                }}
                onblur={() => focusKey === box.key && (focusKey = null)}
                onpointerenter={() => (hover = box.key)}
                onpointerleave={() => hover === box.key && (hover = null)}
              >
                {#if box.kind === 'ghost'}
                  <span class="line1"><span class="sym" aria-hidden="true">?</span><span class="title">{box.id}</span></span>
                  {#if !compact}<span class="line2">{t(box.ghost === 'unknown' ? 'pathmap.ghost.unknown' : 'pathmap.ghost.missing')}</span>{/if}
                {:else if entry && stage}
                  <span class="line1"
                    >{#if compact}<span class="sym">{@render stageMark(stage)}</span>{:else}<ItemIcon
                        {app}
                        shown={shownIcon({ kind: 'path', id: entry.id, icon: entry.icon })}
                      />{/if}<span class="title">{markHidden(entry.title)}</span></span
                  >
                  {#if !compact}
                    <span class="line2"
                      ><span class="word">{@render stageMark(stage)} {stageWord(entry)}</span>{#if levelWord(entry)}<span class="level">{levelWord(entry)}</span>{/if}</span
                    >
                    <span class="line3"
                      ><span class="bar-track"><span class="bar-fill" style:width="{share(entry)}%"></span></span><span class="figure"
                        >{entry.progress.learned}/{entry.progress.total}</span
                      ></span
                    >
                  {/if}
                  {#if softOpen(entry)}<span class="hint" aria-hidden="true">!</span>{/if}
                {/if}
              </button>
            {/each}
          </div>
        </div>
      </div>
    {:else}
      <div class="list" data-pathmap-list>
        {#each groups as group (group.key)}
          <table class:cycle={group.key === 'cycle'}>
            <caption>{markHidden(group.title)}</caption>
            <thead>
              <tr>
                <th scope="col">{t('pathmap.col.path')}</th>
                <th scope="col">{t('pathmap.col.stage')}</th>
                <th scope="col">{t('pathmap.col.progress')}</th>
                <th scope="col">{t('pathmap.col.needs')}</th>
                <th scope="col">{t('pathmap.col.for')}</th>
              </tr>
            </thead>
            <tbody>
              {#each group.rows as entry (entry.id)}
                {@const stage = stageOf(entry)}
                <tr data-row={entry.id}>
                  <th scope="row"
                    ><button type="button" class="link" onclick={(e) => (e.ctrlKey || e.metaKey) && app.canDetach ? app.openPathApart(entry.id) : app.openPath(entry.id)}
                      >{markHidden(entry.title)}</button
                    ></th
                  >
                  <td class="stage {stage}">{@render stageMark(stage)} {stageWord(entry)}{#if softOpen(entry)} <span class="hint-text">({t('pathmap.soft_open')})</span>{/if}</td>
                  <td>{progressWord(entry)}</td>
                  <td>{needsWords(entry).join('; ')}</td>
                  <td>{forWords(entry.id).join('; ')}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/each}
      </div>
    {/if}
  {/if}
</section>

<style>
  .pathmap {
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
  .column,
  .frame-empty,
  .hint-text {
    color: var(--muted);
  }
  .note,
  .none {
    margin: 0;
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
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
  }
  .mode {
    display: inline-flex;
    gap: 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.2rem 0.6rem;
    margin: 0;
  }
  .mode label,
  .check,
  .field {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  select,
  input[type='search'] {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.2rem 0.4rem;
    min-height: 2rem;
  }
  .zoom {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .zoom output {
    min-width: 3.5em;
    text-align: center;
  }
  button:not(.box):not(.frame-title):not(.link) {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.2rem 0.6rem;
    min-height: 2rem;
    cursor: pointer;
  }
  button:disabled {
    cursor: default;
    opacity: 0.6;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 1rem;
    list-style: none;
    padding: 0;
    margin: 0;
    font-size: 0.85rem;
  }
  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .stage.done {
    color: var(--ok);
  }
  .stage.doing {
    color: var(--accent);
  }
  .stage.waiting {
    color: var(--warn);
  }
  .stage.idle,
  .stage.parked {
    color: var(--muted);
  }
  .scroller {
    overflow: auto;
    max-height: 75vh;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
  }
  .canvas {
    position: relative;
  }
  .plane {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
  }
  .column {
    position: absolute;
    font-size: 0.8rem;
    text-align: center;
  }
  .cycle {
    position: absolute;
    border: 2px dashed var(--bad);
    border-radius: var(--radius);
    padding: 0.3rem 0.6rem;
    box-sizing: border-box;
  }
  .cycle p {
    margin: 0;
    color: var(--bad);
    font-weight: 600;
    line-height: 22px;
  }
  .cycle p.fix {
    color: var(--text);
    font-weight: normal;
  }
  .frame {
    position: absolute;
    box-sizing: border-box;
    border: 1.5px solid var(--secondary);
    border-radius: calc(var(--radius) * 2);
    background: color-mix(in srgb, var(--secondary) 6%, var(--surface));
  }
  .frame.done {
    border-color: var(--ok);
  }
  .frame-title {
    position: absolute;
    left: 10px;
    top: 4px;
    max-width: calc(100% - 20px);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-weight: 600;
  }
  button.frame-title {
    cursor: pointer;
    text-decoration: underline;
    text-decoration-color: var(--secondary);
  }
  .frame-empty {
    position: absolute;
    left: 10px;
    top: 30px;
    font-size: 0.8rem;
  }
  .edges {
    position: absolute;
    left: 0;
    top: 0;
    overflow: visible;
    pointer-events: none;
  }
  .edge {
    fill: none;
    stroke-width: 2.2;
  }
  .edge.soft {
    stroke-dasharray: 6 4;
  }
  .edge.muted {
    stroke: var(--muted);
  }
  .edge.warn {
    stroke: var(--warn);
  }
  .edge.bad {
    stroke: var(--bad);
  }
  .head.muted {
    fill: var(--muted);
  }
  .head.warn {
    fill: var(--warn);
  }
  .head.bad {
    fill: var(--bad);
  }
  .tip {
    fill: none;
    stroke-width: 1.8;
  }
  .tip.muted {
    stroke: var(--muted);
  }
  .tip.warn {
    stroke: var(--warn);
  }
  .tip.bad {
    stroke: var(--bad);
  }
  .box {
    --stage: var(--muted);
    position: absolute;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.25rem;
    padding: 0.3rem 0.5rem 0.3rem 0.7rem;
    text-align: start;
    font: inherit;
    font-size: 0.85rem;
    color: var(--text);
    background: var(--surface);
    border: 1.5px solid var(--stage);
    border-left: 5px solid var(--stage);
    border-radius: var(--radius);
    cursor: pointer;
  }
  .box.done {
    --stage: var(--ok);
  }
  .box.doing {
    --stage: var(--accent);
  }
  .box.waiting {
    --stage: var(--warn);
  }
  .box.idle {
    border-color: var(--line);
    border-left-color: var(--muted);
  }
  .box.parked {
    border: 1.5px dashed var(--line);
    border-left: 5px dashed var(--muted);
  }
  .box.ghost {
    --stage: var(--bad);
    border-style: dashed;
    cursor: default;
  }
  .box:focus-visible {
    outline: 2.5px solid var(--focus);
    outline-offset: 4px;
  }
  .box.found {
    box-shadow: 0 0 0 3px var(--mark);
  }
  .dim {
    opacity: 0.35;
  }
  @media (prefers-reduced-motion: no-preference) {
    .box,
    .frame,
    .edge {
      transition: opacity 0.15s;
    }
  }
  .line1,
  .line2,
  .line3 {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    min-width: 0;
  }
  .line1 .title {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .line2 {
    justify-content: space-between;
  }
  .word {
    color: var(--stage);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .box.idle .word,
  .box.parked .word {
    color: var(--muted);
  }
  .level {
    color: var(--muted);
    white-space: nowrap;
  }
  .sym {
    color: var(--stage);
  }
  .bar-track {
    flex: 1;
    height: 6px;
    border-radius: 3px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .bar-fill {
    display: block;
    height: 100%;
    background: var(--stage);
  }
  .box.idle .bar-fill,
  .box.parked .bar-fill {
    background: var(--muted);
  }
  .figure {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .hint {
    position: absolute;
    top: -9px;
    right: -9px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-weight: 700;
    font-size: 0.75rem;
    color: var(--surface);
    background: var(--warn);
  }
  .lock {
    vertical-align: -1px;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  table.cycle caption {
    color: var(--bad);
  }
  caption {
    text-align: start;
    font-weight: 600;
    padding-bottom: 0.3rem;
  }
  th,
  td {
    text-align: start;
    border-bottom: 1px solid var(--line);
    padding: 0.3rem 0.5rem;
    vertical-align: top;
  }
  thead th {
    color: var(--muted);
    font-weight: 600;
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--accent);
    text-decoration: underline;
    cursor: pointer;
    text-align: start;
  }
  @media (forced-colors: active) {
    .edge,
    .tip {
      stroke: CanvasText;
    }
    .head {
      fill: CanvasText;
    }
    .box,
    .frame,
    .cycle {
      border-color: CanvasText;
    }
    .bar-fill,
    .hint {
      background: CanvasText;
      color: Canvas;
    }
  }
</style>
