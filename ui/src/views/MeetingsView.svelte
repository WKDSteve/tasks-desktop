<script lang="ts">
  // All meetings: the coming ones (today, this week, later), the series and the past ones (a past meeting with no
  // minutes and no result is marked), with a search and the filters area, tag, participants and online. The engine
  // reads the meetings (`meetingsIn`); the parts and the filter are `lib/meetingList.ts`. A row opens the meeting
  // page, `n` makes a new meeting. The words are the chunk's (lib/meetingsTexts.ts).
  import type { App } from '../lib/app.svelte';
  import { addDays } from '../lib/calendar';
  import type { MeetingEntry } from '../lib/contract';
  import { translate, type Key } from '../lib/i18n';
  import { chordWatch } from '../lib/keymap';
  import {
    AHEAD_DAYS,
    BACK_DAYS,
    choicesOf,
    dayOf,
    filterList,
    NO_LIST_FILTER,
    partsOf,
    wantsFollowUp,
    type MeetingListFilter,
  } from '../lib/meetingList';
  import { isMeetingsKey, meetingsText, type MeetingsKey } from '../lib/meetingsTexts';
  import { placeSign } from '../lib/timeGrid';
  import Info from 'appkit-ui/Info.svelte';
  import { markHidden } from '../lib/text';

  let { app }: { app: App } = $props();
  const t = (key: Key | MeetingsKey, params: Record<string, string | number> = {}) =>
    isMeetingsKey(key) ? meetingsText(app.lang, key, params) : translate(app.lang, key, params);

  let found = $state<MeetingEntry[]>([]);
  let total = $state(0);
  let phase = $state<'loading' | 'ready' | 'failed'>('loading');
  let filter = $state<MeetingListFilter>({ ...NO_LIST_FILTER });

  // The window: the last days and a year ahead. Read again when a write or a new snapshot came.
  $effect(() => {
    void app.writes;
    void app.snapshot?.rev;
    if (!app.canMeetings) {
      found = [];
      phase = 'ready';
      return;
    }
    const abort = new AbortController();
    const today = app.today;
    Promise.all([
      app.meetingsIn(addDays(today, -BACK_DAYS), addDays(today, -1), abort.signal),
      app.meetingsIn(today, addDays(today, AHEAD_DAYS), abort.signal),
    ])
      .then(([back, ahead]) => {
        if (abort.signal.aborted) return;
        found = [...back.items, ...ahead.items];
        total = back.total + ahead.total;
        phase = 'ready';
      })
      .catch(() => {
        if (abort.signal.aborted) return;
        phase = 'failed';
      });
    return () => abort.abort();
  });

  const choices = $derived(choicesOf(found));
  const shown = $derived(filterList(found, filter));
  const parts = $derived(partsOf(shown, app.today));

  const dayFormat = $derived(new Intl.DateTimeFormat(app.lang, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }));
  const say = (day: string): string => dayFormat.format(new Date(`${day}T00:00:00Z`));
  const when = (m: MeetingEntry): string => `${say(dayOf(m))}, ${m.all_day || m.time === undefined ? t('meetings.all_day') : m.time}`;

  const canNew = $derived(app.canMakeMeetings && !app.locked);
  const ofChord = chordWatch();
  function onKey(event: KeyboardEvent): void {
    if (ofChord(event) || event.defaultPrevented) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target === null || target.closest('input, select, textarea, [contenteditable="true"]') !== null) return;
    if (event.key.toLowerCase() === 'n' && canNew) {
      event.preventDefault();
      app.openMeetingForm({ date: app.today });
    }
  }
</script>

{#snippet row(m: MeetingEntry, past: boolean)}
  <li>
    <button type="button" class="meeting" class:cancelled={m.status === 'cancelled'} data-meeting={m.id} onclick={() => app.openMeeting(m.id)}>
      <span class="when">{when(m)}</span>
      <span class="title">{markHidden(m.title)}</span>
      {#if placeSign(m) !== ''}<span class="sign" aria-hidden="true">{placeSign(m)}</span>{/if}
      <span class="area">{m.area}</span>
      {#if m.status === 'cancelled'}<span class="note">{t('meetings.cancelled')}</span>{/if}
      {#if past && wantsFollowUp(m)}<span class="mark" data-followup>{t('meetings.followup')}</span>{/if}
    </button>
  </li>
{/snippet}

{#snippet part(id: string, title: string, list: MeetingEntry[], past: boolean)}
  <section class="part" aria-labelledby="meetings-{id}" data-part={id}>
    <h3 id="meetings-{id}">{title} <span class="count">{list.length}</span></h3>
    {#if list.length === 0}
      <p class="none">{t('meetings.empty_part')}</p>
    {:else}
      <ul>
        {#each list as m (m.id)}{@render row(m, past)}{/each}
      </ul>
    {/if}
  </section>
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class="meetings" aria-label={t('nav.meetings')} onkeydown={onKey}>
  <header class="head">
    <h2>{t('meetings.title')}</h2>
    <Info hint={t('meetings.intro')} label={t('hint.about', { what: t('nav.meetings') })} />
    {#if canNew}
      <button type="button" data-meetings-new data-hint={t('hint.item.menu.meeting')} onclick={() => app.openMeetingForm({ date: app.today })}>
        {t('meetings.new')}
      </button>
    {/if}
  </header>

  <div class="bar" role="group" aria-label={t('meetings.filters')}>
    <label class="field" data-hint={t('meetings.search.hint')}>
      <span>{t('meetings.search')}</span>
      <input type="search" bind:value={filter.text} data-meetings-search />
    </label>
    <label class="field" data-hint={t('meetings.area.hint')}>
      <span>{t('meetings.area')}</span>
      <select bind:value={filter.area} data-meetings-area>
        <option value="">{t('meetings.area.all')}</option>
        {#each choices.areas as area (area)}<option value={area}>{area}</option>{/each}
      </select>
    </label>
    <label class="field" data-hint={t('meetings.tag.hint')}>
      <span>{t('meetings.tag')}</span>
      <select bind:value={filter.tag} data-meetings-tag>
        <option value="">{t('meetings.tag.all')}</option>
        {#each choices.tags as tag (tag)}<option value={tag}>{tag}</option>{/each}
      </select>
    </label>
    <label class="field" data-hint={t('hint.form.calendar.people')}>
      <span>{t('meetings.people')}</span>
      <select bind:value={filter.people} data-meetings-people>
        <option value="any">{t('calendar.filter.people.any')}</option>
        <option value="with">{t('calendar.filter.people.with')}</option>
        <option value="without">{t('calendar.filter.people.without')}</option>
      </select>
    </label>
    <label class="field check" data-hint={t('meetings.online.hint')}>
      <input
        type="checkbox"
        checked={filter.place === 'online'}
        onchange={(e) => (filter.place = e.currentTarget.checked ? 'online' : 'all')}
        data-meetings-online
      />
      <span>{t('meetings.online')}</span>
    </label>
  </div>

  {#if phase === 'loading'}
    <p class="none" role="status">{t('meetings.loading')}</p>
  {:else if phase === 'failed'}
    <p class="none" role="alert">{t('meetings.failed')}</p>
  {:else if found.length === 0}
    <p class="none">{t('meetings.none')}</p>
  {:else if shown.length === 0}
    <p class="none" data-meetings-empty>{t('meetings.none_filtered')}</p>
  {:else}
    {#if total > found.length}<p class="note" data-meetings-cut>{t('meetings.cut', { n: found.length, total })}</p>{/if}
    {@render part('today', t('meetings.sec.today'), parts.today, false)}
    {@render part('week', t('meetings.sec.week'), parts.week, false)}
    {@render part('later', t('meetings.sec.later'), parts.later, false)}
    {#if parts.series.length > 0}
      <section class="part" aria-labelledby="meetings-series" data-part="series">
        <h3 id="meetings-series">{t('meetings.sec.series')} <span class="count">{parts.series.length}</span></h3>
        <ul>
          {#each parts.series as s (s.series)}
            <li>
              <button type="button" class="meeting" data-series={s.series} onclick={() => app.openMeeting(s.next.id)}>
                <span class="title">{markHidden(s.title)}</span>
                <span class="when">{t('meetings.series_count', { n: s.count, date: say(dayOf(s.next)) })}</span>
                <span class="area">{s.next.area}</span>
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
    {@render part('past', t('meetings.sec.past', { n: BACK_DAYS }), parts.past, true)}
  {/if}
</section>

<style>
  .meetings {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 0;
  }
  .head,
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.8rem;
  }
  h2,
  h3 {
    margin: 0;
  }
  h3 {
    font-size: 0.95rem;
    margin-top: 0.4rem;
  }
  .count {
    color: var(--muted);
    font-weight: normal;
  }
  .field {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  button,
  input[type='search'],
  select {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0.25rem 0.6rem;
  }
  button {
    cursor: pointer;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  button.meeting {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.2rem 0.8rem;
    width: 100%;
    text-align: left;
    background: transparent;
    border: 0;
    border-bottom: 1px solid var(--line);
    border-radius: 0;
    padding: 0.3rem 0.5rem;
  }
  button.meeting:hover {
    background: var(--surface-2);
  }
  button.cancelled .title {
    text-decoration: line-through;
    color: var(--muted);
  }
  .when {
    min-width: 9rem;
    color: var(--muted);
  }
  .title {
    flex: 1 1 12rem;
  }
  .area,
  .none,
  .note {
    color: var(--muted);
    font-size: 0.85rem;
    margin: 0;
  }
  .mark {
    padding: 0 0.35rem;
    border: 1px solid var(--warn);
    border-radius: var(--radius);
    font-size: 0.8rem;
  }
</style>
