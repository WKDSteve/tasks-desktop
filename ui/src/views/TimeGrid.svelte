<script lang="ts">
  // The hour grid of the calendar for a week (seven columns) and a day (one, wider: place, link, participants in the
  // block), concept 7.3. Meetings are blocks in their length; overlapping ones stand side by side with a sign; all-day
  // meetings and the tasks with a date are in the bar above. A drag moves a meeting (`meeting_set` on the version the
  // grid showed), the lower edge changes its length, a drag over empty time opens the form with that time; the keys do
  // the same without a pointer. The page lays out and writes; whether a time is valid is the engine's word. It is
  // loaded when the week or the day is first shown (the main chunk has a budget).
  import { tick } from 'svelte';
  import type { App } from '../lib/app.svelte';
  import { parseDate, type Mark } from '../lib/calendar';
  import type { MeetingEntry } from '../lib/contract';
  import { translate, type Key } from '../lib/i18n';
  import { joinLink } from '../lib/meetingLink';
  import { wallTime } from '../lib/meetings';
  import { markHidden } from '../lib/text';
  import {
    allDayByDay,
    blocksByDay,
    createRange,
    DAY_MIN,
    dragged,
    durationText,
    hhmm,
    movePatch,
    nowOnGrid,
    placeSign,
    SLOT_MIN,
    SNAP_MIN,
    VISIBLE_FROM,
    type Block,
    type DragKind,
  } from '../lib/timeGrid';
  import { addDays } from '../lib/calendar';
  import MeetingThumb from './MeetingThumb.svelte';
  import { seriesNote } from '../lib/series';

  let { app, days, meetings, marks }: { app: App; days: string[]; meetings: MeetingEntry[]; marks: Map<string, Mark[]> } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  /** The height of a half hour, in pixels; a minute is a twelfth of it less. */
  const SLOT_PX = 24;
  const PX_PER_MIN = SLOT_PX / SLOT_MIN;
  const HOURS = Array.from({ length: 24 }, (_, h) => h);
  /** A drag shorter than this many pixels is a click. */
  const DRAG_PX = 5;

  const single = $derived(days.length === 1);
  const blocks = $derived(blocksByDay(meetings, days));
  const allDay = $derived(allDayByDay(meetings, days));
  const canMove = $derived(app.can('meeting_ops') && !app.readOnly && !app.locked);
  const weekday = $derived(new Intl.DateTimeFormat(app.lang, { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' }));
  const longDay = $derived(new Intl.DateTimeFormat(app.lang, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }));
  const nameOf = (day: string, long = false): string => (long ? longDay : weekday).format(parseDate(day) ?? new Date());

  // The line of now moves on every minute.
  let minute = $state(0);
  const nowAt = $derived((void minute, wallTime(app.nowMs())));
  $effect(() => {
    const timer = setInterval(() => (minute += 1), 60_000);
    return () => clearInterval(timer);
  });
  const now = $derived(nowOnGrid(nowAt));

  // The grid shows 07:00 to 20:00; the rest is a scroll away.
  let scroller = $state<HTMLElement | null>(null);
  $effect(() => {
    if (scroller) scroller.scrollTop = VISIBLE_FROM * PX_PER_MIN;
  });

  /** A meeting on its way: where the drag would put it. */
  let drag = $state<{ id: string; kind: DragKind; day: string; start: number; end: number; moved: boolean } | null>(null);
  /** A new meeting on its way: the range dragged over empty time. */
  let sketch = $state<{ day: string; from: number; to: number } | null>(null);
  let suppressClick = false;

  const top = (minutes: number): number => minutes * PX_PER_MIN;

  /** Where a block is drawn in its own column: where the drag put it, when that is still the same day. */
  function placed(b: Block): { start: number; end: number } {
    return drag !== null && drag.moved && drag.id === b.meeting.id && drag.day === b.day ? { start: drag.start, end: drag.end } : { start: b.start, end: b.end };
  }
  const blocksOnDay = (day: string): Block[] => blocks.get(day) ?? [];

  const lengthOf = (b: Pick<Block, 'start' | 'end'>): number => b.end - b.start;

  function columnAt(x: number, y: number): string | null {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el instanceof HTMLElement && el.dataset.col) return el.dataset.col;
    }
    return null;
  }

  // A meeting is picked up by its body (move) or its lower edge (length).
  let origin = { x: 0, y: 0 };
  function down(event: PointerEvent, b: Block, kind: DragKind): void {
    if (!canMove || b.clipped || event.button !== 0 || app.saving) return;
    if (kind === 'resize') event.stopPropagation();
    origin = { x: event.clientX, y: event.clientY };
    drag = { id: b.meeting.id, kind, day: b.day, start: b.start, end: b.end, moved: false };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }
  function move(event: PointerEvent, b: Block): void {
    if (drag === null || drag.id !== b.meeting.id) return;
    const dy = event.clientY - origin.y;
    if (!drag.moved && Math.abs(dy) < DRAG_PX && Math.abs(event.clientX - origin.x) < DRAG_PX) return;
    const day = drag.kind === 'move' ? (columnAt(event.clientX, event.clientY) ?? b.day) : b.day;
    const span = dragged(b, drag.kind, dy / PX_PER_MIN);
    drag = { ...drag, day, ...span, moved: true };
  }
  async function up(event: PointerEvent, b: Block): Promise<void> {
    const now = drag;
    drag = null;
    if (now === null || now.id !== b.meeting.id || !now.moved) return;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
    if (event.type === 'pointercancel') return;
    if (now.day === b.day && now.start === b.start && now.end === b.end) return;
    await put(b.meeting, now.day, now.start, now.end - now.start);
  }
  async function put(m: MeetingEntry, day: string, start: number, length: number): Promise<void> {
    const ok = await app.moveMeeting(m, movePatch(day, start, length));
    if (ok) {
      await tick();
      root?.querySelector<HTMLElement>(`[data-meeting="${m.id}"] .open`)?.focus();
    }
  }
  function open(m: MeetingEntry): void {
    if (suppressClick) return;
    app.openMeeting(m.id);
  }

  let root = $state<HTMLElement | null>(null);
  /** Shift with the arrows moves by a quarter hour or a day, Ctrl+Shift with up and down changes the length. */
  function key(event: KeyboardEvent, b: Block): void {
    // A meeting over midnight is moved on its page: the block holds only the part of this day (`Block.clipped`).
    if (!canMove || b.clipped || !event.shiftKey || event.altKey || event.metaKey || app.saving) return;
    const k = event.key;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) return;
    event.preventDefault();
    if (event.repeat) return;
    const vertical = k === 'ArrowUp' ? -SNAP_MIN : k === 'ArrowDown' ? SNAP_MIN : 0;
    if (event.ctrlKey) {
      if (vertical === 0) return;
      const end = Math.min(DAY_MIN, Math.max(b.start + SNAP_MIN, b.end + vertical));
      void put(b.meeting, b.day, b.start, end - b.start);
      return;
    }
    const step = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0;
    const span = dragged(b, 'move', vertical);
    void put(b.meeting, step === 0 ? b.day : addDays(b.day, step), span.start, lengthOf(b));
  }

  // Empty time: a drag over it makes a meeting (the form opens with that time), a double click one of an hour.
  function minutesAt(event: PointerEvent | MouseEvent, col: HTMLElement): number {
    return (event.clientY - col.getBoundingClientRect().top) / PX_PER_MIN;
  }
  function sketchDown(event: PointerEvent, day: string): void {
    if (!app.canMakeMeetings || app.locked || event.button !== 0 || event.target !== event.currentTarget) return;
    const col = event.currentTarget as HTMLElement;
    col.setPointerCapture?.(event.pointerId);
    origin = { x: event.clientX, y: event.clientY };
    const at = minutesAt(event, col);
    sketch = { day, from: at, to: at };
  }
  function sketchMove(event: PointerEvent): void {
    if (sketch === null) return;
    sketch = { ...sketch, to: minutesAt(event, event.currentTarget as HTMLElement) };
  }
  function sketchUp(event: PointerEvent): void {
    const s = sketch;
    sketch = null;
    if (s === null || event.type === 'pointercancel' || Math.abs(event.clientY - origin.y) < DRAG_PX) return;
    const r = createRange(s.from, s.to);
    app.openMeetingForm({ date: s.day, time: hhmm(r.start), duration: durationText(r.length) });
  }
  function sketchDouble(event: MouseEvent, day: string): void {
    if (!app.canMakeMeetings || app.locked || event.target !== event.currentTarget) return;
    const r = createRange(minutesAt(event, event.currentTarget as HTMLElement), minutesAt(event, event.currentTarget as HTMLElement) + 60);
    app.openMeetingForm({ date: day, time: hhmm(r.start), duration: '1h' });
  }
  const sketched = $derived(sketch === null ? null : createRange(sketch.from, sketch.to));

  function label(b: Block): string {
    const place = b.meeting.location ?? '';
    const from = hhmm(b.start);
    const to = hhmm(b.end);
    const text = place !== '' ? t('calendar.block_place', { title: b.meeting.title, from, to, place }) : t('calendar.block', { title: b.meeting.title, from, to });
    const series = seriesNote(app.lang, b.meeting);
    return `${text}${series !== '' ? `, ${series}` : ''}${b.conflict ? `, ${t('calendar.conflict')}` : ''}${b.meeting.status === 'cancelled' ? `, ${t('calendar.cancelled')}` : ''}`;
  }
  const columns = $derived(`3rem repeat(${days.length}, minmax(0, 1fr))`);
</script>

<div class="timegrid" class:day={single} bind:this={root} data-timegrid={single ? 'day' : 'week'}>
  <div class="head" style:grid-template-columns={columns}>
    <span></span>
    {#each days as day (day)}
      <h4 class:today={day === app.today} data-head={day}>{nameOf(day, single)}</h4>
    {/each}
  </div>

  <div class="allday" style:grid-template-columns={columns} role="group" aria-label={t('calendar.allday')}>
    <span class="rowname">{t('calendar.allday')}</span>
    {#each days as day (day)}
      <ul data-allday={day}>
        {#each allDay.get(day) ?? [] as m (m.id)}
          <li>
            <button
              type="button"
              class="chip meeting"
              class:cancelled={m.status === 'cancelled'}
              class:virtual={m.virtual === true}
              data-meeting={m.id}
              data-series={m.series}
              onclick={() => app.openMeeting(m.id)}
            >
              <span class="sr-only">{t('calendar.kind.meeting')}: </span><span aria-hidden="true">◷</span>
              {#if m.series}<span aria-hidden="true">↻</span><span class="sr-only">{seriesNote(app.lang, m)}: </span>{/if}
              {markHidden(m.title)}
            </button>
          </li>
        {/each}
        {#each (marks.get(day) ?? []).filter((x) => x.kind !== 'span') as mark (`${mark.task.id}:${mark.kind}`)}
          <li>
            <button type="button" class="chip task" data-task={mark.task.id} onclick={() => app.peek(mark.task.id)}>
              <span class="sr-only">{t('calendar.kind.task')}, {t(`calendar.kind.${mark.kind}` as Key)}: </span><span aria-hidden="true">✓</span>
              {markHidden(mark.task.title)}
            </button>
          </li>
        {/each}
      </ul>
    {/each}
  </div>

  <div class="scroll" bind:this={scroller}>
    <div class="body" style:grid-template-columns={columns} style:height="{24 * 2 * SLOT_PX}px">
      <div class="hours" aria-hidden="true">
        {#each HOURS as h (h)}<span style:top="{top(h * 60)}px">{hhmm(h * 60)}</span>{/each}
      </div>
      {#each days as day (day)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="col"
          class:today={day === app.today}
          role="group"
          aria-label={t('calendar.hours', { date: nameOf(day, true) })}
          data-col={day}
          onpointerdown={(e) => sketchDown(e, day)}
          onpointermove={sketchMove}
          onpointerup={sketchUp}
          onpointercancel={sketchUp}
          ondblclick={(e) => sketchDouble(e, day)}
        >
          {#each blocksOnDay(day) as b (b.meeting.id)}
            {@const at = placed(b)}
            {@const link = single ? joinLink(b.meeting.online) : null}
            {#if at}
              <div
                class="block"
                class:conflict={b.conflict}
                class:cancelled={b.meeting.status === 'cancelled'}
                class:virtual={b.meeting.virtual === true}
                class:clipped={b.clipped}
                class:dragging={drag?.id === b.meeting.id && drag.moved && drag.day !== day}
                style:top="{top(at.start)}px"
                style:height="{Math.max(top(at.end - at.start), 12)}px"
                style:left="calc({(b.col / b.cols) * 100}% + 1px)"
                style:width="calc({100 / b.cols}% - 3px)"
                data-meeting={b.meeting.id}
                data-series={b.meeting.series}
              >
                <button
                  type="button"
                  class="open"
                  aria-label={label(b)}
                  title={label(b)}
                  onclick={() => open(b.meeting)}
                  onkeydown={(e) => key(e, b)}
                  onpointerdown={(e) => down(e, b, 'move')}
                  onpointermove={(e) => move(e, b)}
                  onpointerup={(e) => void up(e, b)}
                  onpointercancel={(e) => void up(e, b)}
                >
                  <span class="time" aria-hidden="true">◷ {hhmm(at.start)}{#if b.meeting.series} ↻{/if}{#if b.conflict}<span class="warn" data-conflict> ⚠</span>{/if}</span>
                  <span class="title" aria-hidden="true"><MeetingThumb {app} meeting={b.meeting} size={14} /> {markHidden(b.meeting.title)}</span>
                  {#if single}
                    <span class="more" aria-hidden="true">
                      {#if b.meeting.location}<span>⌖ {b.meeting.location}</span>{/if}
                      {#if b.meeting.online}<span>⧉ {b.meeting.online_service ? t(`meeting.service.${b.meeting.online_service}` as Key) : ''}</span>{/if}
                      {#if (b.meeting.participants?.total ?? 0) > 0}<span>{t('calendar.people', { n: b.meeting.participants.total })}</span>{/if}
                    </span>
                  {:else if placeSign(b.meeting) !== ''}
                    <span class="more" aria-hidden="true">{placeSign(b.meeting)}</span>
                  {/if}
                </button>
                {#if link}<a class="join" href={link} target="_blank" rel="noopener noreferrer">{t('calendar.join')}</a>{/if}
                {#if canMove && !b.clipped}
                  <span
                    class="edge"
                    role="presentation"
                    data-resize={b.meeting.id}
                    title={t('calendar.resize', { title: b.meeting.title })}
                    onpointerdown={(e) => down(e, b, 'resize')}
                    onpointermove={(e) => move(e, b)}
                    onpointerup={(e) => void up(e, b)}
                    onpointercancel={(e) => void up(e, b)}
                  ></span>
                {/if}
              </div>
            {/if}
          {/each}
          {#if drag !== null && drag.moved && drag.day === day && !blocksOnDay(day).some((b) => b.meeting.id === drag?.id)}
            {@const ghost = drag}
            <div class="block dragging" style:top="{top(ghost.start)}px" style:height="{top(ghost.end - ghost.start)}px" style:left="1px" style:width="calc(100% - 3px)" aria-hidden="true"></div>
          {/if}
          {#if sketch !== null && sketch.day === day && sketched !== null}
            <div class="sketch" style:top="{top(sketched.start)}px" style:height="{top(sketched.length)}px" aria-hidden="true"></div>
          {/if}
          {#if day === now.day}<span class="now" style:top="{top(now.minutes)}px" data-now title={t('calendar.now')}></span>{/if}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .timegrid {
    display: flex;
    flex-direction: column;
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  .head,
  .allday,
  .body {
    display: grid;
  }
  .head h4 {
    margin: 0;
    padding: 0.25rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--muted);
    border-left: 1px solid var(--line);
  }
  .head h4.today {
    color: var(--accent);
  }
  .allday {
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    min-height: 1.6rem;
  }
  .rowname {
    font-size: 0.7rem;
    color: var(--muted);
    padding: 0.2rem;
  }
  .allday ul {
    list-style: none;
    margin: 0;
    padding: 0.1rem 0.15rem;
    border-left: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }
  .chip {
    width: 100%;
    text-align: left;
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0.05rem 0.3rem;
    font-size: 0.78rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
  .chip.meeting {
    border-color: var(--accent);
  }
  .chip.task {
    border-style: dashed;
  }
  .cancelled {
    text-decoration: line-through;
  }
  /* An occurrence of a series without a file: computed, nothing entered yet. */
  .chip.virtual,
  .block.virtual {
    border-style: dotted;
  }
  .scroll {
    overflow-y: auto;
    height: calc(26 * 24px);
    max-height: 70vh;
    position: relative;
  }
  .body {
    position: relative;
  }
  .hours {
    position: relative;
  }
  .hours span {
    position: absolute;
    right: 0.3rem;
    transform: translateY(-0.5em);
    font-size: 0.7rem;
    color: var(--muted);
  }
  .hours span:first-child {
    transform: none;
  }
  .col {
    position: relative;
    border-left: 1px solid var(--line);
    background-image: repeating-linear-gradient(to bottom, transparent 0, transparent 23px, var(--line) 23px, var(--line) 24px);
    background-size: 100% 48px;
    touch-action: pan-y;
  }
  .col.today {
    background-color: color-mix(in srgb, var(--accent) 5%, transparent);
  }
  .block {
    position: absolute;
    border: 1px solid var(--accent);
    border-left-width: 4px;
    border-radius: var(--radius);
    background: var(--surface-2);
    overflow: hidden;
    z-index: 1;
  }
  .block.conflict {
    border-style: solid dashed solid solid;
    border-color: var(--warn);
  }
  .block.dragging {
    opacity: 0.6;
    outline: 2px dashed var(--accent);
    z-index: 3;
    background: var(--surface-2);
  }
  .open {
    all: unset;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    padding: 0.05rem 0.25rem;
    font-size: 0.75rem;
    line-height: 1.2;
    color: var(--text);
    cursor: grab;
    touch-action: none;
  }
  .block.clipped .open {
    cursor: pointer;
  }
  .open:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: -2px;
  }
  .time {
    color: var(--muted);
  }
  .warn {
    color: var(--warn);
  }
  .title {
    font-weight: 600;
    overflow: hidden;
  }
  .more {
    display: flex;
    flex-wrap: wrap;
    gap: 0 0.6rem;
    color: var(--muted);
    overflow: hidden;
  }
  .join {
    position: absolute;
    right: 0.2rem;
    bottom: 0.2rem;
    font-size: 0.75rem;
    color: var(--accent);
  }
  .edge {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 6px;
    cursor: ns-resize;
    touch-action: none;
  }
  .sketch {
    position: absolute;
    left: 1px;
    right: 1px;
    background: color-mix(in srgb, var(--accent) 25%, transparent);
    border: 1px dashed var(--accent);
    pointer-events: none;
    z-index: 2;
  }
  .now {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 2px solid var(--accent);
    z-index: 2;
    pointer-events: none;
  }
  .now::before {
    content: '';
    position: absolute;
    left: -4px;
    top: -5px;
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--accent);
  }
  .day .block .open {
    font-size: 0.85rem;
  }
</style>
