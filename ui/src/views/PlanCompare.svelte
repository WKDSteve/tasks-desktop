<script lang="ts">
  // The open plans side by side (capability `plan_compare`): how many tasks, how far, how much effort is open, how long
  // the rest of each plan's critical path is and how many weeks the rest would take at the pace of the last weeks.
  // Every figure is the engine's `tasks.plan_compare` (rule WEB-13); the page chooses the plans, sorts and draws them.
  // A click on a plan opens it in the plan view.
  import type { App } from '../lib/app.svelte';
  import type { PlanCompare } from '../lib/contract';
  import { formatNumber, translate, type Key } from '../lib/i18n';
  import { markHidden } from '../lib/text';
  import Info from 'appkit-ui/Info.svelte';
  import MultiSelect from 'appkit-ui/MultiSelect.svelte';
  import {
    areasOf,
    COMPARE_KEYS,
    nextSort,
    pickRows,
    sortRows,
    statusesOf,
    widest,
    type CompareKey,
  } from '../lib/planCompare';

  let { app }: { app: App } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);
  const num = (n: number) => formatNumber(app.lang, n);

  // Asked once per state of the vault while the comparison is shown; the answer of the last state stays drawn until the
  // one of the new state is in (a write does not blank the table), and a question that is out when the state moves on
  // is abandoned.
  let doc = $state<PlanCompare | null>(null);
  let failed = $state(false);
  const rev = $derived(app.snapshot?.rev ?? '');
  const can = $derived(app.can('plan_compare'));
  $effect(() => {
    const asked = rev;
    if (!can || asked === '') return;
    const abort = new AbortController();
    failed = false;
    app
      .planCompare(abort.signal)
      .then((answer) => {
        if (!abort.signal.aborted) doc = answer;
      })
      .catch(() => {
        if (!abort.signal.aborted) failed = true;
      });
    return () => abort.abort();
  });

  const projects = $derived(app.projects);
  let project = $state('');
  let chosen = $state<string[]>([]);
  // By area and by status: a further choice, of this visit (like the plans chosen by name). An area or a status that
  // no plan has any more is dropped from the choice, so it cannot hide every row unseen.
  let areas = $state<string[]>([]);
  let statuses = $state<string[]>([]);
  const all = $derived(doc?.plans ?? []);
  const areaOptions = $derived(areasOf(all));
  const statusOptions = $derived(statusesOf(all));
  const filter = $derived({
    areas: areas.filter((a) => areaOptions.includes(a)),
    statuses: statuses.filter((s) => statusOptions.includes(s)),
  });
  const rows = $derived(sortRows(pickRows(all, project, chosen, filter), app.compareSort));
  const full = $derived(widest(rows));
  const planOptions = $derived(
    pickRows(all, project, [], filter).map((r) => ({ value: r.id, label: r.title })),
  );
  function statusLabel(status: string): string {
    const key = `plan.status.${status}`;
    return status === 'planning' || status === 'doing' || status === 'parked' ? t(key as Key) : status;
  }

  function sortBy(key: CompareKey): void {
    app.setCompareSort(nextSort(app.compareSort, key));
  }
  function ariaSort(key: CompareKey): 'ascending' | 'descending' | 'none' {
    if (app.compareSort.key !== key) return 'none';
    return app.compareSort.desc ? 'descending' : 'ascending';
  }
  function open(id: string): void {
    app.setPlanDisplay('stages');
    app.openPlan(id);
  }
  const NUMERIC: ReadonlySet<CompareKey> = new Set(['open', 'progress', 'effort', 'path', 'forecast', 'value', 'prio']);
</script>

<section class="card compare" aria-labelledby="compare-title">
  <div class="headline">
    <h2 id="compare-title" class="eyebrow">{t('compare.title')}</h2>
    <Info hint={t('hint.compare')} label={t('hint.about', { what: t('compare.title') })} />
  </div>
  {#if !can}
    <p class="muted">{t('compare.unsupported')}</p>
  {:else if failed && !doc}
    <p class="bad">{t('compare.failed')}</p>
  {:else if !doc}
    <p class="muted">{t('state.loading')}</p>
  {:else}
    <div class="pickers">
      {#if projects.length > 0}
        <label class="pick">
          <span>{t('project.which')}</span>
          <select bind:value={project} onchange={() => (chosen = [])}>
            <option value="">{t('compare.all_plans')}</option>
            {#each projects as p (p.id)}<option value={p.id}>{markHidden(p.title)}</option>{/each}
          </select>
        </label>
      {/if}
      {#if areaOptions.length > 1}
        <MultiSelect
          label={t('nav.areas')}
          hint={t('hint.compare.areas')}
          options={areaOptions.map((a) => ({ value: a, label: a }))}
          selected={filter.areas}
          onchange={(next) => (areas = next)}
          clearLabel={t('kit.select.clear', { label: t('nav.areas') })}
          resetLabel={t('multi.reset')}
          searchLabel={t('multi.search')}
        />
      {/if}
      {#if statusOptions.length > 1}
        <MultiSelect
          label={t('list.filter.status')}
          hint={t('hint.compare.status')}
          options={statusOptions.map((s) => ({ value: s, label: statusLabel(s) }))}
          selected={filter.statuses}
          onchange={(next) => (statuses = next)}
          clearLabel={t('kit.select.clear', { label: t('list.filter.status') })}
          resetLabel={t('multi.reset')}
          searchLabel={t('multi.search')}
        />
      {/if}
      <MultiSelect
        label={t('compare.plans')}
        hint={t('hint.compare.plans')}
        options={planOptions}
        selected={chosen}
        onchange={(ids) => (chosen = ids)}
        clearLabel={t('kit.select.clear', { label: t('compare.plans') })}
        resetLabel={t('multi.reset')}
        searchLabel={t('multi.search')}
      />
      <span class="muted small">{t('compare.pace', { weeks: doc.weeks })}</span>
    </div>
    {#if rows.length === 0}
      <p class="muted">{t('compare.none')}</p>
    {:else}
      <!-- A wide table scrolls in its own box, which the keyboard can reach. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="scroll" tabindex="0">
        <table aria-labelledby="compare-title">
          <thead>
            <tr>
              {#each COMPARE_KEYS as key (key)}
                <th scope="col" class:num={NUMERIC.has(key)} aria-sort={ariaSort(key)}>
                  <button type="button" class="sort" onclick={() => sortBy(key)}
                    >{t(`compare.col.${key}` as Key)}{#if app.compareSort.key === key}<span aria-hidden="true">
                        {app.compareSort.desc ? '▼' : '▲'}</span
                      >{/if}</button
                  >
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each rows as r (r.id)}
              {@const total = r.tasks.open + r.tasks.done}
              <tr data-plan={r.id}>
                <th scope="row">
                  <button type="button" class="link" onclick={() => open(r.id)}>{markHidden(r.title)}</button>
                  <span class="muted small">
                    {#if r.stages > 0}{t('compare.stage', { phase: r.phase_now ?? '–', n: r.stages })}{/if}
                  </span>
                </th>
                <td class="num" data-col="open">
                  {t('compare.tasks', { open: r.tasks.open, total })}
                  {#if r.tasks.waiting + r.tasks.stuck + r.tasks.parked > 0}
                    <span class="muted small"
                      >{t('compare.held', { n: r.tasks.waiting + r.tasks.stuck + r.tasks.parked })}</span
                    >
                  {/if}
                </td>
                <td class="num" data-col="progress">
                  <span
                    class="bar"
                    role="meter"
                    aria-valuemin="0"
                    aria-valuemax={total}
                    aria-valuenow={r.tasks.done}
                    aria-label={t('compare.progress', { done: r.tasks.done, total })}
                    ><span class="fill ok" style:width={`${Math.round(r.progress * 100)}%`}></span></span
                  >
                  {Math.round(r.progress * 100)} %
                </td>
                <td class="num" data-col="effort">
                  <span class="bar" aria-hidden="true"
                    ><span class="fill" style:width={full > 0 ? `${Math.round((r.effort.open_days / full) * 100)}%` : '0%'}
                    ></span></span
                  >
                  {t('compare.days', { days: num(r.effort.open_days) })}
                  <span class="muted small">{num(r.effort.open_low)}–{num(r.effort.open_high)}</span>
                  {#if r.effort.open_without > 0}
                    <span class="warn small">{t('compare.without', { n: r.effort.open_without })}</span>
                  {/if}
                </td>
                <td class="num" data-col="path">
                  {t('compare.days', { days: num(r.path.days) })}
                  {#if r.path.unknown_effort > 0}
                    <span class="warn small">{t('compare.without', { n: r.path.unknown_effort })}</span>
                  {/if}
                </td>
                <td class="num" data-col="forecast">
                  {#if r.forecast_weeks}
                    {r.forecast_weeks.low === r.forecast_weeks.high
                      ? t('compare.weeks_one', { n: r.forecast_weeks.low })
                      : t('compare.weeks', { low: r.forecast_weeks.low, high: r.forecast_weeks.high })}
                  {:else}
                    <span class="muted">–</span>
                  {/if}
                  {#if r.target_due}
                    {#if r.forecast_late}
                      <span class="warn small" data-late>{t('compare.late', { date: r.target_due })}</span>
                    {:else}
                      <span class="muted small">{t('compare.due', { date: r.target_due })}</span>
                    {/if}
                  {/if}
                </td>
                <td class="num" data-col="value">
                  {#if r.value?.avg !== undefined}
                    {t('compare.value', { avg: num(r.value.avg) })}
                    <span class="muted small">{t('compare.value_sum', { sum: r.value.sum })}</span>
                  {:else}
                    <span class="muted">–</span>
                  {/if}
                  {#if r.value && r.value.without > 0}
                    <span class="warn small">{t('compare.value_without', { n: r.value.without })}</span>
                  {/if}
                </td>
                <td class="num" data-col="prio">
                  {#if r.prio !== undefined}{r.prio}{:else}<span class="muted">–</span>{/if}
                </td>
                <td data-col="last_done">{r.last_done ?? '–'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</section>

<style>
  .compare {
    display: grid;
    gap: 0.5rem;
  }
  .headline {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .pickers {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
  }
  .pick {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .pick select {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.2rem 0.4rem;
  }
  .scroll {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th,
  td {
    padding: 0.3rem 0.6rem;
    border-bottom: 1px solid var(--border);
    text-align: left;
    white-space: nowrap;
    vertical-align: middle;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  th[scope='row'] {
    display: grid;
    gap: 0.1rem;
    white-space: normal;
    min-width: 12rem;
  }
  .sort {
    background: none;
    border: 0;
    padding: 0;
    color: inherit;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .link {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    cursor: pointer;
    text-align: left;
    font: inherit;
  }
  .bar {
    display: inline-block;
    vertical-align: middle;
    width: 5rem;
    height: 0.45rem;
    border-radius: 999px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    overflow: hidden;
    margin-right: 0.3rem;
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .fill.ok {
    background: var(--ok);
  }
  .muted {
    color: var(--muted);
  }
  .small {
    font-size: 0.8em;
  }
  .warn {
    color: var(--warn);
  }
  .bad {
    color: var(--bad);
  }
</style>
