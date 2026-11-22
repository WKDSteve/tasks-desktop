<script lang="ts">
  // The view "Learning time" of the tab Lernpläne (concept "Reiter Lernpläne" 7): per learning path the planned hours
  // (a span), the hours done, what is left, a bar of done against planned (beyond the plan in --warn with "+3 h"), and
  // the weeks until done at the pace of the last four weeks. Every figure is the engine's (`PathEntry.hours`,
  // capability `path_hours`; `forecast_weeks` of `tasks.learn_history`; WEB-13). A row unfolds the sessions of its path
  // (`tasks.path` `schedule`), read when first unfolded. Read only.
  import { untrack } from 'svelte';
  import type { App } from '../lib/app.svelte';
  import { translate, type Key } from '../lib/i18n';
  import { isLearnTimeKey, learnTimeText, type LearnTimeKey } from '../lib/learnTimeTexts';
  import type { LearnHistory, PathDocument, Paths } from '../lib/contract';
  import Info from 'appkit-ui/Info.svelte';
  import ItemIcon from './ItemIcon.svelte';
  import { shownIcon } from '../lib/icons';
  import { markHidden } from '../lib/text';
  import { labelText } from '../lib/paths';
  import { forecastWeeks, rowProjects, span, timeRows, type TimeRow } from '../lib/learnTime';

  let { app }: { app: App } = $props();
  // The words of the view come with its chunk (lib/learnTimeTexts.ts); the others are the page's.
  const t = (key: Key | LearnTimeKey, params: Record<string, string | number> = {}) =>
    isLearnTimeKey(key) ? learnTimeText(app.lang, key, params) : translate(app.lang, key, params);

  const usable = $derived(app.can('paths') && app.can('path_hours'));
  const withPace = $derived(app.can('learn_history'));

  let doc = $state<Paths | null>(null);
  let history = $state<LearnHistory | null>(null);
  let problem = $state(false);
  let project = $state('');

  let asked = 0;
  async function read(): Promise<void> {
    const mine = ++asked;
    try {
      const [paths, series] = await Promise.all([
        app.paths(),
        // The forecast is a help, not the table: a series that cannot be read leaves the column empty.
        withPace ? app.learnHistory({ step: 'week' }).catch(() => null) : Promise.resolve(null),
      ]);
      if (mine !== asked) return;
      doc = paths;
      history = series;
      problem = false;
      sessions = new Map();
      for (const id of unfolded) void readSessions(id);
    } catch {
      if (mine !== asked) return;
      problem = true;
    }
  }
  $effect(() => {
    void app.writes;
    void app.snapshot?.rev;
    if (!usable) return;
    untrack(() => void read());
  });

  const rows = $derived(doc ? timeRows(doc.items, history) : []);
  const projects = $derived(rowProjects(rows));
  const shown = $derived(project === '' ? rows : rows.filter((r) => r.project === project));
  const projectTitle = (id: string): string => app.snapshot?.projects?.find((p) => p.id === id)?.title ?? id;
  $effect(() => {
    if (project !== '' && doc && !projects.includes(project)) project = '';
  });

  // The sessions of the unfolded rows, by path id: read when a row is first unfolded, again after a read of the list.
  type Sessions = { state: 'reading' } | { state: 'failed' } | { state: 'ready'; list: NonNullable<PathDocument['schedule']> };
  let unfolded = $state<ReadonlySet<string>>(new Set());
  let sessions = $state<ReadonlyMap<string, Sessions>>(new Map());
  async function readSessions(id: string): Promise<void> {
    sessions = new Map(sessions).set(id, { state: 'reading' });
    let next: Sessions;
    try {
      const path = await app.path(id);
      next = { state: 'ready', list: path.schedule ?? [] };
    } catch {
      next = { state: 'failed' };
    }
    if (unfolded.has(id)) sessions = new Map(sessions).set(id, next);
  }
  function toggle(id: string): void {
    const next = new Set(unfolded);
    if (next.has(id)) next.delete(id);
    else {
      next.add(id);
      if (!sessions.has(id)) void readSessions(id);
    }
    unfolded = next;
  }

  const number = $derived(new Intl.NumberFormat(app.lang === 'de' ? 'de-DE' : 'en-US', { maximumFractionDigits: 2 }));
  const h = (n: number): string => t('learntime.h', { n: number.format(n) });
  const hSpan = (min: number, max: number): string => t('learntime.h', { n: span(min, max, (n) => number.format(n)) });
  function weeks(row: TimeRow): string | null {
    const w = forecastWeeks(row.forecast);
    if (!w) return null;
    if (w.min !== w.max) return t('learntime.weeks_span', { min: w.min, max: w.max });
    return w.min === 1 ? t('learntime.weeks_one') : t('learntime.weeks', { n: w.min });
  }
  const percent = (row: TimeRow): number => Math.round(row.share * 100);
  const STATE_MARK = { open: '○', partial: '◐', done: '✓' } as const;
</script>

<section class="learntime" aria-labelledby="learntime-title">
  <header class="intro">
    <div class="head">
      <h2 id="learntime-title">{t('learntime.title')}</h2>
      <Info hint={t('learntime.intro')} label={t('hint.about', { what: t('learntime.title') })} />
    </div>
  </header>

  {#if !usable}
    <p class="none">{t('learntime.no_engine')}</p>
  {:else if problem && !doc}
    <div class="empty" role="alert">
      <p>{t('learntime.failed')}</p>
      <button type="button" onclick={() => void read()}>{t('learntime.retry')}</button>
    </div>
  {:else if !doc}
    <p class="none" role="status">{t('learntime.reading')}</p>
  {:else if rows.length === 0}
    <div class="empty">
      <p><strong>{t('learntime.none')}</strong></p>
      <p>{t('learntime.none_how')}</p>
      <button type="button" class="primary" onclick={() => app.setView('paths')}>{t('learntime.to_paths')}</button>
    </div>
  {:else}
    {#if projects.length > 0}
      <div class="tools">
        <label class="field" data-hint={t('learntime.hint.project')}
          >{t('learntime.project')}
          <select bind:value={project}>
            <option value="">{t('learntime.project.all')}</option>
            {#each projects as id (id)}<option value={id}>{markHidden(projectTitle(id))}</option>{/each}
          </select></label
        >
      </div>
    {/if}
    {#if shown.length === 0}
      <p class="none">{t('learntime.none_filtered')}</p>
    {:else}
      <div class="scroll">
        <table>
          <caption class="sr-only">{t('learntime.table', { n: shown.length })}</caption>
          <thead>
            <tr>
              <th scope="col">{t('learntime.col.path')}</th>
              <th scope="col" class="num">{t('learntime.col.planned')}</th>
              <th scope="col" class="num">{t('learntime.col.done')}</th>
              <th scope="col" class="num">{t('learntime.col.left')}</th>
              <th scope="col">{t('learntime.col.bar')}</th>
              <th scope="col">{t('learntime.col.forecast')}</th>
            </tr>
          </thead>
          <tbody>
            {#each shown as row (row.id)}
              {@const title = markHidden(row.title)}
              {@const isOpen = unfolded.has(row.id)}
              {@const w = weeks(row)}
              <tr data-path={row.id} class:over={row.over > 0}>
                <th scope="row" data-label={t('learntime.col.path')}>
                  <span class="name">
                    <button
                      type="button"
                      class="fold"
                      aria-expanded={isOpen}
                      aria-controls="learntime-sessions-{row.id}"
                      aria-label={t('learntime.sessions_of', { title })}
                      onclick={() => toggle(row.id)}><span aria-hidden="true">{isOpen ? '▾' : '▸'}</span></button
                    >
                    <ItemIcon {app} shown={shownIcon({ kind: 'path', id: row.id, icon: row.icon })} />
                    <button type="button" class="link" aria-label={t('learntime.open_path', { title })} onclick={() => app.openPath(row.id)}>{title}</button>
                  </span>
                </th>
                <td class="num" data-label={t('learntime.col.planned')}>{hSpan(row.hours.planned_min, row.hours.planned_max)}</td>
                <td class="num" data-label={t('learntime.col.done')}>{h(row.hours.done)}</td>
                <td class="num" data-label={t('learntime.col.left')}>{hSpan(row.hours.open_min, row.hours.open_max)}</td>
                <td data-label={t('learntime.col.bar')}>
                  <span class="barline">
                    <span class="bar" aria-hidden="true"><span class="fill" style:inline-size="{percent(row)}%"></span></span>
                    {#if row.over > 0}
                      <span class="overrun"><span aria-hidden="true">▲</span> <span aria-hidden="true">{t('learntime.over_short', { n: number.format(row.over) })}</span><span class="sr-only">{t('learntime.over', { n: number.format(row.over) })}</span></span>
                    {:else}
                      <span class="sub">{t('learntime.within', { percent: percent(row) })}</span>
                    {/if}
                  </span>
                </td>
                <td data-label={t('learntime.col.forecast')}>
                  {#if w}{w}{:else}<span class="sub" title={t('learntime.no_pace_hint')}>{t('learntime.no_pace')}</span>{/if}
                </td>
              </tr>
              {#if isOpen}
                {@const s = sessions.get(row.id)}
                <tr class="sessions-row" id="learntime-sessions-{row.id}">
                  <td colspan="6">
                    {#if !s || s.state === 'reading'}
                      <p class="sub" role="status">{t('learntime.sessions_reading')}</p>
                    {:else if s.state === 'failed'}
                      <p role="alert">{t('learntime.sessions_failed')}</p>
                    {:else if s.list.length === 0}
                      <p class="sub">{t('learntime.sessions_none')}</p>
                    {:else}
                      <table class="sessions">
                        <caption class="sr-only">{t('learntime.sessions_of', { title })}</caption>
                        <thead>
                          <tr>
                            <th scope="col">{t('learntime.col.session')}</th>
                            <th scope="col" class="num">{t('learntime.col.planned')}</th>
                            <th scope="col" class="num">{t('learntime.col.done')}</th>
                            <th scope="col">{t('learntime.col.state')}</th>
                            <th scope="col">{t('learntime.col.result')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {#each s.list as session (session.index)}
                            <tr data-state={session.state}>
                              <th scope="row" data-label={t('learntime.col.session')}>{markHidden(labelText(session))}</th>
                              <td class="num" data-label={t('learntime.col.planned')}>{hSpan(session.planned_min, session.planned_max)}</td>
                              <td class="num" data-label={t('learntime.col.done')}>{h(session.done)}</td>
                              <td data-label={t('learntime.col.state')}
                                ><span class="state {session.state}"><span aria-hidden="true">{STATE_MARK[session.state]}</span> {t(`learntime.state.${session.state}`)}</span>
                                <span class="sub">({t('learntime.closed', { closed: session.closed, total: session.total })})</span></td
                              >
                              <td data-label={t('learntime.col.result')}>{session.result ? markHidden(session.result) : ''}</td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    {/if}
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</section>

<style>
  .learntime {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.5rem 0;
    container-type: inline-size;
  }
  .intro .head,
  .tools,
  .name,
  .barline {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  h2,
  p {
    margin: 0;
  }
  .none,
  .sub {
    color: var(--muted);
  }
  .field {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  select {
    font: inherit;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.2rem 0.4rem;
  }
  .scroll {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    inline-size: 100%;
    background: var(--surface);
  }
  th,
  td {
    text-align: start;
    padding: 0.4rem 0.5rem;
    border-block-end: 1px solid var(--line);
    vertical-align: middle;
  }
  thead th {
    color: var(--muted);
    font-weight: 600;
  }
  tbody th {
    font-weight: 600;
  }
  .num {
    text-align: end;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .bar {
    display: inline-block;
    inline-size: 8rem;
    block-size: 0.6rem;
    border: 1px solid var(--muted);
    border-radius: 999px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .fill {
    display: block;
    block-size: 100%;
    background: var(--accent);
  }
  tr.over .bar {
    border-color: var(--warn);
  }
  tr.over .fill {
    background: var(--warn);
  }
  .overrun {
    color: var(--warn);
    font-weight: 600;
  }
  .sessions-row > td {
    background: var(--surface-2);
    padding-inline-start: 2rem;
  }
  .sessions {
    background: var(--surface);
  }
  .state.done {
    color: var(--ok);
  }
  .state.partial {
    color: var(--accent);
  }
  .state.open {
    color: var(--muted);
  }
  button:not(.link):not(.fold) {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.25rem 0.6rem;
    min-height: 2rem;
    font: inherit;
    cursor: pointer;
  }
  button.primary {
    background: var(--accent);
    color: var(--accent-text);
    border-color: var(--accent);
  }
  .fold {
    background: none;
    border: 0;
    color: var(--text);
    font: inherit;
    cursor: pointer;
    min-inline-size: 1.75rem;
    min-block-size: 1.75rem;
  }
  .link {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    text-decoration: underline;
    text-align: start;
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
  /* A narrow window: every row a card, each value under its column's name. */
  @container (inline-size < 600px) {
    table,
    thead,
    tbody,
    tr,
    th,
    td {
      display: block;
    }
    thead {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
    tbody > tr:not(.sessions-row) {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      margin-block-end: 0.5rem;
    }
    tbody td,
    tbody th {
      border: 0;
      text-align: start;
    }
    tbody td[data-label]::before {
      content: attr(data-label) ': ';
      color: var(--muted);
    }
    .sessions-row > td {
      padding-inline-start: 0.5rem;
    }
  }
  @media (forced-colors: active) {
    .fill,
    tr.over .fill {
      background: CanvasText;
    }
    .overrun,
    .state.done,
    .state.partial {
      color: CanvasText;
    }
  }
</style>
