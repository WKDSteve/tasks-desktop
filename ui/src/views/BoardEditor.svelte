<script lang="ts">
  // The page's own whiteboard (concept 7.8, format `ink`), loaded on demand (`Lazy`): a pen with pressure, a marker, an
  // eraser (also the eraser end of a pen), six colours of the tokens, three widths, undo and redo, pages, a background
  // of rules or a picture, and a view that moves and zooms. Once a pen was seen a finger only moves the view (palm
  // rejection). Every change is saved after a moment through `board_save` (`app.saveBoard`): the board as
  // `<name>.ink.json` and its pages as an SVG preview, replaced only on the version this surface read or wrote last.
  // Another device that saved meanwhile is a conflict: this one goes on under the free name the engine names.
  import { onMount, untrack } from 'svelte';
  import type { App } from '../lib/app.svelte';
  import type { AssetOwner, BoardSaved } from '../lib/api';
  import {
    INK_COLORS,
    INK_WIDTHS,
    MARKER_OPACITY,
    MAX_POINTS,
    MAX_STROKES,
    PAGE_H,
    PAGE_W,
    boardName,
    previewSvg,
    drawsWith,
    emptyDoc,
    eraseAt,
    erasesWith,
    inkEtag,
    parseInk,
    pressureOf,
    recorded,
    redone,
    rulesPath,
    serializeInk,
    strokePath,
    undone,
    withPage,
    withPageAfter,
    type InkBackground,
    type InkColor,
    type InkDoc,
    type InkHistory,
    type InkPalette,
    type InkStroke,
    type InkWidth,
  } from '../lib/ink';
  import { inkText, type InkKey } from '../lib/inkTexts';
  import { percentText } from '../lib/numbers';

  let {
    app,
    owner,
    id,
    name: given,
    onsaved,
    onclose,
  }: {
    app: App;
    /** The kind of the container: where an existing board is read from. */
    owner: AssetOwner;
    id: string;
    /** An existing board to draw on; none: a new one. */
    name?: string | undefined;
    /** The first save of a new board (in the minutes it becomes a line). */
    onsaved?: (saved: BoardSaved & { name: string }) => void;
    onclose: () => void;
  } = $props();
  const t = (key: InkKey, params: Record<string, string | number> = {}) => inkText(app.lang, key, params);

  /** How long the surface waits after the last change before it saves, and after a save that reached no hub. */
  const SAVE_AFTER_MS = 2500;
  const RETRY_MS = 15_000;
  /** The radius of the eraser, in pixels of the screen. */
  const ERASER_PX = 10;
  /** The longest edge of a picture put behind (it lies in the board file and in its preview). */
  const IMAGE_EDGE = 1600;

  let dialog: HTMLDialogElement | undefined = $state();
  let surface: SVGSVGElement | undefined = $state();
  let probe: HTMLSpanElement | undefined = $state();
  let imagePicker: HTMLInputElement | undefined = $state();
  let boxW = $state(0);
  let boxH = $state(0);

  let name = $state(untrack(() => given ?? boardName(app.nowMs())));
  let doc = $state.raw<InkDoc>(emptyDoc());
  let history = $state.raw<InkHistory>({ past: [], future: [] });
  let at = $state(0);
  let tool = $state<'pen' | 'marker' | 'eraser'>('pen');
  let color = $state<InkColor>('text');
  let width = $state<InkWidth>(INK_WIDTHS[1]);
  /** The view: the point of the page at the top left, and how many pixels a unit of the page is. */
  let view = $state({ x: 0, y: 0, scale: 0 });
  let live = $state.raw<InkStroke | null>(null);
  let status = $state<'loading' | 'idle' | 'unsaved' | 'saving' | 'saved' | 'failed'>(untrack(() => (given ? 'loading' : 'idle')));
  let failure = $state('');
  let notice = $state('');

  /** The version of the board file this surface knows: what it read or wrote last. None: the board is not there yet. */
  let etag: string | undefined;
  let dirty = false;
  let saving: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let penSeen = false;
  let spaceDown = $state(false);

  /** The gesture under way: a stroke, the eraser (with the board before it), or a move of the view. */
  type Gesture =
    | { kind: 'draw'; pointer: number }
    | { kind: 'erase'; pointer: number; before: InkDoc }
    | { kind: 'pan'; pointer: number; x: number; y: number }
    | { kind: 'pinch'; distance: number; mid: { x: number; y: number } };
  let gesture: Gesture | null = null;
  /** The touches on the surface, for two fingers. */
  const touches = new Map<number, { x: number; y: number }>();

  const page = $derived(doc.pages[at] ?? doc.pages[0]);
  const scale = $derived(view.scale > 0 ? view.scale : 1);
  const viewBox = $derived(`${view.x} ${view.y} ${(boxW || PAGE_W) / scale} ${(boxH || PAGE_H) / scale}`);
  /** The outlines of the strokes, made once per stroke (a stroke never changes once it is drawn). */
  const outlines = new WeakMap<InkStroke, string>();
  function outline(s: InkStroke): string {
    let d = outlines.get(s);
    if (d === undefined) {
      d = strokePath(s);
      outlines.set(s, d);
    }
    return d;
  }

  onMount(() => {
    dialog?.showModal();
    if (given) void load(given);
    const wheel = (e: WheelEvent) => onWheel(e);
    surface?.addEventListener('wheel', wheel, { passive: false });
    return () => {
      surface?.removeEventListener('wheel', wheel);
      // Gone without being closed (the meeting or the detail went away): what is not saved yet is saved now.
      if (dirty) void save();
      else clearTimeout(timer);
    };
  });

  // The page fits the surface the first time the surface has a size.
  $effect(() => {
    if (boxW > 0 && boxH > 0 && untrack(() => view.scale) === 0) fit();
  });

  async function load(board: string): Promise<void> {
    const answer = await app.asset(owner, id, `assets/boards/${board}.ink.json`);
    const text = answer && answer !== 'same' ? await answer.blob.text() : null;
    const read = text === null ? null : parseInk(text);
    if (text !== null && read) {
      doc = read;
      etag = await inkEtag(text);
      status = 'saved';
    } else {
      // Unreadable or gone: a new board beside it, never over it.
      notice = t('unreadable');
      name = boardName(app.nowMs());
      status = 'idle';
    }
  }

  function fit(): void {
    const w = boxW || PAGE_W;
    const h = boxH || PAGE_H;
    const s = Math.min(w / PAGE_W, h / PAGE_H) * 0.95;
    view = { x: -(w / s - PAGE_W) / 2, y: -(h / s - PAGE_H) / 2, scale: s };
  }

  /** A point of the screen as a point of the page. */
  function pageAt(clientX: number, clientY: number): { x: number; y: number } {
    const rect = surface?.getBoundingClientRect();
    return { x: view.x + (clientX - (rect?.left ?? 0)) / scale, y: view.y + (clientY - (rect?.top ?? 0)) / scale };
  }

  function zoomAround(clientX: number, clientY: number, factor: number): void {
    const before = pageAt(clientX, clientY);
    const next = Math.min(8, Math.max(0.1, scale * factor));
    const rect = surface?.getBoundingClientRect();
    view = { x: before.x - (clientX - (rect?.left ?? 0)) / next, y: before.y - (clientY - (rect?.top ?? 0)) / next, scale: next };
  }

  function zoomBy(factor: number): void {
    const rect = surface?.getBoundingClientRect();
    zoomAround((rect?.left ?? 0) + (boxW || PAGE_W) / 2, (rect?.top ?? 0) + (boxH || PAGE_H) / 2, factor);
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoomAround(e.clientX, e.clientY, Math.exp(-e.deltaY / 300));
    else view = { ...view, x: view.x + e.deltaX / scale, y: view.y + e.deltaY / scale };
  }

  /** Make a change: the board before it goes into the history, and a save is due. */
  function change(next: InkDoc, before: InkDoc = doc): void {
    if (next === before) return;
    history = recorded(history, before);
    doc = next;
    due();
  }

  function due(): void {
    dirty = true;
    if (status !== 'saving') status = 'unsaved';
    clearTimeout(timer);
    timer = setTimeout(() => void save(), SAVE_AFTER_MS);
  }

  function addPoint(e: PointerEvent): void {
    if (!live || live.points.length >= MAX_POINTS * 3) return;
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const points = [...live.points];
    for (const ev of events.length > 0 ? events : [e]) {
      const p = pageAt(ev.clientX, ev.clientY);
      points.push(p.x, p.y, pressureOf(ev.pointerType, ev.pressure));
    }
    live = { ...live, points: points.slice(0, MAX_POINTS * 3) };
  }

  function eraseUnder(e: PointerEvent): void {
    if (!page) return;
    const p = pageAt(e.clientX, e.clientY);
    const next = eraseAt(page, p.x, p.y, ERASER_PX / scale);
    if (next !== page) doc = withPage(doc, at, next);
  }

  function pinchOf(): { distance: number; mid: { x: number; y: number } } | null {
    const [a, b] = [...touches.values()];
    if (!a || !b) return null;
    return { distance: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }

  function onDown(e: PointerEvent): void {
    if (status === 'loading') return;
    if (e.pointerType === 'pen') penSeen = true;
    if (e.pointerType === 'touch') touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // A second finger: whatever the first one began becomes a move and a zoom of the view.
    if (touches.size >= 2) {
      if (gesture?.kind === 'draw') live = null;
      const pinch = pinchOf();
      gesture = pinch ? { kind: 'pinch', ...pinch } : null;
      return;
    }
    if (gesture) return;
    // The rest of the gesture comes here even off the surface. A pointer the browser does not know (gone already, or
    // a synthetic one) cannot be captured; the gesture still goes on.
    try {
      surface?.setPointerCapture?.(e.pointerId);
    } catch {
      // not captured
    }
    if (spaceDown || e.button === 1 || !drawsWith(e.pointerType, penSeen)) {
      gesture = { kind: 'pan', pointer: e.pointerId, x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button !== 0 && e.button !== 5) return;
    if (tool === 'eraser' || erasesWith(e)) {
      gesture = { kind: 'erase', pointer: e.pointerId, before: doc };
      eraseUnder(e);
      return;
    }
    if ((page?.strokes.length ?? 0) >= MAX_STROKES) return;
    gesture = { kind: 'draw', pointer: e.pointerId };
    const p = pageAt(e.clientX, e.clientY);
    live = { tool: tool === 'marker' ? 'marker' : 'pen', color, width, points: [p.x, p.y, pressureOf(e.pointerType, e.pressure)] };
  }

  function onMove(e: PointerEvent): void {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gesture) return;
    if (gesture.kind === 'pinch') {
      const now = pinchOf();
      if (!now || gesture.distance === 0) return;
      zoomAround(now.mid.x, now.mid.y, now.distance / gesture.distance);
      view = { ...view, x: view.x - (now.mid.x - gesture.mid.x) / scale, y: view.y - (now.mid.y - gesture.mid.y) / scale };
      gesture = { kind: 'pinch', ...now };
      return;
    }
    if (gesture.pointer !== e.pointerId) return;
    if (gesture.kind === 'pan') {
      view = { ...view, x: view.x - (e.clientX - gesture.x) / scale, y: view.y - (e.clientY - gesture.y) / scale };
      gesture = { ...gesture, x: e.clientX, y: e.clientY };
    } else if (gesture.kind === 'erase') eraseUnder(e);
    else addPoint(e);
  }

  function onUp(e: PointerEvent): void {
    touches.delete(e.pointerId);
    if (!gesture) return;
    if (gesture.kind === 'pinch') {
      if (touches.size < 2) gesture = null;
      return;
    }
    if (gesture.pointer !== e.pointerId) return;
    const ended = gesture;
    gesture = null;
    if (ended.kind === 'erase') {
      if (doc !== ended.before) change(doc, ended.before);
    } else if (ended.kind === 'draw' && live && page) {
      const stroke = live;
      live = null;
      change(withPage(doc, at, { ...page, strokes: [...page.strokes, stroke] }));
    }
  }

  function undo(): void {
    const step = undone(history, doc);
    if (!step) return;
    doc = step.doc;
    history = step.history;
    at = Math.min(at, doc.pages.length - 1);
    due();
  }

  function redo(): void {
    const step = redone(history, doc);
    if (!step) return;
    doc = step.doc;
    history = step.history;
    at = Math.min(at, doc.pages.length - 1);
    due();
  }

  function addPage(): void {
    const next = withPageAfter(doc, at);
    if (next === doc) return;
    change(next);
    at += 1;
  }

  function setBackground(background: InkBackground): void {
    if (page && page.background !== background) change(withPage(doc, at, { ...page, background }));
  }

  /** A picture behind the strokes: made at most `IMAGE_EDGE` on its longer edge, fitted into the page. */
  async function putImage(): Promise<void> {
    const file = imagePicker?.files?.[0];
    if (imagePicker) imagePicker.value = '';
    if (!file || !page) return;
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) return;
    const shrink = Math.min(1, IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * shrink);
    canvas.height = Math.round(bitmap.height * shrink);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const href = canvas.toDataURL('image/jpeg', 0.85);
    const fitIn = Math.min(PAGE_W / canvas.width, PAGE_H / canvas.height);
    const w = canvas.width * fitIn;
    const h = canvas.height * fitIn;
    change(withPage(doc, at, { ...page, image: { href, x: (PAGE_W - w) / 2, y: (PAGE_H - h) / 2, w, h } }));
  }

  function dropImage(): void {
    if (!page?.image) return;
    const { image: _, ...rest } = page;
    change(withPage(doc, at, rest));
  }

  /** The colours of the preview: the tokens as the light scheme draws them (a file knows no tokens). */
  function palette(): InkPalette {
    const read = (token: string): string => {
      if (!probe) return '';
      probe.style.color = `var(--${token})`;
      return getComputedStyle(probe).color;
    };
    const colors = Object.fromEntries(INK_COLORS.map((c) => [c, read(c)])) as Record<InkColor, string>;
    return { colors, paper: read('surface'), rule: read('line') };
  }

  async function save(): Promise<void> {
    if (saving) {
      await saving;
      if (dirty) return save();
      return;
    }
    if (!dirty) return;
    clearTimeout(timer);
    saving = write();
    try {
      await saving;
    } finally {
      saving = null;
    }
  }

  async function write(): Promise<void> {
    // A conflict names a free name; the save goes there (at most a few times, then it is said).
    for (let tries = 0; tries < 3; tries++) {
      dirty = false;
      status = 'saving';
      const ink = serializeInk(doc);
      const result = await app.saveBoard({ id, name, ink, svg: previewSvg(doc, palette(), name), ...(etag ? { if_match: etag } : {}) });
      if (result?.ok) {
        const created = etag === undefined;
        etag = result.etag;
        status = dirty ? 'unsaved' : 'saved';
        if (created) onsaved?.({ ...result, name });
        if (dirty) due();
        return;
      }
      const suggestion = result?.error?.code === 'conflict' ? result.error.details?.suggestion : undefined;
      if (suggestion) {
        name = suggestion;
        etag = undefined;
        notice = t('renamed', { name: suggestion });
        continue;
      }
      // Not saved: kept, and tried again after a while (or with the next stroke).
      dirty = true;
      status = 'failed';
      failure = result?.error?.code ?? 'offline';
      clearTimeout(timer);
      timer = setTimeout(() => void save(), RETRY_MS);
      return;
    }
    dirty = true;
    status = 'failed';
    failure = 'conflict';
  }

  /** Closing once more after a save that failed: what is not saved is given up. */
  let giveUp = false;

  async function close(): Promise<void> {
    await save();
    if (dirty && status === 'failed' && !giveUp) {
      giveUp = true;
      notice = t('closeAgain');
      return;
    }
    clearTimeout(timer);
    dirty = false;
    dialog?.close();
    onclose();
  }

  function onKey(e: KeyboardEvent): void {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
    if ((e.ctrlKey || e.metaKey) && !typing) {
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
      return;
    }
    if (e.key !== ' ') return;
    // Moving the view starts only on the surface; it ends wherever the key is let go (the focus may have moved).
    if (e.type === 'keyup') spaceDown = false;
    else if (!typing && e.target === surface) spaceDown = true;
    if (e.target === surface) e.preventDefault();
  }

  const statusText = $derived(
    status === 'loading'
      ? t('loading')
      : status === 'saving'
        ? t('saving')
        : status === 'saved'
          ? t('saved')
          : status === 'failed'
            ? t('failed', { code: failure })
            : status === 'unsaved'
              ? t('unsaved')
              : '',
  );
</script>

<dialog
  bind:this={dialog}
  class="board"
  aria-labelledby="board-title"
  onkeydown={onKey}
  onkeyup={onKey}
  oncancel={(e) => {
    e.preventDefault();
    void close();
  }}
>
  <header>
    <h2 id="board-title">{t('title', { name })}</h2>
    <p class="status" role="status">{statusText}</p>
    <button type="button" onclick={() => void close()}>{t('close')}</button>
  </header>
  {#if notice}<p class="notice" role="alert">{notice}</p>{/if}
  <div class="tools" role="toolbar" aria-label={t('title', { name })}>
    <div class="group">
      {#each ['pen', 'marker', 'eraser'] as const as k (k)}
        <button type="button" aria-pressed={tool === k} onclick={() => (tool = k)}>{t(k)}</button>
      {/each}
    </div>
    <div class="group">
      {#each INK_COLORS as c, i (c)}
        <button type="button" class="swatch" aria-pressed={color === c} aria-label={t('color', { n: i + 1 })} title={t('color', { n: i + 1 })} onclick={() => (color = c)}
          ><span style:background={`var(--${c})`}></span></button
        >
      {/each}
    </div>
    <div class="group">
      {#each INK_WIDTHS as w, i (w)}
        <button type="button" class="width" aria-pressed={width === w} aria-label={t('width', { n: i + 1 })} title={t('width', { n: i + 1 })} onclick={() => (width = w)}
          ><span style:height={`${w / 2 + 1}px`}></span></button
        >
      {/each}
    </div>
    <div class="group">
      <button type="button" disabled={history.past.length === 0} onclick={undo}>{t('undo')}</button>
      <button type="button" disabled={history.future.length === 0} onclick={redo}>{t('redo')}</button>
    </div>
    <div class="group">
      <button type="button" disabled={at === 0} aria-label={t('prev')} title={t('prev')} onclick={() => (at -= 1)}>‹</button>
      <span class="page">{t('page', { n: at + 1, m: doc.pages.length })}</span>
      <button type="button" disabled={at >= doc.pages.length - 1} aria-label={t('next')} title={t('next')} onclick={() => (at += 1)}>›</button>
      <button type="button" onclick={addPage}>{t('add')}</button>
    </div>
    <div class="group">
      <label data-hint={t('help')}>
        <span>{t('background')}</span>
        <select value={page?.background ?? 'none'} onchange={(e) => setBackground(e.currentTarget.value as InkBackground)}>
          {#each ['none', 'grid', 'lines'] as const as b (b)}<option value={b}>{t(`bg.${b}`)}</option>{/each}
        </select>
      </label>
      <button type="button" onclick={() => imagePicker?.click()}>{t('image')}</button>
      {#if page?.image}<button type="button" onclick={dropImage}>{t('image.drop')}</button>{/if}
      <input bind:this={imagePicker} type="file" accept="image/*" hidden onchange={() => void putImage()} />
    </div>
    <div class="group">
      <button type="button" aria-label={t('zoomOut')} title={t('zoomOut')} onclick={() => zoomBy(1 / 1.25)}>−</button>
      <button type="button" class="zoom-fit" onclick={fit}>{percentText(app.lang, scale)}</button>
      <button type="button" aria-label={t('zoomIn')} title={t('zoomIn')} onclick={() => zoomBy(1.25)}>+</button>
    </div>
    <div class="group">
      <button type="button" disabled title={t('later')}>{t('excalidraw')}</button>
      <button type="button" disabled title={t('later')}>{t('external')}</button>
    </div>
  </div>
  <div class="area" bind:clientWidth={boxW} bind:clientHeight={boxH}>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <svg
      bind:this={surface}
      class:panning={spaceDown}
      class:erasing={tool === 'eraser'}
      role="img"
      aria-label={t('surface', { n: at + 1, m: doc.pages.length })}
      tabindex="0"
      {viewBox}
      onpointerdown={onDown}
      onpointermove={onMove}
      onpointerup={onUp}
      onpointercancel={onUp}
      onlostpointercapture={onUp}
      onblur={() => (spaceDown = false)}
    >
      {#if page}
        <rect class="paper" x="0" y="0" width={PAGE_W} height={PAGE_H} />
        {#if page.background !== 'none'}<path class="rules" d={rulesPath(page.background, 0)} />{/if}
        {#if page.image}<image href={page.image.href} x={page.image.x} y={page.image.y} width={page.image.w} height={page.image.h} />{/if}
        {#each page.strokes as s, i (i)}
          <path d={outline(s)} style:fill={`var(--${s.color})`} fill-opacity={s.tool === 'marker' ? MARKER_OPACITY : 1} />
        {/each}
        {#if live}
          <path d={strokePath(live)} style:fill={`var(--${live.color})`} fill-opacity={live.tool === 'marker' ? MARKER_OPACITY : 1} />
        {/if}
      {/if}
    </svg>
  </div>
  <p class="help">{t('help')}</p>
  <span class="probe" bind:this={probe} aria-hidden="true"></span>
</dialog>

<style>
  dialog.board {
    width: calc(100vw - 2rem);
    height: calc(100vh - 2rem);
    max-width: none;
    max-height: none;
    padding: 0.5rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  dialog.board:not([open]) {
    display: none;
  }
  dialog::backdrop {
    background: var(--backdrop);
  }
  header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  h2 {
    margin: 0;
    font-size: 1.05rem;
    flex: 1;
    overflow-wrap: anywhere;
  }
  .status,
  .help {
    margin: 0;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .notice {
    margin: 0;
    color: var(--warn);
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    align-items: center;
  }
  .group {
    display: flex;
    gap: 0.25rem;
    align-items: center;
  }
  label {
    display: flex;
    gap: 0.3rem;
    align-items: center;
    font-size: 0.85rem;
  }
  button,
  select {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.25rem 0.55rem;
    font: inherit;
    cursor: pointer;
  }
  button[aria-pressed='true'] {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .swatch span {
    display: block;
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
  }
  .width span {
    display: block;
    width: 1.2rem;
    background: var(--text);
    border-radius: 2px;
  }
  .zoom-fit,
  .page {
    font-variant-numeric: tabular-nums;
    font-size: 0.85rem;
    padding: 0 0.25rem;
  }
  .area {
    flex: 1;
    min-height: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--surface-2);
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
    cursor: crosshair;
  }
  svg.erasing {
    cursor: cell;
  }
  svg.panning {
    cursor: grab;
  }
  svg:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: -2px;
  }
  .paper {
    fill: var(--surface);
  }
  .rules {
    stroke: var(--line);
    stroke-width: 1;
    fill: none;
    vector-effect: non-scaling-stroke;
  }
  .probe {
    position: absolute;
    width: 0;
    height: 0;
    overflow: hidden;
    color-scheme: light;
  }
</style>
