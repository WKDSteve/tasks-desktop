<script lang="ts">
  // The acceptance view: the one list of the open live checks, in three groups (see `lib/abnahme.ts`): a test sheet green
  // by machine that waits for a judgement, a sheet done by hand (the engine reads the states line: `TaskEntry.sheets`),
  // and the live checks without a sheet (`needs-live-test`) with the boxes of their acceptance section. A sheet shows its
  // snapshots as text grids and its criteria as checkboxes; a tick is written into the task as the one changed line of
  // its body (`set_body` on the version read, so a change made meanwhile is not written over). When every point is ticked
  // the page offers `done` (the dialog of the finish), never while a sheet of the task is red, stale or never ran;
  // nothing is finished by itself. The filter of the app narrows it like every view (`app.shown`). Keys: `j`/`k` move
  // over tasks and points, Space ticks the point under the cursor (refused while a write is on its way).
  import type { App } from '../lib/app.svelte';
  import type { TaskDocument, TaskEntry } from '../lib/contract';
  import {
    GROUPS,
    abnahmeOf,
    allTicked,
    groupOf,
    parseAcceptance,
    parseSheets,
    progress,
    rowsOf,
    tickedOf,
    tickItem,
    troubleOf,
    waiting,
    type Group,
    type Item,
  } from '../lib/abnahme';
  import { ApiError } from '../lib/api';
  import { translate, type Key } from '../lib/i18n';
  import Info from 'appkit-ui/Info.svelte';
  import { markHidden } from '../lib/text';
  import FilterNote from './FilterNote.svelte';
  import { tick as settle } from 'svelte';

  let { app }: { app: App } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  type Doc = { state: 'loading' } | { state: 'ok'; doc: TaskDocument } | { state: 'failed'; etag?: string };
  type Snap = { state: 'loading' } | { state: 'ok'; rows: string[] } | { state: 'failed'; code: string };

  const groups = $derived(abnahmeOf(app.shown));
  const tasks = $derived(GROUPS.flatMap((g) => groups[g]));
  let docs = $state.raw<Record<string, Doc>>({});
  let snaps = $state.raw<Record<string, Snap>>({});
  // The id of the task whose body changed under a tick, to say so once.
  let changed = $state<string | null>(null);

  // A task is read when it is new here or its file changed (its etag differs from the one read).
  $effect(() => {
    for (const task of tasks) {
      const have = docs[task.id];
      if (have?.state === 'loading') continue;
      if (have?.state === 'ok' && have.doc.task.etag === task.etag) continue;
      if (have?.state === 'failed' && have.etag === task.etag) continue;
      void read(task.id, task.etag);
    }
  });

  async function read(id: string, etag: string | undefined): Promise<void> {
    docs = { ...docs, [id]: { state: 'loading' } };
    try {
      const doc = await app.readTask(id);
      docs = { ...docs, [id]: { state: 'ok', doc } };
    } catch {
      docs = { ...docs, [id]: { state: 'failed', etag } };
    }
  }

  // The snapshots of the sheets that wait are read once each (their names are in the block; a new run writes the same name).
  $effect(() => {
    for (const task of tasks) {
      const entry = docs[task.id];
      if (entry?.state !== 'ok' || !task.sheets) continue;
      for (const sheet of waiting(parseSheets(entry.doc.body))) {
        for (const name of sheet.snapshots) {
          if (!snaps[name]) void readSnap(name);
        }
      }
    }
  });

  // Without a hub the snapshots lie in a folder only the person can give: said once, not once per snapshot.
  const noCheckouts = $derived(Object.values(snaps).some((s) => s.state === 'failed' && s.code === 'no_checkouts'));

  async function chooseCheckouts(): Promise<void> {
    if (!(await app.chooseCheckouts())) return;
    for (const name of Object.keys(snaps)) void readSnap(name);
  }

  async function readSnap(name: string): Promise<void> {
    snaps = { ...snaps, [name]: { state: 'loading' } };
    try {
      snaps = { ...snaps, [name]: { state: 'ok', rows: rowsOf(await app.readSheetSnapshot(name)) } };
    } catch (error) {
      snaps = { ...snaps, [name]: { state: 'failed', code: error instanceof ApiError ? error.code : 'offline' } };
    }
  }

  /** Whether the tick was written; when not, the task is read again and the boxes are drawn from it (as it was). */
  async function tick(id: string, doc: TaskDocument, item: Item, checked: boolean): Promise<boolean> {
    if (doc.body_truncated) return false;
    const body = tickItem(doc.body, item, checked);
    if (body === null) {
      // The text is not what was read: read it again, write nothing.
      changed = id;
      await read(id, doc.task.etag);
      return false;
    }
    changed = null;
    const written = await app.setBody(id, body, doc.task.etag);
    // A refused write (a change made elsewhere, read only) leaves the task as it was: read it again.
    if (!written) await read(id, doc.task.etag);
    return written;
  }

  /** The points of a task to tick, in the order drawn: its waiting sheets' criteria, or its acceptance boxes. */
  function pointsOf(task: TaskEntry, doc: TaskDocument): Item[] {
    if (task.sheets) return waiting(parseSheets(doc.body)).flatMap((s) => [...s.items.filter((i) => i.kind === 'judge'), ...s.items.filter((i) => i.kind === 'manual')]);
    return parseAcceptance(doc.body);
  }

  // ── the cursor of the keys: a task's head or one of its points ──────────────────────────────────────────────────────
  type Stop = { key: string; id: string; item?: Item };
  const stops = $derived.by(() => {
    const out: Stop[] = [];
    for (const task of tasks) {
      out.push({ key: task.id, id: task.id });
      const entry = docs[task.id];
      if (entry?.state !== 'ok') continue;
      for (const item of pointsOf(task, entry.doc)) out.push({ key: `${task.id}#${item.line}`, id: task.id, item });
    }
    return out;
  });
  let cursor = $state<string | null>(null);
  let section: HTMLElement | undefined = $state();

  async function move(delta: number): Promise<void> {
    if (stops.length === 0) return;
    const at = stops.findIndex((s) => s.key === cursor);
    const next = at < 0 ? (delta > 0 ? 0 : stops.length - 1) : Math.max(0, Math.min(stops.length - 1, at + delta));
    cursor = stops[next]?.key ?? null;
    await settle();
    section?.querySelector('[data-cursor="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  async function tickCursor(): Promise<void> {
    const stop = stops.find((s) => s.key === cursor);
    if (!stop?.item) return;
    const entry = docs[stop.id];
    if (entry?.state !== 'ok' || entry.doc.body_truncated) return;
    // As in the inbox: no write while one is on its way (the toast says so), and none on a page that is read only.
    if (app.refusesKeyWrite()) return;
    await tick(stop.id, entry.doc, stop.item, !stop.item.checked);
  }

  function onKey(event: KeyboardEvent): boolean {
    // CapsLock turns j into J: the case of the letter is not trusted (as in the inbox).
    const letter = event.key.length === 1 && !event.shiftKey ? event.key.toLowerCase() : event.key;
    if (letter === 'j' || letter === 'k') {
      void move(letter === 'j' ? 1 : -1);
      return true;
    }
    if (event.key === ' ') {
      // Space on a button, a link or a box that has the focus does what it does there (a focused box ticks itself and
      // is the cursor, see `point`): the key of the view is for the cursor alone.
      if (event.target instanceof Element && event.target.closest('button, a, input, select, textarea, summary, [role="button"]')) return false;
      // Holding the key does not flip the box back and forth.
      if (!event.repeat) void tickCursor();
      return true;
    }
    return false;
  }

  $effect(() => {
    app.viewKeys = onKey;
    return () => {
      if (app.viewKeys === onKey) app.viewKeys = null;
    };
  });

  const kinds = ['judge', 'manual'] as const;
  const headings: Record<Group, Key> = { inbox: 'abnahme.group.inbox', manual: 'abnahme.group.manual', hand: 'abnahme.group.hand' };
</script>

{#snippet point(task: TaskEntry, doc: TaskDocument, item: Item)}
  {@const key = `${task.id}#${item.line}`}
  {@const here = cursor === key}
  <label class:cursor={here} data-cursor={here ? 'true' : undefined}>
    <input
      type="checkbox"
      checked={item.checked}
      disabled={doc.body_truncated || app.saving}
      onfocus={() => (cursor = key)}
      onchange={(event) => void tick(task.id, doc, item, event.currentTarget.checked)}
    />
    <span>{item.text}</span>
  </label>
{/snippet}

<section class="abnahme" aria-label={t('nav.abnahme')} bind:this={section}>
  <header class="intro">
    <FilterNote {app} />
    {#if noCheckouts && app.canChooseCheckouts}
      <p class="checkouts">
        {t('abnahme.no_checkouts')}
        <button type="button" onclick={() => void chooseCheckouts()}>{t('abnahme.choose_checkouts')}</button>
      </p>
    {/if}
    <div class="head">
      <h2>{t('nav.abnahme')}</h2>
      <Info hint={t('hint.abnahme')} label={t('hint.about', { what: t('nav.abnahme') })} />
    </div>
    <p class="keys">{t('abnahme.keys')}</p>
  </header>
  {#if tasks.length === 0}
    <p class="empty">{t('abnahme.none')}</p>
  {:else}
    {#each GROUPS as group (group)}
      {@const members = groups[group]}
      <section class="group" data-group={group} aria-labelledby={`abnahme-group-${group}`}>
        <h3 id={`abnahme-group-${group}`}>{t(headings[group])} <span class="n" data-count={members.length}>({members.length})</span></h3>
        {#each members as task (task.id)}
          {@const entry = docs[task.id]}
          {@const trouble = troubleOf(task)}
          {@const head = cursor === task.id}
          <article class="task" data-task={task.id} data-group={groupOf(task)}>
            <header class="thead" class:cursor={head} data-cursor={head ? 'true' : undefined}>
              <h4>{markHidden(task.title)}</h4>
              <span class="id">{task.id}</span>
              {#if app.machineActions && task.sheets}
                <button
                  type="button"
                  class="link"
                  data-action="run-sheets"
                  disabled={app.sheetRun?.state === 'running'}
                  onclick={() => void app.runSheets(task.id)}>{t('abnahme.run_sheets')}</button
                >
              {/if}
              <button type="button" class="link" onclick={() => app.reveal(task.id)}>{t('abnahme.open_task')}</button>
            </header>
            {#if trouble}
              <p class="trouble" role="note" data-trouble>
                {t('abnahme.trouble', { red: trouble.red, stale: trouble.stale, never: trouble.never })}
              </p>
            {/if}
            {#if app.sheetRun?.id === task.id && app.sheetRun.state !== 'idle'}
              <div class="run" data-run={app.sheetRun.state} role="status">
                {#if app.sheetRun.state === 'running'}
                  {t('abnahme.run_running')}
                {:else if app.sheetRun.state === 'failed'}
                  {markHidden(app.sheetRun.message ?? '')}
                {:else}
                  <strong>{t(app.sheetRun.code === 0 ? 'abnahme.run_green' : app.sheetRun.code === 1 ? 'abnahme.run_red' : 'abnahme.run_not_run')}</strong>
                  {#if app.sheetRun.lines && app.sheetRun.lines.length > 0}
                    <pre class="grid">{markHidden(app.sheetRun.lines.join('\n'))}</pre>
                  {/if}
                {/if}
              </div>
            {/if}
            {#if !entry || entry.state === 'loading'}
              <p class="note" role="status">{t('abnahme.loading')}</p>
            {:else if entry.state === 'failed'}
              <p class="note" role="alert">{t('abnahme.failed')}</p>
            {:else if task.sheets}
              {@const sheets = parseSheets(entry.doc.body)}
              {@const open = waiting(sheets)}
              {@const done = progress(sheets)}
              <p class="count" role="status">{t('abnahme.progress', { ticked: done.ticked, total: done.total })}</p>
              {#if entry.doc.body_truncated}<p class="note" role="alert">{t('abnahme.truncated')}</p>{/if}
              {#if changed === task.id}<p class="note" role="alert">{t('abnahme.changed')}</p>{/if}
              {#each open as sheet (sheet.id ?? sheet.title)}
                <div class="sheet">
                  <h5>{markHidden(sheet.title)}</h5>
                  {#if sheet.snapshots.length > 0}
                    <div class="snaps" aria-label={t('abnahme.snapshots')}>
                      {#each sheet.snapshots as name (name)}
                        {@const snap = snaps[name]}
                        <figure>
                          <figcaption>{name.slice(name.lastIndexOf('/') + 1)}</figcaption>
                          {#if !snap || snap.state === 'loading'}
                            <p class="note">{t('abnahme.loading')}</p>
                          {:else if snap.state === 'failed' && snap.code === 'no_checkouts'}
                            <p class="note">{t('abnahme.snap_waiting')}</p>
                          {:else if snap.state === 'failed'}
                            <p class="note" role="alert">{t('abnahme.snap_failed', { code: snap.code })}</p>
                          {:else}
                            <pre class="grid">{snap.rows.join('\n')}</pre>
                          {/if}
                        </figure>
                      {/each}
                    </div>
                  {/if}
                  {#each kinds as kind (kind)}
                    {@const items = sheet.items.filter((i) => i.kind === kind)}
                    {#if items.length > 0}
                      <fieldset class="points">
                        <legend>{t(kind === 'judge' ? 'abnahme.judge' : 'abnahme.manual')}</legend>
                        {#each items as item (item.line)}
                          {@render point(task, entry.doc, item)}
                        {/each}
                      </fieldset>
                    {/if}
                  {/each}
                </div>
              {/each}
              {#if allTicked(sheets) && !trouble}
                <div class="offer" role="status">
                  <span>{t('abnahme.all_ticked')}</span>
                  <button type="button" class="primary" onclick={() => void app.startFinish(task.id)}>{t('abnahme.finish')}</button>
                </div>
              {/if}
            {:else}
              {@const items = parseAcceptance(entry.doc.body)}
              {@const done = tickedOf(items)}
              <p class="count" role="status">{t('abnahme.progress', { ticked: done.ticked, total: done.total })}</p>
              {#if entry.doc.body_truncated}<p class="note" role="alert">{t('abnahme.truncated')}</p>{/if}
              {#if changed === task.id}<p class="note" role="alert">{t('abnahme.changed')}</p>{/if}
              {#if items.length > 0}
                <fieldset class="points">
                  <legend>{t('abnahme.acceptance')}</legend>
                  {#each items as item (item.line)}
                    {@render point(task, entry.doc, item)}
                  {/each}
                </fieldset>
              {:else}
                <p class="note">{t('abnahme.no_points')}</p>
              {/if}
              {#if done.ticked === done.total}
                <div class="offer" role="status">
                  <span>{t(items.length > 0 ? 'abnahme.all_ticked' : 'abnahme.nothing_to_tick')}</span>
                  <button type="button" class="primary" onclick={() => void app.startFinish(task.id)}>{t('abnahme.finish')}</button>
                </div>
              {/if}
            {/if}
          </article>
        {:else}
          <p class="note">{t('abnahme.group_empty')}</p>
        {/each}
      </section>
    {/each}
  {/if}
</section>

<style>
  .abnahme {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    min-height: 0;
  }
  .intro {
    padding: 0.2rem 0.2rem 0;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .head h2 {
    margin: 0;
    font-size: 1.05rem;
  }
  .keys {
    color: var(--muted);
    font-size: 0.85rem;
    margin: 0.2rem 0 0;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .group h3 {
    margin: 0.3rem 0 0;
    font-size: 0.95rem;
  }
  .group h3 .n {
    color: var(--muted);
    font-weight: normal;
  }
  .task {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.7rem 0.9rem;
  }
  .thead {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.2rem 0.7rem;
    border-radius: var(--radius);
  }
  .thead h4 {
    margin: 0;
    font-size: 1rem;
  }
  .cursor {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .id {
    color: var(--muted);
    font-size: 0.85rem;
  }
  .link {
    margin-left: auto;
    padding: 0;
    background: none;
    border: 0;
    color: var(--accent);
    cursor: pointer;
  }
  .count,
  .note,
  .empty {
    color: var(--muted);
    margin: 0.4rem 0;
  }
  .trouble {
    margin: 0.4rem 0;
    padding: 0.3rem 0.5rem;
    border-left: 3px solid var(--bad);
  }
  .sheet {
    margin-top: 0.6rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border);
  }
  .sheet h5 {
    margin: 0 0 0.4rem;
    font-size: 0.95rem;
  }
  .snaps {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-bottom: 0.5rem;
  }
  figure {
    margin: 0;
    max-width: 100%;
  }
  figcaption {
    color: var(--muted);
    font-size: 0.8rem;
  }
  .grid {
    margin: 0.2rem 0 0;
    padding: 0.4rem 0.5rem;
    overflow-x: auto;
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 0.8rem;
    line-height: 1.2;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .points {
    border: 0;
    margin: 0 0 0.4rem;
    padding: 0;
  }
  .points legend {
    color: var(--muted);
    font-size: 0.85rem;
    padding: 0;
  }
  label {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.15rem 0;
    border-radius: var(--radius);
  }
  .offer {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    margin-top: 0.7rem;
  }
</style>
