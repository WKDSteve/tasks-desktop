<script lang="ts">
  // The page of one meeting (concept 7.2): its head (time, place, the service with "Join", status, tasks) and three
  // tabs, Preparation, In the meeting and Result, every one reachable at any time; the clock only picks the tab it
  // opens on. Preparation: the agenda to tick, the documents (a link or a path becomes a line of `## Unterlagen`), the
  // attachments (the same bar as a task's: file, video, image, audio, camera), the cover. In the meeting: Join, who is
  // there, the agenda. Result: decisions, follow-ups, the result, "Mark as done". Every change is one operation of the
  // engine on the version read (`if_match`); the page reads the meeting again after it.
  import { closeOnBackdrop } from 'appkit-ui/backdrop';
  import { hostOf, parseMarkdown } from 'appkit-ui/markdown';
  import Blocks from 'appkit-ui/Blocks.svelte';
  import { AssetImages } from '../lib/assetImages.svelte';
  import { shownIcon } from '../lib/icons';
  import ImageViewer from './ImageViewer.svelte';
  import ItemCover from './ItemCover.svelte';
  import ItemIcon from './ItemIcon.svelte';
  import { hasAssetImage, isAssetImage } from '../lib/images';
  import AssetImg from './AssetImg.svelte';
  import type { App } from '../lib/app.svelte';
  import type { MeetingDocument, Result } from '../lib/contract';
  import { floating } from '../lib/floating';
  import { translate, type Key } from '../lib/i18n';
  import { joinLink } from '../lib/meetingLink';
  import {
    MEETING_TABS,
    coverChoices,
    coverOf,
    documentsHeading,
    sectionText,
    startTab,
    whenText,
    withComments,
    withDocument,
    type MeetingTab,
  } from '../lib/meetings';
  import type { Op } from '../lib/api';
  import { markHidden } from '../lib/text';
  import AttachBar from './AttachBar.svelte';
  import Lazy from './Lazy.svelte';
  import MeetingMinutes from './MeetingMinutes.svelte';
  import { untrack } from 'svelte';

  let { app }: { app: App } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  let dialog: HTMLDialogElement | undefined = $state();
  let doc = $state<MeetingDocument | null>(null);
  let failed = $state<string | null>(null);
  let tab = $state<MeetingTab>('prep');
  let documentText = $state('');
  // The meeting the tab was chosen for: a new meeting opens on the tab of its time, a reread keeps the one chosen.
  let tabFor = '';
  // The meeting is being read: a change now would go out on the version from before the last write.
  let reading = $state(false);
  const tabs: Record<MeetingTab, HTMLButtonElement | undefined> = $state({ prep: undefined, during: undefined, result: undefined });

  const id = $derived(app.meetingOpen);
  const m = $derived(doc?.meeting ?? null);
  // The images below `assets/` of a meeting in its folder form, for the text of its decisions and its result.
  const assetOwner = $derived(m?.folder ? m.id : null);
  let images = $state<AssetImages | null>(null);
  $effect(() => {
    const owner = assetOwner;
    if (owner === null) {
      images = null;
      return;
    }
    const store = new AssetImages((kind, of, file, held) => app.asset(kind, of, file, held), 'meeting', owner, { recheckOnFront: true });
    images = store;
    return () => store.dispose();
  });
  // The meeting read again: an image that was missing, or one put into its folder since, is read again.
  $effect(() => {
    const store = images;
    const etag = m?.etag;
    const assets = m?.assets;
    untrack(() => store?.refresh(etag, assets));
  });
  let viewing = $state<{ url: string; alt: string } | null>(null);
  /** The side of the small picture of an image among the documents; a click shows it large. */
  const THUMB_PX = 96;
  const imageSource = $derived(images?.source(t('image.missing'), (_src, url, alt) => (viewing = { url, alt })));
  /**
   * A section with an image of the meeting's folder, as Markdown with the image drawn. A section without one stays its
   * text as written (its lines as they are), as before.
   */
  const blocksOf = (text: string) => parseMarkdown(text, { assets: true });
  const etag = $derived(m?.etag);
  const join = $derived(m ? joinLink(m.online) : null);
  const present = $derived(doc ? doc.participants.filter((p) => p.present).length : 0);
  const covers = $derived(m ? coverChoices(m) : []);
  const cover = $derived(m ? coverOf(m as typeof m & { cover?: string }) : undefined);
  const canWrite = $derived(app.can('meeting_ops') && !app.readOnly);
  const busy = $derived(app.saving || reading);

  $effect(() => {
    if (!dialog) return;
    if (id !== null && !dialog.open) dialog.showModal();
    if (id === null && dialog.open) dialog.close();
  });

  // Read the meeting when it is opened, after each write of the page (`app.writes`) and when the vault changed.
  $effect(() => {
    const which = id;
    void app.writes;
    void app.snapshot?.rev;
    if (which === null) {
      doc = null;
      failed = null;
      tabFor = '';
      reading = false;
      return;
    }
    const abort = new AbortController();
    reading = true;
    app
      .readMeeting(which, abort.signal)
      .then((read) => {
        if (abort.signal.aborted) return;
        reading = false;
        // Another meeting: what was typed into the result or the link of the one before is not this one's.
        if (tabFor !== which) {
          resultDirty = false;
          recordingDirty = false;
        }
        doc = read;
        failed = null;
        if (tabFor !== which) {
          tabFor = which;
          tab = startTab(read.meeting, app.nowMs());
        }
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        reading = false;
        failed = (error as { code?: string })?.code ?? 'offline';
      });
    return () => abort.abort();
  });

  /** One write on the version read; the page reads the meeting again after it (`app.writes`). */
  async function send(op: Op): Promise<Result | null> {
    if (!canWrite || refused()) return null;
    return app.write([op]);
  }

  /** Whether a change must wait (a write on its way, or the meeting being read again): then it is said, not sent. */
  function refused(): boolean {
    if (!busy) return false;
    app.tell('error', app.saving ? 'write.busy' : 'meeting.busy_reading');
    return true;
  }

  function guard(): { if_match?: string } {
    return etag ? { if_match: etag } : {};
  }

  function chooseTab(next: MeetingTab, focus = false): void {
    tab = next;
    if (focus) tabs[next]?.focus();
  }

  /** The keys of a tab list: arrows go round, Home and End to the ends. */
  function tabKey(event: KeyboardEvent): void {
    const at = MEETING_TABS.indexOf(tab);
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (at + 1) % MEETING_TABS.length;
    else if (event.key === 'ArrowLeft') next = (at + MEETING_TABS.length - 1) % MEETING_TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = MEETING_TABS.length - 1;
    if (next === null) return;
    event.preventDefault();
    chooseTab(MEETING_TABS[next] ?? 'prep', true);
  }

  async function addDocument(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const entry = documentText.trim();
    if (!doc || !id || entry === '' || doc.body_truncated) return;
    const heading = documentsHeading(doc.body);
    const result = await send({ op: 'set_section', id, heading: `## ${heading}`, text: withDocument(doc.body, heading, entry), ...guard() });
    // What was typed stays when nothing was written (a refusal, a conflict, a write on its way).
    if (result?.results.every((r) => r.ok)) documentText = '';
  }

  async function close(): Promise<void> {
    if (!id) return;
    if (refused()) return;
    // Taken back by the toast (the engine's inverse opens the meeting again).
    await app.write([{ op: 'meeting_close', id, ...guard() }], {
      saidAs: (result) => (result.results[0]?.without_result ? 'meeting.closed_without_result' : undefined),
    });
  }

  /** The text of a section of the body, as the engine wrote the headings (de or en). */
  const section = (de: string, en: string): string => (doc ? sectionText(doc.body, de) || sectionText(doc.body, en) : '');

  // The result and the link to the recording, as typed: what was read, until the person changes it.
  let resultText = $state('');
  let resultDirty = $state(false);
  let recordingText = $state('');
  let recordingDirty = $state(false);
  $effect(() => {
    const read = section('Ergebnis', 'Result');
    const recording = m?.recording ?? '';
    untrack(() => {
      if (!resultDirty) resultText = read;
      if (!recordingDirty) recordingText = recording;
    });
  });
  /** The heading of the result in this body: English only when the meeting was written in English. */
  const resultHeading = $derived(doc && /^## Result\s*$/m.test(doc.body) && !/^## Ergebnis\s*$/m.test(doc.body) ? 'Result' : 'Ergebnis');
  const untasked = $derived(doc ? doc.followups.filter((f) => !f.task && !f.ticked) : []);

  async function saveResult(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!id || !doc || doc.body_truncated) return;
    const result = await send({ op: 'set_section', id, heading: `## ${resultHeading}`, text: withComments(doc.body, resultHeading, resultText.trim()), ...guard() });
    if (result?.results.every((r) => r.ok)) resultDirty = false;
  }

  async function saveRecording(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!id) return;
    const link = recordingText.trim();
    const result = await send({ op: 'meeting_set', id, patch: { recording: link === '' ? null : link }, ...guard() });
    if (result?.results.every((r) => r.ok)) recordingDirty = false;
  }

  /** Tasks of the follow-ups (line `n`, or every one without a task): the engine writes each id behind its line. */
  async function makeTasks(n?: number): Promise<void> {
    if (!id) return;
    await send({ op: 'meeting_followups', id, ...(n === undefined ? {} : { n }) });
  }
</script>

<dialog
  bind:this={dialog}
  class="meeting-page"
  use:floating={{ kind: 'meeting-page', moveLabel: t('float.move'), moveHint: t('hint.float.move') }}
  use:closeOnBackdrop={{ closeable: () => true }}
  aria-labelledby="meeting-page-title"
  onclose={() => app.closeMeeting()}
>
  {#if failed !== null}
    <p role="alert">{t('meeting.failed', { code: failed })}</p>
    <div class="actions"><button type="button" onclick={() => app.closeMeeting()}>{t('meeting.close_page')}</button></div>
  {:else if !doc || !m}
    <p role="status">{t('meeting.loading')}</p>
  {:else}
    <header>
      <h2 id="meeting-page-title">
        <ItemIcon {app} shown={shownIcon({ kind: 'meeting', id: m.id, icon: m.icon })} size={20} />
        {markHidden(m.title)}
      </h2>
      {#if cover && m.folder}<ItemCover {app} kind="meeting" id={m.id} file={cover} title={m.title} />{/if}
      <p class="when">
        <span>{whenText(m, t('meeting.all_day'))}</span>
        {#if m.status}<span class="chip status" data-status={m.status}>{t(`meeting.status.${m.status}` as Key)}</span>{/if}
        {#if m.online_service}<span class="chip">{t(`meeting.service.${m.online_service}` as Key)}</span>{/if}
      </p>
      {#if m.series || m.repeat}<Lazy {app} load={() => import('./MeetingSeries.svelte')} extra={{ meeting: m, busy }} />{/if}
      {#if m.location}<p class="muted">{t('meeting.where')}: {markHidden(m.location)}</p>{/if}
      <p class="id muted">{markHidden(m.id)}</p>
    </header>

    <div class="tablist" role="tablist" aria-label={t('meeting.tabs')} tabindex="-1" onkeydown={tabKey}>
      {#each MEETING_TABS as which (which)}
        <button
          bind:this={tabs[which]}
          type="button"
          role="tab"
          id={`meeting-tab-${which}`}
          aria-controls={`meeting-panel-${which}`}
          aria-selected={tab === which}
          tabindex={tab === which ? 0 : -1}
          onclick={() => chooseTab(which)}>{t(`meeting.tab.${which}` as Key)}</button
        >
      {/each}
    </div>

    {#snippet agenda()}
      <section aria-labelledby={`meeting-agenda-${tab}`}>
        <h3 id={`meeting-agenda-${tab}`}>{t('meeting.agenda')}</h3>
        {#if doc && doc.agenda.length > 0}
          <ul class="checks">
            {#each doc.agenda as item (item.n)}
              <li>
                <label data-hint={t('hint.form.meeting.agenda')}>
                  <input
                    type="checkbox"
                    checked={item.ticked}
                    disabled={!canWrite}
                    aria-disabled={busy ? 'true' : undefined}
                    aria-label={t('meeting.agenda.item', { n: item.n })}
                    data-agenda={item.n}
                    onclick={(e) => {
                      // The box shows what the file says: a click asks the engine and the meeting is read again.
                      e.preventDefault();
                      if (id) void send({ op: 'tick_step', id, n: item.n, done: !item.ticked, section: 'agenda', ...guard() });
                    }}
                  />
                  <span>{markHidden(item.text)}</span>
                </label>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="muted">{t('meeting.empty')}</p>
        {/if}
      </section>
    {/snippet}

    {#snippet people()}
      <section aria-labelledby={`meeting-people-${tab}`}>
        <h3 id={`meeting-people-${tab}`}>
          {t('meeting.participants')}
          {#if doc && doc.participants.length > 0}<span class="muted">{t('meeting.participants.present', { n: present, total: doc.participants.length })}</span>{/if}
        </h3>
        {#if doc && doc.participants.length > 0}
          <ul class="checks">
            {#each doc.participants as p (p.n)}
              <li>
                <label data-hint={t('hint.form.meeting.attend')}>
                  <input
                    type="checkbox"
                    checked={p.present}
                    disabled={!canWrite}
                    aria-disabled={busy ? 'true' : undefined}
                    aria-label={t('meeting.participants.tick', { name: markHidden(p.name) })}
                    data-present={p.n}
                    onclick={(e) => {
                      e.preventDefault();
                      if (id) void send({ op: 'meeting_attend', id, n: p.n, present: !p.present, ...guard() });
                    }}
                  />
                  <span>{markHidden(p.name)}{#if p.role}<span class="muted">{` (${markHidden(p.role)})`}</span>{/if}{#if p.email}<span class="muted">{` ${markHidden(p.email)}`}</span>{/if}</span>
                </label>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="muted">{t('meeting.empty')}</p>
        {/if}
      </section>
    {/snippet}

    {#snippet joinButton(big: boolean)}
      {#if join}
        <a class="button join" class:big href={join} target="_blank" rel="noopener noreferrer"
          >{t('meeting.join')}{#if m?.online_service} · {t(`meeting.service.${m.online_service}` as Key)}{/if}</a
        >
      {/if}
    {/snippet}

    <div class="panel" role="tabpanel" id={`meeting-panel-${tab}`} aria-labelledby={`meeting-tab-${tab}`} tabindex="0">
      {#if tab === 'prep'}
        {@render joinButton(false)}
        {@render agenda()}
        <section aria-labelledby="meeting-documents">
          <h3 id="meeting-documents">{t('meeting.documents')}</h3>
          {#if doc.documents.length > 0}
            <ul>
              {#each doc.documents as d (d.n)}
                <li>
                  {#if d.kind === 'web' && d.href && joinLink(d.href)}
                    {@const link = joinLink(d.href)}
                    {@const host = link ? hostOf(link) : null}
                    <a href={link} target="_blank" rel="noopener noreferrer">{markHidden(d.text)}</a
                    >{#if host}<span class="muted">{` (${markHidden(host)})`}</span>{/if}
                  {:else if d.kind === 'asset' && images && isAssetImage(d.href)}
                    <span>{markHidden(d.text)}</span>
                    <span class="thumb" data-document-image={d.href}
                      ><AssetImg
                        {images}
                        file={d.href}
                        alt={d.text}
                        missing={t('image.missing')}
                        size={THUMB_PX}
                        onopen={(url, alt) => (viewing = { url, alt })}
                      /></span
                    >
                  {:else}
                    <span>{markHidden(d.text)}</span>{#if d.kind === 'asset' && d.href}<span class="muted">{` (${markHidden(d.href)})`}</span>{/if}
                  {/if}
                </li>
              {/each}
            </ul>
          {:else}
            <p class="muted">{t('meeting.empty')}</p>
          {/if}
          {#if canWrite && doc.body_truncated}
            <p class="muted" role="status">{t('meeting.documents.cut')}</p>
          {:else if canWrite}
            <form class="row" onsubmit={addDocument} data-document-add>
              <label data-hint={t('hint.form.meeting.document')}>
                <span>{t('meeting.documents.add')}</span>
                <input type="text" bind:value={documentText} maxlength="2000" />
              </label>
              <button type="submit" disabled={documentText.trim() === '' || busy}>{t('meeting.documents.add_button')}</button>
            </form>
          {/if}
        </section>
        <section aria-labelledby="meeting-tasks">
          <h3 id="meeting-tasks">{t('meeting.tasks')}</h3>
          {#if m.tasks.length > 0}
            <ul>
              {#each m.tasks as task (task)}
                {@const open = app.tasks.find((x) => x.id === task)}
                <li>
                  {#if open}
                    <button
                      type="button"
                      class="link"
                      onclick={() => {
                        app.closeMeeting();
                        app.reveal(task);
                      }}>{markHidden(open.title)}</button
                    >
                    <span class="muted">{markHidden(task)}</span>
                  {:else}
                    <span>{markHidden(task)}</span>
                  {/if}
                </li>
              {/each}
            </ul>
          {:else}
            <p class="muted">{t('meeting.empty')}</p>
          {/if}
        </section>
        {@render people()}
        {#if app.canAttach && canWrite && id}
          <section aria-labelledby="meeting-attach">
            <h3 id="meeting-attach">{t('meeting.attachments')}</h3>
            <AttachBar {app} {id} owner="meeting" />
          </section>
        {/if}
        <section aria-labelledby="meeting-cover">
          <h3 id="meeting-cover">{t('meeting.cover')}</h3>
          {#if cover}<p>{t('meeting.cover.current', { path: markHidden(cover) })}</p>{/if}
          {#if covers.length > 0}
            <ul>
              {#each covers as path (path)}
                <li>
                  <span>{markHidden(path)}</span>
                  {#if canWrite && path !== cover}
                    <button type="button" data-cover-use={path} disabled={busy} onclick={() => id && send({ op: 'meeting_set', id, patch: { cover: path }, ...guard() })}
                      >{t('meeting.cover.use')}</button
                    >
                  {/if}
                </li>
              {/each}
            </ul>
          {:else}
            <p class="muted">{t('meeting.cover.none')}</p>
          {/if}
        </section>
      {:else if tab === 'during'}
        {@render joinButton(true)}
        <!-- One per meeting: what is typed and the drafts belong to the meeting they were made in. -->
        {#key m.id}<MeetingMinutes {app} id={m.id} body={doc.body} {etag} cut={doc.body_truncated} {canWrite} {busy} read={doc} />{/key}
        {@render people()}
        {@render agenda()}
      {:else}
        <section aria-labelledby="meeting-decisions">
          <h3 id="meeting-decisions">{t('meeting.decisions')}</h3>
          {#if section('Beschlüsse', 'Decisions') !== '' && images && hasAssetImage(section('Beschlüsse', 'Decisions'))}<div class="prose"
            ><Blocks blocks={blocksOf(section('Beschlüsse', 'Decisions'))} headingBase={3} images={imageSource} /></div
          >{:else if section('Beschlüsse', 'Decisions') !== ''}<pre>{markHidden(section('Beschlüsse', 'Decisions'))}</pre>{:else}<p class="muted">{t('meeting.empty')}</p>{/if}
        </section>
        <section aria-labelledby="meeting-followups">
          <h3 id="meeting-followups">{t('meeting.followups')}</h3>
          {#if doc.followups.length > 0}
            <ul>
              {#each doc.followups as f (f.n)}
                <li class:ticked={f.ticked}>
                  {markHidden(f.text)}{#if f.task}<span class="muted"> → {markHidden(f.task)}</span>{/if}
                  {#if canWrite && !f.task && !f.ticked}
                    <button type="button" class="small" disabled={busy} onclick={() => makeTasks(f.n)}>{t('meeting.followups.make')}</button>
                  {/if}
                </li>
              {/each}
            </ul>
            {#if canWrite && untasked.length > 1}
              <button type="button" disabled={busy} onclick={() => makeTasks()}>{t('meeting.followups.make_all')}</button>
            {/if}
          {:else}
            <p class="muted">{t('meeting.empty')}</p>
          {/if}
        </section>
        <section aria-labelledby="meeting-result">
          <h3 id="meeting-result">{t('meeting.result')}</h3>
          {#if section('Ergebnis', 'Result') !== '' && images && hasAssetImage(section('Ergebnis', 'Result'))}<div class="prose"
            ><Blocks blocks={blocksOf(section('Ergebnis', 'Result'))} headingBase={3} images={imageSource} /></div
          >{:else if section('Ergebnis', 'Result') !== ''}<pre>{markHidden(section('Ergebnis', 'Result'))}</pre>{:else}<p class="muted">{t('meeting.empty')}</p>{/if}
          {#if m.recording && joinLink(m.recording)}
            <p><a href={joinLink(m.recording)} target="_blank" rel="noopener noreferrer">{t('meeting.recording')}</a></p>
          {/if}
          {#if canWrite && !doc.body_truncated}
            <form class="stack" onsubmit={saveResult}>
              <label data-hint={t('hint.form.meeting.result')}>
                <span>{t('meeting.result')}</span>
                <textarea rows="4" maxlength="20000" bind:value={resultText} oninput={() => (resultDirty = true)}></textarea>
              </label>
              <button type="submit" disabled={busy || !resultDirty}>{t('meeting.result.save')}</button>
            </form>
          {/if}
          {#if canWrite}
            <form class="row" onsubmit={saveRecording}>
              <label data-hint={t('hint.form.meeting.recording')}>
                <span>{t('meeting.recording.link')}</span>
                <input type="url" bind:value={recordingText} maxlength="2000" oninput={() => (recordingDirty = true)} />
              </label>
              <button type="submit" disabled={busy || !recordingDirty}>{t('meeting.recording.save')}</button>
            </form>
          {/if}
        </section>
        {#if canWrite && m.status === 'planned'}
          <div class="actions"><button type="button" class="primary" disabled={busy} onclick={close} data-meeting-close>{t('meeting.close')}</button></div>
        {/if}
      {/if}
    </div>
    <div class="actions">
      <button type="button" onclick={() => app.closeMeeting()}>{t('meeting.close_page')}</button>
    </div>
  {/if}
  <ImageViewer image={viewing} close={() => (viewing = null)} label={{ close: t('image.close'), view: t('image.view') }} />
</dialog>

<style>
  dialog {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem 1.25rem;
    width: min(52rem, calc(100vw - 2rem));
    max-height: calc(100vh - 2rem);
    overflow: auto;
  }
  dialog::backdrop {
    background: var(--backdrop);
  }
  h2 {
    margin: 0 0 0.3rem;
    font-size: 1.15rem;
    overflow-wrap: anywhere;
  }
  h3 {
    font-size: 0.95rem;
    margin: 0.9rem 0 0.4rem;
  }
  header p {
    margin: 0 0 0.25rem;
  }
  .when {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
  }
  .chip {
    font-size: 0.75rem;
    padding: 0 0.5rem;
    border: 1px solid var(--border);
    border-radius: 999px;
  }
  .id {
    font-size: 0.8rem;
  }
  .muted {
    color: var(--muted);
  }
  .tablist {
    display: flex;
    gap: 0.25rem;
    border-bottom: 1px solid var(--border);
    margin: 0.8rem 0 0.4rem;
  }
  [role='tab'] {
    border: 1px solid transparent;
    border-bottom: 2px solid transparent;
    border-radius: var(--radius) var(--radius) 0 0;
    background: none;
    padding: 0.35rem 0.8rem;
  }
  [role='tab'][aria-selected='true'] {
    border-bottom-color: var(--accent);
    font-weight: 600;
  }
  .panel:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  ul {
    margin: 0;
    padding-left: 1.1rem;
  }
  ul.checks {
    list-style: none;
    padding-left: 0;
  }
  ul.checks label {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
  }
  .thumb {
    display: block;
    margin: 0.25rem 0;
  }
  li.ticked {
    text-decoration: line-through;
    color: var(--muted);
  }
  .prose {
    overflow-wrap: anywhere;
  }
  pre {
    white-space: pre-wrap;
    font: inherit;
    margin: 0;
  }
  .row {
    display: flex;
    gap: 0.5rem;
    align-items: end;
    margin-top: 0.5rem;
  }
  .row label {
    display: grid;
    gap: 0.2rem;
    flex: 1;
  }
  .stack {
    display: grid;
    gap: 0.4rem;
    margin-top: 0.5rem;
    justify-items: start;
  }
  .stack label {
    display: grid;
    gap: 0.2rem;
    width: 100%;
  }
  button.small {
    padding: 0 0.4rem;
    font-size: 0.85rem;
    margin-left: 0.4rem;
  }
  textarea,
  input[type='url'],
  input[type='text'] {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.35rem 0.5rem;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1rem;
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
    display: inline-block;
  }
  button.link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent);
    text-decoration: underline;
  }
  .join {
    margin: 0.4rem 0;
    border-color: var(--accent);
  }
  .join.big {
    font-size: 1.15rem;
    padding: 0.6rem 1.4rem;
  }
  .primary {
    border-color: var(--accent);
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
