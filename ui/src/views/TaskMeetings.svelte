<script lang="ts">
  // The meetings of a task in its detail (concept 7.1): the coming ones (the next first) and the past ones (the last
  // first), each with its time, the service of its address and its status, a click opens its page; and "New meeting"
  // with the task filled in. Which meetings a task has is the engine's (`meetings` of the task entry, from `tasks:` of
  // the meeting files); the entries are read with `meetings?task=` when the task names some.
  import type { App } from '../lib/app.svelte';
  import type { MeetingEntry, TaskEntry } from '../lib/contract';
  import { translate, type Key } from '../lib/i18n';
  import { MEETING_PAGES, splitMeetings, whenText } from '../lib/meetings';
  import { addDays } from '../lib/calendar';
  import { foldSeries, joinPages, seriesNote } from '../lib/series';
  import { markHidden } from '../lib/text';

  let { app, task }: { app: App; task: TaskEntry } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  let items = $state<MeetingEntry[] | null>(null);
  let failed = $state(false);
  const named = $derived(task.meetings ?? []);
  const key = $derived(`${task.id}\u0000${named.join(',')}`);
  // A series names the task in each of its occurrences: the list keeps those with a file and the next one of each series.
  const split = $derived(items ? splitMeetings(foldSeries(items, app.nowMs()), app.nowMs()) : { coming: [], past: [] });

  // The task the list was read for: another task (the detail switched) shows nothing of the one before while its own
  // meetings are read; a reread of the same task keeps its list until the new one is there.
  let readFor = '';

  /**
   * The meetings of task `id`, the earliest first. More than a page is a series of many weeks: its pages are read on
   * (at most `MEETING_PAGES`), so that a past occurrence with a file between the first page and today is listed too.
   * The engine lists at most 500 occurrences of a series in a window, counted from its start: a series longer than that
   * fills the pages from 1900 with past ones. Its coming occurrences are therefore read from yesterday on whenever there
   * was more than one page.
   */
  async function readAll(id: string, signal: AbortSignal): Promise<MeetingEntry[]> {
    const items: MeetingEntry[] = [];
    let offset: number | undefined = 0;
    for (let page = 0; page < MEETING_PAGES && offset !== undefined; page += 1) {
      const doc = await app.meetingsOfTask(id, signal, undefined, offset);
      items.push(...doc.items);
      offset = doc.next_offset;
      if (page === 0 && offset === undefined) return items;
    }
    const later = await app.meetingsOfTask(id, signal, addDays(app.today, -1));
    return joinPages(items, later.items);
  }

  $effect(() => {
    const id = task.id;
    void key;
    void app.snapshot?.rev;
    if (readFor !== id) {
      readFor = id;
      items = null;
      failed = false;
    }
    if (named.length === 0 || !app.canMeetings) {
      items = [];
      failed = false;
      return;
    }
    const abort = new AbortController();
    readAll(id, abort.signal)
      .then((list) => {
        if (abort.signal.aborted) return;
        items = list;
        failed = false;
      })
      .catch(() => {
        if (abort.signal.aborted) return;
        failed = true;
      });
    return () => abort.abort();
  });
</script>

{#if app.canMeetings}
  <section class="meetings" aria-labelledby="task-meetings-title">
    <h3 id="task-meetings-title">
      {t('detail.meetings')}
      {#if named.length > 0}<span class="muted">{named.length}</span>{/if}
    </h3>
    {#if named.length === 0}
      <p class="muted">{t('detail.meetings.none')}</p>
    {:else if failed}
      <p class="muted" role="alert">{t('meeting.failed', { code: 'offline' })}</p>
    {:else if items === null}
      <p class="muted" role="status">{t('detail.meetings.loading')}</p>
    {:else}
      {#each [['coming', split.coming], ['past', split.past]] as const as [part, list] (part)}
        {#if list.length > 0}
          <h4>{t(`detail.meetings.${part}` as Key)}</h4>
          <ul>
            {#each list as m (m.id)}
              <li class:cancelled={m.status === 'cancelled'}>
                <button type="button" class="link" data-meeting={m.id} onclick={() => app.openMeeting(m.id)}>{markHidden(m.title)}</button>
                <span class="when">{whenText(m, t('meeting.all_day'))}</span>
                {#if m.series}<span class="chip" data-series={m.series}>↻ {seriesNote(app.lang, m)}</span>{/if}
                {#if m.online_service}<span class="chip">{t(`meeting.service.${m.online_service}` as Key)}</span>{/if}
                {#if m.status && m.status !== 'planned'}<span class="chip">{t(`meeting.status.${m.status}` as Key)}</span>{/if}
              </li>
            {/each}
          </ul>
        {/if}
      {/each}
      {#if task.meetings_truncated}<p class="muted">{t('detail.meetings.more')}</p>{/if}
    {/if}
    {#if app.canMakeMeetings}
      <p>
        <button type="button" data-hint={t('hint.item.menu.meeting')} disabled={app.locked} onclick={() => app.openMeetingForm({ tasks: [task.id] })}
          >{t('detail.meetings.new')}</button
        >
      </p>
    {/if}
  </section>
{/if}

<style>
  h4 {
    font-size: 0.85rem;
    color: var(--muted);
    margin: 0.4rem 0 0.2rem;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.25rem;
  }
  li {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: baseline;
  }
  li.cancelled .link {
    text-decoration: line-through;
  }
  .when {
    font-size: 0.85rem;
    color: var(--muted);
  }
  .chip {
    font-size: 0.75rem;
    padding: 0 0.5rem;
    border: 1px solid var(--border);
    border-radius: 999px;
  }
  .muted {
    color: var(--muted);
  }
  button {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.3rem 0.7rem;
    cursor: pointer;
  }
  button.link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent);
    text-decoration: underline;
    text-align: left;
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
