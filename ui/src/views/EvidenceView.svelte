<script lang="ts">
  // The evidence of all learning paths (concept "Reiter Lernpläne" 10): grouped by field of knowledge (a point under every
  // field its path serves, those without one last) or by path; a row says given or open with symbol and word, the text of
  // the point (Markdown reader of the kit; untrusted), its path, the stage it proves (T/P n) and its proof as a link (a web
  // address only). A row opens its point in the view of the paths. Which point is evidence, its state, its stage and the
  // fields are the engine's (`tasks.learn_evidence`, the titles of the fields from `tasks.competences`; WEB-13).
  import { untrack } from 'svelte';
  import type { App } from '../lib/app.svelte';
  import type { Key } from '../lib/i18n';
  import type { Competences, LearnEvidence } from '../lib/contract';
  import Info from 'appkit-ui/Info.svelte';
  import Blocks from 'appkit-ui/Blocks.svelte';
  import { hostOf, parseMarkdown } from 'appkit-ui/markdown';
  import { markHidden } from '../lib/text';
  import { labelText } from '../lib/paths';
  import { stageText } from '../lib/competences';
  import { evidenceTexts, type EvidenceKey } from '../lib/evidenceTexts';
  import {
    EVIDENCE_FILTERS,
    evidenceCompetences,
    evidenceGroups,
    evidenceTotals,
    webLink,
    type EvidenceFilter,
    type EvidenceGroup,
    type EvidenceGrouping,
    type EvidenceRow,
  } from '../lib/evidence';

  let { app }: { app: App } = $props();
  const t = (key: EvidenceKey | Key, params: Record<string, string | number> = {}) => evidenceTexts.t(app.lang, key, params);

  const usable = $derived(app.can('learn_evidence'));
  const withFields = $derived(app.can('competences'));

  // The evidence (the finished paths too: their evidence is the portfolio) and the fields for their titles and scale.
  let doc = $state<LearnEvidence | null>(null);
  let fields = $state<Competences | null>(null);
  let problem = $state(false);
  let asked = 0;
  async function read(): Promise<void> {
    const mine = ++asked;
    const fieldsRead = withFields ? app.competences().catch(() => null) : Promise.resolve(null);
    try {
      const [answer, fieldDoc] = await Promise.all([app.learnEvidence({ include_done: true }), fieldsRead]);
      if (mine !== asked) return;
      doc = answer;
      fields = fieldDoc;
      problem = false;
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

  let filter = $state<EvidenceFilter>('all');
  let competence = $state('');
  // Grouped by field where the engine knows fields, else by path.
  let chosenGrouping = $state<EvidenceGrouping | null>(null);
  const grouping = $derived<EvidenceGrouping>(chosenGrouping ?? (withFields ? 'competence' : 'path'));
  const items = $derived(doc?.items ?? []);
  const fieldTitle = (id: string): string => markHidden(fields?.items.find((f) => f.id === id)?.title ?? id);
  /** Groups by name, the fields without one last (as the catalogue orders them). */
  const byGroup = (a: string | undefined, b: string | undefined): number =>
    a === b ? 0 : a === undefined ? 1 : b === undefined ? -1 : a.localeCompare(b);
  // The fields in the order of the catalogue: by group, then by title.
  const fieldOrder = $derived(
    (fields?.items ?? [])
      .toSorted((a, b) => byGroup(a.group, b.group) || a.title.localeCompare(b.title))
      .map((f) => f.id),
  );
  const groups = $derived(evidenceGroups(items, { filter, competence, grouping }, fieldOrder));
  const totals = $derived(evidenceTotals(items));
  const competenceChoices = $derived(evidenceCompetences(items).toSorted((a, b) => fieldTitle(a).localeCompare(fieldTitle(b))));

  function groupTitle(group: EvidenceGroup): string {
    if (group.kind === 'none') return t('evidence.group.none');
    if (group.kind === 'competence') return fieldTitle(group.id ?? '');
    const first = group.rows[0]?.item;
    return markHidden(first?.title ?? group.id ?? '');
  }
  const STATE_SYMBOL = { given: '✓', open: '○', dropped: '–' } as const;
  const stage = (level: number): string => stageText(fields?.scale, level, app.lang);
  const forText = (row: EvidenceRow): string | null =>
    row.item.for ? t('evidence.for', { axis: t(`evidence.axis.${row.item.for.axis}`), stage: stage(row.item.for.level) }) : null;
  const forName = (row: EvidenceRow): string | null =>
    row.item.for ? t('evidence.for_name', { axis: t(`evidence.axis_name.${row.item.for.axis}`), stage: stage(row.item.for.level) }) : null;
  const pointOf = (row: EvidenceRow): string => row.item.key ?? `#${row.item.index}`;
</script>

<section class="evidence" aria-label={t('nav.evidence')}>
  <header class="head">
    <h2>{t('nav.evidence')}</h2>
    <Info hint={t('evidence.intro')} label={t('hint.about', { what: t('nav.evidence') })} />
  </header>

  {#if !usable}
    <p class="none" role="note">{t('evidence.old_engine')}</p>
  {:else if problem && doc === null}
    <p class="none" role="alert">{t('evidence.failed')} <button type="button" onclick={() => void read()}>{t('paths.retry')}</button></p>
  {:else if doc === null}
    <p class="none" role="status">{t('evidence.reading')}</p>
  {:else if items.length === 0}
    <div class="empty" data-evidence-empty>
      <p>{t('evidence.none')}</p>
      <p class="none">{t('evidence.none_how')}</p>
      <pre><code>## Lernpunkte

{t('evidence.none_example')}</code></pre>
      <button type="button" onclick={() => app.setView('paths')}>{t('evidence.open_paths')}</button>
    </div>
  {:else}
    <div class="bar">
      <p class="count" data-evidence-count>{t('evidence.count', totals)}</p>
      <fieldset class="choice" data-hint={t('hint.form.evidence.filter')}>
        <legend class="sr">{t('evidence.filter')}</legend>
        {#each EVIDENCE_FILTERS as value (value)}
          <label><input type="radio" name="evidence-filter" {value} bind:group={filter} data-evidence-filter={value} />{t(`evidence.filter.${value}`)}</label>
        {/each}
      </fieldset>
      {#if competenceChoices.length > 0}
        <label class="field" data-hint={t('hint.form.evidence.competence')}
          >{t('evidence.competence')}
          <select bind:value={competence} data-evidence-competence>
            <option value="">{t('evidence.competence.all')}</option>
            {#each competenceChoices as id (id)}<option value={id}>{fieldTitle(id)}</option>{/each}
          </select></label
        >
      {/if}
      <fieldset class="choice" data-hint={t('hint.form.evidence.group')}>
        <legend>{t('evidence.group')}</legend>
        {#each ['competence', 'path'] as const as value (value)}
          <label
            ><input
              type="radio"
              name="evidence-group"
              {value}
              checked={grouping === value}
              onchange={() => (chosenGrouping = value)}
              data-evidence-group={value}
            />{t(`evidence.group.${value}`)}</label
          >
        {/each}
      </fieldset>
    </div>

    {#if groups.length === 0}
      <p class="none" role="status">{t('evidence.filtered_none')}</p>
    {/if}
    {#each groups as group (group.key)}
      {@const title = groupTitle(group)}
      <section class="group" aria-labelledby="evidence-{group.key}" data-evidence-group-of={group.key}>
        <h3 id="evidence-{group.key}">{title}</h3>
        <ul aria-label={t('evidence.list', { title })}>
          {#each group.rows as row (row.key)}
            {@const proof = webLink(row.item.link)}
            {@const proves = forText(row)}
            <li class="row {row.state}" data-evidence={row.key} data-evidence-state={row.state}>
              <span class="state"><span aria-hidden="true">{STATE_SYMBOL[row.state]}</span> {t(`evidence.state.${row.state}`)}</span>
              <span class="label"><Blocks blocks={parseMarkdown(row.item.label)} /></span>
              {#if proves !== null}<span class="for" title={forName(row) ?? undefined}><span class="sr">{forName(row)}</span><span aria-hidden="true">{proves}</span></span>{/if}
              <span class="where">
                {#if grouping !== 'path'}<span class="path">{markHidden(row.item.title)}{#if row.item.path_done}{' '}({t('evidence.path_done')}){/if}</span>{/if}
                {#if proof !== null}<a href={proof} target="_blank" rel="noopener noreferrer" data-evidence-proof>{t('evidence.proof')}: {hostOf(proof)}</a>{/if}
              </span>
              <button
                type="button"
                class="open"
                aria-label={t('evidence.open_point_of', { label: markHidden(labelText(row.item)), path: markHidden(row.item.title) })}
                onclick={() => app.openPath(row.item.path, pointOf(row))}
                data-evidence-open>{t('evidence.open_point')}</button
              >
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  {/if}
</section>

<style>
  .evidence {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 0;
    max-width: 60rem;
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
    margin: 0.4rem 0 0.3rem;
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
  .where,
  .count {
    color: var(--muted);
  }
  .none,
  .count {
    margin: 0;
  }
  .count {
    font-weight: 700;
    color: var(--text);
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
  .choice {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.2rem 0.6rem;
    margin: 0;
  }
  .choice legend:not(.sr) {
    float: left;
    color: var(--muted);
  }
  .choice label,
  .field {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  select {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.2rem 0.4rem;
    min-height: 2rem;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .row {
    display: grid;
    grid-template-columns: 7rem minmax(0, 1fr) auto auto;
    grid-template-areas: 'state label for open' 'state where where open';
    align-items: center;
    gap: 0.1rem 0.75rem;
    padding: 0.35rem 0.5rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .row.open {
    border-style: dashed;
  }
  .row.dropped {
    opacity: 0.8;
  }
  .state {
    grid-area: state;
    color: var(--muted);
  }
  .row.given .state {
    color: var(--ok);
    font-weight: 600;
  }
  .label {
    grid-area: label;
    overflow-wrap: anywhere;
  }
  .label :global(p) {
    margin: 0;
  }
  .for {
    grid-area: for;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .where {
    grid-area: where;
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem 0.8rem;
    font-size: 0.85em;
  }
  .where a {
    color: var(--accent-text);
  }
  .open {
    grid-area: open;
  }
  button {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.2rem 0.6rem;
    min-height: 2rem;
    cursor: pointer;
  }
  @media (max-width: 600px) {
    .row {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas: 'state for' 'label label' 'where where' 'open open';
    }
    .open {
      justify-self: start;
    }
  }
</style>
