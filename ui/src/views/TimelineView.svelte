<script lang="ts">
  import TaskIcon from './TaskIcon.svelte';
  // The timeline (Gantt-like): a bar for each open task from `start` to `due` (a mark for a task with one date), in
  // rows grouped by plan or by area, a line for today, the dependencies as arrows (see `lib/timeline.ts`). Dragging a
  // bar moves both dates, dragging an end moves one; a finger drags by the grip of a row or by an end. The keys do the
  // same: the arrows walk the rows and the parts of a bar, Shift with left or right moves the part under the focus and
  // letting go of Shift saves it. Every change is one `set` through the engine (`App.setDates`), which judges it. The
  // table under the picture says the same in words and sets the dates in fields. The page works out only the layout.
  import { tick, untrack } from 'svelte';
  import type { App } from '../lib/app.svelte';
  import { parseDate } from '../lib/calendar';
  import type { MeetingEntry, TaskEntry } from '../lib/contract';
  import { dayOfMeeting, diamondsByTask, fillOf, withMeetingRows } from '../lib/timelineMeetings';
  import MeetingThumb from './MeetingThumb.svelte';
  import { isOverdue } from '../lib/remind';
  import { translate, type Key } from '../lib/i18n';
  import { chordWatch } from '../lib/keymap';
  import {
    arrowPath,
    barsOf,
    clip,
    DAY_WIDTH,
    daysBetween,
    edgesOf,
    lastDay,
    movedBar,
    partsOf,
    patchOf,
    rangeOf,
    rowsOf,
    ticksOf,
    TIMELINE_GROUPINGS,
    TIMELINE_ZOOMS,
    type Bar,
    type BarPart,
    type Names,
    type TimelineGrouping,
    type TimelineZoom,
  } from '../lib/timeline';
  import Info from 'appkit-ui/Info.svelte';
  import { markHidden } from '../lib/text';
  import FilterNote from './FilterNote.svelte';

  let { app }: { app: App } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  // The picture is laid out in pixels: the arrows are drawn from the same numbers as the rows and the bars.
  const ROW = 30;
  const HEAD = 44;
  /** Rows of the table under the picture at most (the picture itself shows every task with a date). */
  const TABLE_LIMIT = 300;

  let zoom = $state<TimelineZoom>('month');
  let grouping = $state<TimelineGrouping>('plan');
  let folded = $state<ReadonlySet<string>>(new Set());
  let pageWidth = $state(1024);
  const labelWidth = $derived(pageWidth < 640 ? 130 : 240);
  const dayWidth = $derived(DAY_WIDTH[zoom]);

  const tasks = $derived(app.shown);
  const bars = $derived(barsOf(tasks));
  const barOfId = $derived(new Map(bars.map((b) => [b.task.id, b])));
  const loose = $derived(tasks.filter((x) => !barOfId.has(x.id)));
  const range = $derived(rangeOf(bars, app.today, zoom));
  const grid = $derived(ticksOf(range, zoom));
  const width = $derived(range.days * dayWidth);

  const names: Names = {
    plan: (id) => (app.snapshot?.plans ?? []).find((p) => p.id === id)?.title ?? id,
    project: (id) => app.projects.find((p) => p.id === id)?.title ?? id,
    projectOf: (task) => (app.can('projects') ? app.projectOf(task) : undefined),
  };
  // The meetings of the days shown (concept 7.4): diamonds on the rows of their tasks, a row of their own in a group.
  let meetings = $state<MeetingEntry[]>([]);
  /** The engine's count of the meetings of the range: more than `meetings` when the pages ran out (said under the bar). */
  let meetingsTotal = $state(0);
  // The meeting under the pointer or the focus: its diamonds on every row light up together.
  let hot = $state<string | null>(null);
  const diamonds = $derived(diamondsByTask(meetings, bars));
  const rows = $derived(withMeetingRows(rowsOf(bars, grouping, names, folded), meetings, bars, grouping));
  $effect(() => {
    void app.writes;
    void app.snapshot?.rev;
    if (!app.canMeetings || bars.length === 0) {
      meetings = [];
      meetingsTotal = 0;
      return;
    }
    const abort = new AbortController();
    app
      .meetingsIn(range.from, lastDay(range), abort.signal)
      .then((read) => {
        if (abort.signal.aborted) return;
        meetings = read.items;
        meetingsTotal = read.total;
      })
      .catch(() => {
        if (abort.signal.aborted) return;
        meetings = [];
        meetingsTotal = 0;
      });
    return () => abort.abort();
  });
  const meetingLabel = (m: MeetingEntry): string => t('timeline.meeting', { title: m.title, date: say(dayOfMeeting(m) ?? ''), status: t(`timeline.fill.${fillOf(m, app.nowMs())}` as Key) });
  /** The row each task with a visible row is drawn in. */
  const rowOf = $derived(new Map(rows.flatMap((r, i) => (r.type === 'task' ? [[r.bar.task.id, i] as const] : []))));
  const taskRows = $derived(rows.flatMap((r) => (r.type === 'task' ? [r.bar] : [])));

  const monthName = $derived(new Intl.DateTimeFormat(app.lang, { month: 'short', year: 'numeric', timeZone: 'UTC' }));
  const dayName = $derived(new Intl.DateTimeFormat(app.lang, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }));
  const say = (date: string): string => dayName.format(parseDate(date) ?? new Date());

  // A part of a bar on its way: by a pointer, or by the keys while Shift is held. Drawn where it would land.
  let move = $state<{ id: string; part: BarPart; days: number; by: 'pointer' | 'keys'; from?: Column } | null>(null);
  // Only the bar that moves reads the move: a step of a drag draws one bar again, not every bar of the picture.
  const movingId = $derived(move?.id ?? null);
  const placed = (bar: Bar): { from: string; to: string } =>
    movingId === bar.task.id && move !== null ? movedBar(bar, move.part, move.days) : bar;
  /** Where a span lies in the track, or null outside of the days shown. */
  function box(span: { from: string; to: string }): { left: number; width: number; cutLeft: boolean; cutRight: boolean } | null {
    const part = clip(span, range);
    if (!part) return null;
    return {
      left: daysBetween(range.from, part.from) * dayWidth,
      width: (daysBetween(part.from, part.to) + 1) * dayWidth,
      cutLeft: part.cutLeft,
      cutRight: part.cutRight,
    };
  }
  const todayX = $derived(daysBetween(range.from, app.today) * dayWidth + dayWidth / 2);

  const arrows = $derived(
    edgesOf(bars, app.can('late_blockers')).flatMap((edge) => {
      const a = barOfId.get(edge.from);
      const b = barOfId.get(edge.to);
      const ra = rowOf.get(edge.from);
      const rb = rowOf.get(edge.to);
      if (!a || !b || ra === undefined || rb === undefined) return [];
      const from = box(placed(a));
      const to = box(placed(b));
      if (!from || !to) return [];
      return [{ ...edge, d: arrowPath(from.left + from.width, ra * ROW + ROW / 2, to.left, rb * ROW + ROW / 2, ROW) }];
    }),
  );
  /** What a task waits for, by name, for the table (with a word for an arrow that points back). */
  const waits = $derived.by(() => {
    const out = new Map<string, { title: string; backwards: boolean }[]>();
    for (const edge of edgesOf(bars, app.can('late_blockers'))) {
      const list = out.get(edge.to) ?? [];
      list.push({ title: barOfId.get(edge.from)?.task.title ?? edge.from, backwards: edge.backwards });
      out.set(edge.to, list);
    }
    return out;
  });

  function label(bar: Bar): string {
    const span = placed(bar);
    const title = bar.task.title;
    if (bar.kind === 'due') return t('timeline.mark.due', { title, date: say(span.to) });
    if (bar.kind === 'start') return t('timeline.mark.start', { title, date: say(span.from) });
    return t('timeline.bar', { title, from: say(span.from), to: say(span.to) });
  }
  const moving = $derived.by(() => {
    if (move === null) return '';
    const bar = barOfId.get(move.id);
    return bar ? t(move.by === 'keys' ? 'timeline.moving.keys' : 'timeline.moving', { what: label(bar) }) : '';
  });

  async function commit(): Promise<void> {
    const now = move;
    move = null;
    if (now === null) return;
    const bar = barOfId.get(now.id);
    const patch = bar ? patchOf(bar, now.part, now.days) : null;
    if (patch !== null) await app.setDates(now.id, patch);
    // The new dates may put the row elsewhere, and a row that moves loses the focus: the keys get it back.
    if (now.by === 'keys' && now.from !== undefined) {
      await tick();
      if (!scroller?.contains(document.activeElement)) await focusOn(now.id, now.from);
    }
  }

  // The pointer: the mouse takes a bar anywhere, a finger or a pen the grip of the row or an end of the bar (a
  // finger on the bar itself scrolls the page). The pointer is followed on the window from the moment it goes down:
  // let go anywhere (off the bar, off the picture, on another bar), the drag ends there, and a pointer that is lost
  // (the window loses the focus, the pointer is cancelled) gives it up. Nothing of a drag outlives its pointer.
  let held: { pointer: number; x: number; dragged: boolean; on: Element; slack: number } | null = null;
  /** How far a pointer goes before a press is a drag (a click that wobbles, a tap on a grip, is none), in pixels. */
  const SLACK = { mouse: 6, other: 12 } as const;
  let clickEaten = false;
  function capture(on: Element, pointer: number): void {
    try {
      on.setPointerCapture(pointer);
    } catch {
      // A pointer that is gone cannot be captured; the drag then ends where the element ends.
    }
  }
  function onDown(event: PointerEvent, bar: Bar, part: BarPart, grab: boolean): void {
    if (app.locked || event.button !== 0 || held !== null) return;
    if (event.pointerType !== 'mouse' && !grab) return;
    held = {
      pointer: event.pointerId,
      x: event.clientX,
      dragged: false,
      on: event.currentTarget as Element,
      slack: event.pointerType === 'mouse' ? SLACK.mouse : SLACK.other,
    };
    move = { id: bar.task.id, part, days: 0, by: 'pointer' };
    follow(true);
    // A grip or an end is followed from the start. The bar itself only once it is dragged: a pointer captured at
    // once would take the click that opens the task away from the bar.
    if (grab) {
      capture(held.on, event.pointerId);
      event.preventDefault();
    }
    // An end is inside the bar: the bar does not start a second drag for the same pointer.
    event.stopPropagation();
  }
  function onMove(event: PointerEvent): void {
    if (held === null || move === null || event.pointerId !== held.pointer) return;
    const way = event.clientX - held.x;
    // Not a drag yet: in a narrow zoom half a day is a few pixels, less than a hand wobbles while it clicks.
    if (!held.dragged && Math.abs(way) < held.slack) return;
    const days = Math.round(way / dayWidth);
    if (days !== 0 && !held.dragged) {
      held.dragged = true;
      capture(held.on, held.pointer);
    }
    if (days !== move.days) move = { ...move, days };
  }
  function onUp(event: PointerEvent, cancelled = false): void {
    if (held === null || event.pointerId !== held.pointer) return;
    // The click that ends a drag is not a click on the bar.
    clickEaten = held.dragged;
    if (clickEaten) setTimeout(() => (clickEaten = false), 0);
    letGo();
    if (cancelled) move = null;
    else void commit();
  }
  const onCancel = (event: PointerEvent): void => onUp(event, true);
  /** The pointer is gone without a word (the window lost the focus): the drag is given up, nothing is written. */
  function onLost(): void {
    if (held === null) return;
    letGo();
    move = null;
  }
  function letGo(): void {
    held = null;
    follow(false);
  }
  function follow(on: boolean): void {
    const change = on ? window.addEventListener : window.removeEventListener;
    change.call(window, 'pointermove', onMove as EventListener);
    change.call(window, 'pointerup', onUp as EventListener);
    change.call(window, 'pointercancel', onCancel as EventListener);
    change.call(window, 'blur', onLost);
  }
  // A view that goes away while a pointer is held leaves no listener behind.
  $effect(() => () => follow(false));
  function open(id: string): void {
    if (clickEaten) {
      clickEaten = false;
      return;
    }
    app.peek(id);
  }

  // The keys: one control of the picture takes Tab (the name of a task, at first of the first one); the arrows go on.
  let root = $state<HTMLElement | null>(null);
  type Column = 'name' | BarPart;
  let chosen = $state<{ id: string; column: Column } | null>(null);
  /** The controls a row has: its name, and the parts of its bar when the bar is in the days shown. */
  const columnsOf = (bar: Bar): Column[] => (clip(bar, range) ? ['name', ...partsOf(bar)] : ['name']);
  const cursor = $derived.by((): { id: string; column: Column } | null => {
    const bar = chosen === null ? undefined : barOfId.get(chosen.id);
    if (chosen !== null && bar && rowOf.has(chosen.id)) {
      // A part that is not drawn (any more) cannot take Tab: the name of the row does.
      return columnsOf(bar).includes(chosen.column) ? chosen : { id: chosen.id, column: 'name' };
    }
    const first = taskRows[0];
    return first ? { id: first.task.id, column: 'name' } : null;
  });
  const tabs = (id: string, column: Column): 0 | -1 => (cursor !== null && cursor.id === id && cursor.column === column ? 0 : -1);
  async function focusOn(id: string, column: Column): Promise<void> {
    chosen = { id, column };
    await tick();
    for (const el of root?.querySelectorAll<HTMLElement>(`[data-column="${column}"]`) ?? []) {
      if (el.dataset.task === id) {
        el.focus();
        return;
      }
    }
  }
  // `g h` and `g l` are the page's (Today, the list): the letters after a `g` are not taken as steps.
  const ofChord = chordWatch();
  function onKey(event: KeyboardEvent): void {
    if (ofChord(event)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const el = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-column][data-task]') : null;
    const id = el?.dataset.task;
    const bar = id === undefined ? undefined : barOfId.get(id);
    if (!el || id === undefined || !bar) return;
    const column = el.dataset.column as Column;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (key === 'Escape' && move !== null) {
      event.preventDefault();
      move = null;
      return;
    }
    const sideways = key === 'ArrowLeft' || key === 'h' ? -1 : key === 'ArrowRight' || key === 'l' ? 1 : 0;
    const week = key === 'PageUp' ? -7 : key === 'PageDown' ? 7 : 0;
    if (event.shiftKey) {
      // Shift moves the part under the focus (the name stands for the whole bar); nothing is written before Shift is
      // let go, so that several days are one change.
      const days = sideways !== 0 ? sideways : week;
      if (days === 0 || app.locked || held !== null) return;
      event.preventDefault();
      const part: BarPart = column === 'name' || !partsOf(bar).includes(column) ? 'body' : column;
      const before = move !== null && move.id === id && move.part === part && move.by === 'keys' ? move.days : 0;
      move = { id, part, days: before + days, by: 'keys', from: column };
      return;
    }
    if (sideways !== 0) {
      const columns = columnsOf(bar);
      const next = columns[columns.indexOf(column) + sideways];
      event.preventDefault();
      if (next !== undefined) void focusOn(id, next);
      return;
    }
    const down = key === 'ArrowDown' || key === 'j' ? 1 : key === 'ArrowUp' || key === 'k' ? -1 : 0;
    if (down !== 0) {
      const next = taskRows[taskRows.findIndex((b) => b.task.id === id) + down];
      event.preventDefault();
      if (next) {
        const columns = columnsOf(next);
        void focusOn(next.task.id, columns.includes(column) ? column : columns.includes('body') ? 'body' : 'name');
      }
    }
  }
  function onKeyUp(event: KeyboardEvent): void {
    if (event.key === 'Shift' && move !== null && move.by === 'keys') void commit();
  }
  function onFocusOut(event: FocusEvent): void {
    // The focus leaves the picture with a move by the keys still open: it is given up, not written behind the back.
    // "The picture" is what hears the keys: in the tools or the table a Shift let go would not be heard any more.
    if (move === null || move.by !== 'keys') return;
    if (event.relatedTarget instanceof Node && scroller?.contains(event.relatedTarget)) return;
    move = null;
  }

  function toggle(key: string): void {
    const next = new Set(folded);
    if (!next.delete(key)) next.add(key);
    folded = next;
  }

  // Today in view: when the view opens and when the zoom changes, and by the button.
  let scroller = $state<HTMLElement | null>(null);
  function toToday(): void {
    if (!scroller) return;
    scroller.scrollLeft = Math.max(0, todayX - Math.max(0, scroller.clientWidth - labelWidth) / 3);
  }
  $effect(() => {
    void zoom;
    void scroller;
    untrack(toToday);
  });

  /**
   * A date field of the table writes when it is left, or on Enter: while a date is typed the browser passes through
   * dates nobody meant (the year 2027 is 0002, 0020, 0202 on its way, each one a valid date and a `change`).
   */
  async function setDate(field: HTMLInputElement, id: string, key: 'start' | 'due'): Promise<void> {
    const task = app.tasks.find((x) => x.id === id);
    const value = field.value;
    if (!task || (task[key] ?? '') === value) return;
    await app.setDates(id, { [key]: value === '' ? null : value });
    await tick();
    // A date the engine refused does not stay in the field as if it were the task's.
    field.value = app.tasks.find((x) => x.id === id)?.[key] ?? '';
  }
  function onDateKey(event: KeyboardEvent, id: string, key: 'start' | 'due'): void {
    if (event.key !== 'Enter' || event.repeat) return;
    event.preventDefault();
    void setDate(event.currentTarget as HTMLInputElement, id, key);
  }
</script>

<svelte:window bind:innerWidth={pageWidth} />

<!-- A meeting on its day: the picture inside, the status as the fill (hollow, half, full, struck through). -->
{#snippet diamond(m: MeetingEntry)}
  {@const day = dayOfMeeting(m)}
  {@const at = day === null ? null : box({ from: day, to: day })}
  {#if at}
    <button
      type="button"
      class="diamond {fillOf(m, app.nowMs())}"
      class:hot={hot === m.id}
      style:left="{at.left + dayWidth / 2 - 9}px"
      tabindex="-1"
      data-meeting={m.id}
      data-fill={fillOf(m, app.nowMs())}
      title={meetingLabel(m)}
      aria-label={meetingLabel(m)}
      onmouseenter={() => (hot = m.id)}
      onmouseleave={() => (hot = null)}
      onclick={() => app.openMeeting(m.id)}
    >
      <span class="inner"><MeetingThumb {app} meeting={m} size={18} /></span>
    </button>
  {/if}
{/snippet}

{#snippet barOf(bar: Bar)}
  {@const task = bar.task}
  {@const at = box(placed(bar)) ?? (movingId === task.id ? box(bar) : null)}
  {#if at}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="bar {bar.kind}"
      class:overdue={bar.kind !== 'start' && task.status !== 'parked' && isOverdue(task.due, app.today)}
      class:moving={movingId === task.id}
      class:cut-left={at.cutLeft}
      class:cut-right={at.cutRight}
      class:selected={app.selectedId === task.id}
      style:left="{at.left}px"
      style:width="{at.width}px"
      data-bar={task.id}
      data-from={placed(bar).from}
      data-to={placed(bar).to}
      onpointerdown={(e) => onDown(e, bar, 'body', false)}
    >
      {#if bar.kind === 'bar'}
        <button
          type="button"
          class="end first"
          tabindex={tabs(task.id, 'start')}
          data-task={task.id}
          data-column="start"
          data-hint={t('hint.ui.timeline.end')}
          aria-label={t('timeline.part.start', { title: task.title, date: say(placed(bar).from) })}
          onpointerdown={(e) => onDown(e, bar, 'start', true)}
        ></button>
      {/if}
      <button
        type="button"
        class="body"
        tabindex={tabs(task.id, 'body')}
        data-task={task.id}
        data-column="body"
        title={task.title}
        aria-label={label(bar)}
        onclick={() => open(task.id)}
      >
        {#if bar.kind === 'bar'}<TaskIcon {app} {task} size={12} /><span class="bar-title" aria-hidden="true">{markHidden(task.title)}</span>{/if}
      </button>
      {#if bar.kind === 'bar'}
        <button
          type="button"
          class="end last"
          tabindex={tabs(task.id, 'end')}
          data-task={task.id}
          data-column="end"
          data-hint={t('hint.ui.timeline.end')}
          aria-label={t('timeline.part.end', { title: task.title, date: say(placed(bar).to) })}
          onpointerdown={(e) => onDown(e, bar, 'end', true)}
        ></button>
      {/if}
    </div>
  {/if}
{/snippet}

<section class="timeline" aria-label={t('nav.timeline')} bind:this={root}>
  <FilterNote {app} />
  <header class="intro">
    <div class="head">
      <h2>{t('timeline.title')}</h2>
      <Info hint={t('timeline.intro')} label={t('hint.about', { what: t('nav.timeline') })} />
    </div>
    <div class="tools">
      <button type="button" onclick={toToday}>{t('timeline.today')}</button>
      <label data-hint={t('hint.form.timeline.zoom')}>
        <span>{t('timeline.zoom')}</span>
        <select data-timeline-zoom value={zoom} onchange={(e) => (zoom = e.currentTarget.value as TimelineZoom)}>
          {#each TIMELINE_ZOOMS as z (z)}<option value={z}>{t(`timeline.zoom.${z}` as Key)}</option>{/each}
        </select>
      </label>
      <label data-hint={t('hint.form.timeline.group')}>
        <span>{t('timeline.group')}</span>
        <select data-timeline-group value={grouping} onchange={(e) => (grouping = e.currentTarget.value as TimelineGrouping)}>
          {#each TIMELINE_GROUPINGS as g (g)}<option value={g}>{t(`timeline.group.${g}` as Key)}</option>{/each}
        </select>
      </label>
    </div>
    <p class="help">{t('timeline.help')}</p>
    {#if meetingsTotal > meetings.length}
      <p class="note" data-meetings-cut>{t('meetings.cut', { n: meetings.length, total: meetingsTotal })}</p>
    {/if}
    <!-- Always in the page, so that a screen reader hears it fill. -->
    <p class="status" role="status" data-timeline-moving>{moving}</p>
  </header>

  {#if bars.length === 0}
    <p class="none">{t('timeline.none')}</p>
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="scroll" bind:this={scroller} onkeydown={onKey} onkeyup={onKeyUp} onfocusout={onFocusOut}>
      <div class="canvas" style:width="{labelWidth + width}px">
        <div class="row top" style:height="{HEAD}px">
          <div class="label" style:width="{labelWidth}px">{t('timeline.col.task')}</div>
          <div class="track" style:width="{width}px" aria-hidden="true">
            {#each grid.months as month (month.date)}
              <span class="month" style:left="{month.offset * dayWidth}px" style:width="{month.days * dayWidth}px">
                {#if month.days * dayWidth >= 60}<span class="month-name" style:left="{labelWidth + 4}px">{monthName.format(parseDate(month.date) ?? new Date())}</span>{/if}
              </span>
            {/each}
            {#if zoom !== 'quarter'}
              {#each grid.ticks as mark (mark.date)}
                {#if zoom === 'week' || mark.major}
                  <span class="day" class:major={mark.major} style:left="{mark.offset * dayWidth}px">{Number(mark.date.slice(8))}</span>
                {/if}
              {/each}
            {/if}
          </div>
        </div>
        <div class="rows" style:height="{rows.length * ROW}px">
          <div class="lines" style:left="{labelWidth}px" style:width="{width}px" aria-hidden="true">
            {#each grid.ticks as mark (mark.date)}
              <span class="line" class:major={mark.major} style:left="{mark.offset * dayWidth}px"></span>
            {/each}
            <span class="now" style:left="{todayX}px" data-timeline-today></span>
          </div>
          {#each rows as row (row.type === 'task' ? row.bar.task.id : row.key)}
            <div class="row" class:group={row.type === 'group'} style:height="{ROW}px">
              {#if row.type === 'group'}
                {@const name = row.kind === 'none' ? t('timeline.no_plan') : row.label}
                {@const at = box(row.span)}
                <div class="label" style:width="{labelWidth}px" style:padding-left="{0.3 + row.level * 0.8}rem">
                  <button
                    type="button"
                    class="fold"
                    aria-expanded={!row.folded}
                    aria-label={t('timeline.group_row', { name, n: row.count, from: say(row.span.from), to: say(row.span.to) })}
                    data-group={row.key}
                    onclick={() => toggle(row.key)}
                  >
                    <span aria-hidden="true">{row.folded ? '▸' : '▾'}</span>
                    <span class="group-name" aria-hidden="true">{markHidden(name)}</span>
                    <small aria-hidden="true">({row.count})</small>
                  </button>
                </div>
                <div class="track" style:width="{width}px" aria-hidden="true">
                  {#if at}
                    <span class="span {row.kind}" class:cut-left={at.cutLeft} class:cut-right={at.cutRight} style:left="{at.left}px" style:width="{at.width}px" data-span={row.key}></span>
                  {/if}
                </div>
              {:else if row.type === 'meetings'}
                <div class="label" style:width="{labelWidth}px" style:padding-left="{0.3 + row.level * 0.8}rem">
                  <span class="meetings-name" data-meetings-row={row.key}>{t('timeline.meetings_row')} <small>({row.meetings.length})</small></span>
                </div>
                <div class="track" style:width="{width}px">
                  {#each row.meetings as m (m.id)}{@render diamond(m)}{/each}
                </div>
              {:else}
                {@const bar = row.bar}
                <div class="label" style:width="{labelWidth}px" style:padding-left="{0.3 + row.level * 0.8}rem">
                  {#if !app.locked}
                    <!-- A finger drags the whole bar by this grip (the keys have Shift with the arrows). -->
                    <span
                      class="grip"
                      data-hint={t('hint.ui.timeline.grip')}
                      role="presentation"
                      aria-hidden="true"
                      onpointerdown={(e) => onDown(e, bar, 'body', true)}>⠿</span
                    >
                  {/if}
                  <button
                    type="button"
                    class="name"
                    class:selected={app.selectedId === bar.task.id}
                    tabindex={tabs(bar.task.id, 'name')}
                    data-task={bar.task.id}
                    data-column="name"
                    title={bar.task.title}
                    onclick={() => app.peek(bar.task.id)}><TaskIcon {app} task={bar.task} size={12} /><span class="name-title">{markHidden(bar.task.title)}</span></button
                  >
                </div>
                <div class="track" style:width="{width}px">
                  {@render barOf(bar)}
                  {#each diamonds.get(bar.task.id) ?? [] as m (m.id)}{@render diamond(m)}{/each}
                </div>
              {/if}
            </div>
          {/each}
          <svg
            class="arrows"
            aria-hidden="true"
            style:left="{labelWidth}px"
            width={width}
            height={rows.length * ROW}
            viewBox={`0 0 ${width} ${rows.length * ROW}`}
          >
            <defs>
              <marker id="time-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path class="arrow-head" d="M 0 0 L 10 5 L 0 10 z" />
              </marker>
              <marker id="time-head-back" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path class="arrow-head back" d="M 0 0 L 10 5 L 0 10 z" />
              </marker>
            </defs>
            {#each arrows as arrow (`${arrow.from}>${arrow.to}`)}
              <path
                class="arrow {arrow.kind}"
                class:back={arrow.backwards}
                d={arrow.d}
                data-arrow={`${arrow.from}>${arrow.to}`}
                marker-end={arrow.backwards ? 'url(#time-head-back)' : 'url(#time-head)'}
              />
            {/each}
          </svg>
        </div>
      </div>
    </div>
  {/if}
  {#if loose.length > 0}<p class="note" data-timeline-undated>{t('timeline.undated', { n: loose.length })}</p>{/if}

  <details class="list">
    <summary>{t('timeline.table')}</summary>
    <table>
      <thead>
        <tr>
          <th scope="col">{t('timeline.col.task')}</th>
          <th scope="col">{t('timeline.col.start')}</th>
          <th scope="col">{t('timeline.col.due')}</th>
          <th scope="col">{t('timeline.col.waits')}</th>
        </tr>
      </thead>
      <tbody>
        {#each [...bars.map((b) => b.task), ...loose].slice(0, TABLE_LIMIT) as task (task.id)}
          <tr data-table-task={task.id}>
            <th scope="row"><TaskIcon {app} {task} /><button type="button" class="link" onclick={() => app.peek(task.id)}>{markHidden(task.title)}</button></th>
            <td data-hint={t('hint.form.timeline.start')}>
              <input
                type="date"
                value={task.start ?? ''}
                max={task.due ?? undefined}
                disabled={app.locked}
                aria-label={t('timeline.field.start', { title: task.title })}
                onblur={(e) => void setDate(e.currentTarget, task.id, 'start')}
                onkeydown={(e) => onDateKey(e, task.id, 'start')}
              />
            </td>
            <td data-hint={t('hint.form.timeline.due')}>
              <input
                type="date"
                value={task.due ?? ''}
                disabled={app.locked}
                aria-label={t('timeline.field.due', { title: task.title })}
                onblur={(e) => void setDate(e.currentTarget, task.id, 'due')}
                onkeydown={(e) => onDateKey(e, task.id, 'due')}
              />
            </td>
            <td>
              {#each waits.get(task.id) ?? [] as other, i (i)}
                <span class="wait" class:back={other.backwards}
                  >{markHidden(other.title)}{#if other.backwards}
                    <em>({t('timeline.late')})</em>{/if}</span
                >
              {/each}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if tasks.length > TABLE_LIMIT}<p class="note">{t('timeline.more', { n: tasks.length - TABLE_LIMIT })}</p>{/if}
    {#if meetings.length > 0}
      <h3 class="meetings-head">{t('timeline.meetings_row')}</h3>
      <ul class="meeting-list" data-timeline-meetings>
        {#each meetings.slice(0, TABLE_LIMIT) as m (m.id)}
          <li>
            <button type="button" class="link" onclick={() => app.openMeeting(m.id)}>{markHidden(m.title)}</button>
            <span class="muted">{meetingLabel(m)}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </details>
</section>

<style>
  .timeline {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 0;
  }
  .intro .head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  h2 {
    margin: 0;
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem 1rem;
    margin-top: 0.4rem;
  }
  .tools label {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .tools button,
  select,
  input {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0.25rem 0.6rem;
  }
  .tools button,
  select {
    cursor: pointer;
  }
  .help,
  .note,
  .none,
  .status {
    color: var(--muted);
    font-size: 0.85rem;
    margin: 0.3rem 0 0;
  }
  .status {
    color: var(--text);
    min-height: 1.2em;
  }
  .scroll {
    overflow: auto;
    max-height: 72vh;
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  .canvas {
    position: relative;
  }
  .row {
    display: flex;
    box-sizing: border-box;
    border-bottom: 1px solid var(--line);
  }
  .row.top {
    position: sticky;
    top: 0;
    z-index: 4;
    background: var(--surface);
    color: var(--muted);
    font-size: 0.8rem;
  }
  .rows {
    position: relative;
  }
  .label {
    flex: none;
    box-sizing: border-box;
    position: sticky;
    left: 0;
    z-index: 3;
    display: flex;
    align-items: center;
    gap: 0.2rem;
    min-width: 0;
    padding: 0 0.3rem;
    background: var(--bg);
    border-right: 1px solid var(--line);
  }
  .row.top .label,
  .row.group .label {
    background: var(--surface);
    font-weight: 600;
  }
  .track {
    flex: none;
    position: relative;
  }
  .month {
    position: absolute;
    top: 0;
    height: 50%;
    box-sizing: border-box;
    padding: 0.15rem 0.3rem;
    border-left: 1px solid var(--line);
    white-space: nowrap;
  }
  /* The name of a month stays in view while its days are scrolled through. */
  .month-name {
    position: sticky;
    display: inline-block;
  }
  .day {
    position: absolute;
    bottom: 0.1rem;
    padding-left: 0.2rem;
    font-size: 0.72rem;
  }
  .day.major {
    color: var(--text);
  }
  .lines {
    position: absolute;
    top: 0;
    bottom: 0;
    pointer-events: none;
  }
  .line {
    position: absolute;
    top: 0;
    bottom: 0;
    border-left: 1px dotted var(--line);
  }
  .line.major {
    border-left-style: solid;
  }
  .diamond {
    position: absolute;
    top: 6px;
    width: 18px;
    height: 18px;
    padding: 0;
    transform: rotate(45deg) scale(0.8);
    background: var(--surface);
    border: 2px solid var(--accent);
    overflow: hidden;
    cursor: pointer;
    z-index: 1;
  }
  .diamond .inner {
    display: block;
    width: 100%;
    height: 100%;
    transform: rotate(-45deg) scale(1.5);
  }
  .diamond.full {
    background: var(--accent);
  }
  .diamond.half {
    background: linear-gradient(135deg, var(--accent) 50%, var(--surface) 50%);
  }
  .diamond.cancelled {
    border-style: dashed;
    color: var(--muted);
    border-color: var(--muted);
  }
  .diamond.cancelled::after {
    content: '';
    position: absolute;
    left: -2px;
    right: -2px;
    top: 50%;
    border-top: 2px solid var(--muted);
  }
  .diamond.hot,
  .diamond:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .muted {
    color: var(--muted);
  }
  .meeting-list {
    list-style: none;
    padding: 0;
    margin: 0.3rem 0;
  }
  .meetings-head {
    font-size: 0.95rem;
    margin: 0.6rem 0 0;
  }
  .meetings-name {
    color: var(--muted);
    font-style: italic;
  }
  .now {
    position: absolute;
    top: 0;
    bottom: 0;
    border-left: 2px solid var(--accent);
    z-index: 2;
  }
  .fold,
  .name {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
    flex: 1;
    background: none;
    border: 0;
    color: inherit;
    font: inherit;
    text-align: left;
    padding: 0.1rem 0.2rem;
    cursor: pointer;
  }
  .name,
  .group-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
  }
  .name.selected {
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .grip {
    flex: none;
    min-width: 1.3rem;
    text-align: center;
    cursor: grab;
    color: var(--muted);
    touch-action: none;
    user-select: none;
  }
  .span {
    position: absolute;
    top: 40%;
    height: 20%;
    box-sizing: border-box;
    background: var(--muted);
    border-radius: 2px;
  }
  .span.project {
    top: 30%;
    height: 40%;
  }
  .bar {
    position: absolute;
    top: 4px;
    bottom: 4px;
    box-sizing: border-box;
    display: flex;
    min-width: 0;
    z-index: 1;
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    background: var(--surface-2);
    cursor: grab;
  }
  .bar.due,
  .bar.start {
    border-radius: 999px;
    border-width: 2px;
  }
  .bar.start {
    border-style: dashed;
  }
  .bar.overdue {
    border-color: var(--warn);
  }
  .bar.overdue .end {
    background: var(--warn);
  }
  .bar.moving {
    opacity: 0.75;
    outline: 2px dashed var(--accent);
  }
  .bar.selected {
    box-shadow: 0 0 0 2px var(--focus);
  }
  .bar.cut-left,
  .span.cut-left {
    border-left-style: dotted;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }
  .bar.cut-right,
  .span.cut-right {
    border-right-style: dotted;
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
  .bar .body {
    flex: 1;
    min-width: 0;
    background: none;
    border: 0;
    color: var(--text);
    font: inherit;
    font-size: 0.8rem;
    text-align: left;
    padding: 0 0.2rem;
    cursor: inherit;
    overflow: hidden;
  }
  .bar-title {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .end {
    flex: none;
    width: 8px;
    padding: 0;
    border: 0;
    background: var(--accent);
    cursor: ew-resize;
    touch-action: none;
  }
  .end.first {
    border-radius: var(--radius) 0 0 var(--radius);
  }
  .end.last {
    border-radius: 0 var(--radius) var(--radius) 0;
  }
  @media (any-pointer: coarse) {
    .end {
      width: 14px;
    }
  }
  .arrows {
    position: absolute;
    top: 0;
    pointer-events: none;
    z-index: 2;
  }
  .arrow {
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.5;
  }
  .arrow.after {
    stroke-dasharray: 4 3;
  }
  .arrow.back {
    stroke: var(--warn);
    stroke-width: 2.5;
  }
  .arrow-head {
    fill: var(--muted);
  }
  .arrow-head.back {
    fill: var(--warn);
  }
  .list summary {
    cursor: pointer;
  }
  table {
    border-collapse: collapse;
    margin-top: 0.4rem;
  }
  th,
  td {
    text-align: left;
    padding: 0.2rem 0.5rem;
    border-bottom: 1px solid var(--line);
    font-weight: normal;
  }
  thead th {
    color: var(--muted);
    font-weight: 600;
  }
  .link {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .wait {
    display: block;
  }
  .wait.back {
    color: var(--warn);
  }
</style>
