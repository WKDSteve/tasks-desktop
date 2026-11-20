<script lang="ts">
  // The calendar: the open tasks and the meetings on their days, a month, a week or a day (see `lib/calendar.ts`). Week
  // and day are the hour grid (`TimeGrid.svelte`, loaded when first shown); the month has the meetings as chips before
  // the tasks. A task stands on its due
  // day; with a start date also on the days from start to due. Dragging a task onto a day sets its due date, dragging
  // it to the list of the tasks without a date takes the date away; both go through the engine (`App.dropOnDay`), which
  // judges them. A finger drags by the grip of a task, and the keys do the same without dragging (the arrows go over
  // the days, `m` picks a task up and Enter puts it on the day); the detail sets the dates as well. Overdue is shown
  // as the list shows it (`isOverdue`); the page works out nothing more than where a task stands.
  import type { App } from '../lib/app.svelte';
  import { tick } from 'svelte';
  import {
    CALENDAR_MODES,
    cursorDay,
    dayAfterKey,
    daysOf,
    marksByDay,
    parseDate,
    sameMonth,
    startOfWeek,
    step,
    undated,
    type CalendarMode,
  } from '../lib/calendar';
  import { calendarTargetAt, createGrip, farEnough, type CalendarTarget, type PointerDragEvent } from '../lib/pointerDrag';
  import { isOverdue } from '../lib/remind';
  import { translate, type Key } from '../lib/i18n';
  import { chordWatch } from '../lib/keymap';
  import Info from 'appkit-ui/Info.svelte';
  import { markHidden } from '../lib/text';
  import FilterNote from './FilterNote.svelte';
  import Lazy from './Lazy.svelte';
  import MeetingThumb from './MeetingThumb.svelte';
  import type { MeetingEntry } from '../lib/contract';
  import { filterMeetings, meetingsByDay, NO_FILTER, placeSign, type MeetingFilter } from '../lib/timeGrid';

  let { app }: { app: App } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  const MIME = 'application/x-tasks-calendar';
  // Tasks of a month cell before "+n more" (a week shows them all).
  const CELL_LIMIT = 4;

  let mode = $state<CalendarMode>('month');
  // Any day of the month or week shown; until a step is taken it is today (which moves on with the page).
  let picked = $state<string | null>(null);
  const anchor = $derived(picked ?? app.today);

  const days = $derived(daysOf(mode, anchor));
  const tasks = $derived(app.shown);
  const marks = $derived(marksByDay(tasks, days));
  const loose = $derived(undated(tasks));

  // The meetings of the days on view, as the filters leave them (concept 7.3).
  let showMeetings = $state(true);
  let filter = $state<MeetingFilter>({ ...NO_FILTER });
  let found = $state<MeetingEntry[]>([]);
  $effect(() => {
    void app.writes;
    void app.snapshot?.rev;
    const first = days[0];
    const last = days[days.length - 1];
    if (!app.canMeetings || !showMeetings || first === undefined || last === undefined) {
      found = [];
      return;
    }
    const abort = new AbortController();
    app
      .meetingsIn(first, last, abort.signal)
      .then((items) => {
        if (!abort.signal.aborted) found = items;
      })
      .catch(() => {
        if (!abort.signal.aborted) found = [];
      });
    return () => abort.abort();
  });
  const shownMeetings = $derived(filterMeetings(found, filter));
  const meetingDays = $derived(meetingsByDay(shownMeetings, days));
  const hourly = $derived(mode !== 'month');
  const canNew = $derived(app.canMakeMeetings && !app.locked);

  const format = $derived(new Intl.DateTimeFormat(app.lang, { month: 'long', year: 'numeric', timeZone: 'UTC' }));
  const weekday = $derived(new Intl.DateTimeFormat(app.lang, { weekday: 'short', timeZone: 'UTC' }));
  const dayFormat = $derived(new Intl.DateTimeFormat(app.lang, { day: 'numeric', month: 'short', timeZone: 'UTC' }));
  const heading = $derived.by(() => {
    if (mode === 'month') return format.format(parseDate(anchor) ?? new Date());
    if (mode === 'day') return `${dayFormat.format(parseDate(anchor) ?? new Date())} ${anchor.slice(0, 4)}`;
    const first = days[0] ?? anchor;
    const last = days[days.length - 1] ?? anchor;
    return `${dayFormat.format(parseDate(first) ?? new Date())} – ${dayFormat.format(parseDate(last) ?? new Date())} ${last.slice(0, 4)}`;
  });
  const weekdays = $derived(days.slice(0, 7).map((d) => weekday.format(parseDate(d) ?? new Date())));
  const weeks = $derived(mode === 'month' ? Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7)) : []);

  let dragging = $state<string | null>(null);
  let overDay = $state<string | null>(null);
  let overLoose = $state(false);
  // A cell that shows all of its tasks in a month (the "+n more" opened).
  let opened = $state<string | null>(null);

  function onDragStart(event: DragEvent, id: string): void {
    if (app.saving || app.locked) {
      event.preventDefault();
      return;
    }
    dragging = id;
    event.dataTransfer?.setData(MIME, id);
    event.dataTransfer?.setData('text/plain', id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }
  function onDragEnd(): void {
    dragging = null;
    overDay = null;
    overLoose = false;
  }
  function onDayOver(event: DragEvent, day: string): void {
    if (dragging === null) return;
    event.preventDefault();
    overDay = day;
    overLoose = false;
  }
  function onLooseOver(event: DragEvent): void {
    if (dragging === null) return;
    event.preventDefault();
    overLoose = true;
    overDay = null;
  }
  async function onDayDrop(event: DragEvent, day: string): Promise<void> {
    event.preventDefault();
    const id = dragging;
    onDragEnd();
    if (id !== null) await app.dropOnDay(id, day);
  }
  async function onLooseDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    const id = dragging;
    onDragEnd();
    if (id !== null) await app.dropOnDay(id, null);
  }

  // A finger or a pen drags a task by its grip (HTML5 drag does not start on a touch screen), as on the board: the
  // places count only once the finger has gone a stretch, and the drop goes to the day or the list it moved onto.
  let from = { x: 0, y: 0 };
  let fingerAt: CalendarTarget | null = null;
  const grip = createGrip(
    () => onPointerDrag,
    () => app.locked,
  );
  function onPointerDrag(e: PointerDragEvent): void {
    if (e.phase === 'start') {
      dragging = e.id;
      from = { x: e.x, y: e.y };
      fingerAt = null;
      return;
    }
    if (dragging !== e.id) return;
    if (e.phase === 'move') {
      fingerAt = farEnough(from, e) ? calendarTargetAt(document, e.x, e.y) : null;
      overDay = fingerAt?.kind === 'day' ? fingerAt.day : null;
      overLoose = fingerAt?.kind === 'loose';
      return;
    }
    const target = e.phase === 'end' ? fingerAt : null;
    onDragEnd();
    fingerAt = null;
    if (target !== null) void app.dropOnDay(e.id, target.kind === 'day' ? target.day : null);
  }

  // The keys: one day of the grid takes Tab (the others are reached with the arrows), and a task is moved without
  // dragging: `m` on a task picks it up, the arrows choose the day, Enter puts it there; Shift with an arrow moves
  // the due date of the task under the focus; Delete takes the date away.
  let root = $state<HTMLElement | null>(null);
  let chosen = $state<string | null>(null);
  const cursor = $derived(cursorDay(mode, days, anchor, app.today, chosen));
  // The task picked up with `m`, until it is put down or given up.
  let carried = $state<string | null>(null);
  const carriedTitle = $derived(carried === null ? '' : (app.tasks.find((x) => x.id === carried)?.title ?? carried));

  /** The chip of a task that can be moved: on its due day, or in the list without a date. */
  function movableChip(id: string): HTMLElement | null {
    const chips = root?.querySelectorAll<HTMLElement>('.chip[data-task]') ?? [];
    for (const el of chips) if (el.dataset.task === id && (el.dataset.kind ?? 'due') === 'due') return el;
    return null;
  }
  /** The cursor goes to `day` (the grid follows to its month or week) and the day takes the focus. */
  async function focusDay(day: string): Promise<void> {
    chosen = day;
    if (!days.includes(day)) {
      picked = day;
      opened = null;
    }
    await tick();
    root?.querySelector<HTMLElement>(`td[data-day="${day}"]`)?.focus();
  }
  /**
   * After a write the task is found again where it stands now. Where it cannot take the focus (hidden behind
   * "+n more", only a start left, a write the engine refused that took it out of the grid) the day `fallback` does:
   * the focus is never left on nothing.
   */
  async function focusTask(id: string, fallback: string = cursor): Promise<void> {
    await tick();
    const chip = movableChip(id);
    if (chip) chip.focus();
    else await focusDay(days.includes(fallback) ? fallback : cursor);
  }
  /** The due date of `id` goes to `day` (null: away). The cursor and the grid follow only a date that was written. */
  async function moveDue(id: string, day: string | null, from: string): Promise<void> {
    await app.dropOnDay(id, day);
    const now = app.tasks.find((x) => x.id === id)?.due ?? null;
    if (day !== null && now === day) {
      chosen = day;
      if (!days.includes(day)) {
        picked = day;
        opened = null;
      }
    }
    await focusTask(id, day !== null && now === day ? day : from);
  }
  function pickUp(id: string): void {
    if (app.locked) return;
    carried = id;
    void focusDay(cursor);
  }
  async function putDown(day: string | null): Promise<void> {
    const id = carried;
    carried = null;
    if (id === null) return;
    await app.dropOnDay(id, day);
    await focusTask(id);
  }
  function giveUp(): void {
    const id = carried;
    carried = null;
    if (id !== null) void focusTask(id);
  }
  /** The key as the handlers read it: a letter in lower case (CapsLock turns a plain m into 'M'). */
  const keyOf = (event: KeyboardEvent): string => (event.key.length === 1 ? event.key.toLowerCase() : event.key);
  /** The task whose movable chip has the focus. */
  function taskUnder(target: EventTarget | null): string | null {
    const el = target instanceof HTMLElement ? target.closest<HTMLElement>('.chip[data-task]') : null;
    return el && (el.dataset.kind ?? 'due') === 'due' ? (el.dataset.task ?? null) : null;
  }
  // `g h` and `g l` are the page's (Today, the list): the letters after a `g` are not taken as steps over the days.
  const ofChord = chordWatch();
  function onGridKey(event: KeyboardEvent): void {
    if (ofChord(event)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const day = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('td[data-day]')?.dataset.day : undefined;
    if (day === undefined) return;
    const key = keyOf(event);
    const id = taskUnder(event.target);
    const next = dayAfterKey(mode, day, key);
    if (next !== null) {
      if (event.shiftKey) {
        // Shift moves the due date of the task under the focus, not the cursor.
        if (id === null || carried !== null) return;
        event.preventDefault();
        if (event.repeat) return;
        void moveDue(id, next, day);
        return;
      }
      event.preventDefault();
      void focusDay(next);
      return;
    }
    if (event.shiftKey) return;
    if (carried !== null) {
      if (key === 'Enter' || key === ' ') {
        event.preventDefault();
        if (!event.repeat) void putDown(day);
      } else if (key === 'Delete' || key === 'Backspace') {
        event.preventDefault();
        if (!event.repeat) void putDown(null);
      } else if (key === 'Escape') {
        event.preventDefault();
        giveUp();
      }
      return;
    }
    if (id === null || event.repeat) return;
    if (key === 'm') {
      event.preventDefault();
      chosen = day;
      pickUp(id);
    } else if (key === 'Delete' || key === 'Backspace') {
      event.preventDefault();
      void moveDue(id, null, day);
    }
  }
  function onLooseKey(event: KeyboardEvent): void {
    if (ofChord(event)) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const key = keyOf(event);
    if (carried !== null) {
      if (key === 'Escape') {
        event.preventDefault();
        giveUp();
      }
      return;
    }
    const id = taskUnder(event.target);
    if (id !== null && key === 'm' && !event.repeat) {
      event.preventDefault();
      pickUp(id);
    }
  }

  function go(direction: 1 | -1): void {
    picked = step(mode, anchor, direction);
    opened = null;
  }
  function toToday(): void {
    picked = null;
    opened = null;
  }
  function setMode(next: CalendarMode): void {
    // The week that holds the day on view; the month of the week's Monday when going back.
    mode = next;
    picked = next === 'month' ? anchor : days.includes(app.today) ? app.today : next === 'week' ? startOfWeek(anchor) : anchor;
    opened = null;
  }
  /** m, w and d switch the view, n makes a meeting; not in a field, not on a task chip (there `m` picks the task up). */
  const ofRootChord = chordWatch();
  function onRootKey(event: KeyboardEvent): void {
    if (ofRootChord(event) || event.defaultPrevented) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat || carried !== null) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target === null || target.closest('input, select, textarea, [contenteditable="true"], .block, .chip[data-task]') !== null) return;
    const key = keyOf(event);
    const next = key === 'm' ? 'month' : key === 'w' ? 'week' : key === 'd' ? 'day' : null;
    if (next !== null) {
      event.preventDefault();
      if (next !== mode) setMode(next);
    } else if (key === 'n' && canNew) {
      event.preventDefault();
      app.openMeetingForm({ date: mode === 'month' ? (chosen ?? app.today) : anchor });
    }
  }
  function limitOf(day: string, count: number): number {
    return opened === day ? count : CELL_LIMIT;
  }
</script>

{#snippet chip(m: { task: (typeof tasks)[number]; kind: 'due' | 'start' | 'span' })}
  {@const task = m.task}
  <button
    type="button"
    class="chip {m.kind}"
    class:overdue={m.kind === 'due' && task.status !== 'parked' && isOverdue(task.due, app.today)}
    class:selected={app.selectedId === task.id}
    class:dragging={dragging === task.id}
    class:carried={carried === task.id}
    draggable={m.kind === 'due' && !app.locked}
    data-task={task.id}
    data-kind={m.kind}
    title={task.title}
    ondragstart={(e) => onDragStart(e, task.id)}
    ondragend={onDragEnd}
    onclick={() => app.peek(task.id)}
  >
    <span class="sr-only">{t(`calendar.kind.${m.kind}` as Key)}: </span>
    <span aria-hidden="true">✓</span>
    <span class="chip-title">{markHidden(task.title)}</span>
  </button>
{/snippet}

<!-- A finger drags by this grip (the keys and a screen reader have `m` and the arrows). -->
{#snippet handle(id: string)}
  <span
    class="grip"
    data-hint={t('hint.ui.calendar.grip')}
    role="presentation"
    aria-hidden="true"
    onpointerdown={(e) => grip(e, id, 'start')}
    onpointermove={(e) => grip(e, id, 'move')}
    onpointerup={(e) => grip(e, id, 'end')}
    onpointercancel={(e) => grip(e, id, 'cancel')}>⠿</span
  >
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class="calendar" aria-label={t('nav.calendar')} bind:this={root} onkeydown={onRootKey}>
  <FilterNote {app} />
  <header class="intro">
    <div class="head">
      <h2>{t('calendar.title')}</h2>
      <Info hint={t('calendar.intro')} label={t('hint.about', { what: t('nav.calendar') })} />
    </div>
    <div class="bar">
      <div class="nav" role="group" aria-label={heading}>
        <button type="button" onclick={() => go(-1)}>‹ {t('calendar.prev')}</button>
        <button type="button" onclick={toToday}>{t('calendar.today')}</button>
        <button type="button" onclick={() => go(1)}>{t('calendar.next')} ›</button>
      </div>
      <h3 class="when" aria-live="polite" data-calendar-heading>{heading}</h3>
      <label class="mode" data-hint={t('hint.form.calendar.mode')}>
        <span>{t('calendar.mode')}</span>
        <select value={mode} onchange={(e) => setMode(e.currentTarget.value as CalendarMode)}>
          {#each CALENDAR_MODES as m (m)}<option value={m}>{t(`calendar.mode.${m}` as Key)}</option>{/each}
        </select>
      </label>
    </div>
    {#if app.canMeetings}
      <div class="bar filters" role="group" aria-label={t('calendar.meetings')}>
        <label class="mode" data-hint={t('hint.form.calendar.meetings')}>
          <input type="checkbox" bind:checked={showMeetings} data-calendar-meetings />
          <span>{t('calendar.meetings')}</span>
        </label>
        <label class="mode" data-hint={t('hint.form.calendar.place')}>
          <span>{t('calendar.filter.place')}</span>
          <select bind:value={filter.place} disabled={!showMeetings} data-calendar-place>
            <option value="all">{t('calendar.filter.place.all')}</option>
            <option value="online">{t('calendar.filter.place.online')}</option>
            <option value="in_person">{t('calendar.filter.place.in_person')}</option>
            {#each ['teams', 'zoom', 'meet', 'webex', 'jitsi'] as service (service)}
              <option value={service}>{t(`meeting.service.${service}` as Key)}</option>
            {/each}
          </select>
        </label>
        <label class="mode" data-hint={t('hint.form.calendar.people')}>
          <span>{t('calendar.filter.people')}</span>
          <select bind:value={filter.people} disabled={!showMeetings} data-calendar-people>
            <option value="any">{t('calendar.filter.people.any')}</option>
            <option value="with">{t('calendar.filter.people.with')}</option>
            <option value="without">{t('calendar.filter.people.without')}</option>
          </select>
        </label>
        {#if canNew}
          <button type="button" data-calendar-new onclick={() => app.openMeetingForm({ date: mode === 'month' ? (chosen ?? app.today) : anchor })}>
            {t('calendar.new_meeting')}
          </button>
        {/if}
      </div>
    {/if}
    <p class="help">{hourly ? t('calendar.grid_help') : t('calendar.help')}</p>
    <!-- Always in the page, so that a screen reader hears it fill. -->
    <p class="carry" role="status" data-calendar-carry>
      {#if carried !== null}
        <span>{t('calendar.carry', { title: carriedTitle })}</span>
        <button type="button" onclick={giveUp}>{t('calendar.carry_stop')}</button>
      {/if}
    </p>
  </header>

  <div class="layout">
    {#if hourly}
      <Lazy {app} load={() => import('./TimeGrid.svelte')} extra={{ days, meetings: shownMeetings, marks }} />
    {:else}
      <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
      <table class="grid" class:week={mode === 'week'} role="grid" aria-label={heading} onkeydown={onGridKey}>
        <thead>
          <tr>{#each weekdays as name, i (i)}<th scope="col">{name}</th>{/each}</tr>
        </thead>
        <tbody>
          {#each weeks as week, w (w)}
            <tr>
              {#each week as day (day)}
                {@const here = marks.get(day) ?? []}
                {@const ms = meetingDays.get(day) ?? []}
                {@const cap = limitOf(day, ms.length + here.length)}
                <td
                  role="gridcell"
                  tabindex={day === cursor ? 0 : -1}
                  class:today={day === app.today}
                  class:dim={mode === 'month' && !sameMonth(day, anchor)}
                  class:over={(overDay === day && dragging !== null) || (carried !== null && day === cursor)}
                  data-day={day}
                  aria-label={t('calendar.day', { date: day, n: here.length })}
                  ondblclick={(e) => canNew && e.target === e.currentTarget && app.openMeetingForm({ date: day })}
                  ondragover={(e) => onDayOver(e, day)}
                  ondrop={(e) => void onDayDrop(e, day)}
                >
                  <span class="num" aria-hidden="true">{Number(day.slice(8))}</span>
                  <ul>
                    {#each ms.slice(0, cap) as m (m.id)}
                      <li>
                        <button
                          type="button"
                          class="chip meeting"
                          class:cancelled={m.status === 'cancelled'}
                          data-meeting={m.id}
                          title={m.title}
                          onclick={() => app.openMeeting(m.id)}
                        >
                          <span class="sr-only">{t('calendar.kind.meeting')}: </span>
                          <span aria-hidden="true">◷</span>
                          {#if !m.all_day && m.time}<span class="at">{m.time}</span>{/if}
                          {#if placeSign(m) !== ''}<span aria-hidden="true">{placeSign(m)}</span>{/if}
                          <MeetingThumb {app} meeting={m} size={16} />
                          <span class="chip-title">{markHidden(m.title)}</span>
                        </button>
                      </li>
                    {/each}
                    {#each here.slice(0, Math.max(0, cap - ms.length)) as m (`${m.task.id}:${m.kind}`)}
                      <li>
                        {#if m.kind === 'due' && !app.locked}{@render handle(m.task.id)}{/if}
                        {@render chip(m)}
                      </li>
                    {/each}
                  </ul>
                  {#if ms.length + here.length > cap}
                    <button type="button" class="more" onclick={() => (opened = day)}>
                      {t('calendar.more', { n: ms.length + here.length - cap })}
                    </button>
                  {/if}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}

    <aside
      class="loose"
      class:over={overLoose && dragging !== null}
      aria-label={t('calendar.undated')}
      data-loose
      ondragover={onLooseOver}
      ondrop={(e) => void onLooseDrop(e)}
    >
      <h3>{t('calendar.undated')} <small>({loose.length})</small></h3>
      {#if dragging !== null}<p class="drop">{t('calendar.undated_drop')}</p>{/if}
      {#if loose.length === 0}
        <p class="none">{t('calendar.undated_none')}</p>
      {:else}
        <ul>
          {#each loose.slice(0, 200) as task (task.id)}
            <li>
              {#if !app.locked}{@render handle(task.id)}{/if}
              <button
                type="button"
                class="chip loose-chip"
                class:selected={app.selectedId === task.id}
                class:dragging={dragging === task.id}
                class:carried={carried === task.id}
                draggable={!app.locked}
                data-task={task.id}
                title={task.title}
                ondragstart={(e) => onDragStart(e, task.id)}
                ondragend={onDragEnd}
                onkeydown={onLooseKey}
                onclick={() => app.peek(task.id)}
              >
                <span class="chip-title">{markHidden(task.title)}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </aside>
  </div>
</section>

<style>
  .calendar {
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
  h2,
  h3 {
    margin: 0;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem 1rem;
    margin-top: 0.4rem;
  }
  .nav {
    display: flex;
    gap: 0.3rem;
  }
  .when {
    font-size: 1.05rem;
    min-width: 11rem;
  }
  .mode {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-left: auto;
  }
  button,
  select {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0.25rem 0.6rem;
    cursor: pointer;
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 14rem;
    gap: 0.8rem;
    align-items: start;
  }
  .grid {
    border-collapse: collapse;
    table-layout: fixed;
    width: 100%;
  }
  th {
    font-weight: 600;
    color: var(--muted);
    text-align: left;
    padding: 0.2rem 0.3rem;
  }
  td {
    border: 1px solid var(--line);
    vertical-align: top;
    height: 6.2rem;
    padding: 0.15rem 0.25rem;
    min-width: 0;
  }
  .week td {
    height: 18rem;
  }
  td.dim {
    background: var(--surface);
    color: var(--muted);
  }
  td.today .num {
    background: var(--accent);
    color: var(--accent-text);
    border-radius: 999px;
    padding: 0 0.35rem;
  }
  td.over,
  .loose.over {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .num {
    display: inline-block;
    font-size: 0.8rem;
    margin-bottom: 0.1rem;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.12rem;
  }
  li {
    display: flex;
    align-items: center;
    gap: 0.1rem;
    min-width: 0;
  }
  .grip {
    flex: none;
    min-width: 1.1rem;
    text-align: center;
    cursor: grab;
    color: var(--muted);
    font-size: 0.8rem;
    touch-action: none;
    user-select: none;
  }
  td:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: -2px;
  }
  .help,
  .carry {
    color: var(--muted);
    font-size: 0.85rem;
    margin: 0.3rem 0 0;
  }
  .carry {
    color: var(--text);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  .carry:empty {
    display: none;
  }
  .chip.carried {
    outline: 2px dashed var(--accent);
  }
  .chip {
    flex: 1;
    min-width: 0;
    width: 100%;
    text-align: left;
    padding: 0.05rem 0.3rem;
    font-size: 0.8rem;
    border-radius: var(--radius);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip.meeting {
    border-color: var(--accent);
    display: flex;
    align-items: center;
    gap: 0.2rem;
  }
  .chip.meeting .chip-title {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chip.cancelled {
    text-decoration: line-through;
  }
  .at {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .filters {
    margin-top: 0.2rem;
  }
  .chip.due {
    border-color: var(--accent);
  }
  .chip.start {
    border-style: dashed;
  }
  .chip.span {
    background: var(--surface);
    color: var(--muted);
    border-style: dotted;
  }
  .chip.overdue {
    color: var(--warn);
    border-color: var(--warn);
  }
  .chip.selected {
    outline: 2px solid var(--focus);
  }
  .chip.dragging {
    opacity: 0.5;
  }
  .chip[draggable='true'] {
    cursor: grab;
  }
  .more {
    border: 0;
    background: none;
    color: var(--accent);
    padding: 0;
    font-size: 0.8rem;
  }
  .loose {
    border: 1px dashed var(--line);
    border-radius: var(--radius);
    padding: 0.4rem;
    max-height: 70vh;
    overflow: auto;
  }
  .loose h3 {
    font-size: 0.95rem;
  }
  .none,
  .drop {
    color: var(--muted);
    font-size: 0.85rem;
    margin: 0.3rem 0;
  }
  @media (max-width: 52rem) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
