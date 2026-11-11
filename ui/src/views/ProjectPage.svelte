<script lang="ts">
  // The page of a project (capability `projects`): its goal, how far it is (the engine's rollup), its own open tasks and
  // its plans as cards by stage (status, a bar of the finished tasks, the next task). A plan can be moved to another
  // stage, taken out of the project or added to it, and the project's status changed: `plan_set` / `project_set`, which
  // the engine judges and which can be taken back. Nothing is reckoned here but the layout.
  import type { App } from '../lib/app.svelte';
  import { formatNumber, hintOf, labelOf, translate, type Key } from '../lib/i18n';
  import Info from 'appkit-ui/Info.svelte';
  import { markHidden } from '../lib/text';
  import { projectPage, share, subtaskCount, type PlanCard } from '../lib/projects';
  import ClosePanel from './ClosePanel.svelte';
  import { PLAN_STATUSES } from '../lib/planwizard';

  let { app, projectId }: { app: App; projectId: string } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  const project = $derived(app.projects.find((p) => p.id === projectId));
  const plans = $derived(app.snapshot?.plans ?? []);
  const page = $derived(project ? projectPage(project, plans, app.tasks) : null);
  const titles = $derived(new Map(app.tasks.map((x) => [x.id, x.title] as const)));
  // The plans that are in no project: they can be added to this one.
  const free = $derived(plans.filter((p) => !p.project));
  const canPlanSet = $derived(app.can('plan_set') && !app.readOnly);

  // The finished tasks of each plan (the snapshot holds the open ones only): asked of the engine once per plan and state.
  let finished = $state<Record<string, number>>({});
  let askedFor = '';
  $effect(() => {
    const ids = page?.stages.flatMap((s) => s.cards.map((c) => c.plan.id)) ?? [];
    const key = `${app.snapshot?.rev ?? ''}|${ids.join(',')}`;
    if (key === askedFor || ids.length === 0) return;
    askedFor = key;
    let gone = false;
    void (async () => {
      const next: Record<string, number> = {};
      for (const id of ids) {
        try {
          next[id] = (await app.finished({ plan: id, limit: 1 })).total;
        } catch {
          // Without the figure the card shows the open tasks only.
        }
        if (gone) return;
      }
      finished = next;
    })();
    return () => {
      gone = true;
      if (askedFor === key) askedFor = '';
    };
  });

  function stageName(phase: string | null): string {
    return phase === null ? t('project.no_stage') : t('project.stage', { phase });
  }

  function barOf(card: PlanCard): { done: number; total: number; pct: number } | null {
    const done = finished[card.plan.id];
    if (done === undefined) return null;
    const total = done + card.open.length;
    return { done, total, pct: Math.round(share(done, card.open.length) * 100) };
  }

  // Finishing by hand: the panel asks the engine first and says what happens or what holds it open (`ClosePanel`).
  type Closing = { kind: 'plan' | 'project'; id: string; title: string };
  let closing = $state<Closing | null>(null);
  const names = $derived(new Map([...titles, ...plans.map((p) => [p.id, p.title] as const)]));
  function askClose(kind: 'plan' | 'project', id: string, title: string): void {
    closing = { kind, id, title };
  }

  let attachId = $state('');
  async function attach(): Promise<void> {
    if (attachId === '' || !project) return;
    if (await app.setPlanFile('plan', attachId, { project: project.id })) attachId = '';
  }
</script>

{#snippet closePanel(c: Closing)}
  <ClosePanel
    {app}
    kind={c.kind}
    id={c.id}
    title={c.title}
    {names}
    label={c.kind === 'plan' ? t('project.close') : t('project.close_project')}
    onclose={() => (closing = null)}
  />
{/snippet}

{#if !project || !page}
  <p class="muted">{t('state.loading')}</p>
{:else}
  <section class="card head" aria-label={t('project.page')} data-project={project.id}>
    <div class="title-row">
      <h2 class="title">{markHidden(project.title)}</h2>
      {#if project.status}<span class="tag">{t(`plan.status.${project.status}` as Key)}</span>{/if}
      <span class="leave">
        {#if app.projects.length > 1}
          <label class="pick">
            <span>{t('project.which')}</span>
            <select value={project.id} onchange={(e) => app.openProject(e.currentTarget.value)}>
              {#each app.projects as p (p.id)}<option value={p.id}>{markHidden(p.title)}</option>{/each}
            </select>
          </label>
        {/if}
        <button type="button" class="link" onclick={() => app.openProject('')}>{t('project.leave')}</button>
      </span>
    </div>
    {#if project.target}
      <p class="goal">
        <span class="label">{t('project.target')}:</span>
        <button type="button" class="link" onclick={() => app.peek(project.target ?? '')}
          >{markHidden(titles.get(project.target) ?? project.target)}</button
        >
      </p>
    {/if}
    <p class="rollup">
      {t('project.rollup', {
        done: project.rollup.plans_done,
        plans: project.rollup.plans_total,
        tdone: project.rollup.tasks_done,
        tasks: project.rollup.tasks_done + project.rollup.tasks_open,
        days: formatNumber(app.lang, project.rollup.days_open),
      })}
      {#if project.rollup.plans_parked > 0}· {t('project.parked', { n: project.rollup.plans_parked })}{/if}
      <Info hint={t('hint.project.rollup')} label={t('hint.about', { what: t('project.page') })} />
    </p>
    <div class="toolbar">
      {#if app.can('project_set') && !app.readOnly && project.status !== 'done'}
        <label class="pick">
          <span>{t('project.status')}</span>
          <select
            value={project.status ?? 'planning'}
            onchange={(e) => void app.setPlanFile('project', project.id, { status: e.currentTarget.value })}
          >
            {#each PLAN_STATUSES as s (s)}<option value={s}>{t(`plan.status.${s}` as Key)}</option>{/each}
          </select>
        </label>
      {/if}
      {#if app.can('plan_new') && !app.readOnly}
        <button type="button" onclick={() => app.openPlanWizard('plan', project.id)}>{t('project.new_plan')}</button>
      {/if}
      {#if app.can('project_close') && !app.readOnly}
        <button type="button" data-hint={t('hint.ui.project.close')} onclick={() => askClose('project', project.id, project.title)}
          >{t('project.close_project')}</button
        >
      {/if}
      {#if canPlanSet && free.length > 0}
        <label class="pick">
          <span>{t('project.attach')}</span>
          <select bind:value={attachId}>
            <option value="">{t('project.attach_choose')}</option>
            {#each free as p (p.id)}<option value={p.id}>{markHidden(p.title)}</option>{/each}
          </select>
        </label>
        <button type="button" disabled={attachId === '' || app.saving} onclick={() => void attach()}>{t('project.attach')}</button>
      {/if}
    </div>
    {#if closing?.kind === 'project' && closing.id === project.id}{@render closePanel(closing)}{/if}
  </section>

  <section class="card" aria-label={t('project.own')}>
    <h3 class="eyebrow">{t('project.own')} ({page.own.length})</h3>
    {#if page.own.length === 0}
      <p class="muted">{t('project.own_none')}</p>
    {:else}
      <ul class="plain">
        {#each page.own as task (task.id)}
          <li data-id={task.id}>
            <button type="button" class="link" onclick={() => app.peek(task.id)}>{markHidden(task.title)}</button>
            <span class="meta">
              <span class="tag">{labelOf(app.lang, 'status', task.status ?? 'open')}</span>
              {#if subtaskCount(task)}<span class="tag soft" data-hint={hintOf(app.lang, 'hint', 'steps')}>{subtaskCount(task)}</span>{/if}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="stages" aria-label={t('project.plans')}>
    {#each page.stages as stage (stage.phase ?? '')}
      <div class="stage" data-phase={stage.phase ?? ''}>
        <h3 class="eyebrow">{stageName(stage.phase)} ({stage.cards.length})</h3>
        <ul class="cards">
          {#each stage.cards as card (card.plan.id)}
            {@const bar = barOf(card)}
            <li class="card plan-card" data-plan={card.plan.id}>
              <div class="title-row">
                <button type="button" class="link plan-title" onclick={() => app.openPlan(card.plan.id)}
                  >{markHidden(card.plan.title)}</button
                >
                {#if card.plan.status}<span class="tag">{t(`plan.status.${card.plan.status}` as Key)}</span>{/if}
              </div>
              <div class="bar-row">
                {#if bar}
                  <span
                    class="bar"
                    role="meter"
                    aria-valuemin="0"
                    aria-valuemax={bar.total}
                    aria-valuenow={bar.done}
                    aria-label={t('project.progress', { done: bar.done, total: bar.total })}
                    data-hint={t('hint.project.bar')}
                    ><span class="fill" style:width={`${bar.pct}%`}></span></span
                  >
                  <span class="muted small">{bar.done}/{bar.total}</span>
                {:else}
                  <span class="muted small">{t('project.open_tasks', { n: card.open.length })}</span>
                {/if}
              </div>
              <p class="next">
                {#if card.next}
                  <span class="label">{t('project.next')}</span>
                  <button type="button" class="link" onclick={() => app.peek(card.next?.id ?? '')}
                    >{markHidden(card.next.title)}</button
                  >
                  {#if subtaskCount(card.next)}<span class="tag soft" data-hint={hintOf(app.lang, 'hint', 'steps')}>{subtaskCount(card.next)}</span>{/if}
                {:else}
                  <span class="muted">{t('project.next_none')}</span>
                {/if}
              </p>
              {#if canPlanSet}
                <div class="actions">
                  {#if project.phase_order.length > 0}
                    <label class="pick" data-hint={t('hint.ui.project.phase')}>
                      <span>{t('project.phase')}</span>
                      <select
                        value={card.plan.phase ?? ''}
                        onchange={(e) =>
                          void app.setPlanFile('plan', card.plan.id, { phase: e.currentTarget.value === '' ? null : e.currentTarget.value })}
                      >
                        <option value="">{t('project.no_stage')}</option>
                        {#each project.phase_order as ph (ph)}<option value={ph}>{markHidden(ph)}</option>{/each}
                      </select>
                    </label>
                  {/if}
                  <button
                    type="button"
                    class="link small"
                    data-hint={t('hint.ui.project.detach')}
                    disabled={app.saving}
                    onclick={() => void app.setPlanFile('plan', card.plan.id, { project: null, phase: null })}
                    >{t('project.detach')}</button
                  >
                  {#if app.can('plan_close')}
                    <button
                      type="button"
                      class="link small"
                      data-hint={t('hint.ui.project.close')}
                      onclick={() => askClose('plan', card.plan.id, card.plan.title)}>{t('project.close')}</button
                    >
                  {/if}
                </div>
              {/if}
              {#if closing?.kind === 'plan' && closing.id === card.plan.id}{@render closePanel(closing)}{/if}
            </li>
          {/each}
        </ul>
      </div>
    {:else}
      <p class="muted">{t('project.plans_none')}</p>
    {/each}
  </section>
{/if}

<style>
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.9rem 1rem;
  }
  .head {
    display: grid;
    gap: 0.4rem;
  }
  .title-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  .title {
    margin: 0;
    font-size: 1.15rem;
  }
  .leave {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .goal,
  .rollup,
  .next {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
  }
  .label {
    color: var(--muted);
  }
  .toolbar,
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  .pick {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
    color: var(--muted);
    min-width: 0;
  }
  .pick select {
    min-width: 0;
    max-width: 16rem;
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.2rem 0.4rem;
  }
  .eyebrow {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    margin: 0 0 0.5em;
  }
  .muted {
    color: var(--muted);
  }
  .small {
    font-size: 0.8rem;
  }
  .stages {
    display: grid;
    gap: 1rem;
  }
  .cards {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
    gap: 0.75rem;
  }
  .plan-card {
    display: grid;
    gap: 0.45rem;
    align-content: start;
  }
  .plan-title {
    font-weight: 600;
  }
  .bar-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .bar {
    flex: 1;
    height: 0.45rem;
    border-radius: 999px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--ok);
  }
  .plain {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .plain li {
    display: grid;
    gap: 0.15rem;
    padding: 0.3rem 0;
    border-bottom: 1px solid var(--border);
  }
  .plain li:last-child {
    border-bottom: 0;
  }
  .link {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    cursor: pointer;
    text-align: left;
  }
  .link:disabled {
    color: var(--muted);
    cursor: default;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .tag {
    font-size: 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0 0.35rem;
  }
  .tag.soft {
    color: var(--muted);
  }
</style>
