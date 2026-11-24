<script lang="ts">
  // The minutes of a meeting (concept 7.7), in the tab "In the meeting": the entries in the order of their time, each
  // with its time and the sign of its kind, and one field below them. A shortcut at the start of a line names its kind
  // (task, decision, question, checklist, mark; the help line says them and they can be changed); the buttons send what
  // is typed as that kind, and a photo or a recording is attached and becomes a line. Every entry is one `meeting_capture`
  // of the engine, sent without `if_match`: two devices writing at once lose nothing. A plain line can afterwards be made
  // a task, a decision or a question. An entry that reached no hub stays as a draft in this browser and is written once
  // the hub answers; the page says so.
  // A board (✎) is drawn on the page's own surface (`BoardEditor`, loaded on demand); its first save becomes a line of
  // the kind `board` with its preview, and a board of the minutes opens there again to draw on.
  import { untrack } from 'svelte';
  import type { App } from '../lib/app.svelte';
  import { translate, type Key } from '../lib/i18n';
  import {
    DEFAULT_SHORTCUTS,
    MAX_CAPTURE,
    captureOp,
    capturesOf,
    clockOf,
    convertOps,
    minutesOf,
    parseShortcuts,
    type Capture,
    type MinuteLine,
    type MinutesDraft,
    type Shortcuts,
  } from '../lib/minutes';
  import { markHidden } from '../lib/text';
  import { boardOfAsset } from '../lib/ink';
  import type { BoardSaved } from '../lib/api';
  import Lazy from './Lazy.svelte';

  let {
    app,
    id,
    body,
    etag,
    cut,
    canWrite,
    busy,
    read,
  }: {
    app: App;
    id: string;
    body: string;
    etag: string | undefined;
    cut: boolean;
    canWrite: boolean;
    busy: boolean;
    /** The document as last read: a new one each time the hub answered a read. */
    read: unknown;
  } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  const shortcuts = $derived(app.minutesShortcuts);
  const lines = $derived(minutesOf(body, shortcuts.mark));
  let text = $state('');
  let drafts = $state<MinutesDraft[]>(untrack(() => app.minutesDrafts(id)));
  let flushing = false;
  /** After drafts reached no hub: not before this (wall ms), so a hub that answers reads but takes no write is not asked
   * again at every read. */
  let retryAfter = 0;
  let editing = $state<Shortcuts | null>(null);
  let photoInput: HTMLInputElement | undefined = $state();
  let audioInput: HTMLInputElement | undefined = $state();

  /** How long drafts wait after they reached no hub before the next read tries them again. */
  const RETRY_MS = 15_000;
  const SIGNS: Record<MinuteLine['kind'], string> = { text: '·', task: '☐', decision: '✓', question: '?', image: '▣', audio: '♪' };

  /** Whether a change must wait (a write on its way, or the meeting being read again): then it is said, not sent. */
  function refused(): boolean {
    if (!busy) return false;
    app.tell('error', app.saving ? 'write.busy' : 'meeting.busy_reading');
    return true;
  }

  function keepDrafts(next: MinutesDraft[]): void {
    drafts = next;
    app.setMinutesDrafts(id, next);
  }

  /** Send the entries of one typed line (all in one request); what reached no hub stays as drafts with its time. */
  async function sendCaptures(captures: Capture[]): Promise<boolean> {
    if (captures.some((c) => c.text.length > MAX_CAPTURE)) {
      app.tell('error', 'minutes.too_long', { n: MAX_CAPTURE });
      return false;
    }
    if (!canWrite || refused()) return false;
    const at = clockOf(app.nowMs());
    const result = await app.write(captures.map((c) => captureOp(id, c, at)));
    if (result?.results.every((r) => r.ok)) return true;
    if (result === null && app.lastWriteUnsent) {
      const kept = captures.flatMap((c): MinutesDraft[] =>
        c.kind === 'text' || c.kind === 'task' || c.kind === 'decision' || c.kind === 'question' ? [{ kind: c.kind, text: c.text, at }] : [],
      );
      keepDrafts([...drafts, ...kept]);
      return true;
    }
    return false;
  }

  async function add(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (await sendCaptures(capturesOf(text, shortcuts))) text = '';
  }

  /** A button: what is typed, as this kind (the shortcut of the line, if any, still counts). */
  async function addAs(kind: 'task' | 'decision' | 'question'): Promise<void> {
    const captures = capturesOf(text, shortcuts);
    if (captures.length === 0) return;
    const typed = captures.length === 1 && captures[0]?.kind === 'text' ? [{ kind, text: captures[0].text }] : captures;
    if (await sendCaptures(typed)) text = '';
  }

  /** A photo or a recording: attached to the meeting first, then a line of the minutes with it. */
  async function attach(kind: 'photo' | 'audio', input: HTMLInputElement | undefined): Promise<void> {
    const file = input?.files?.[0];
    if (input) input.value = '';
    if (!file || !canWrite || refused()) return;
    const asset = await app.attachFileAsset(id, file, kind === 'photo' ? 'image' : 'audio');
    if (!asset) return;
    await app.write([captureOp(id, { kind, text: '', asset }, clockOf(app.nowMs()))]);
  }

  /** The board open on the drawing surface: a new one (no name) or one of the minutes. */
  let board = $state<{ name?: string } | null>(null);

  /** A new board, saved for the first time: a line of the minutes with its preview. */
  async function boardSaved(saved: BoardSaved & { name: string }): Promise<void> {
    if (saved.preview) await app.write([captureOp(id, { kind: 'board', text: saved.name, asset: saved.preview }, clockOf(app.nowMs()))]);
  }

  async function convert(line: MinuteLine, to: 'task' | 'decision' | 'question'): Promise<void> {
    if (!canWrite || cut || refused()) return;
    const ops = convertOps(id, body, line, to, etag);
    if (ops) await app.write(ops);
  }

  // The drafts are written as soon as the meeting was read (the hub answers again), in one request with their times.
  $effect(() => {
    void read;
    if (drafts.length === 0 || !canWrite) return;
    untrack(() => void flush());
  });

  async function flush(): Promise<void> {
    if (flushing || busy || drafts.length === 0 || Date.now() < retryAfter) return;
    flushing = true;
    const sent = drafts;
    try {
      const result = await app.write(sent.map((d) => captureOp(id, { kind: d.kind, text: d.text }, d.at)));
      // Written, or refused by the engine (it said why): either way not sent again. Unsent: kept for the next read.
      if (result !== null || !app.lastWriteUnsent) keepDrafts(drafts.slice(sent.length));
      else retryAfter = Date.now() + RETRY_MS;
    } finally {
      flushing = false;
    }
  }

  function saveShortcuts(event: SubmitEvent): void {
    event.preventDefault();
    if (!editing) return;
    app.setMinutesShortcuts(parseShortcuts(JSON.stringify(editing)));
    editing = null;
  }
</script>

<section aria-labelledby="meeting-minutes" class="minutes">
  <h3 id="meeting-minutes">{t('minutes.title')}</h3>
  {#if lines.length > 0}
    <ol class="lines">
      {#each lines as line (line.n)}
        <li class:marked={line.marked} data-kind={line.kind}>
          <span class="at">{line.at}</span>
          <span class="sign" title={t(`minutes.kind.${line.kind}` as Key)} aria-label={t(`minutes.kind.${line.kind}` as Key)}>{SIGNS[line.kind]}</span>
          <span class="text"
            >{#if line.marked}<strong>{t('minutes.marked')}:</strong> {/if}{markHidden(line.text)}{#if line.asset}<span class="muted"> ({markHidden(line.asset)})</span>{/if}</span
          >
          {#if canWrite && !cut && line.kind === 'text' && !line.marked && line.at !== ''}
            <span class="convert">
              {#each ['task', 'decision', 'question'] as const as to (to)}
                <button
                  type="button"
                  class="small"
                  disabled={busy}
                  aria-label={t('minutes.convert', { kind: t(`minutes.kind.${to}` as Key), text: markHidden(line.text) })}
                  onclick={() => convert(line, to)}>{SIGNS[to]}</button
                >
              {/each}
            </span>
          {/if}
          {#if canWrite && app.canAttach && line.kind === 'image' && line.asset && boardOfAsset(line.asset)}
            {@const name = boardOfAsset(line.asset) ?? ''}
            <button type="button" class="small" aria-label={t('minutes.board.edit', { name })} title={t('minutes.board.edit', { name })} onclick={() => (board = { name })}
              >✎</button
            >
          {/if}
        </li>
      {/each}
    </ol>
  {:else}
    <p class="muted">{t('meeting.empty')}</p>
  {/if}
  {#if drafts.length > 0}
    <div class="drafts" role="status">
      <p>{t('minutes.drafts', { n: drafts.length })}</p>
      <ul>
        {#each drafts as d, i (i)}<li><span class="at">{d.at}</span> {SIGNS[d.kind]} {markHidden(d.text)}</li>{/each}
      </ul>
    </div>
  {/if}
  {#if canWrite}
    <form class="entry" onsubmit={add}>
      <label data-hint={t('hint.form.meeting.minutes')}>
        <span class="visually-hidden">{t('minutes.input')}</span>
        <input spellcheck="true" type="text" bind:value={text} maxlength={MAX_CAPTURE + 20} placeholder={t('minutes.input')} aria-describedby="minutes-help" />
      </label>
      <button type="submit" disabled={text.trim() === ''}>{t('minutes.add')}</button>
    </form>
    <div class="buttons">
      {#each ['task', 'decision', 'question'] as const as kind (kind)}
        <button type="button" disabled={text.trim() === '' || busy} onclick={() => addAs(kind)}>{SIGNS[kind]} {t(`minutes.kind.${kind}` as Key)}</button>
      {/each}
      {#if app.canAttach}
        <button type="button" disabled={busy || app.uploading !== null} onclick={() => photoInput?.click()}>{SIGNS.image} {t('minutes.kind.image')}</button>
        <button type="button" disabled={busy || app.uploading !== null} onclick={() => audioInput?.click()}>{SIGNS.audio} {t('minutes.kind.audio')}</button>
        <button type="button" disabled={board !== null} onclick={() => (board = {})}>✎ {t('minutes.kind.board')}</button>
        <input bind:this={photoInput} type="file" accept="image/*" capture="environment" hidden onchange={() => attach('photo', photoInput)} />
        <input bind:this={audioInput} type="file" accept="audio/*" capture="user" hidden onchange={() => attach('audio', audioInput)} />
      {/if}
    </div>
    <p id="minutes-help" class="muted help">
      {t('minutes.help', { task: shortcuts.task, decision: shortcuts.decision, question: shortcuts.question, checklist: shortcuts.checklist, mark: shortcuts.mark })}
      <button type="button" class="link" onclick={() => (editing = editing ? null : { ...shortcuts })}>{t('minutes.shortcuts')}</button>
    </p>
    {#if editing}
      <form class="shortcuts" onsubmit={saveShortcuts}>
        {#each Object.keys(DEFAULT_SHORTCUTS) as (keyof Shortcuts)[] as key (key)}
          <label data-hint={t('hint.form.meeting.shortcut')}>
            <span>{t((key === 'checklist' || key === 'mark' ? `minutes.shortcut.${key}` : `minutes.kind.${key}`) as Key)}</span>
            <input spellcheck="false" type="text" bind:value={editing[key]} maxlength="8" size="4" />
          </label>
        {/each}
        <button type="submit">{t('minutes.shortcuts.save')}</button>
        <button type="button" onclick={() => (editing = { ...DEFAULT_SHORTCUTS })}>{t('minutes.shortcuts.reset')}</button>
      </form>
    {/if}
  {/if}
  {#if board}
    <Lazy
      {app}
      load={() => import('./BoardEditor.svelte')}
      extra={{ owner: 'meeting' as const, id, name: board.name, onsaved: boardSaved, onclose: () => (board = null) }}
      onfailed={() => (board = null)}
    />
  {/if}
</section>

<style>
  .lines {
    list-style: none;
    padding: 0;
    margin: 0 0 0.5rem;
    display: grid;
    gap: 0.15rem;
  }
  .lines li {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
  }
  .lines li.marked {
    border-left: 3px solid var(--accent);
    padding-left: 0.4rem;
  }
  .at {
    font-variant-numeric: tabular-nums;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .sign {
    width: 1.1rem;
    text-align: center;
  }
  .text {
    flex: 1;
    overflow-wrap: anywhere;
  }
  .convert {
    display: inline-flex;
    gap: 0.2rem;
  }
  .muted {
    color: var(--muted);
  }
  .drafts {
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    padding: 0.4rem 0.6rem;
    margin: 0.4rem 0;
  }
  .drafts p {
    margin: 0 0 0.2rem;
  }
  .drafts ul {
    margin: 0;
    padding-left: 1rem;
  }
  .entry {
    display: flex;
    gap: 0.5rem;
  }
  .entry label {
    flex: 1;
    display: grid;
  }
  .buttons,
  .shortcuts {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.4rem;
    align-items: end;
  }
  .shortcuts label {
    display: grid;
    gap: 0.1rem;
    font-size: 0.85rem;
  }
  .help {
    font-size: 0.85rem;
    margin: 0.3rem 0 0;
  }
  input[type='text'] {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.35rem 0.5rem;
  }
  button {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.3rem 0.7rem;
    cursor: pointer;
    font: inherit;
  }
  button.small {
    padding: 0 0.4rem;
    font-size: 0.85rem;
  }
  button.link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent);
    text-decoration: underline;
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
