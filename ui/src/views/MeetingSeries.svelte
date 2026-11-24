<script lang="ts">
  // The series on the page of a meeting (capability `meeting_series`), loaded on demand. An occurrence names its day
  // and its series, and offers to cancel this one (`meeting_set status=cancelled` on its own id: the first entry makes
  // its file) or, while it has no file, to skip its day (`except` of the series). A series itself is edited here: its
  // interval, its last day and the days without one. Every value is the engine's to judge; a write goes out on the
  // version read (`if_match`: of an occurrence without a file, the version of the series).
  import type { App } from '../lib/app.svelte';
  import type { MeetingEntry } from '../lib/contract';
  import { REPEATS, repeatLabel, seriesPatch, seriesWord, withExcept, type SeriesWord } from '../lib/series';

  let { app, meeting, busy }: { app: App; meeting: MeetingEntry; busy: boolean } = $props();
  const s = (key: SeriesWord, day = '') => seriesWord(app.lang, key, day);

  const canWrite = $derived(app.can('meeting_ops') && !app.readOnly && !app.locked);
  const offered = $derived(meeting.repeat && !(REPEATS as readonly string[]).includes(meeting.repeat) ? [...REPEATS, meeting.repeat] : REPEATS);

  // The series as typed: what was read, until the person changes it.
  let repeat = $state('');
  let until = $state('');
  let except = $state('');
  let editedFor = '';
  $effect(() => {
    const key = `${meeting.id}\u0000${meeting.etag ?? ''}`;
    if (key === editedFor) return;
    editedFor = key;
    repeat = meeting.repeat ?? '';
    until = meeting.repeat_until ?? '';
    except = (meeting.except ?? []).join(', ');
  });

  const guard = (etag?: string) => (etag ? { if_match: etag } : {});

  async function cancelOne(): Promise<void> {
    if (!canWrite || busy) return;
    await app.write([{ op: 'meeting_set', id: meeting.id, patch: { status: 'cancelled' }, ...guard(meeting.etag) }]);
  }

  async function skipDay(): Promise<void> {
    if (!canWrite || busy || !meeting.series || !meeting.occurrence) return;
    let series;
    try {
      series = await app.readMeeting(meeting.series);
    } catch (error: unknown) {
      app.tell('error', 'meeting.failed', { code: (error as { code?: string })?.code ?? 'offline' });
      return;
    }
    const day = meeting.occurrence;
    const result = await app.write([
      { op: 'meeting_set', id: meeting.series, patch: { except: withExcept(series.meeting.except, day) }, ...guard(series.meeting.etag) },
    ]);
    // The day has no occurrence any more: its page has nothing to show.
    if (result?.results.every((r) => r.ok)) app.closeMeeting();
  }

  async function saveSeries(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!canWrite || busy) return;
    const patch = seriesPatch(meeting, { repeat, until, except });
    if (Object.keys(patch).length === 0) return;
    await app.write([{ op: 'meeting_set', id: meeting.id, patch, ...guard(meeting.etag) }]);
  }
</script>

{#if meeting.series}
  <div class="series" data-occurrence={meeting.occurrence ?? ''}>
    <span>↻ {s('series')} · {s('occurrence', meeting.occurrence ?? meeting.date ?? '')}{meeting.virtual ? ` (${s('virtual')})` : ''}</span>
    <button type="button" onclick={() => meeting.series && app.openMeeting(meeting.series)} data-series-open>{s('open')}</button>
    {#if canWrite && meeting.status === 'planned'}
      <button type="button" disabled={busy} onclick={cancelOne} data-series-cancel>{s('cancel')}</button>
    {/if}
    {#if canWrite && meeting.virtual && meeting.occurrence}
      <button type="button" disabled={busy} onclick={skipDay} data-series-skip>{s('except')}</button>
    {/if}
  </div>
{:else if meeting.repeat}
  <form class="series" onsubmit={saveSeries} data-series-edit>
    <label data-hint={s('hint_repeat')}>
      <span>↻ {s('repeat')}</span>
      <select bind:value={repeat} disabled={!canWrite}>
        {#each offered as r (r)}<option value={r}>{repeatLabel(app.lang, r)}</option>{/each}
      </select>
    </label>
    <label data-hint={s('hint_until')}>
      <span>{s('until')}</span>
      <input type="date" bind:value={until} disabled={!canWrite} />
    </label>
    <label class="wide" data-hint={s('hint_except')}>
      <span>{s('exceptions')}</span>
      <input spellcheck="false" type="text" bind:value={except} maxlength="2200" disabled={!canWrite} />
    </label>
    {#if canWrite}<button type="submit" disabled={busy}>{s('save')}</button>{/if}
  </form>
{/if}

<style>
  .series {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.4rem 0.6rem;
    margin: 0.3rem 0;
    font-size: 0.9rem;
  }
  label {
    display: grid;
    gap: 0.15rem;
  }
  label span {
    color: var(--muted);
    font-size: 0.8rem;
  }
  .wide {
    flex: 1 1 14rem;
  }
</style>
