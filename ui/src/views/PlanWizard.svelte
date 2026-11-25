<script lang="ts">
  import FieldError from 'appkit-ui/FieldError.svelte';
  import { tick } from 'svelte';
  import { focusFirstInvalid } from 'appkit-ui/formErrors';
  import { leaveGuard } from 'appkit-ui/leaveGuard';
  import LeaveAsk from 'appkit-ui/LeaveAsk.svelte';
  import Info from 'appkit-ui/Info.svelte';
  import { closeOnBackdrop } from 'appkit-ui/backdrop';
  import { floating } from '../lib/floating';
  // The plan wizard: a title and an area are enough; the rest (the areas it covers, the phases, the target, the gate)
  // is optional. While the person types, the engine is asked for a dry run: it names the plan, says when the name is
  // taken and refuses a form that is not one, so the rules are not written a second time here.
  import type { App } from '../lib/app.svelte';
  import { areaLabel } from '../lib/filter';
  import { translate, type Key } from '../lib/i18n';
  import {
    PLAN_STATUSES,
    canCreate,
    emptyForm,
    parsePhases,
    replacePhase,
    type PlanForm,
    type PlanPreview,
  } from '../lib/planwizard';
  import MultiSelect from 'appkit-ui/MultiSelect.svelte';
  import PendingAttachments from './PendingAttachments.svelte';
  import { badLink, parseList } from '../lib/fields';

  let { app }: { app: App } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) =>
    translate(app.lang, key, params);

  let dialog: HTMLDialogElement | undefined = $state();
  // Something typed or chosen that closing would lose: Escape asks first (leaveGuard).
  let leaving = $state(false);
  // A send that found something missing: the fields say it (formErrors.ts).
  let attempted = $state(false);
  let formEl: HTMLFormElement | undefined = $state();
  const isDirty = (): boolean => form.title.trim() !== '' || files.length > 0;
  let form = $state<PlanForm>(emptyForm());
  // The answer of the dry run, with the form it was asked for: an answer for an older form is none for this one.
  let answer = $state<{ key: string; value: PlanPreview } | null>(null);
  const formKey = $derived(JSON.stringify(form));
  const preview = $derived<PlanPreview | null>(answer && answer.key === formKey ? answer.value : null);
  // The areas the plan covers follow the area of the file until the person chooses them.
  let areasTouched = $state(false);
  let busy = $state(false);
  // What is attached once the plan is made (the plan does not exist before): not part of the form the engine judges.
  let files = $state<File[]>([]);
  let screenshot = $state(false);
  // A link that is no web address, named before anything is sent (as "Create task" does).
  const notLink = $derived(badLink(parseList(form.links)));

  const areas = $derived(
    [...app.allAreaNames]
      .map((name) => ({ value: name, label: app.shortAreas ? areaLabel(name, app.allAreaNames) : name, title: name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  );
  const phases = $derived(parsePhases(form.phases));
  // The phase the engine refused in the last dry run (the first wrong word): its chip is marked, with the reason.
  const badPhase = $derived(preview?.kind === 'refused' ? preview.phase : undefined);
  // A plan can go to a project (and one of its stages); a project is in none.
  const projects = $derived(app.projects);
  const stagesOfProject = $derived(projects.find((p) => p.id === form.project)?.phase_order ?? []);
  // The open tasks, offered as the target of the plan (typed text is allowed too).
  const targets = $derived(app.tasks.map((x) => x.id));

  $effect(() => {
    if (!dialog) return;
    if (app.planning && !dialog.open) {
      // the area of the task the wizard was opened for, else the one area chosen (an area group with one member
      // counts); a group is never a place to write to
      const area = app.planningArea ?? app.writeArea ?? areas[0]?.value ?? '';
      form = emptyForm(area, app.planningKind, app.planningProject);
      answer = null;
      areasTouched = false;
      files = [];
      screenshot = false;
      leaving = false;
      attempted = false;
      dialog.showModal();
    }
    if (!app.planning && dialog.open) dialog.close();
  });

  // The dry run follows the form, a moment after the last key; an answer that arrives late for an older form is dropped.
  $effect(() => {
    if (!app.planning) return;
    const snapshot = $state.snapshot(form) as PlanForm;
    if (snapshot.title.trim() === '' || snapshot.area === '') return;
    const key = JSON.stringify(snapshot);
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      const value = await app.previewPlan(snapshot, abort.signal);
      if (!abort.signal.aborted) answer = { key, value };
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  });

  const titleMissing = $derived(attempted && form.title.trim() === '');
  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    if (form.title.trim() === '' || form.area === '') {
      attempted = true;
      await tick();
      focusFirstInvalid(formEl);
      return;
    }
    if (app.saving || notLink !== null || !canCreate(form, preview)) return;
    busy = true;
    try {
      const id = await app.createPlan($state.snapshot(form) as PlanForm, preview);
      // after the plan is made: the first asset makes the plain file a folder
      if (id) await app.attachAll(id, files, screenshot);
    } finally {
      busy = false;
    }
  }
</script>

<dialog bind:this={dialog} use:floating={{ kind: 'plan-wizard', moveLabel: t('float.move'), moveHint: t('hint.float.move') }} use:closeOnBackdrop={{ closeable: () => !isDirty() }} use:leaveGuard={{ dirty: isDirty, ask: () => (leaving = true) }} aria-labelledby="plan-title" onclose={() => app.closePlanWizard()}>
  <form onsubmit={submit} novalidate aria-busy={busy} bind:this={formEl}>
    <div class="dialog-head">
      <h2 id="plan-title">{t(form.kind === 'project' ? 'plan.new.project_title' : 'plan.new.title')}</h2>
      <Info hint={t('hint.dialog.plan')} label={t('hint.about', { what: t(form.kind === 'project' ? 'plan.new.project_title' : 'plan.new.title') })} />
    </div>
    {#if leaving}<LeaveAsk confirm={t('leave.confirm')} discard={t('leave.discard')} keep={t('leave.keep')} ondiscard={() => { leaving = false; dialog?.close(); }} onkeep={() => (leaving = false)} />{/if}
    {#if app.can('project_new')}
      <div class="kind" role="radiogroup" aria-label={t('plan.new.kind')}>
        {#each ['plan', 'project'] as const as kind (kind)}
          <label class="check" data-hint={t(`hint.form.plan.kind.${kind}`)}>
            <input
              type="radio"
              name="plan-kind"
              value={kind}
              checked={form.kind === kind}
              disabled={kind === 'plan' && !app.can('plan_new')}
              onchange={() => {
                form.kind = kind;
                if (kind === 'project') {
                  form.project = '';
                  form.phase = '';
                }
              }}
            />
            <span>{t(`plan.new.kind.${kind}`)}</span>
          </label>
        {/each}
      </div>
    {/if}
    <label data-hint={t(form.kind === 'project' ? 'hint.form.project.title' : 'hint.form.plan.title')}>
      <span>{t('capture.name')}</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input spellcheck="true" type="text" bind:value={form.title} maxlength="300" required autofocus aria-invalid={titleMissing ? 'true' : undefined} aria-describedby={titleMissing ? 'plan-title-error' : undefined} />
    </label>
    <FieldError id="plan-title-error" text={titleMissing ? t('form.title_required') : null} />
    <label data-hint={t('hint.form.plan.area')}>
      <span>{t('plan.new.area')}</span>
      <select
        bind:value={form.area}
        required
        onchange={() => {
          if (!areasTouched) form.areas = form.area ? [form.area] : [];
        }}
      >
        {#each areas as a (a.value)}
          <option value={a.value} title={a.title}>{a.label}</option>
        {/each}
      </select>
    </label>
    <div class="field">
      <!-- The choice carries its own label; a second one above it said the same twice. -->
      <MultiSelect
        label={t('plan.new.areas')}
        hint={t('hint.form.plan.areas')}
        options={areas}
        selected={form.areas}
        onchange={(next) => {
          areasTouched = true;
          form.areas = next;
        }}
        clearLabel={t('kit.select.clear', { label: t('plan.new.areas') })}
        resetLabel={t('multi.reset')}
        searchLabel={t('multi.search')}
      />
      <small class="hint">{t('plan.new.areas_hint')}</small>
    </div>
    <label data-hint={t('hint.form.plan.phases')}>
      <span>{t('plan.new.phases')} <small>({t('field.tags_hint')})</small></span>
      <input spellcheck="false" type="text" bind:value={form.phases} placeholder={t('plan.new.phases_example')} />
    </label>
    {#if phases.length > 0}
      <p class="phases" role="group" aria-label={t('plan.new.order')}>
        {#each phases as phase, i (phase)}
          {@const bad = badPhase?.value === phase}
          <span
            class="chip"
            class:bad-chip={bad}
            title={bad && preview?.kind === 'refused' ? preview.message : undefined}
            >{i + 1} {phase}{#if bad}<span class="sr-only"> ({t('plan.new.phase_refused')})</span>{/if}</span
          >
        {/each}
      </p>
      {#if badPhase?.suggestion}
        {@const word = badPhase.value}
        {@const by = badPhase.suggestion}
        <p class="suggest">
          <button type="button" onclick={() => (form.phases = replacePhase(form.phases, word, by))}
            >{t('plan.new.phase_take', { word, suggestion: by })}</button
          >
        </p>
      {/if}
    {/if}
    <!-- The target: an existing task named, or a new one made with the plan in the same request. -->
    <div class="field target">
      {#if form.targetNew}
        <label for="plan-target-title" data-hint={t('hint.form.plan.target_new')}>{t('plan.new.target')}</label>
        <div class="row">
          <input spellcheck="true"
            id="plan-target-title"
            data-hint={t('hint.form.plan.target_new')}
            type="text"
            bind:value={form.targetTitle}
            maxlength="300"
            placeholder={app.planTargetTitle({ ...form, targetTitle: '' })}
            aria-describedby="plan-target-help"
            aria-label={t('plan.new.target_title')}
          />
          <button type="button" data-hint={t('hint.form.plan.target_pick')} onclick={() => (form.targetNew = false)}>{t('plan.new.target_pick')}</button>
        </div>
        <small class="hint" id="plan-target-help"
          >{t(form.kind === 'project' ? 'plan.new.target_new_help_project' : 'plan.new.target_new_help')}
          {#if preview?.kind === 'ok' && preview.target}{t('plan.new.target_will', { id: preview.target })}{/if}</small
        >
      {:else}
        <label for="plan-target" data-hint={t('hint.form.plan.target')}>{t('plan.new.target')}</label>
        <div class="row">
          <input spellcheck="false"
            id="plan-target"
            data-hint={t('hint.form.plan.target')}
            type="text"
            bind:value={form.target}
            list="plan-targets"
            placeholder="lib.nvim/alpha"
            aria-describedby="plan-target-help"
          />
          <button type="button" data-hint={t('hint.form.plan.target_make')} onclick={() => (form.targetNew = true)}>{t('plan.new.target_make')}</button>
        </div>
        <datalist id="plan-targets">
          {#each targets as id (id)}<option value={id}></option>{/each}
        </datalist>
        <small class="hint" id="plan-target-help">{t('plan.new.target_help')}</small>
      {/if}
    </div>
    {#if form.kind === 'plan' && projects.length > 0}
      <label data-hint={t('hint.form.plan.project')}>
        <span>{t('plan.new.project')}</span>
        <select bind:value={form.project} onchange={() => (form.phase = '')}>
          <option value="">{t('project.none')}</option>
          {#each projects as p (p.id)}<option value={p.id}>{p.title}</option>{/each}
        </select>
      </label>
      {#if form.project !== '' && stagesOfProject.length > 0}
        <label data-hint={t('hint.form.plan.stage')}>
          <span>{t('plan.new.phase')}</span>
          <select bind:value={form.phase}>
            <option value="">{t('project.no_stage')}</option>
            {#each stagesOfProject as ph (ph)}<option value={ph}>{ph}</option>{/each}
          </select>
        </label>
      {/if}
    {/if}
    <label data-hint={t('hint.form.plan.status')}>
      <span>{t('plan.new.status')}</span>
      <select bind:value={form.status}>
        {#each PLAN_STATUSES as s (s)}<option value={s}>{t(`plan.status.${s}` as Key)}</option>{/each}
      </select>
    </label>
    <label class="check" data-hint={t('hint.form.plan.gate')}>
      <input type="checkbox" bind:checked={form.hard} />
      <span>{t('plan.new.gate')}</span>
    </label>
    <label data-hint={t('hint.form.plan.summary')}>
      <span>{t('plan.new.summary')}</span>
      <input spellcheck="true" type="text" bind:value={form.summary} maxlength="1000" aria-describedby="plan-summary-help" />
      <small class="hint" id="plan-summary-help">{t('plan.new.summary_help')}</small>
    </label>
    {#if app.can('plan_links')}
      <label data-hint={t('hint.form.plan.links')}>
        <span>{t('field.links')} <small>({t('field.tags_hint')})</small></span>
        <input spellcheck="false"
          type="text"
          bind:value={form.links}
          placeholder="https://"
          aria-invalid={notLink !== null || undefined}
          aria-describedby="plan-links-help"
        />
        <small class="hint" id="plan-links-help">{t('plan.new.links_help')}</small>
      </label>
      {#if notLink !== null}<p class="bad" role="alert">{t('field.links_invalid', { link: notLink })}</p>{/if}
    {/if}
    {#if app.can('plan_assets')}
      <PendingAttachments {app} bind:files bind:screenshot />
    {/if}

    <p class="preview" role="status" aria-live="polite">
      {#if preview?.kind === 'ok'}
        {#if preview.renamed}
          <span class="warn">{t('plan.new.taken', { id: preview.id })}</span>
        {:else}
          {t(form.kind === 'project' ? 'plan.new.project_will' : 'plan.new.will', { id: preview.id })}
        {/if}
      {:else if preview?.kind === 'refused'}
        <span class="bad">{preview.message}</span>
      {:else if preview?.kind === 'unknown' && form.title.trim() !== ''}
        <span class="warn">{t('plan.new.unknown')}</span>
      {/if}
    </p>

    <div class="actions">
      <button type="button" onclick={() => app.closePlanWizard()}>{t('dialog.cancel')}</button>
      <!-- Locked while a request runs, while a link is wrong, and while the engine has not yet confirmed a form that is filled in
           (a wait, not a mistake); an empty form can be sent and says what is missing. -->
      <button type="submit" class="primary" disabled={busy || app.locked || notLink !== null || (form.title.trim() !== '' && form.area !== '' && !canCreate(form, preview))}
        >{t('capture.create')}</button
      >
    </div>
  </form>
</dialog>

<style>
  dialog {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem 1.25rem;
    width: min(34rem, calc(100vw - 2rem));
    max-height: calc(100vh - 2rem);
    overflow: auto;
  }
  dialog::backdrop {
    background: var(--backdrop);
  }
  h2 {
    margin: 0 0 0.75rem;
    font-size: 1.1rem;
  }
  label,
  .field {
    display: grid;
    gap: 0.2rem;
    margin-bottom: 0.7rem;
  }
  .kind {
    display: flex;
    gap: 1rem;
    margin-bottom: 0.7rem;
  }
  .kind label.check {
    margin-bottom: 0;
  }
  label.check {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  input[type='text'],
  select {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.35rem 0.5rem;
  }
  .hint {
    color: var(--muted);
  }
  .target .row {
    display: flex;
    gap: 0.4rem;
  }
  .target .row input {
    flex: 1;
    min-width: 0;
  }
  .phases {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin: -0.3rem 0 0.7rem;
  }
  .chip {
    font-size: 0.75rem;
    padding: 0 0.5rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--muted);
  }
  .bad-chip {
    border-color: var(--bad);
    color: var(--bad);
    text-decoration: wavy underline;
  }
  .suggest {
    margin: -0.4rem 0 0.7rem;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .preview {
    min-height: 1.4rem;
    margin: 0 0 0.7rem;
    font-size: 0.85rem;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .warn {
    color: var(--warn);
  }
  .bad {
    color: var(--bad);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  button {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.35rem 0.8rem;
    cursor: pointer;
  }
  .primary {
    border-color: var(--accent);
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
