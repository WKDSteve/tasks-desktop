<script lang="ts">
  import { closeOnBackdrop } from 'appkit-ui/backdrop';
  import { floating } from '../lib/floating';
  // "Split into tasks": ai-desktop proposes the tasks a plan still needs; the person ticks them (nothing is ticked at
  // first) and only the ticked ones are created, after a yes, a new phase only after its own yes. The hub sends the plan
  // and passes on the drafts; the page creates them through the engine.
  import type { App } from '../lib/app.svelte';
  import { translate, type Key } from '../lib/i18n';
  import { newPhases, type DraftResult, type Split } from '../lib/split';
  import { markHidden } from '../lib/text';

  let { app }: { app: App } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  let dialog: HTMLDialogElement | undefined = $state();
  const plan = $derived(app.splitFor);
  const planEntry = $derived(plan === null ? undefined : (app.snapshot?.plans ?? []).find((p) => p.id === plan));

  type Stage = 'asking' | 'confirm' | 'choose' | 'confirm_create' | 'confirm_phases' | 'creating' | 'done' | 'failed';
  let stage = $state<Stage>('asking');
  let why = $state('');
  let split = $state<Split | null>(null);
  let job = '';
  let ticked = $state<number[]>([]);
  let results = $state<DraftResult[]>([]);
  // The answer to the question before a private plan leaves the machine.
  let answer: ((yes: boolean) => void) | null = null;
  // Counts the openings: drafts that come back after the dialog was closed are not shown.
  let opened = 0;

  const phases = $derived(split === null ? [] : newPhases(split.drafts, ticked, planEntry?.phase_order ?? []));

  async function ask(id: string): Promise<void> {
    const run = opened;
    stage = 'asking';
    const outcome = await app.askSplit(
      id,
      () =>
        new Promise<boolean>((resolve) => {
          stage = 'confirm';
          answer = (yes) => {
            answer = null;
            stage = 'asking';
            resolve(yes);
          };
        }),
      () => run === opened && app.splitFor === id,
    );
    if (run !== opened) return;
    if (outcome.kind === 'split') {
      split = outcome.split;
      job = outcome.job;
      stage = 'choose';
    } else {
      why = outcome.kind === 'declined' ? t('split.declined') : t('split.failed', { why: outcome.why });
      stage = 'failed';
    }
  }

  function create(): void {
    if (ticked.length === 0) return;
    stage = 'confirm_create';
  }

  async function createNow(addPhases: boolean): Promise<void> {
    if (split === null || plan === null) return;
    stage = 'creating';
    results = await app.createSplit(plan, split, ticked, job, phases, addPhases);
    stage = 'done';
  }

  function close(): void {
    answer?.(false);
    app.closeSplit();
  }

  $effect(() => {
    if (!dialog) return;
    if (plan !== null && !dialog.open) {
      opened += 1;
      split = null;
      ticked = [];
      results = [];
      why = '';
      dialog.showModal();
      void ask(plan);
    }
    if (plan === null && dialog.open) dialog.close();
  });

  function resultOf(n: number): DraftResult | undefined {
    return results.find((r) => r.n === n);
  }
</script>

<dialog
  bind:this={dialog}
  class="split-dialog"
  use:floating={{ kind: 'split', moveLabel: t('float.move'), moveHint: t('hint.float.move') }}
  use:closeOnBackdrop={{ closeable: () => stage !== 'creating' && ticked.length === 0 }}
  aria-labelledby="split-title"
  onclose={close}
>
  {#if plan !== null}
    <h2 id="split-title">{t('split.title')}</h2>
    <p class="what">{markHidden(planEntry?.title ?? plan)} <code>{plan}</code></p>
    {#if stage === 'asking'}
      <p role="status">{t('split.asking')}</p>
    {:else if stage === 'confirm'}
      <p role="alert">{t('split.confirm')}</p>
      <div class="actions">
        <button type="button" onclick={() => answer?.(false)}>{t('split.confirm_no')}</button>
        <button type="button" class="primary" onclick={() => answer?.(true)}>{t('split.confirm_yes')}</button>
      </div>
    {:else if stage === 'failed'}
      <p role="alert">{why}</p>
    {:else if split !== null}
      {#if split.phases.some((p) => p.new)}
        <p class="note">{t('split.phases_proposed', { phases: split.phases.filter((p) => p.new).map((p) => p.name).join(', ') })}</p>
      {/if}
      <ul class="drafts">
        {#each split.drafts as d (d.n)}
          {@const done = resultOf(d.n)}
          <li class:invalid={d.invalid !== undefined}>
            <label data-hint={t('hint.form.split_draft')}>
              <input
                type="checkbox"
                value={d.n}
                bind:group={ticked}
                disabled={d.invalid !== undefined || stage !== 'choose'}
              />
              <span class="n">{d.n}.</span>
              <span class="title">{markHidden(d.title)}</span>
              <span class="meta"
                >{d.area}{d.kind ? ` · ${d.kind}` : ''}{d.prio !== undefined ? ` · prio ${d.prio}` : ''}{d.effort ? ` · ${d.effort}` : ''}{d.phase
                  ? ` · ${t('split.phase')} ${d.phase}`
                  : ''}</span
              >
            </label>
            {#if d.summary}<p class="summary">{markHidden(d.summary)}</p>{/if}
            {#if d.acceptance.length > 0}
              <ul class="acc">
                {#each d.acceptance as a, i (i)}<li>{markHidden(a)}</li>{/each}
              </ul>
            {/if}
            {#if d.after.length > 0 || d.blocked_by.length > 0}
              <p class="deps">
                {#if d.after.length > 0}{t('split.after')}: {d.after.join(', ')}{/if}
                {#if d.blocked_by.length > 0}{t('split.blocked_by')}: {d.blocked_by.join(', ')}{/if}
              </p>
            {/if}
            {#if d.invalid}<p class="why">{t('split.invalid', { why: d.invalid })}</p>{/if}
            {#if done && 'id' in done}
              <p class="made" role="status">{t('split.made', { id: done.id })}{done.warning ? ` (${done.warning})` : ''}</p>
            {:else if done && 'refused' in done}
              <p class="why" role="status">{t('split.refused', { why: done.refused })}</p>
            {/if}
          </li>
        {/each}
      </ul>
      {#if stage === 'confirm_create'}
        <p role="alert">{t('split.confirm_create', { n: ticked.length, plan })}</p>
        <div class="actions">
          <button type="button" onclick={() => (stage = 'choose')}>{t('dialog.cancel')}</button>
          <button type="button" class="primary" onclick={() => (phases.length > 0 ? (stage = 'confirm_phases') : void createNow(true))}
            >{t('split.create')}</button
          >
        </div>
      {:else if stage === 'confirm_phases'}
        <p role="alert">{t('split.confirm_phases', { phases: phases.join(', '), plan })}</p>
        <div class="actions">
          <button type="button" onclick={() => void createNow(false)}>{t('split.phases_no')}</button>
          <button type="button" class="primary" onclick={() => void createNow(true)}>{t('split.phases_yes')}</button>
        </div>
      {:else if stage === 'creating'}
        <p role="status">{t('split.creating')}</p>
      {/if}
    {/if}
    <div class="actions">
      {#if stage === 'choose'}
        <button type="button" class="primary" disabled={ticked.length === 0} onclick={create}
          >{t('split.create_ticked', { n: ticked.length })}</button
        >
      {/if}
      <button type="button" disabled={stage === 'creating'} onclick={close}>{t(stage === 'done' ? 'split.close' : 'dialog.cancel')}</button>
    </div>
  {/if}
</dialog>

<style>
  dialog {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem 1.25rem;
    width: min(42rem, calc(100vw - 2rem));
    max-height: calc(100vh - 4rem);
  }
  dialog::backdrop {
    background: var(--backdrop);
  }
  h2 {
    margin: 0 0 0.5rem;
    font-size: 1.1rem;
  }
  .what {
    font-weight: 600;
    margin: 0 0 0.6rem;
  }
  .what code {
    font-weight: normal;
    color: var(--muted);
  }
  .drafts {
    list-style: none;
    margin: 0 0 0.6rem;
    padding: 0;
    display: grid;
    gap: 0.5rem;
  }
  .drafts > li {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.4rem 0.6rem;
  }
  .drafts > li.invalid {
    opacity: 0.75;
  }
  .drafts label {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: baseline;
  }
  .title {
    font-weight: 600;
  }
  .meta,
  .deps,
  .note {
    color: var(--muted);
    font-size: 0.9rem;
  }
  .summary,
  .deps,
  .why,
  .made {
    margin: 0.2rem 0 0;
  }
  .acc {
    margin: 0.2rem 0 0;
    padding-left: 1.2rem;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.6rem;
  }
</style>
