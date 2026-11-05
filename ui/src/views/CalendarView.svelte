<script lang="ts">
  // The calendar: the open tasks on their days, a month or a week (see `lib/calendar.ts`). A task stands on its due
  // day; with a start date also on the days from start to due. Dragging a task onto a day sets its due date, dragging
  // it to the list of the tasks without a date takes the date away; both go through the engine (`App.dropOnDay`), which
  // judges them. The detail sets the dates without dragging, so the drag is not the only way. Overdue is shown as the
  // list shows it (`isOverdue`); the page works out nothing more than where a task stands.
  import type { App } from '../lib/app.svelte';
  import {
    CALENDAR_MODES,
    daysOf,
    marksByDay,
    parseDate,
    sameMonth,
    startOfWeek,
    step,
    undated,
    type CalendarMode,
  } from '../lib/calendar';
  import { isOverdue } from '../lib/remind';
  import { translate, type Key } from '../lib/i18n';
  import Info from 'appkit-ui/Info.svelte';
  import { markHidden } from '../lib/text';
  import FilterNote from './FilterNote.svelte';

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

  const format = $derived(new Intl.DateTimeFormat(app.lang, { month: 'long', year: 'numeric', timeZone: 'UTC' }));
  const weekday = $derived(new Intl.DateTimeFormat(app.lang, { weekday: 'short', timeZone: 'UTC' }));
  const dayFormat = $derived(new Intl.DateTimeFormat(app.lang, { day: 'numeric', month: 'short', timeZone: 'UTC' }));
  const heading = $derived.by(() => {
    if (mode === 'month') return format.format(parseDate(anchor) ?? new Date());
    const first = days[0] ?? anchor;
    const last = days[days.length - 1] ?? anchor;
    return `${dayFormat.format(parseDate(first) ?? new Date())} – ${dayFormat.format(parseDate(last) ?? new Date())} ${last.slice(0, 4)}`;
  });
  const weekdays = $derived(days.slice(0, 7).map((d) => weekday.format(parseDate(d) ?? new Date())));
  const weeks = $derived(Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7)));

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
    picked = next === 'week' ? (days.includes(app.today) ? app.today : startOfWeek(anchor)) : anchor;
    opened = null;
  }
  function limitOf(day: string, count: number): number {
    return mode === 'week' || opened === day ? count : CELL_LIMIT;
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
    draggable={m.kind === 'due' && !app.locked}
    data-task={task.id}
    data-kind={m.kind}
    title={task.title}
    ondragstart={(e) => onDragStart(e, task.id)}
    ondragend={onDragEnd}
    onclick={() => app.peek(task.id)}
  >
    <span class="sr-only">{t(`calendar.kind.${m.kind}` as Key)}: </span>
    <span class="chip-title">{markHidden(task.title)}</span>
  </button>
{/snippet}

<section class="calendar" aria-label={t('nav.calendar')}>
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
      <label class="mode">
        <span>{t('calendar.mode')}</span>
        <select value={mode} onchange={(e) => setMode(e.currentTarget.value as CalendarMode)}>
          {#each CALENDAR_MODES as m (m)}<option value={m}>{t(`calendar.mode.${m}` as Key)}</option>{/each}
        </select>
      </label>
    </div>
  </header>

  <div class="layout">
    <table class="grid" class:week={mode === 'week'}>
      <thead>
        <tr>{#each weekdays as name, i (i)}<th scope="col">{name}</th>{/each}</tr>
      </thead>
      <tbody>
        {#each weeks as week, w (w)}
          <tr>
            {#each week as day (day)}
              {@const here = marks.get(day) ?? []}
              <td
                class:today={day === app.today}
                class:dim={mode === 'month' && !sameMonth(day, anchor)}
                class:over={overDay === day && dragging !== null}
                data-day={day}
                aria-label={t('calendar.day', { date: day, n: here.length })}
                ondragover={(e) => onDayOver(e, day)}
                ondrop={(e) => void onDayDrop(e, day)}
              >
                <span class="num" aria-hidden="true">{Number(day.slice(8))}</span>
                <ul>
                  {#each here.slice(0, limitOf(day, here.length)) as m (`${m.task.id}:${m.kind}`)}
                    <li>{@render chip(m)}</li>
                  {/each}
                </ul>
                {#if here.length > limitOf(day, here.length)}
                  <button type="button" class="more" onclick={() => (opened = day)}>
                    {t('calendar.more', { n: here.length - CELL_LIMIT })}
                  </button>
                {/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>

    <aside
      class="loose"
      class:over={overLoose && dragging !== null}
      aria-label={t('calendar.undated')}
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
              <button
                type="button"
                class="chip loose-chip"
                class:selected={app.selectedId === task.id}
                class:dragging={dragging === task.id}
                draggable={!app.locked}
                data-task={task.id}
                title={task.title}
                ondragstart={(e) => onDragStart(e, task.id)}
                ondragend={onDragEnd}
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
  .chip {
    width: 100%;
    text-align: left;
    padding: 0.05rem 0.3rem;
    font-size: 0.8rem;
    border-radius: var(--radius);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
