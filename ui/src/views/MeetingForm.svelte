<script lang="ts">
  // The form of a new meeting (concept 7.1): one dialog, two columns. On the left the time and the place (title, area,
  // date, beginning, end or duration, all day, the time zone folded away, place, the address to join with the service
  // the engine names and Open / Copy, the tasks); on the right the people and the rest (participants, notification,
  // icon, tags) and what is attached once it is made. While the person types, the engine is asked for a dry run of
  // `meeting_new`: it names the meeting or says why it would refuse it, so the rules are not written a second time here.
  // A quick line of the palette opens this form filled in (nothing is saved before "Create").
  import { closeOnBackdrop } from 'appkit-ui/backdrop';
  import MultiSelect from 'appkit-ui/MultiSelect.svelte';
  import type { App } from '../lib/app.svelte';
  import { areaLabel } from '../lib/filter';
  import { floating } from '../lib/floating';
  import { translate, type Key } from '../lib/i18n';
  import { joinLink } from '../lib/meetingLink';
  import { MAX_NOTIFY, MAX_PARTICIPANTS, NOTIFY_PRESETS, type MeetingForm, type MeetingPreview } from '../lib/meetings';
  import { markHidden } from '../lib/text';
  import PendingAttachments from './PendingAttachments.svelte';

  let { app }: { app: App } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  let dialog: HTMLDialogElement | undefined = $state();
  let form = $state<MeetingForm | null>(null);
  let answer = $state<{ key: string; value: MeetingPreview } | null>(null);
  const formKey = $derived(JSON.stringify(form));
  const preview = $derived<MeetingPreview | null>(answer && answer.key === formKey ? answer.value : null);
  let busy = $state(false);
  let files = $state<File[]>([]);
  let screenshot = $state(false);
  let coverFirst = $state(true);
  let ownNotify = $state('');
  // The service of the address, as the engine names it, with the address it was asked for.
  let service = $state<{ online: string; name: string | null } | null>(null);

  const areas = $derived(
    [...app.allAreaNames]
      .map((name) => ({ value: name, label: app.shortAreas ? areaLabel(name, app.allAreaNames) : name, title: name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  );
  const taskOptions = $derived.by(() => {
    const open = app.tasks.map((x) => ({ value: x.id, label: `${markHidden(x.title)} (${x.id})`, title: x.id }));
    // a task named by the quick line that is not open (finished, or not known) is still offered
    for (const id of form?.tasks ?? []) if (!open.some((o) => o.value === id)) open.push({ value: id, label: id, title: id });
    return open;
  });
  const zones = $derived.by(() => {
    try {
      return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
    } catch {
      return [];
    }
  });
  const link = $derived(form ? joinLink(form.online) : null);
  const serviceName = $derived(form && service && service.online === form.online.trim() ? service.name : null);
  const hasImage = $derived(files.some((f) => f.type.startsWith('image/')));

  $effect(() => {
    if (!dialog) return;
    if (app.meetingDraft !== null && !dialog.open) {
      form = $state.snapshot(app.meetingDraft) as MeetingForm;
      answer = null;
      files = [];
      screenshot = false;
      coverFirst = true;
      ownNotify = '';
      service = null;
      dialog.showModal();
    }
    if (app.meetingDraft === null && dialog.open) dialog.close();
  });

  // The dry run follows the form, a moment after the last key; an answer for an older form is dropped.
  $effect(() => {
    if (app.meetingDraft === null || form === null) return;
    const snapshot = $state.snapshot(form) as MeetingForm;
    if (snapshot.title.trim() === '' || snapshot.area === '') return;
    const key = JSON.stringify(snapshot);
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      const value = await app.previewMeeting(snapshot, abort.signal);
      if (!abort.signal.aborted) answer = { key, value };
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  });

  // The service of the address: the engine's word for it (the same table as on the meeting it makes).
  $effect(() => {
    const online = form?.online.trim() ?? '';
    if (online === '') return;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      const name = await app.meetingService(online, abort.signal);
      if (!abort.signal.aborted) service = { online, name };
    }, 300);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  });

  function toggleNotify(spec: string): void {
    if (!form) return;
    if (form.notify.includes(spec)) form.notify = form.notify.filter((s) => s !== spec);
    else if (form.notify.length < MAX_NOTIFY) form.notify = [...form.notify, spec];
  }

  function addOwnNotify(): void {
    if (!form) return;
    const spec = ownNotify.trim();
    if (spec === '' || form.notify.includes(spec) || form.notify.length >= MAX_NOTIFY) return;
    form.notify = [...form.notify, spec];
    ownNotify = '';
  }

  function addParticipant(): void {
    if (!form || form.participants.length >= MAX_PARTICIPANTS) return;
    form.participants = [...form.participants, { name: '', email: '', role: '' }];
  }

  async function copyLink(): Promise<void> {
    const text = form?.online.trim() ?? '';
    if (text === '') return;
    try {
      await navigator.clipboard.writeText(text);
      app.tell('ok', 'meeting.online.copied');
    } catch {
      app.tell('error', 'meeting.online.copy_failed');
    }
  }

  const canCreate = $derived(form !== null && form.title.trim() !== '' && form.area !== '' && form.date !== '' && preview?.kind !== 'refused');

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy || app.saving || form === null || !canCreate) return;
    busy = true;
    try {
      await app.createMeeting($state.snapshot(form) as MeetingForm, files, screenshot, coverFirst && hasImage);
    } finally {
      busy = false;
    }
  }
</script>

<dialog
  bind:this={dialog}
  class="meeting-form"
  use:floating={{ kind: 'meeting-form', moveLabel: t('float.move'), moveHint: t('hint.float.move') }}
  use:closeOnBackdrop={{ closeable: () => (form?.title.trim() ?? '') === '' && files.length === 0 }}
  aria-labelledby="meeting-form-title"
  onclose={() => app.closeMeetingForm()}
>
  {#if form}
    <form onsubmit={submit}>
      <h2 id="meeting-form-title">{t('meeting.new.title')}</h2>
      {#if app.meetingNotes.problems.length > 0 || app.meetingNotes.assumedDay}
        <div class="notes" role="status">
          {#if app.meetingNotes.problems.length > 0}<p class="warn">{t('meeting.quick.problems', { words: app.meetingNotes.problems.join(' ') })}</p>{/if}
          {#if app.meetingNotes.assumedDay}<p class="muted">{t('meeting.quick.assumed_day')}</p>{/if}
        </div>
      {/if}
      <div class="columns">
        <fieldset class="column">
          <legend>{t('meeting.new.left')}</legend>
          <label data-hint={t('hint.form.meeting.title')}>
            <span>{t('meeting.field.title')}</span>
            <!-- svelte-ignore a11y_autofocus -->
            <input type="text" bind:value={form.title} maxlength="300" required autofocus />
          </label>
          <label data-hint={t('hint.form.meeting.area')}>
            <span>{t('meeting.field.area')}</span>
            <select bind:value={form.area} required>
              {#each areas as a (a.value)}<option value={a.value} title={a.title}>{a.label}</option>{/each}
            </select>
          </label>
          <div class="row">
            <label data-hint={t('hint.form.meeting.date')}>
              <span>{t('meeting.field.date')}</span>
              <input type="date" bind:value={form.date} required />
            </label>
            <label class="check" data-hint={t('hint.form.meeting.all_day')}>
              <input type="checkbox" bind:checked={form.allDay} />
              <span>{t('meeting.field.all_day')}</span>
            </label>
          </div>
          {#if !form.allDay}
            <div class="row">
              <label data-hint={t('hint.form.meeting.time')}>
                <span>{t('meeting.field.time')}</span>
                <input type="time" bind:value={form.time} />
              </label>
              <label data-hint={t('hint.form.meeting.end_mode')}>
                <span>{t('meeting.field.end_mode')}</span>
                <select bind:value={form.endMode}>
                  <option value="duration">{t('meeting.field.duration')}</option>
                  <option value="end">{t('meeting.field.end')}</option>
                </select>
              </label>
              {#if form.endMode === 'end'}
                <label data-hint={t('hint.form.meeting.end')}>
                  <span>{t('meeting.field.end')}</span>
                  <input type="time" bind:value={form.end} />
                </label>
              {:else}
                <label data-hint={t('hint.form.meeting.duration')}>
                  <span>{t('meeting.field.duration')}</span>
                  <input type="text" bind:value={form.duration} placeholder="60m" maxlength="10" size="6" />
                </label>
              {/if}
            </div>
          {/if}
          <details class="tz" open={form.tz !== ''}>
            <summary>{t('meeting.field.tz')}{form.tz !== '' ? `: ${form.tz}` : ''}</summary>
            <label data-hint={t('hint.form.meeting.tz')}>
              <span>{t('meeting.field.tz')}</span>
              <input type="text" bind:value={form.tz} list="meeting-zones" placeholder="Europe/Vienna" maxlength="64" aria-describedby="meeting-tz-help" />
            </label>
            <datalist id="meeting-zones">
              {#each zones as zone (zone)}<option value={zone}></option>{/each}
            </datalist>
            <small class="muted" id="meeting-tz-help">{t('meeting.field.tz_help')}</small>
          </details>
          <label data-hint={t('hint.form.meeting.location')}>
            <span>{t('meeting.field.location')}</span>
            <input type="text" bind:value={form.location} maxlength="300" />
          </label>
          <div class="field">
            <label data-hint={t('hint.form.meeting.online')}>
              <span>{t('meeting.field.online')}</span>
              <input type="url" bind:value={form.online} placeholder="https://" maxlength="2000" aria-describedby="meeting-online-state" />
            </label>
            <div class="online-row" id="meeting-online-state">
              {#if serviceName}
                <span class="service" data-service={serviceName}>{t('meeting.service.label', { name: t(`meeting.service.${serviceName}` as Key) })}</span>
              {/if}
              {#if link}
                <a class="button" href={link} target="_blank" rel="noopener noreferrer">{t('meeting.online.open')}</a>
              {:else if form.online.trim() !== ''}
                <span class="muted">{t('meeting.online.not_https')}</span>
              {/if}
              {#if form.online.trim() !== ''}
                <button type="button" onclick={copyLink}>{t('meeting.online.copy')}</button>
              {/if}
            </div>
          </div>
          <div class="field">
            <MultiSelect
              label={t('meeting.field.tasks')}
              hint={t('hint.form.meeting.tasks')}
              options={taskOptions}
              selected={form.tasks}
              onchange={(next) => {
                if (form) form.tasks = next;
              }}
              clearLabel={t('kit.select.clear', { label: t('meeting.field.tasks') })}
              resetLabel={t('multi.reset')}
              searchLabel={t('multi.search')}
            />
          </div>
        </fieldset>

        <fieldset class="column">
          <legend>{t('meeting.new.right')}</legend>
          <fieldset class="group">
            <legend>{t('meeting.field.participants')}</legend>
            {#each form.participants as p, i (i)}
              <div class="person" role="group" aria-label={t('meeting.participant.row', { n: i + 1 })}>
                <label data-hint={t('hint.form.meeting.participant')}>
                  <span class="sr-only">{t('meeting.participant.name')}</span>
                  <input type="text" bind:value={p.name} placeholder={t('meeting.participant.name')} maxlength="120" />
                </label>
                <label data-hint={t('hint.form.meeting.participant')}>
                  <span class="sr-only">{t('meeting.participant.email')}</span>
                  <input type="email" bind:value={p.email} placeholder={t('meeting.participant.email')} maxlength="200" />
                </label>
                <label data-hint={t('hint.form.meeting.participant')}>
                  <span class="sr-only">{t('meeting.participant.role')}</span>
                  <input type="text" bind:value={p.role} placeholder={t('meeting.participant.role')} maxlength="60" size="8" />
                </label>
                <button
                  type="button"
                  aria-label={t('meeting.participant.remove', { n: i + 1 })}
                  onclick={() => {
                    if (form) form.participants = form.participants.filter((_, j) => j !== i);
                  }}>×</button
                >
              </div>
            {/each}
            <button type="button" onclick={addParticipant} disabled={form.participants.length >= MAX_PARTICIPANTS}>{t('meeting.participant.add')}</button>
          </fieldset>

          <fieldset class="group">
            <legend>{t('meeting.field.notify')}</legend>
            <div class="chips" role="group" aria-label={t('meeting.field.notify')}>
              {#each NOTIFY_PRESETS as spec (spec)}
                <button type="button" class="chip" aria-pressed={form.notify.includes(spec)} onclick={() => toggleNotify(spec)}
                  >{t(`meeting.notify.${spec}` as Key)}</button
                >
              {/each}
              {#each form.notify.filter((s) => !(NOTIFY_PRESETS as readonly string[]).includes(s)) as spec (spec)}
                <button type="button" class="chip" aria-pressed="true" aria-label={t('meeting.notify.remove', { spec })} onclick={() => toggleNotify(spec)}
                  >{spec} ×</button
                >
              {/each}
            </div>
            <div class="row">
              <label data-hint={t('hint.form.meeting.notify')}>
                <span>{t('meeting.notify.own')}</span>
                <input
                  type="text"
                  bind:value={ownNotify}
                  maxlength="20"
                  size="10"
                  onkeydown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addOwnNotify();
                    }
                  }}
                />
              </label>
              <button type="button" onclick={addOwnNotify} disabled={form.notify.length >= MAX_NOTIFY}>{t('meeting.notify.add')}</button>
            </div>
            <small class="muted">{form.notify.length >= MAX_NOTIFY ? t('meeting.notify.max') : form.notify.length === 0 ? t('meeting.notify.none') : ''}</small>
          </fieldset>

          <label data-hint={t('hint.form.meeting.icon')}>
            <span>{t('meeting.field.icon')}</span>
            <input type="text" bind:value={form.icon} maxlength="64" />
          </label>
          <label data-hint={t('hint.form.meeting.tags')}>
            <span>{t('meeting.field.tags')} <small>({t('field.tags_hint')})</small></span>
            <input type="text" bind:value={form.tags} maxlength="500" />
          </label>
          {#if app.can('attach')}
            <PendingAttachments {app} bind:files bind:screenshot />
            {#if hasImage}
              <label class="check" data-hint={t('hint.form.meeting.cover_first')}>
                <input type="checkbox" bind:checked={coverFirst} />
                <span>{t('meeting.field.cover_first')}</span>
              </label>
            {/if}
          {/if}
        </fieldset>
      </div>

      <p class="preview" role="status" aria-live="polite">
        {#if preview?.kind === 'ok'}
          {t('meeting.new.will', { id: preview.id })}
        {:else if preview?.kind === 'refused'}
          <span class="bad">{preview.message}</span>
        {:else if preview?.kind === 'unknown' && form.title.trim() !== ''}
          <span class="warn">{t('meeting.new.unknown')}</span>
        {/if}
      </p>

      <div class="actions">
        <button type="button" onclick={() => app.closeMeetingForm()}>{t('dialog.cancel')}</button>
        <button type="submit" class="primary" disabled={busy || app.locked || !canCreate}>{t('capture.create')}</button>
      </div>
    </form>
  {/if}
</dialog>

<style>
  dialog {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem 1.25rem;
    width: min(58rem, calc(100vw - 2rem));
    max-height: calc(100vh - 2rem);
    overflow: auto;
  }
  dialog::backdrop {
    background: var(--backdrop);
  }
  h2 {
    margin: 0 0 0.75rem;
    font-size: 1.1rem;
  }
  .columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
    gap: 1rem;
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
  }
  .column > legend {
    color: var(--muted);
    font-size: 0.85rem;
    margin-bottom: 0.4rem;
  }
  .group {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.4rem 0.6rem;
    margin-bottom: 0.7rem;
  }
  .group > legend {
    color: var(--muted);
    font-size: 0.85rem;
    padding: 0 0.3rem;
  }
  label,
  .field {
    display: grid;
    gap: 0.2rem;
    margin-bottom: 0.7rem;
  }
  label.check {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    align-items: end;
  }
  .row > label {
    flex: 1 1 7rem;
  }
  .row > label.check {
    flex: 0 0 auto;
    margin-bottom: 1rem;
  }
  .person {
    display: grid;
    grid-template-columns: 1.2fr 1.4fr 0.8fr auto;
    gap: 0.3rem;
    align-items: center;
  }
  .person label {
    margin-bottom: 0.3rem;
  }
  input[type='text'],
  input[type='url'],
  input[type='email'],
  input[type='date'],
  input[type='time'],
  select {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.35rem 0.5rem;
    min-width: 0;
  }
  .tz {
    margin-bottom: 0.7rem;
  }
  .tz summary {
    cursor: pointer;
    color: var(--muted);
    margin-bottom: 0.3rem;
  }
  .online-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
    margin-top: -0.4rem;
  }
  .service {
    font-size: 0.8rem;
    padding: 0 0.5rem;
    border: 1px solid var(--border);
    border-radius: 999px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin-bottom: 0.5rem;
  }
  .chip {
    border-radius: 999px;
    font-size: 0.8rem;
    padding: 0.1rem 0.6rem;
  }
  .chip[aria-pressed='true'] {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .notes p {
    margin: 0 0 0.4rem;
  }
  .muted {
    color: var(--muted);
  }
  .preview {
    min-height: 1.4rem;
    margin: 0 0 0.7rem;
    font-size: 0.85rem;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .warn {
    color: var(--warn);
  }
  .bad {
    color: var(--bad);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  button,
  .button {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.3rem 0.7rem;
    cursor: pointer;
    text-decoration: none;
    font: inherit;
  }
  .primary {
    border-color: var(--accent);
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
