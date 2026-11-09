<script lang="ts">
  // The plan as a graph: the stages of the engine as rows (the first at the top, the tasks of a cycle last), the tasks'
  // own blocked_by (a solid arrow) and after (a dashed one) between them, the critical path drawn thick. Read only: a
  // click opens a task as in the stages. The keys walk the tasks (left and right in a row, up and down to the next
  // row); the dependencies stand once more as a table under the picture, for a screen reader and for a quick read.
  // While the graph of one task is open (what it needs, or what waits for it: the engine's `planfor`, the panel above),
  // only its tasks are drawn; `n` and `u` on a task open that focus for it. An arrow is a control too (a click, or
  // Enter on it: a small menu; Delete takes it away), and so is each row of the table: one `set` at the waiting task.
  // A task dropped on another (the mouse, or a finger by its grip), or `l` and then the keys, makes the other wait
  // for it: hard, or soft with Alt. The arrow to come is drawn dashed while it is chosen; the engine refuses a cycle.
  import type { App } from '../lib/app.svelte';
  import { connectOp, criticalEdges, depGraphOf, focusStages, neighbourOf, orderRows, type DepEdge, type EdgeAction } from '../lib/depGraph';
  import { createGrip, farEnough, placeAt, type PointerDragEvent } from '../lib/pointerDrag';
  import { hintOf, labelOf, translate, type Key } from '../lib/i18n';
  import type { Stage } from '../lib/plan';
  import { markHidden } from '../lib/text';

  let {
    app,
    stages,
    critical,
    path,
    cycles,
    onopen,
  }: {
    app: App;
    stages: readonly Stage[];
    critical: ReadonlySet<string>;
    path: readonly string[];
    cycles: readonly string[][];
    onopen: (id: string) => void;
  } = $props();

  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  // The focus, once the engine's answer for the task and the way asked is there (until then the whole plan stays).
  const focus = $derived.by(() => {
    const open = app.graph;
    const doc = app.graphDoc;
    if (!open || !doc || doc.id !== open.id || doc.direction !== open.direction) return null;
    return { id: open.id, direction: open.direction, ids: new Set([open.id, ...doc.nodes.map((n) => n.id)]) };
  });
  const shown = $derived(focusStages(stages, focus?.ids ?? null));
  const graph = $derived(depGraphOf(shown));
  const rows = $derived(orderRows(graph.rows, graph.edges));
  const tasks = $derived(new Map(stages.flatMap((s) => s.tasks).map((task) => [task.id, task] as const)));
  // The tasks of the focus this plan (or the filter) does not hold: named as a number, not drawn.
  const outside = $derived(focus ? [...focus.ids].filter((id) => !tasks.has(id)).length : 0);
  const onPath = $derived(criticalEdges(path));

  // A row draws its first tasks; the rest on a press (a stage of hundreds is not one block of work, as in the stages).
  const FIRST = 50;
  let opened = $state<ReadonlySet<string>>(new Set());
  const rowKey = (stage: number | null): string => (stage === null ? 'cycle' : String(stage));
  const drawnRows = $derived(rows.map((r) => ({ ...r, ids: opened.has(rowKey(r.stage)) ? r.ids : r.ids.slice(0, FIRST) })));
  const drawnIds = $derived(new Set(drawnRows.flatMap((r) => r.ids)));

  // The one task the Tab key lands on (the others are reached with the arrow keys): the selected one, else the first.
  let focused = $state<string | null>(null);
  const tabStop = $derived(
    focused !== null && drawnIds.has(focused)
      ? focused
      : app.selectedId !== null && drawnIds.has(app.selectedId)
        ? app.selectedId
        : (drawnRows.find((r) => r.ids.length > 0)?.ids[0] ?? null),
  );

  let canvas: HTMLDivElement | undefined = $state();
  let size = $state({ w: 0, h: 0 });
  let lines = $state<{ edge: DepEdge; d: string; critical: boolean }[]>([]);

  /** The path of one arrow between two boxes (in the canvas's frame): down from the bottom to the top, else a bow. */
  function arrow(a: DOMRect, b: DOMRect, base: { left: number; top: number }): string {
    const ax = a.left + a.width / 2 - base.left;
    const bx = b.left + b.width / 2 - base.left;
    if (b.top >= a.bottom) {
      const y1 = a.bottom - base.top;
      const y2 = b.top - base.top;
      const dy = Math.max(12, (y2 - y1) / 2);
      return `M ${ax} ${y1} C ${ax} ${y1 + dy}, ${bx} ${y2 - dy}, ${bx} ${y2}`;
    }
    if (a.top >= b.bottom) {
      // Up (an `after` can point to an earlier row): from the top of the one to the bottom of the other.
      const y1 = a.top - base.top;
      const y2 = b.bottom - base.top;
      const dy = Math.max(12, (y1 - y2) / 2);
      return `M ${ax} ${y1} C ${ax} ${y1 - dy}, ${bx} ${y2 + dy}, ${bx} ${y2}`;
    }
    // In the same row: a bow above it, from the side of the one to the side of the other.
    const right = b.left >= a.right;
    const x1 = (right ? a.right : a.left) - base.left;
    const x2 = (right ? b.left : b.right) - base.left;
    const y = a.top - base.top + a.height / 3;
    return `M ${x1} ${y} C ${x1 + (right ? 24 : -24)} ${y - 36}, ${x2 + (right ? -24 : 24)} ${y - 36}, ${x2} ${y}`;
  }

  /** Measure the boxes as they are drawn and lay the arrows between them. */
  function layArrows(): void {
    if (!canvas) return;
    const frame = canvas.getBoundingClientRect();
    const base = { left: frame.left - canvas.scrollLeft, top: frame.top - canvas.scrollTop };
    const boxes = new Map<string, DOMRect>();
    for (const el of canvas.querySelectorAll<HTMLElement>('[data-node]')) boxes.set(el.dataset['node']!, el.getBoundingClientRect());
    lines = graph.edges.flatMap((edge) => {
      const a = boxes.get(edge.from);
      const b = boxes.get(edge.to);
      return a && b ? [{ edge, d: arrow(a, b, base), critical: edge.kind === 'blocked_by' && onPath.has(`${edge.from}>${edge.to}`) }] : [];
    });
    size = { w: canvas.scrollWidth, h: canvas.scrollHeight };
  }

  // After each drawing of the rows, and when the canvas changes its size (a wider window lets a row wrap less).
  $effect(() => {
    void drawnRows;
    void graph;
    layArrows();
  });
  $effect(() => {
    if (!canvas) return;
    const watch = new ResizeObserver(() => layArrows());
    watch.observe(canvas);
    return () => watch.disconnect();
  });

  function onNodeKey(e: KeyboardEvent, id: string): void {
    if (linking?.by === 'keys') {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        linking = null;
        return;
      }
      if (e.key === 'Enter') {
        // Not the click of the button: Enter sets the arrow (or does nothing on a task it cannot be set to).
        e.preventDefault();
        if (linking.to !== null) void connect(e.altKey);
        return;
      }
    } else if (e.key === 'l' && !e.ctrlKey && !e.metaKey && !e.altKey && !app.locked) {
      e.preventDefault();
      e.stopPropagation();
      linking = { from: id, to: null, soft: false, by: 'keys' };
      return;
    }
    if ((e.key === 'n' || e.key === 'u') && !e.ctrlKey && !e.metaKey && !e.altKey && app.can('plan_for')) {
      e.preventDefault();
      e.stopPropagation();
      focused = id;
      app.openGraph(id, e.key === 'n' ? 'needs' : 'unlocks');
      // The focus stays on the task (it is drawn in its own focus): the panel above does not take it.
      app.graphWantsFocus = false;
      return;
    }
    const keys: Record<string, 'left' | 'right' | 'up' | 'down'> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    const dir = keys[e.key];
    if (dir === undefined) return;
    e.preventDefault();
    const next = neighbourOf(drawnRows, id, dir);
    if (next === null) return;
    focused = next;
    canvas?.querySelector<HTMLElement>(`[data-node="${CSS.escape(next)}"]`)?.focus();
  }

  // -- joining two tasks --

  /** A join on its way: from which task, to which (once one is chosen that it can be set to), and by what. */
  let linking = $state<{ from: string; to: string | null; soft: boolean; by: 'keys' | 'drag' | 'finger' } | null>(null);
  let preview = $state<string | null>(null);

  /** Whether `to` can be made to wait for the task being joined (not itself, not joined to it already). */
  function canTake(to: string): boolean {
    const task = tasks.get(to);
    return linking !== null && task !== undefined && connectOp(task, linking.from, 'blocked_by') !== null;
  }

  function choose(to: string | null, soft = linking?.soft ?? false): void {
    if (!linking) return;
    linking = { ...linking, to: to !== null && canTake(to) ? to : null, soft };
  }

  async function connect(soft: boolean): Promise<void> {
    const join = linking;
    linking = null;
    if (!join || join.to === null) return;
    await app.connectEdge(join.from, join.to, soft ? 'after' : 'blocked_by');
    focused = join.to;
    canvas?.querySelector<HTMLElement>(`[data-node="${CSS.escape(join.to)}"]`)?.focus();
  }

  // The arrow to come, laid as the others are, between the two boxes as they are drawn now.
  $effect(() => {
    const join = linking;
    void lines;
    if (!join || join.to === null || !canvas) {
      preview = null;
      return;
    }
    const a = canvas.querySelector<HTMLElement>(`[data-node="${CSS.escape(join.from)}"]`)?.getBoundingClientRect();
    const b = canvas.querySelector<HTMLElement>(`[data-node="${CSS.escape(join.to)}"]`)?.getBoundingClientRect();
    const frame = canvas.getBoundingClientRect();
    preview = a && b ? arrow(a, b, { left: frame.left - canvas.scrollLeft, top: frame.top - canvas.scrollTop }) : null;
  });

  // What the join will do, in words (a screen reader hears it as the target changes).
  const linkNote = $derived.by(() => {
    const join = linking;
    if (!join) return null;
    const from = markHidden(titleOf(join.from));
    if (join.to === null) return t(join.by === 'keys' ? 'graph.link.start' : 'graph.link.drag', { from });
    return t(join.soft ? 'graph.link.soft' : 'graph.link.hard', { from, to: markHidden(titleOf(join.to)) });
  });

  function onNodeFocus(id: string): void {
    focused = id;
    if (linking?.by === 'keys') choose(id === linking.from ? null : id);
  }

  // The mouse: HTML5 drag, a drop on a task joins.
  function onDragStart(e: DragEvent, id: string): void {
    if (app.locked) {
      e.preventDefault();
      return;
    }
    e.dataTransfer?.setData('text/plain', id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'link';
    linking = { from: id, to: null, soft: false, by: 'drag' };
  }
  function onDragOver(e: DragEvent, id: string): void {
    if (linking?.by !== 'drag') return;
    if (!canTake(id)) {
      if (linking.to === id) choose(null);
      return;
    }
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'link';
    if (linking.to !== id || linking.soft !== e.altKey) choose(id, e.altKey);
  }
  function onDrop(e: DragEvent, id: string): void {
    if (linking?.by !== 'drag') return;
    e.preventDefault();
    choose(id, e.altKey);
    void connect(e.altKey);
  }
  function onDragEnd(): void {
    if (linking?.by === 'drag') linking = null;
  }

  // A finger or a pen, by the grip of a task (HTML5 drag does not start on a touch screen).
  let fingerFrom = { x: 0, y: 0 };
  const grip = createGrip(
    () => onFinger,
    () => app.locked,
  );
  function onFinger(e: PointerDragEvent): void {
    if (e.phase === 'start') {
      fingerFrom = { x: e.x, y: e.y };
      linking = { from: e.id, to: null, soft: false, by: 'finger' };
      return;
    }
    if (linking?.by !== 'finger' || linking.from !== e.id) return;
    if (e.phase === 'move') {
      choose(farEnough(fingerFrom, e) ? placeAt(document, e.x, e.y, 'data-node') : null);
      return;
    }
    if (e.phase === 'end' && linking.to !== null) void connect(false);
    else linking = null;
  }

  // -- the arrows as controls --

  const edgeKey = (edge: DepEdge): string => `${edge.kind}:${edge.from}>${edge.to}`;
  /** The menu of one arrow, where it was asked for (in the frame of the canvas's content). */
  let menu = $state<{ edge: DepEdge; x: number; y: number } | null>(null);
  let menuBox: HTMLDivElement | undefined = $state();

  function edgeLabel(edge: DepEdge): string {
    return t('graph.edge.label', {
      to: markHidden(titleOf(edge.to)),
      from: markHidden(titleOf(edge.from)),
      kind: t(edge.kind === 'blocked_by' ? 'graph.kind.blocked_by' : 'graph.kind.after'),
    });
  }

  const hitOf = (edge: DepEdge): SVGPathElement | null =>
    canvas?.querySelector<SVGPathElement>(`path.hit[data-edge-key="${CSS.escape(edgeKey(edge))}"]`) ?? null;

  function openMenu(edge: DepEdge, at?: { clientX: number; clientY: number }): void {
    if (!canvas) return;
    let x: number;
    let y: number;
    if (at) {
      const frame = canvas.getBoundingClientRect();
      x = at.clientX - frame.left + canvas.scrollLeft;
      y = at.clientY - frame.top + canvas.scrollTop;
    } else {
      // From the keyboard: at the middle of the arrow.
      const hit = hitOf(edge);
      const mid = hit ? hit.getPointAtLength(hit.getTotalLength() / 2) : { x: 0, y: 0 };
      x = mid.x;
      y = mid.y;
    }
    menu = { edge, x, y };
    requestAnimationFrame(() => menuBox?.querySelector<HTMLElement>('button')?.focus());
  }

  function closeMenu(back = true): void {
    const edge = menu?.edge;
    menu = null;
    if (back && edge) hitOf(edge)?.focus();
  }

  function openTask(id: string): void {
    menu = null;
    onopen(id);
  }

  async function act(edge: DepEdge, action: EdgeAction): Promise<void> {
    menu = null;
    await app.editEdge(edge, action);
    // The arrow is gone or drawn anew: the keys go on from the task that waits.
    focused = edge.to;
    canvas?.querySelector<HTMLElement>(`[data-node="${CSS.escape(edge.to)}"]`)?.focus();
  }

  function onHitKey(e: KeyboardEvent, edge: DepEdge): void {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      void act(edge, 'remove');
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openMenu(edge);
    }
  }

  function onMenuKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
    }
  }

  // A press inside the menu: WebKit does not give a pressed button the focus, the focus leaves the menu, and the
  // menu must not close before the click arrives.
  let pressing = false;

  function onMenuFocusOut(e: FocusEvent): void {
    const next = e.relatedTarget as Node | null;
    if (pressing || (next && menuBox?.contains(next))) return;
    closeMenu(false);
  }

  // A press outside the open menu closes it.
  $effect(() => {
    if (!menu) return;
    const down = (e: PointerEvent): void => {
      pressing = !!menuBox?.contains(e.target as Node);
      if (!pressing) closeMenu(false);
    };
    const up = (): void => {
      // After the click of this press (a click comes after pointerup, in the same task).
      setTimeout(() => (pressing = false));
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    return () => {
      pressing = false;
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
    };
  });

  // The arrows of the task the keys are on are the ones Tab reaches (after the task); the others by the mouse.
  const tabbable = (edge: DepEdge): boolean => tabStop !== null && (edge.from === tabStop || edge.to === tabStop);
  const toggleKey = (edge: DepEdge): Key => (edge.kind === 'blocked_by' ? 'graph.edge.soften' : 'graph.edge.harden');

  const titleOf = (id: string): string => tasks.get(id)?.title ?? app.graphDoc?.nodes.find((n) => n.id === id)?.title ?? id;
  const rowName = (stage: number | null): string => (stage === null ? t('plan.no_stage') : t('plan.stage', { n: stage }));
</script>

<section class="graph" aria-label={t('graph.view')} aria-busy={app.saving}>
  <p class="legend">{t('graph.legend')}</p>
  {#if linkNote}<p class="link-note" role="status">{linkNote}</p>{/if}
  {#if focus}
    <p class="focus-note" role="status">
      <span>{t(focus.direction === 'needs' ? 'graph.focus.needs' : 'graph.focus.unlocks', { title: markHidden(titleOf(focus.id)) })}</span>
      {#if outside > 0}<span class="muted">{t('graph.focus.outside', { n: outside })}</span>{/if}
      <button type="button" class="link" onclick={() => app.closeGraph()}>{t('graph.focus.all')}</button>
    </p>
  {/if}
  {#if focus && shown.length === 0}<p class="muted">{t('graph.focus.none')}</p>{/if}
  <div
    class="canvas"
    bind:this={canvas}
    onfocusout={(e) => {
      // The keys left the graph: a join by the keys stops (it would wait unseen).
      if (linking?.by === 'keys' && !canvas?.contains(e.relatedTarget as Node | null)) linking = null;
    }}
  >
    <svg class="arrows" aria-hidden="true" width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`}>
      <defs>
        <marker id="dep-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path class="head" d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
        <marker id="dep-head-critical" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path class="head critical" d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      </defs>
      {#each lines as line (`${line.edge.kind}:${line.edge.from}>${line.edge.to}`)}
        <path
          class="line"
          class:soft={line.edge.kind === 'after'}
          class:critical={line.critical}
          data-edge={`${line.edge.from}>${line.edge.to}`}
          data-kind={line.edge.kind}
          d={line.d}
          marker-end={line.critical ? 'url(#dep-head-critical)' : 'url(#dep-head)'}
        />
      {/each}
      {#if preview}<path class="line preview" d={preview} marker-end="url(#dep-head)" />{/if}
    </svg>
    {#each drawnRows as row, r (rowKey(row.stage))}
      {@const all = rows[r]!.ids.length}
      <div class="row" class:cycle={row.stage === null} data-row={rowKey(row.stage)}>
        <h3 class="row-head">{rowName(row.stage)} ({all})</h3>
        {#if row.stage === null}
          {#each cycles as cycle, i (i)}<p class="cycle-note">{t('plan.cycle')}: <code>{markHidden(cycle.join(' → '))}</code></p>{/each}
        {/if}
        <div class="nodes">
          {#each row.ids as id (id)}
            {@const task = tasks.get(id)}
            {@const hidden = graph.hidden.get(id) ?? 0}
            <button
              type="button"
              class="node"
              class:critical={critical.has(id)}
              class:root={id === focus?.id}
              class:link-from={linking?.from === id}
              class:link-to={linking?.to === id}
              class:waiting={task?.readiness?.state === 'waiting' || task?.readiness?.state === 'stuck'}
              data-node={id}
              tabindex={id === tabStop ? 0 : -1}
              aria-current={id === app.selectedId ? 'true' : undefined}
              draggable={!app.locked}
              onfocus={() => onNodeFocus(id)}
              onkeydown={(e) => onNodeKey(e, id)}
              onclick={() => {
                linking = null;
                onopen(id);
              }}
              ondragstart={(e) => onDragStart(e, id)}
              ondragover={(e) => onDragOver(e, id)}
              ondrop={(e) => onDrop(e, id)}
              ondragend={onDragEnd}
            >
              <span class="title">{markHidden(task?.title ?? id)}</span>
              <span class="meta">
                <span class="tag" data-hint={hintOf(app.lang, 'hint.status', task?.status ?? '')}>{labelOf(app.lang, 'status', task?.status)}</span>
                {#if task?.prio !== undefined}<span class="tag soft">P{task.prio}</span>{/if}
                {#if task?.effort}<span class="tag soft">{markHidden(task.effort)}</span>{/if}
                {#if hidden > 0}<span class="tag soft" data-hint={t('graph.hidden_hint')}>{t('graph.hidden', { n: hidden })}</span>{/if}
              </span>
              <span class="id">{id}</span>
              <!-- A finger joins by this grip (the keys have l, the mouse drags the whole task). -->
              <span
                class="grip"
                data-hint={t('hint.ui.graph.grip')}
                role="presentation"
                aria-hidden="true"
                onpointerdown={(e) => grip(e, id, 'start')}
                onpointermove={(e) => grip(e, id, 'move')}
                onpointerup={(e) => grip(e, id, 'end')}
                onpointercancel={(e) => grip(e, id, 'cancel')}>⠿</span
              >
            </button>
          {/each}
          {#if all > row.ids.length}
            <button type="button" class="more" onclick={() => (opened = new Set([...opened, rowKey(row.stage)]))}>
              {t('graph.more', { n: all - row.ids.length })}
            </button>
          {/if}
        </div>
      </div>
    {/each}
    <svg class="hits" width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`}>
      {#each lines as line (edgeKey(line.edge))}
        <path
          class="hit"
          role="button"
          tabindex={tabbable(line.edge) ? 0 : -1}
          aria-label={edgeLabel(line.edge)}
          data-edge-key={edgeKey(line.edge)}
          d={line.d}
          onclick={(e) => openMenu(line.edge, e)}
          onkeydown={(e) => onHitKey(e, line.edge)}
        />
      {/each}
    </svg>
    {#if menu}
      {@const edge = menu.edge}
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <!-- Escape of any of its buttons closes the menu, and leaving it with Tab does: the group listens for them. -->
      <div
        class="edge-menu"
        role="group"
        aria-label={edgeLabel(edge)}
        style:left={`${menu.x}px`}
        style:top={`${menu.y}px`}
        bind:this={menuBox}
        onkeydown={onMenuKey}
        onfocusout={onMenuFocusOut}
      >
        <button type="button" onclick={() => act(edge, 'remove')}>{t('graph.edge.remove')}</button>
        <button type="button" onclick={() => act(edge, 'toggle')}>{t(toggleKey(edge))}</button>
        <button type="button" onclick={() => openTask(edge.to)}>{t('graph.edge.open_to', { title: markHidden(titleOf(edge.to)) })}</button>
        <button type="button" onclick={() => openTask(edge.from)}>{t('graph.edge.open_from', { title: markHidden(titleOf(edge.from)) })}</button>
      </div>
    {/if}
  </div>
  <details class="edges">
    <summary>{t('graph.edges', { n: graph.edges.length })}</summary>
    {#if graph.edges.length > 0}
      <table>
        <thead>
          <tr>
            <th scope="col">{t('graph.col.waits')}</th>
            <th scope="col">{t('graph.col.on')}</th>
            <th scope="col">{t('graph.col.kind')}</th>
            <th scope="col">{t('graph.col.change')}</th>
          </tr>
        </thead>
        <tbody>
          {#each graph.edges as edge (`${edge.kind}:${edge.from}>${edge.to}`)}
            <tr>
              <td><button type="button" class="link" onclick={() => onopen(edge.to)}>{markHidden(titleOf(edge.to))}</button></td>
              <td><button type="button" class="link" onclick={() => onopen(edge.from)}>{markHidden(titleOf(edge.from))}</button></td>
              <td>{t(edge.kind === 'blocked_by' ? 'graph.kind.blocked_by' : 'graph.kind.after')}</td>
              <td class="change">
                <button type="button" class="link" aria-label={`${t('graph.edge.remove')}: ${edgeLabel(edge)}`} onclick={() => act(edge, 'remove')}
                  >{t('graph.edge.remove')}</button
                >
                <button type="button" class="link" aria-label={`${t(toggleKey(edge))}: ${edgeLabel(edge)}`} onclick={() => act(edge, 'toggle')}
                  >{t(toggleKey(edge))}</button
                >
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </details>
</section>

<style>
  .graph {
    display: grid;
    gap: 0.5rem;
  }
  .focus-note {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: baseline;
    margin: 0;
    font-size: 0.9rem;
  }
  .muted {
    margin: 0;
    color: var(--muted);
  }
  .legend {
    margin: 0;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .canvas {
    position: relative;
    overflow: auto;
    max-height: 75vh;
    padding: 0.25rem 0.25rem 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }
  /* The arrows lie under the boxes: a box stays clickable where an arrow passes it. */
  .arrows {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
    overflow: visible;
  }
  /* The arrows as controls: a wide stroke nobody sees, under the boxes (a box wins where an arrow passes it). */
  .hits {
    position: absolute;
    left: 0;
    top: 0;
    z-index: 0;
    pointer-events: none;
    overflow: visible;
  }
  .hit {
    fill: none;
    stroke: transparent;
    stroke-width: 12;
    pointer-events: stroke;
    cursor: pointer;
  }
  .hit:hover,
  .hit:focus-visible {
    stroke: var(--focus);
    stroke-opacity: 0.45;
    outline: none;
  }
  .edge-menu {
    position: absolute;
    z-index: 2;
    display: grid;
    gap: 0.15rem;
    min-width: 12rem;
    padding: 0.3rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .edge-menu button {
    text-align: left;
    padding: 0.3rem 0.5rem;
    border: none;
    border-radius: var(--radius);
    background: none;
    color: var(--text);
    cursor: pointer;
  }
  .edge-menu button:hover,
  .edge-menu button:focus-visible {
    background: var(--surface-2);
  }
  td.change {
    display: flex;
    gap: 0.6rem;
  }
  .line {
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.5;
  }
  /* The arrow to come, while a join is chosen. */
  .line.preview {
    stroke: var(--focus);
    stroke-width: 2;
    stroke-dasharray: 3 3;
  }
  .node.link-from {
    outline: 2px dashed var(--focus);
    outline-offset: 2px;
  }
  .node.link-to {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .grip {
    position: absolute;
    right: 0.3rem;
    bottom: 0.2rem;
    color: var(--muted);
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .link-note {
    margin: 0;
    font-size: 0.9rem;
  }
  .line.soft {
    stroke-dasharray: 5 4;
  }
  .line.critical {
    stroke: var(--accent);
    stroke-width: 3;
  }
  .head {
    fill: var(--muted);
  }
  .head.critical {
    fill: var(--accent);
  }
  .row {
    position: relative;
    padding: 0.4rem 0.25rem 1.6rem;
  }
  .row.cycle {
    border: 1px dashed var(--bad);
    border-radius: var(--radius);
  }
  .row-head {
    margin: 0 0 0.35rem;
    font-size: 0.8rem;
    color: var(--muted);
    font-weight: 600;
  }
  .cycle-note {
    margin: 0 0 0.35rem;
    font-size: 0.8rem;
  }
  .nodes {
    display: flex;
    flex-wrap: wrap;
    gap: 1.2rem 1.5rem;
    align-items: flex-start;
  }
  .node {
    position: relative;
    z-index: 1;
    display: grid;
    gap: 0.2rem;
    width: 13rem;
    text-align: left;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-2);
    color: var(--text);
    cursor: pointer;
  }
  .node:hover,
  .node:focus-visible {
    border-color: var(--accent);
  }
  .node[aria-current='true'] {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .node.critical {
    border-color: var(--accent);
    border-width: 2px;
  }
  /* The task the focus is about: a double frame, so it is found at once among the ones it needs. */
  .node.root {
    border-color: var(--accent);
    border-style: double;
    border-width: 4px;
  }
  .node.waiting {
    opacity: 0.75;
  }
  .title {
    font-size: 0.85rem;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .tag {
    font-size: 0.7rem;
    padding: 0 0.3rem;
    border: 1px solid var(--border);
    border-radius: 999px;
  }
  .tag.soft {
    color: var(--muted);
  }
  .id {
    font-size: 0.7rem;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .more {
    position: relative;
    z-index: 1;
    align-self: center;
    background: none;
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    color: var(--text);
    padding: 0.4rem 0.6rem;
    cursor: pointer;
  }
  .edges summary {
    cursor: pointer;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .edges table {
    border-collapse: collapse;
    margin-top: 0.4rem;
  }
  .edges th,
  .edges td {
    border-bottom: 1px solid var(--border);
    padding: 0.2rem 0.6rem 0.2rem 0;
    text-align: left;
    font-size: 0.85rem;
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    cursor: pointer;
    text-align: left;
  }
</style>
