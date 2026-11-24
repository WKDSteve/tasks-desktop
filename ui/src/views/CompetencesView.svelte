<script lang="ts">
  // The catalogue of the competences (concept "Reiter Lernpläne" 5): a table per group, a row per field of knowledge with
  // its stage in theory and practice as a ladder of 8 rungs (reached filled, a half stage half, the 12-month target framed,
  // the 24-month one dashed; always also as number and name), the targets, the learning paths that lead there (a chip with
  // stage symbol and progress, opens the path) and the evidence given and open. A row opens below it: the text of the file
  // (Markdown reader of the kit; untrusted), the day it was assessed, the file. Read only. The stages, the scale and which
  // path serves which field are the engine's (`tasks.competences`, `tasks.learn_evidence`, `tasks.paths`; WEB-13).
  import { untrack } from 'svelte';
  import type { App } from '../lib/app.svelte';
  import type { Key } from '../lib/i18n';
  import type { Competences, LearnEvidence, PathEntry, PathStage, Paths } from '../lib/contract';
  import Info from 'appkit-ui/Info.svelte';
  import LearnScopeNote from './LearnScopeNote.svelte';
  import { scopeOf } from '../lib/learnScope';
  import Blocks from 'appkit-ui/Blocks.svelte';
  import { parseMarkdown } from 'appkit-ui/markdown';
  import { markHidden } from '../lib/text';
  import { dayDate } from '../lib/badges';
  import { COMPETENCE_EXAMPLE, competenceTexts, type CompetenceKey } from '../lib/competenceTexts';
  import {
    AXES,
    competenceGroups,
    evidenceCounts,
    ladder,
    pathsOf,
    pathsWithoutCompetence,
    stageText,
    targetOf,
    targetRung,
    type Axis,
    type Competence,
    type CompetenceSort,
  } from '../lib/competences';

  let { app }: { app: App } = $props();
  const t = (key: CompetenceKey | Key, params: Record<string, string | number> = {}) => competenceTexts.t(app.lang, key, params);

  const usable = $derived(app.can('competences'));
  const withEvidence = $derived(app.can('learn_evidence'));

  // The fields, the paths (the finished ones too, for their chips) and the evidence: read together when the view opens,
  // after every write and when the hub tells of a change. A path list or evidence that fails leaves the catalogue whole.
  let doc = $state<Competences | null>(null);
  let paths = $state<PathEntry[]>([]);
  let evidence = $state<LearnEvidence['items'] | null>(null);
  let problem = $state(false);
  // The area filter of the page (lib/learnScope.ts): the fields of its areas (a field belongs to the area its file is
  // in, as the engine scopes them) and the evidence of the paths of its areas; read again when it changes. The fields
  // are read whole and narrowed here: which path a field of another area serves still counts for "paths without a field".
  const scope = $derived(scopeOf(app));
  const asking = $derived(JSON.stringify(scope.query));
  let asked = 0;
  async function read(): Promise<void> {
    const mine = ++asked;
    const query = scope.query;
    const pathsRead: Promise<Paths | null> = app.can('paths') ? app.pathsForMap().catch(() => null) : Promise.resolve(null);
    const evidenceRead: Promise<LearnEvidence | null> = withEvidence ? app.learnEvidence({ include_done: true, ...query }).catch(() => null) : Promise.resolve(null);
    try {
      const [answer, pathDoc, evidenceDoc] = await Promise.all([app.competences(), pathsRead, evidenceRead]);
      if (mine !== asked) return;
      doc = answer;
      paths = pathDoc?.items ?? [];
      evidence = evidenceDoc ? scope.keep(evidenceDoc.items) : null;
      problem = false;
    } catch {
      if (mine !== asked) return;
      problem = true;
    }
  }
  $effect(() => {
    void app.writes;
    void app.snapshot?.rev;
    void asking;
    if (!usable) return;
    untrack(() => void read());
  });

  let withTarget = $state(false);
  let withPath = $state(false);
  let text = $state('');
  let sort = $state<CompetenceSort>('name');
  const items = $derived(scope.keep(doc?.items ?? []));
  const groups = $derived(competenceGroups(items, paths, { withTarget, withPath, text }, sort));
  const counts = $derived(evidenceCounts(evidence ?? []));
  const without = $derived(pathsWithoutCompetence(scope.keep(paths), doc?.items ?? []));
  const scale = $derived(doc?.scale);

  const stage = (level: number): string => stageText(scale, level, app.lang);
  const axisName = (axis: Axis): string => t(axis === 't' ? 'competences.axis.t' : 'competences.axis.p');
  /** The name of a ladder for a screen reader: "Theory: 3 Profi, target in 12 months 4 Bachelor". */
  function ladderName(item: Competence, axis: Axis): string {
    const now = item[axis];
    const parts = [t('competences.ladder', { axis: axisName(axis), stage: now === undefined ? t('competences.unassessed') : stage(now) })];
    const t12 = targetOf(item.target_12, axis);
    const t24 = targetOf(item.target_24, axis);
    if (t12 !== undefined) parts.push(t('competences.ladder_target12', { stage: stage(t12) }));
    if (t24 !== undefined) parts.push(t('competences.ladder_target24', { stage: stage(t24) }));
    return parts.join(', ');
  }
  function targetList(target: Competence['target_12']): string | null {
    const parts = AXES.flatMap((axis) => {
      const level = targetOf(target, axis);
      return level === undefined ? [] : [t('competences.target_axis', { axis: axis.toUpperCase(), stage: stage(level) })];
    });
    return parts.length === 0 ? null : parts.join(', ');
  }

  const STAGE_SYMBOL: Record<PathStage, string> = { done: '✓', doing: '◐', waiting: '🔒', idle: '○', parked: '‖' };
  const stageOf = (p: PathEntry): PathStage => p.stage ?? (p.status === 'done' ? 'done' : 'idle');
  const stageWord = (s: PathStage): string => t(`competences.stage.${s}`);
  const pathName = (p: PathEntry): string =>
    t('competences.path_name', { title: markHidden(p.title), stage: stageWord(stageOf(p)), learned: p.progress?.learned ?? 0, total: p.progress?.total ?? 0 });

  const locale = $derived(app.lang === 'de' ? 'de-DE' : 'en-GB');
  const longDay = $derived(new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }));
  const day = (text: string): string => {
    const date = dayDate(text);
    return date ? longDay.format(date) : text;
  };

  // The rows opened below them, by id.
  let open = $state<ReadonlySet<string>>(new Set());
  function toggle(id: string): void {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    open = next;
  }
  const rowId = (id: string): string => `competence-${id.replace(/[^A-Za-z0-9_-]/g, '-')}`;
  // The columns of a table: the evidence only with an engine that names it.
  const columns = $derived(withEvidence ? 6 : 5);
</script>

{#snippet rung(kind: string, target12: boolean, target24: boolean)}
  <span class="rung {kind}" class:t12={target12} class:t24={target24} aria-hidden="true"></span>
{/snippet}

{#snippet ladderOf(item: Competence, axis: Axis)}
  {@const now = item[axis]}
  {@const r12 = targetRung(targetOf(item.target_12, axis))}
  {@const r24 = targetRung(targetOf(item.target_24, axis))}
  <span class="ladder-cell">
    <span class="ladder" role="img" aria-label={ladderName(item, axis)} data-ladder={axis}>
      {#each ladder(now) as kind, i (i)}
        {@render rung(kind, r12 === i + 1, r24 === i + 1 && r24 !== r12)}
      {/each}
    </span>
    <span class="stage-text" aria-hidden="true">{now === undefined ? '?' : stage(now)}</span>
  </span>
{/snippet}

{#snippet chip(p: PathEntry)}
  {@const s = stageOf(p)}
  <button type="button" class="chip stage-{s}" aria-label={pathName(p)} onclick={() => app.openPath(p.id)} data-competence-path={p.id}
    ><span aria-hidden="true">{STAGE_SYMBOL[s]}</span>
    {markHidden(p.title)}
    <span class="muted">{t('competences.path_progress', { learned: p.progress?.learned ?? 0, total: p.progress?.total ?? 0 })}</span></button
  >
{/snippet}

<section class="competences" aria-label={t('nav.competences')}>
  <header class="head">
    <h2>{t('nav.competences')}</h2>
    <Info hint={t('competences.intro')} label={t('hint.about', { what: t('nav.competences') })} />
  </header>

  {#if !usable}
    <p class="none" role="note">{t('competences.old_engine')}</p>
  {:else if problem && doc === null}
    <p class="none" role="alert">{t('competences.failed')} <button type="button" onclick={() => void read()}>{t('paths.retry')}</button></p>
  {:else if doc === null}
    <p class="none" role="status">{t('competences.reading')}</p>
  {:else if items.length === 0 && scope.active}
    <LearnScopeNote {app} {scope} />
  {:else if items.length === 0}
    <div class="empty" data-competences-empty>
      <p>{t('competences.none')}</p>
      <p class="none">{t('competences.none_how')}</p>
      <pre translate="no"><code translate="no">{COMPETENCE_EXAMPLE}</code></pre>
      <button type="button" onclick={() => app.setView('paths')}>{t('competences.open_paths')}</button>
    </div>
  {:else}
    <div class="bar">
      <label class="check" data-hint={t('hint.form.competences.target')}
        ><input type="checkbox" bind:checked={withTarget} data-competences-target />{t('competences.filter.target')}</label
      >
      <label class="check" data-hint={t('hint.form.competences.path')}
        ><input type="checkbox" bind:checked={withPath} data-competences-path />{t('competences.filter.path')}</label
      >
      <label class="field" data-hint={t('hint.form.competences.sort')}
        >{t('competences.sort')}
        <select bind:value={sort} data-competences-sort>
          <option value="name">{t('competences.sort.name')}</option>
          <option value="distance">{t('competences.sort.distance')}</option>
        </select></label
      >
      <label class="field" data-hint={t('hint.form.competences.search')}
        ><span class="sr">{t('competences.search')}</span><input spellcheck="false"
          type="search"
          bind:value={text}
          placeholder={t('competences.search_placeholder')}
          data-competences-search
        /></label
      >
    </div>

    {#if groups.length === 0}
      <p class="none" role="status">{t('competences.filtered_none')}</p>
    {/if}
    {#each groups as group (group.name ?? '')}
      {@const caption = group.name === null ? t('competences.group.none') : markHidden(group.name)}
      {@const captionId = `competences-group-${(group.name ?? '-').replace(/[^A-Za-z0-9_-]/g, '-')}`}
      <!-- A table wider than the window scrolls: its region must take the focus to scroll by the keyboard (axe scrollable-region-focusable). -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="table-wrap" role="region" aria-labelledby={captionId} tabindex="0" data-competences-group={group.name ?? ''}>
        <table>
          <caption id={captionId}>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t('competences.col.field')}</th>
              <th scope="col">{t('competences.col.t')}</th>
              <th scope="col">{t('competences.col.p')}</th>
              <th scope="col">{t('competences.col.target')}</th>
              <th scope="col">{t('competences.col.paths')}</th>
              {#if withEvidence}<th scope="col">{t('competences.col.evidence')}</th>{/if}
            </tr>
          </thead>
          <tbody>
            {#each group.items as item (item.id)}
              {@const served = pathsOf(item, paths)}
              {@const count = counts.get(item.id)}
              {@const t12 = targetList(item.target_12)}
              {@const t24 = targetList(item.target_24)}
              <tr data-competence={item.id} class:invalid={!item.valid}>
                <th scope="row">
                  <button
                    type="button"
                    class="more"
                    aria-expanded={open.has(item.id)}
                    aria-controls={open.has(item.id) ? rowId(item.id) : undefined}
                    data-competence-more
                    onclick={() => toggle(item.id)}
                    ><span class="caret" aria-hidden="true">{open.has(item.id) ? '▾' : '▸'}</span>
                    {markHidden(item.title)}</button
                  >
                </th>
                <td data-label={t('competences.col.t')}>{@render ladderOf(item, 't')}</td>
                <td data-label={t('competences.col.p')}>{@render ladderOf(item, 'p')}</td>
                <td data-label={t('competences.col.target')}>
                  {#if t12 === null && t24 === null}<span class="muted">{t('competences.target_none')}</span>{:else}
                    {#if t12 !== null}<span class="target">{t('competences.target12', { list: t12 })}</span>{/if}
                    {#if t24 !== null}<span class="target">{t('competences.target24', { list: t24 })}</span>{/if}
                  {/if}
                </td>
                <td data-label={t('competences.col.paths')}>
                  {#if served.length === 0}<span class="muted">{t('competences.paths_none')}</span>{:else}
                    <span class="chips">{#each served as p (p.id)}{@render chip(p)}{/each}</span>
                  {/if}
                </td>
                {#if withEvidence}
                  <td data-label={t('competences.col.evidence')} data-competence-evidence>
                    {#if count}{t('competences.evidence', { given: count.given, open: count.open })}{:else}<span class="muted"
                        >{t('competences.evidence_none')}</span
                      >{/if}
                  </td>
                {/if}
              </tr>
              {#if open.has(item.id)}
                <tr class="detail-row" id={rowId(item.id)} data-competence-detail={item.id}>
                  <td colspan={columns}>
                    <div class="detail">
                      {#if item.assessed}<p class="muted">{t('competences.assessed', { date: day(item.assessed) })}</p>{/if}
                      {#if item.problems.length > 0}
                        <p class="problems" role="note">{t('competences.problems', { list: item.problems.map(markHidden).join('; ') })}</p>
                      {/if}
                      <h3>{t('competences.why')}</h3>
                      {#if item.body.trim() === ''}
                        <p class="muted">{t('competences.body_none')}</p>
                      {:else}
                        <div class="prose"><Blocks blocks={parseMarkdown(item.body)} headingBase={3} /></div>
                        {#if item.body_truncated}<p class="muted">{t('competences.body_truncated')}</p>{/if}
                      {/if}
                      {#if served.length > 0}
                        <h3>{t('competences.col.paths')}</h3>
                        <ul class="path-list">
                          {#each served as p (p.id)}
                            <li>
                              {@render chip(p)}
                              <progress max={Math.max(1, p.progress?.total ?? 0)} value={p.progress?.learned ?? 0} aria-label={pathName(p)}></progress>
                            </li>
                          {/each}
                        </ul>
                      {/if}
                      <p class="file">
                        {t('competences.file')}: <code translate="no">{markHidden(item.file)}</code>
                        {#if app.machineActions}
                          <!-- The hub opens the file the engine names for this id; the page sends the id, never the path. -->
                          <button
                            type="button"
                            class="open-editor"
                            data-hint={t('competences.open_editor_hint')}
                            aria-label={t('competences.open_editor', { title: markHidden(item.title) })}
                            onclick={() => void app.openInEditor(item.id, 'competence')}>{t('editor.button')}</button
                          >
                        {/if}
                      </p>
                    </div>
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    {/each}

    {#if without.length > 0 && !withTarget && !withPath && text.trim() === ''}
      <section class="without" aria-labelledby="competences-without" data-competences-without>
        <h3 id="competences-without">{t('competences.without')}</h3>
        <p class="muted">{t('competences.without_how')}</p>
        <span class="chips">{#each without as p (p.id)}{@render chip(p)}{/each}</span>
      </section>
    {/if}

    <p class="legend" data-competences-legend>
      <span class="key">{@render rung('full', false, false)} {t('competences.legend.reached')}</span>
      <span class="key">{@render rung('half', false, false)} {t('competences.legend.half')}</span>
      <span class="key">{@render rung('empty', true, false)} {t('competences.legend.t12')}</span>
      <span class="key">{@render rung('empty', false, true)} {t('competences.legend.t24')}</span>
    </p>
  {/if}
</section>

<style>
  .competences {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 0;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  h2 {
    margin: 0;
    font-size: 1.1rem;
  }
  h3 {
    margin: 0.4rem 0 0.2rem;
    font-size: 0.95rem;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .none,
  .muted {
    color: var(--muted);
  }
  .none {
    margin: 0;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.4rem;
  }
  .empty p {
    margin: 0;
  }
  pre {
    margin: 0;
    padding: 0.4rem 0.6rem;
    background: var(--surface-2);
    border-radius: var(--radius);
    max-width: 100%;
    overflow-x: auto;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
  }
  .check,
  .field {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  select,
  input[type='search'] {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.2rem 0.4rem;
    min-height: 2rem;
  }
  .table-wrap {
    overflow-x: auto;
    max-inline-size: 100%;
    container-type: inline-size;
  }
  .table-wrap:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  caption {
    text-align: start;
    font-weight: 700;
    padding: 0.3rem 0;
  }
  th,
  td {
    text-align: start;
    vertical-align: top;
    padding: 0.35rem 0.5rem;
    border-bottom: 1px solid var(--border);
  }
  thead th {
    color: var(--muted);
    font-weight: 600;
    white-space: nowrap;
  }
  tr.invalid th {
    text-decoration: underline wavy var(--bad);
  }
  button.more {
    display: inline-flex;
    align-items: baseline;
    gap: 0.3rem;
    padding: 0.1rem 0.2rem;
    background: none;
    border: 0;
    color: var(--text);
    font: inherit;
    font-weight: 600;
    text-align: start;
    cursor: pointer;
  }
  .ladder-cell {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    white-space: nowrap;
  }
  .ladder {
    display: inline-flex;
    gap: 3px;
  }
  .rung {
    box-sizing: border-box;
    display: inline-block;
    width: 12px;
    height: 16px;
    border: 1px solid var(--muted);
    border-radius: 2px;
    background: var(--surface-2);
  }
  .rung.full {
    background: var(--accent);
    border-color: var(--accent);
  }
  .rung.half {
    background: linear-gradient(to right, var(--accent) 50%, var(--surface-2) 50%);
  }
  .rung.t12 {
    outline: 2px solid var(--secondary);
    outline-offset: 1px;
  }
  .rung.t24 {
    outline: 2px dashed var(--secondary);
    outline-offset: 1px;
  }
  .target {
    display: block;
    white-space: nowrap;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.1rem 0.5rem;
    min-height: 1.8rem;
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 999px;
    font: inherit;
    font-size: 0.9em;
    cursor: pointer;
  }
  .chip.stage-done {
    border-color: var(--ok);
  }
  .chip.stage-doing {
    border-color: var(--accent);
  }
  .chip.stage-waiting {
    border-color: var(--warn);
  }
  .chip.stage-parked {
    border-style: dashed;
  }
  .detail {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    max-width: 48rem;
  }
  .detail p {
    margin: 0;
  }
  .problems {
    color: var(--bad);
  }
  .path-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .path-list li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  progress {
    width: 8rem;
    accent-color: var(--accent);
  }
  .file code {
    overflow-wrap: anywhere;
  }
  .open-editor {
    margin-inline-start: 0.5rem;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 1rem;
    margin: 0;
    color: var(--muted);
    font-size: 0.9em;
  }
  .key {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .without {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .without p {
    margin: 0;
  }
  button:not(.more):not(.chip) {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.2rem 0.6rem;
    min-height: 2rem;
    cursor: pointer;
  }
  @container (width < 600px) {
    table,
    thead,
    tbody,
    tr,
    th,
    td,
    caption {
      display: block;
    }
    thead {
      display: none;
    }
    tbody tr:not(.detail-row) {
      margin-block-end: 0.5rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
    }
    td[data-label]::before {
      content: attr(data-label) ': ';
      display: block;
      color: var(--muted);
      font-size: 0.85em;
    }
  }
  @media (forced-colors: active) {
    .rung {
      border-color: CanvasText;
    }
    .rung.full {
      background: Highlight;
      border-color: Highlight;
    }
    .rung.half {
      background: linear-gradient(to right, Highlight 50%, Canvas 50%);
    }
    .rung.t12,
    .rung.t24 {
      outline-color: CanvasText;
    }
  }
</style>
