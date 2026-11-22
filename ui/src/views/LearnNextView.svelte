<script lang="ts">
  // The view "Next learning step" of the tab Lernpläne (concept "Reiter Lernpläne" 4): for every running learning path
  // the next point to learn now, chosen by the engine (`tasks.learn_next`, capability `learn_next`; WEB-13), with the
  // two after it folded below. A card marks its point learned, seen or not applicable (`node_set`, the way the view of
  // the paths writes, refused with `write.busy` while a write is on its way) and opens it in the path. A point under
  // `{safety}` asks before it is closed and is sent with `ack`. The keys l, s, n and Enter act only on the card that
  // holds the focus, never on the page.
  import { tick, untrack } from 'svelte';
  import type { App } from '../lib/app.svelte';
  import { translate, type Key } from '../lib/i18n';
  import { isLearnNextKey, learnNextText, type LearnNextKey } from '../lib/learnNextTexts';
  import type { LearnNext, LearnPoint } from '../lib/contract';
  import Info from 'appkit-ui/Info.svelte';
  import { hostOf } from 'appkit-ui/markdown';
  import ItemIcon from './ItemIcon.svelte';
  import { shownIcon } from '../lib/icons';
  import { markHidden } from '../lib/text';
  import { cleanReason, labelText, openableLink, pointRef, REASON_MAX } from '../lib/paths';
  import {
    cardKey,
    hoursText,
    ofProject,
    projectsOf,
    stepNeedsAck,
    stepNeedsReason,
    stepOp,
    type LearnNextItem,
    type StepState,
  } from '../lib/learnNext';

  let { app }: { app: App } = $props();
  // The words of the view come with its chunk (lib/learnNextTexts.ts); the others are the page's.
  const t = (key: Key | LearnNextKey, params: Record<string, string | number> = {}) =>
    isLearnNextKey(key) ? learnNextText(app.lang, key, params) : translate(app.lang, key, params);

  type Machine = '' | 'private' | 'workstation' | 'wsl';
  const MACHINES: readonly Machine[] = ['', 'private', 'workstation', 'wsl'];

  const usable = $derived(app.can('learn_next') && app.can('path'));
  const game = $derived(app.gamification && app.can('xp'));

  let doc = $state<LearnNext | null>(null);
  let problem = $state(false);
  let reading = $state(false);
  let project = $state('');
  let machine = $state<Machine>('');
  // The card whose reason is being written, or whose safety question is open (by path id).
  let asking = $state<{ path: string; state: StepState; kind: 'reason' | 'confirm'; missing: boolean } | null>(null);
  let draft = $state('');
  let root: HTMLElement | undefined = $state();

  // Each question has a number: an answer that comes after another was asked is dropped.
  let asked = 0;
  async function read(): Promise<void> {
    const mine = ++asked;
    reading = true;
    try {
      const answer = await app.learnNext(machine === '' ? { n: 3 } : { n: 3, machine });
      if (mine !== asked) return;
      doc = answer;
      problem = false;
      // A question left open on a card whose path has no step any more closes.
      if (asking && !answer.items.some((i) => i.path === asking!.path)) asking = null;
    } catch {
      if (mine !== asked) return;
      problem = true;
    } finally {
      if (mine === asked) reading = false;
    }
  }
  // Read when the view opens, after every write, when the hub tells of a change and when the machine changes.
  $effect(() => {
    void app.writes;
    void app.snapshot?.rev;
    void machine;
    if (!usable) return;
    untrack(() => void read());
  });

  const all = $derived(doc?.items ?? []);
  const projects = $derived(projectsOf(all));
  const projectTitle = (id: string): string => app.snapshot?.projects?.find((p) => p.id === id)?.title ?? id;
  const shown = $derived(ofProject(all, project));
  // The project chosen is gone from the list (its paths finished): every project again.
  $effect(() => {
    if (project !== '' && doc && !projects.includes(project)) project = '';
  });
  const busy = $derived(app.saving || reading);

  const label = (point: LearnPoint): string => markHidden(labelText(point));

  /** Whether a change must wait (a write on its way, or the list being read again): then it is said, not sent. */
  function refused(): boolean {
    if (!busy) return false;
    app.tell('error', app.saving ? 'write.busy' : 'paths.busy_reading');
    return true;
  }

  async function focusCard(path: string, field?: string): Promise<void> {
    await tick();
    const card = [...(root?.querySelectorAll<HTMLElement>('article[data-path]') ?? [])].find((a) => a.dataset['path'] === path);
    const target = (field ? card?.querySelector<HTMLElement>(field) : null) ?? card;
    target?.focus();
  }

  function send(item: LearnNextItem, state: StepState, reason?: string, ack = false): void {
    const point = item.points[0];
    void app.write([stepOp(item.path, point, state, reason, ack)]).then(() => focusCard(item.path));
  }

  /** The choice of a card: learned goes at once (after the safety question), seen and dropped ask for a reason first. */
  function choose(item: LearnNextItem, state: StepState): void {
    const point = item.points[0];
    if (stepNeedsReason(state)) {
      draft = '';
      asking = { path: item.path, state, kind: 'reason', missing: false };
      void focusCard(item.path, 'textarea, input.reason');
      return;
    }
    if (stepNeedsAck(point, state)) {
      asking = { path: item.path, state, kind: 'confirm', missing: false };
      void focusCard(item.path, 'button.confirm-no');
      return;
    }
    if (!refused()) send(item, state);
  }

  function saveReason(item: LearnNextItem): void {
    if (!asking || asking.kind !== 'reason') return;
    const reason = cleanReason(draft);
    if (reason === null) {
      asking = { ...asking, missing: true };
      return;
    }
    // Refused while busy: the field stays open with what is typed.
    if (refused()) return;
    const state = asking.state;
    if (stepNeedsAck(item.points[0], state)) {
      // The reason is kept; the safety question comes next and sends both.
      pendingReason = reason;
      asking = { path: item.path, state, kind: 'confirm', missing: false };
      void focusCard(item.path, 'button.confirm-no');
      return;
    }
    asking = null;
    send(item, state, reason);
  }
  let pendingReason: string | undefined;

  function confirm(item: LearnNextItem): void {
    if (!asking || asking.kind !== 'confirm' || refused()) return;
    const { state } = asking;
    const reason = pendingReason;
    pendingReason = undefined;
    asking = null;
    send(item, state, reason, true);
  }

  function cancel(item: LearnNextItem): void {
    asking = null;
    pendingReason = undefined;
    void focusCard(item.path);
  }

  function openInPath(item: LearnNextItem, point: LearnPoint = item.points[0]): void {
    app.openPath(item.path, pointRef(point));
  }

  /** The keys of a card, only while it (or a control on it) holds the focus and no field is being written. */
  function onCardKey(event: KeyboardEvent, item: LearnNextItem): void {
    const target = event.target as HTMLElement;
    if (target.closest('textarea, input, select, details > summary, a, .ask')) return;
    const what = cardKey(event);
    if (what === null) return;
    // Enter on a button is the button's own.
    if (what === 'open' && target !== event.currentTarget) return;
    event.preventDefault();
    if (what === 'open') openInPath(item);
    else choose(item, what);
  }
</script>

<section class="learnnext" aria-labelledby="learnnext-title" bind:this={root}>
  <header class="intro">
    <div class="head">
      <h2 id="learnnext-title">{t('learnnext.title')}</h2>
      <Info hint={t('learnnext.intro')} label={t('hint.about', { what: t('learnnext.title') })} />
    </div>
    <p class="keys">{t('learnnext.keys')}</p>
  </header>

  {#if !usable}
    <p class="none">{t('learnnext.no_engine')}</p>
  {:else}
    <div class="tools">
      {#if projects.length > 0}
        <label class="field" data-hint={t('learnnext.hint.project')}
          >{t('learnnext.project')}
          <select bind:value={project}>
            <option value="">{t('learnnext.project.all')}</option>
            {#each projects as id (id)}<option value={id}>{markHidden(projectTitle(id))}</option>{/each}
          </select></label
        >
      {/if}
      <label class="field" data-hint={t('learnnext.hint.machine')}
        >{t('learnnext.machine')}
        <select bind:value={machine}>
          {#each MACHINES as m (m)}<option value={m}>{t(m === '' ? 'learnnext.machine.all' : `learnnext.machine.${m}`)}</option>{/each}
        </select></label
      >
      <span class="status" role="status">{#if app.saving}{t('learnnext.saving')}{:else if reading && doc}{t('learnnext.reading')}{/if}</span>
    </div>

    {#if problem && !doc}
      <div class="empty" role="alert">
        <p>{t('learnnext.failed')}</p>
        <button type="button" onclick={() => void read()}>{t('learnnext.retry')}</button>
      </div>
    {:else if !doc}
      <p class="none" role="status">{t('learnnext.reading')}</p>
    {:else if shown.length === 0}
      <div class="empty">
        {#if all.length > 0}
          <p>{t('learnnext.none_filtered')}</p>
        {:else}
          <p><strong>{t('learnnext.none')}</strong></p>
          <p>{t('learnnext.none_how')}</p>
          <button type="button" class="primary" onclick={() => app.setView('paths')}>{t('learnnext.begin')}</button>
        {/if}
      </div>
    {:else}
      {#if doc.incomplete.length > 0}
        <p class="note" role="note">{t('learnnext.incomplete', { list: doc.incomplete.map(markHidden).join(', ') })}</p>
      {/if}
      <ul class="cards" aria-label={t('learnnext.list', { n: shown.length })}>
        {#each shown as item (item.path)}
          {@const point = item.points[0]}
          {@const text = label(point)}
          {@const link = openableLink(point.link)}
          {@const hours = hoursText(point)}
          {@const open = asking?.path === item.path ? asking : null}
          <li>
            <!-- The card is one stop of the Tab key with its shortcuts (l, s, n, Enter); each is a button on it as well. -->
            <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
            <article
              class="card"
              class:safety={point.safety}
              data-path={item.path}
              data-point={pointRef(point)}
              tabindex="0"
              aria-label={t('learnnext.card', { path: markHidden(item.title), point: text })}
              aria-describedby="learnnext-keys-{item.path}"
              onkeydown={(e) => onCardKey(e, item)}
            >
              <header>
                <ItemIcon {app} shown={shownIcon({ kind: 'path', id: item.path, icon: item.icon })} />
                <h3>{markHidden(item.title)}</h3>
                <span class="sub">{t(item.stage === 'doing' ? 'learnnext.path_stage.doing' : 'learnnext.path_stage.idle')}</span>
              </header>
              <p class="label">{text}</p>
              <ul class="meta">
                <li>{t('learnnext.stage', { label: markHidden(labelText({ label: point.stage_label })) })}</li>
                {#if link}
                  <li>
                    <a href={link} target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">{t('learnnext.source', { host: hostOf(link) ?? link })}</a>
                  </li>
                {/if}
                {#if hours}<li>{t('learnnext.hours', { h: hours })}</li>{/if}
                {#if game && point.xp !== undefined}<li>{t('learnnext.xp', { n: point.xp })}</li>{/if}
                {#if point.machine}<li>{t('learnnext.machines', { list: point.machine.join(', ') })}</li>{/if}
                {#if point.promoted}<li>{t('learnnext.promoted', { id: point.promoted })}</li>{/if}
                {#if point.safety}
                  <li class="badge" title={t('learnnext.safety_hint', { safety: '{safety}' })}><span aria-hidden="true">⚠</span> {t('learnnext.safety')}</li>
                {/if}
              </ul>
              <span id="learnnext-keys-{item.path}" class="sr-only">{t('learnnext.keys')}</span>

              {#if open?.kind === 'reason'}
                <form
                  class="ask"
                  data-hint={t('learnnext.hint.reason')}
                  onsubmit={(e) => {
                    e.preventDefault();
                    saveReason(item);
                  }}
                >
                  <label for="learnnext-reason-{item.path}">{t(open.state === 'seen' ? 'learnnext.reason.seen' : 'learnnext.reason.dropped')}</label>
                  <input
                    id="learnnext-reason-{item.path}"
                    class="reason"
                    type="text"
                    maxlength={REASON_MAX}
                    bind:value={draft}
                    onkeydown={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        cancel(item);
                      }
                    }}
                    aria-invalid={open.missing ? 'true' : undefined}
                    aria-describedby={open.missing ? `learnnext-missing-${item.path}` : undefined}
                  />
                  {#if open.missing}<p id="learnnext-missing-{item.path}" class="missing" role="alert">{t('learnnext.reason.required')}</p>{/if}
                  <div class="row">
                    <button type="submit" class="primary">{t('learnnext.reason.save')}</button>
                    <button type="button" onclick={() => cancel(item)}>{t('learnnext.reason.cancel')}</button>
                  </div>
                </form>
              {:else if open?.kind === 'confirm'}
                <div class="ask" role="group" aria-labelledby="learnnext-confirm-{item.path}">
                  <p id="learnnext-confirm-{item.path}"><span aria-hidden="true">⚠</span> {t('learnnext.confirm', { state: t(`learnnext.state.${open.state as 'learned' | 'seen'}`) })}</p>
                  <div class="row">
                    <button type="button" class="primary" aria-disabled={busy ? 'true' : undefined} onclick={() => confirm(item)}>{t('learnnext.confirm.yes')}</button>
                    <button type="button" class="confirm-no" onclick={() => cancel(item)}>{t('learnnext.confirm.no')}</button>
                  </div>
                </div>
              {/if}

              <footer>
                <button type="button" class="primary" aria-label={t('learnnext.learned_of', { label: text })} aria-disabled={busy ? 'true' : undefined} onclick={() => choose(item, 'learned')}
                  ><span aria-hidden="true">✓</span> {t('learnnext.learned')}</button
                >
                <button type="button" aria-label={t('learnnext.seen_of', { label: text })} aria-disabled={busy ? 'true' : undefined} onclick={() => choose(item, 'seen')}
                  ><span aria-hidden="true">◐</span> {t('learnnext.seen')}</button
                >
                <button type="button" aria-label={t('learnnext.dropped_of', { label: text })} aria-disabled={busy ? 'true' : undefined} onclick={() => choose(item, 'dropped')}
                  ><span aria-hidden="true">–</span> {t('learnnext.dropped')}</button
                >
                <button type="button" class="link" aria-label={t('learnnext.open_of', { label: text })} onclick={() => openInPath(item)}>{t('learnnext.open')}</button>
              </footer>

              {#if item.points.length > 1}
                <details class="after">
                  <summary>{t('learnnext.after', { n: item.points.length - 1 })}</summary>
                  <ol>
                    {#each item.points.slice(1) as next (next.index)}
                      {@const nextHours = hoursText(next)}
                      <li>
                        <button type="button" class="link" aria-label={t('learnnext.open_of', { label: label(next) })} onclick={() => openInPath(item, next)}>{label(next)}</button>
                        {#if nextHours}<span class="sub">· {t('learnnext.hours', { h: nextHours })}</span>{/if}
                        {#if next.safety}<span class="sub">· <span aria-hidden="true">⚠</span> {t('learnnext.safety')}</span>{/if}
                      </li>
                    {/each}
                  </ol>
                </details>
              {/if}
            </article>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<style>
  .learnnext {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.5rem 0;
  }
  .intro .head,
  .tools,
  .card > header,
  footer,
  .row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  h2,
  h3,
  p {
    margin: 0;
  }
  h3 {
    font-size: 1rem;
  }
  .keys,
  .none,
  .sub,
  .status,
  .meta,
  .note {
    color: var(--muted);
  }
  .field {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  select,
  input {
    font: inherit;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.2rem 0.4rem;
  }
  ul,
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 22rem), 1fr));
    gap: 0.75rem;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    height: 100%;
    box-sizing: border-box;
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.75rem;
  }
  .card:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .card.safety {
    border-left: 4px solid var(--warn);
  }
  .label {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.75rem;
    font-size: 0.9em;
  }
  .meta a {
    color: var(--accent);
  }
  .badge {
    color: var(--warn);
    font-weight: 600;
  }
  .ask {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    border-top: 1px solid var(--border);
    padding-top: 0.45rem;
  }
  .missing {
    color: var(--bad);
  }
  footer {
    margin-top: auto;
  }
  button:not(.link) {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.25rem 0.6rem;
    min-height: 2rem;
    font: inherit;
    cursor: pointer;
  }
  button[aria-disabled='true'] {
    cursor: default;
    opacity: 0.6;
  }
  button.primary {
    background: var(--accent);
    color: var(--accent-text);
    border-color: var(--accent);
  }
  .link {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
    text-decoration: underline;
    text-align: left;
  }
  .after summary {
    cursor: pointer;
    color: var(--muted);
  }
  .after ol {
    margin-top: 0.3rem;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 1rem;
    background: var(--surface);
    border: 1px dashed var(--border);
    border-radius: var(--radius);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  @media (forced-colors: active) {
    .card.safety {
      border-left-color: CanvasText;
    }
    .badge {
      color: CanvasText;
    }
  }
</style>
