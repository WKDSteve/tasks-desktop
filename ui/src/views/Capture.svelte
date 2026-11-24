<script lang="ts">
  import { tick } from 'svelte';
  import { focusFirstInvalid } from '../lib/formErrors';
  import { leaveGuard } from '../lib/leaveGuard';
  import LeaveAsk from './LeaveAsk.svelte';
  import Info from 'appkit-ui/Info.svelte';
  import { untrack } from 'svelte';
  import { closeOnBackdrop } from 'appkit-ui/backdrop';
  import { floating } from '../lib/floating';
  // Quick capture: a title and an area, nothing else is required. The
  // engine gives the task its place and its file; the page selects it.
  import type { App } from '../lib/app.svelte';
  import { areaLabel } from '../lib/filter';
  import { badLink, badTag, bodyFromSections, parseList, parseTags, scaffoldRows, severityApplies, splitOther } from '../lib/fields';
  import { hintOf, labelOf, translate, type Key } from '../lib/i18n';
  import PickField from './PickField.svelte';
  import { phaseOptions, planOptions, projectOptions } from '../lib/picker';
  import type { TaskDraft } from '../lib/suggestFields';

  let { app }: { app: App } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) =>
    translate(app.lang, key, params);

  const BODY_MAX = 20000;
  let dialog: HTMLDialogElement | undefined = $state();
  // Something typed or chosen that closing would lose: Escape asks first (leaveGuard).
  let leaving = $state(false);
  // A send that found something missing: the fields say it (formErrors.ts).
  let attempted = $state(false);
  let formEl: HTMLFormElement | undefined = $state();
  const isDirty = (): boolean => files.length > 0 || [title, context, acceptance, notes, summary, tags, other, refs, links].some((v) => v.trim() !== '');
  let title = $state('');
  let area = $state('');
  let prio = $state('');
  let kind = $state('');
  let effort = $state('');
  let value = $state('');
  let actor = $state('');
  let summary = $state('');
  let tags = $state('');
  let categories = $state<string[]>([]);
  let scopes = $state<string[]>([]);
  let other = $state('');
  // The ids of the scaffold lines the person unticked (a line that comes back keeps its state).
  let scaffoldOff = $state<string[]>([]);
  let status = $state('');
  let after = $state('');
  let plan = $state('');
  let phase = $state('');
  let project = $state('');
  let due = $state('');
  let start = $state('');
  let extraAreas = $state<string[]>([]);
  let severity = $state('');
  let refs = $state('');
  let links = $state('');
  let problem = $state('');
  let context = $state('');
  let acceptance = $state('');
  let notes = $state('');
  let attach = $state(false);
  let files = $state<File[]>([]);
  let busy = $state(false);
  // "Suggest fields": a free text, asked of ai-desktop; the draft fills the fields above, only "Create" makes the task.
  let draftOpen = $state(false);
  let draftText = $state('');
  let draftBusy = $state(false);
  let draftNote = $state('');
  // The answer to the question before the text leaves the machine; null: no question open.
  let draftAnswer = $state<((yes: boolean) => void) | null>(null);
  // Counts the openings of the form: a draft that comes back after the form was closed fills nothing.
  let opened = 0;

  const scaffold = $derived(
    scaffoldRows(
      app.ranges.scaffold,
      { kind, categories, scopes },
      { categories: app.ranges.categories, scopes: app.ranges.scopes },
      app.lang,
    ),
  );
  const severityFits = $derived(severityApplies(kind, categories));
  // The plan and its phase are chosen from the engine's lists (`PickField`), as in the detail.
  const plans = $derived(app.snapshot?.plans ?? []);
  const phases = $derived(phaseOptions(plans.find((p) => p.id === plan), app.tasks));
  let more = $state(false);
  function choosePlan(next: string): void {
    plan = next;
    // A phase of the old plan that the new one does not have is not kept.
    if (!phaseOptions(plans.find((p) => p.id === next), app.tasks).some((o) => o.value === phase)) phase = '';
  }
  function planAction(action: string): void {
    if (action === 'none') choosePlan('');
    else if (action === 'new-plan') {
      app.openPlanWizard('plan', '', { area, then: (id) => choosePlan(id) });
    }
  }

  const areas = $derived(
    [...app.allAreaNames]
      .map((name) => ({ name, label: app.shortAreas ? areaLabel(name, app.allAreaNames) : name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  );

  $effect(() => {
    if (!dialog) return;
    if (app.capturing && !dialog.open) {
      // The area of the filter, when exactly one is chosen, is the one most
      // likely meant (an area group with one member counts; a group is never a place to write to).
      area = app.captureArea ?? app.writeArea ?? areas[0]?.name ?? '';
      title = app.captureTitle;
      prio = '';
      kind = app.captureFill.kind ?? '';
      effort = '';
      value = '';
      actor = '';
      summary = app.captureFill.summary ?? '';
      tags = app.captureFill.tags ?? '';
      categories = [];
      scopes = [];
      other = '';
      scaffoldOff = [];
      status = '';
      after = '';
      plan = app.captureFill.plan ?? '';
      phase = app.captureFill.phase ?? '';
      project = app.captureFill.project ?? '';
      // A plan or project given from outside is shown, with the other fields it stands among (and so are the refs
      // and links of a finding that was handed over).
      more = plan !== '' || project !== '' || (app.captureFill.refs ?? '') !== '' || (app.captureFill.links ?? '') !== '';
      due = '';
      start = '';
      extraAreas = [];
      severity = '';
      refs = app.captureFill.refs ?? '';
      links = app.captureFill.links ?? '';
      problem = '';
      context = app.captureFill.context ?? '';
      acceptance = '';
      notes = '';
      attach = false;
      files = [];
      // A question still open from the last time is answered no (untracked: the effect does not follow it).
      untrack(() => draftAnswer?.(false));
      draftOpen = false;
      draftText = '';
      draftBusy = false;
      draftNote = '';
      opened += 1;
      leaving = false;
      attempted = false;
      dialog.showModal();
    }
    if (!app.capturing) {
      // Closed while the form asked whether the text may leave this machine: that is a no, and the waiting job is put
      // away (untracked, as above).
      untrack(() => draftAnswer?.(false));
      if (dialog.open) dialog.close();
    }
  });

  /** Ask ai-desktop for the fields of the text; the draft fills the form, nothing is created. */
  async function suggest(): Promise<void> {
    if (draftBusy) return;
    const text = draftText.trim();
    if (text === '') {
      draftNote = t('draft.empty');
      return;
    }
    const run = opened;
    draftBusy = true;
    draftNote = t('draft.asking');
    const outcome = await app.suggestFields(
      text,
      () =>
        new Promise<boolean>((resolve) => {
          draftAnswer = (yes) => {
            draftAnswer = null;
            resolve(yes);
          };
        }),
      () => run === opened && app.capturing,
    );
    if (run !== opened || !app.capturing) return;
    draftBusy = false;
    if (outcome.kind === 'declined') draftNote = t('draft.declined');
    else if (outcome.kind === 'failed') draftNote = t('draft.failed', { why: outcome.why });
    else fill(outcome.draft);
  }

  /** The fields of a draft into the form: only those it has; every field stays as editable as a typed one. */
  function fill(draft: TaskDraft): void {
    title = draft.title;
    if (draft.area !== undefined && areas.some((a) => a.name === draft.area)) area = draft.area;
    if (draft.kind !== undefined) kind = draft.kind;
    if (draft.prio !== undefined) prio = String(draft.prio);
    if (draft.effort !== undefined) effort = draft.effort;
    if (draft.value !== undefined) value = String(draft.value);
    if (draft.tags !== undefined && draft.tags.length > 0) tags = draft.tags.join(', ');
    if (draft.category !== undefined && draft.category.length > 0) categories = [...draft.category];
    if (draft.plan !== undefined) choosePlan(draft.plan);
    // The summary is one line of the form (at most 300 characters).
    if (draft.summary !== undefined) summary = draft.summary.replace(/\s*\n\s*/g, ' ').trim().slice(0, 300);
    if (draft.acceptance !== undefined && draft.acceptance.length > 0) {
      acceptance = draft.acceptance.map((line) => `- [ ] ${line}`).join('\n');
    }
    if (summary !== '' || tags !== '' || categories.length > 0 || plan !== '') more = true;
    draftOpen = false;
    draftNote =
      draft.dropped.length > 0 ? t('draft.filled_dropped', { list: draft.dropped.join(', ') }) : t('draft.filled');
  }

  const titleMissing = $derived(attempted && title.trim() === '');
  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    if (title.trim() === '' || area === '') {
      attempted = true;
      await tick();
      focusFirstInvalid(formEl);
      return;
    }
    busy = true;
    try {
      const fields: Record<string, unknown> = {};
      if (prio !== '') fields['prio'] = Number(prio);
      if (kind !== '') fields['kind'] = kind;
      if (effort !== '') fields['effort'] = effort;
      if (value !== '') fields['value'] = Number(value);
      if (actor !== '') fields['actor'] = actor;
      if (summary.trim() !== '') fields['summary'] = summary.trim();
      // `Other`: a scope word joins the ticks, any other word is a tag (named after the task is made)
      const split = splitOther(other, app.ranges.scopes, scopes);
      const tagList = parseTags([tags, ...split.tags].filter((x) => x.trim() !== '').join(', '));
      const bad = badTag(tagList);
      if (bad !== null) {
        problem = t('field.tags_invalid', { tag: bad });
        return;
      }
      problem = '';
      if (tagList.length > 0) fields['tags'] = tagList;
      if (categories.length > 0) fields['category'] = categories;
      if (split.scope.length > 0) fields['scope'] = split.scope;
      if (status !== '') fields['status'] = status;
      if (severity !== '' && severityFits) fields['severity'] = severity;
      const refList = parseList(refs);
      if (refList.length > 0) fields['refs'] = refList;
      const linkList = parseList(links);
      const notLink = badLink(linkList);
      if (notLink !== null) {
        problem = t('field.links_invalid', { link: notLink });
        return;
      }
      if (linkList.length > 0) fields['links'] = linkList;
      const afterList = parseList(after);
      if (afterList.length > 0) fields['after'] = afterList;
      if (plan.trim() !== '') fields['plan'] = plan.trim();
      if (phase.trim() !== '') fields['phase'] = phase.trim();
      if (project !== '') fields['project'] = project;
      if (due !== '') fields['due'] = due;
      if (start !== '') fields['start'] = start;
      if (due !== '' && start !== '' && start > due) {
        problem = t('capture.dates_order');
        return;
      }
      // One task in each area named (the one chosen first), the same text in all of them.
      const names = [area, ...extraAreas.filter((name) => name !== area)];
      // the ticked scaffold lines open the Acceptance section, the person's own lines follow
      const picked = scaffold.filter((row) => !scaffoldOff.includes(row.id)).map((row) => `- [ ] ${row.text}`);
      const ownAcceptance = acceptance.trim();
      const body = bodyFromSections(
        { context, acceptance: [...picked, ...(ownAcceptance !== '' ? [ownAcceptance] : [])].join('\n'), notes },
        app.lang,
      );
      // The engine refuses a body over 20000 characters; the three fields together can be more (and the headings add
      // to it), so say it here instead of failing the whole write of several areas.
      if (body.length > BODY_MAX) {
        problem = t('capture.body_too_long', { max: BODY_MAX });
        return;
      }
      const created = await app.createTask(names, title.trim(), fields, body);
      // After the task is made: a plain task becomes the folder of its assets.
      if (created) await app.attachAll(created, files, attach);
      if (created && split.tags.length > 0) app.tell('ok', 'capture.other_to_tags', { words: split.tags.join(', ') });
    } finally {
      busy = false;
    }
  }
</script>

<dialog bind:this={dialog} use:floating={{ kind: 'capture', moveLabel: t('float.move'), moveHint: t('hint.float.move') }} use:closeOnBackdrop={{ closeable: () => !isDirty() }} use:leaveGuard={{ dirty: isDirty, ask: () => (leaving = true) }} aria-labelledby="capture-title" onclose={() => app.closeCapture()}>
  <form onsubmit={submit} novalidate aria-busy={busy} bind:this={formEl}>
    <div class="dialog-head">
      <h2 id="capture-title">{t('capture.title')}</h2>
      <Info hint={t('hint.dialog.capture')} label={t('hint.about', { what: t('capture.title') })} />
    </div>
    {#if leaving}<LeaveAsk {app} ondiscard={() => { leaving = false; dialog?.close(); }} onkeep={() => (leaving = false)} />{/if}
    {#if app.aiFeatures}
      <div class="draft">
        {#if !draftOpen}
          <button type="button" data-hint={t('hint.form.draft_button')} onclick={() => (draftOpen = true)}
            >{t('draft.button')}</button
          >
        {:else}
          <label data-hint={t('hint.form.draft_text')}>
            <span>{t('draft.text_label')}</span>
            <textarea spellcheck="true" bind:value={draftText} rows="4" maxlength="20000" disabled={draftBusy}></textarea>
          </label>
          {#if draftAnswer}
            <p class="draft-ask" role="alert">{t('draft.confirm')}</p>
            <div class="draft-row">
              <button type="button" onclick={() => draftAnswer?.(true)}>{t('draft.confirm_yes')}</button>
              <button type="button" onclick={() => draftAnswer?.(false)}>{t('draft.confirm_no')}</button>
            </div>
          {:else}
            <div class="draft-row">
              <button type="button" onclick={suggest} disabled={draftBusy}>{t('draft.go')}</button>
              <button type="button" onclick={() => (draftOpen = false)} disabled={draftBusy}>{t('draft.close')}</button>
            </div>
          {/if}
        {/if}
        {#if draftNote}<p class="draft-note" role="status">{draftNote}</p>{/if}
      </div>
    {/if}
    <label data-hint={t('hint.form.task.title')}>
      <span>{t('capture.name')}</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input spellcheck="true" type="text" bind:value={title} maxlength="300" required autofocus aria-invalid={titleMissing ? 'true' : undefined} aria-describedby={titleMissing ? 'capture-title-error' : undefined} />
    </label>
    {#if titleMissing}<small class="field-error" id="capture-title-error">{t('form.title_required')}</small>{/if}
    <label data-hint={t('hint.form.task.area')}>
      <span>{t('capture.area')}</span>
      <select bind:value={area} required>
        {#each areas as a (a.name)}
          <option value={a.name} title={a.name}>{a.label}</option>
        {/each}
      </select>
    </label>
    {#if areas.length > 1}
      <details class="more">
        <summary>{t('capture.areas_more')}</summary>
        <div class="checks" data-hint={t('hint.form.task.areas_more')}>
          {#each areas.filter((a) => a.name !== area) as a (a.name)}
            <label class="check">
              <input type="checkbox" value={a.name} bind:group={extraAreas} />
              <span title={a.name}>{a.label}</span>
            </label>
          {/each}
        </div>
      </details>
    {/if}
    <div class="grid">
      <label data-hint={hintOf(app.lang, 'hint.field', 'kind')}>
        <span>{t('field.kind')}</span>
        <select bind:value={kind}>
          <option value="">{t('field.none')}</option>
          {#each app.ranges.kinds as k (k)}<option value={k}>{labelOf(app.lang, 'kind', k)}</option>{/each}
        </select>
      </label>
      <label data-hint={hintOf(app.lang, 'hint.field', 'prio')}>
        <span>{t('field.prio')}</span>
        <select bind:value={prio}>
          <option value="">{t('field.none')}</option>
          {#each app.ranges.prios as p (p)}<option value={String(p)}>{p}</option>{/each}
        </select>
      </label>
      <label data-hint={hintOf(app.lang, 'hint.field', 'effort')}>
        <span>{t('field.effort')}</span>
        <select bind:value={effort}>
          <option value="">{t('field.none')}</option>
          {#each app.ranges.efforts as e (e)}<option value={e}>{e}</option>{/each}
        </select>
      </label>
      <label data-hint={hintOf(app.lang, 'hint.field', 'value')}>
        <span>{t('field.value')}</span>
        <select bind:value={value}>
          <option value="">{t('field.none')}</option>
          {#each app.ranges.values as v (v)}<option value={String(v)}>{v}</option>{/each}
        </select>
      </label>
      <label data-hint={hintOf(app.lang, 'hint.field', 'actor')}>
        <span>{t('field.actor')}</span>
        <select bind:value={actor}>
          <option value="">{t('field.none')}</option>
          {#each app.ranges.actors as a (a)}<option value={a}>{labelOf(app.lang, 'actor', a)}</option>{/each}
        </select>
      </label>
      <label data-hint={hintOf(app.lang, 'hint.field', 'status')}>
        <span>{t('field.status')}</span>
        <select bind:value={status}>
          <option value="">{t('field.none')}</option>
          {#each app.ranges.statuses as s (s)}<option value={s}>{labelOf(app.lang, 'status', s)}</option>{/each}
        </select>
      </label>
      <label data-hint={hintOf(app.lang, 'hint.field', 'due')}>
        <span>{t('field.due')}</span>
        <input type="date" bind:value={due} />
      </label>
      <label data-hint={hintOf(app.lang, 'hint.field', 'start')}>
        <span>{t('field.start')}</span>
        <input type="date" bind:value={start} max={due === '' ? undefined : due} />
      </label>
    </div>
    <details class="more" bind:open={more}>
      <summary>{t('capture.more')}</summary>
      <label data-hint={hintOf(app.lang, 'hint.field', 'summary')}>
        <span>{t('field.summary')}</span>
        <input spellcheck="true" type="text" bind:value={summary} maxlength="300" />
      </label>
      <label data-hint={hintOf(app.lang, 'hint.field', 'tags')}>
        <span>{t('field.tags')} <small>({t('field.tags_hint')})</small></span>
        <input spellcheck="false" type="text" bind:value={tags} />
      </label>
      <fieldset class="cats" data-hint={hintOf(app.lang, 'hint.field', 'category')}>
        <legend>{t('field.category')}</legend>
        <div class="checks">
          {#each app.ranges.categories as c (c)}
            <label class="check">
              <input type="checkbox" value={c} bind:group={categories} />
              <span>{labelOf(app.lang, 'category', c)}</span>
            </label>
          {/each}
        </div>
      </fieldset>
      <fieldset class="cats" data-hint={hintOf(app.lang, 'hint.field', 'scope')}>
        <legend>{t('field.scope')}</legend>
        <div class="checks">
          {#each app.ranges.scopes as c (c)}
            <label class="check">
              <input type="checkbox" value={c} bind:group={scopes} />
              <span>{labelOf(app.lang, 'scope', c)}</span>
            </label>
          {/each}
        </div>
      </fieldset>
      <label data-hint={hintOf(app.lang, 'hint.field', 'scope_other')}>
        <span>{t('field.scope_other')} <small>({t('field.scope_other_hint')})</small></span>
        <input spellcheck="false" type="text" bind:value={other} />
      </label>
      <label data-hint={hintOf(app.lang, 'hint.field', 'severity')}>
        <span>{t('field.severity')}{#if !severityFits} <small>({t('field.severity_only')})</small>{/if}</span>
        <select bind:value={severity} disabled={!severityFits}>
          <option value="">{t('field.none')}</option>
          {#each app.ranges.severities as v (v)}<option value={v}>{labelOf(app.lang, 'severity', v)}</option>{/each}
        </select>
      </label>
      <label data-hint={hintOf(app.lang, 'hint.field', 'refs')}>
        <span>{t('field.refs')} <small>({t('field.tags_hint')})</small></span>
        <input spellcheck="false" type="text" bind:value={refs} />
      </label>
      <label data-hint={hintOf(app.lang, 'hint.field', 'links')}>
        <span>{t('field.links')} <small>({t('field.tags_hint')})</small></span>
        <input spellcheck="false" type="text" bind:value={links} placeholder="https://" />
      </label>
      <label data-hint={hintOf(app.lang, 'hint.field', 'after')}>
        <span>{t('field.after')} <small>({t('field.tags_hint')})</small></span>
        <input spellcheck="false" type="text" bind:value={after} placeholder="area/task" />
      </label>
      <PickField
        label={t('field.plan')}
        hint={hintOf(app.lang, 'hint.field', 'plan')}
        name="plan"
        value={plan}
        options={planOptions(plans, area)}
        actions={[
          { id: 'none', label: t('pick.plan.none') },
          ...(app.can('plan_new') ? [{ id: 'new-plan', label: t('pick.plan.new') }] : []),
        ]}
        placeholder={t('pick.plan.none')}
        searchLabel={t('pick.plan.search')}
        emptyLabel={t('pick.empty')}
        onpick={choosePlan}
        onaction={planAction}
      />
      <PickField
        label={t('field.phase')}
        hint={hintOf(app.lang, 'hint.field', 'phase')}
        name="phase"
        value={phase}
        options={phases}
        actions={[{ id: 'none', label: t('pick.phase.none') }]}
        placeholder={plan ? t('pick.phase.none') : t('pick.phase.no_plan')}
        searchLabel={t('pick.phase.search')}
        emptyLabel={t('pick.empty')}
        disabled={plan === '' && phase === ''}
        onpick={(v) => (phase = v)}
        onaction={() => (phase = '')}
      />
      {#if app.can('projects') || project !== ''}
        <PickField
          label={t('field.project')}
          hint={hintOf(app.lang, 'hint.field', 'project')}
          name="project"
          value={project}
          options={projectOptions(app.projects, area)}
          actions={[{ id: 'none', label: t('pick.project.none') }]}
          placeholder={t('pick.project.none')}
          searchLabel={t('pick.project.search')}
          emptyLabel={t('pick.empty')}
          onpick={(v) => (project = v)}
          onaction={() => (project = '')}
        />
      {/if}
    </details>
    <label data-hint={t('hint.form.task.context')}>
      <span>{t('capture.context')} <small>({t('capture.sections_hint')})</small></span>
      <textarea spellcheck="true" bind:value={context} rows="3" maxlength="20000"></textarea>
    </label>
    {#if scaffold.length > 0}
      <fieldset class="cats" data-hint={t('hint.form.task.scaffold')}>
        <legend>{t('capture.scaffold')} <small>({t('capture.scaffold_hint')})</small></legend>
        <div class="checks">
          {#each scaffold as row (row.id)}
            <label class="check">
              <input
                type="checkbox"
                checked={!scaffoldOff.includes(row.id)}
                onchange={(e) => {
                  scaffoldOff = e.currentTarget.checked ? scaffoldOff.filter((id) => id !== row.id) : [...scaffoldOff, row.id];
                }}
              />
              <span>{row.text}</span>
            </label>
          {/each}
        </div>
      </fieldset>
    {/if}
    <label data-hint={t('hint.form.task.acceptance')}>
      <span>{t('capture.acceptance')} <small>({t('capture.acceptance_hint')})</small></span>
      <textarea spellcheck="true" bind:value={acceptance} rows="3" maxlength="20000"></textarea>
    </label>
    <label data-hint={t('hint.form.task.notes')}>
      <span>{t('capture.notes')}</span>
      <textarea spellcheck="true" bind:value={notes} rows="2" maxlength="20000"></textarea>
    </label>
    <!-- loaded when it can be used: the main chunk of the page stays within its budget -->
    {#if app.canAttach}
      {#await import('./PendingAttachments.svelte') then { default: PendingAttachments }}
        <PendingAttachments {app} bind:files bind:screenshot={attach} />
      {/await}
    {/if}
    {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
    <div class="actions">
      <button type="button" onclick={() => app.closeCapture()}>{t('dialog.cancel')}</button>
      <button type="submit" class="primary" disabled={busy}
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
    width: min(36rem, calc(100vw - 2rem));
  }
  dialog::backdrop {
    background: var(--backdrop);
  }
  h2 {
    margin: 0 0 0.75rem;
    font-size: 1.1rem;
  }
  label {
    display: grid;
    gap: 0.2rem;
    margin-bottom: 0.7rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: 0 0.75rem;
  }
  .more {
    margin-bottom: 0.7rem;
  }
  .draft {
    margin-bottom: 0.7rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border);
  }
  .draft-row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .draft-ask,
  .draft-note {
    margin: 0.4rem 0;
    font-size: 0.9rem;
  }
  .more summary {
    cursor: pointer;
    color: var(--accent);
    margin-bottom: 0.5rem;
  }
  .problem {
    color: var(--bad);
    margin: 0 0 0.6rem;
  }
  .cats {
    border: 0;
    padding: 0;
    margin: 0 0 0.7rem;
  }
  .cats legend {
    padding: 0;
    margin-bottom: 0.2rem;
  }
  .checks {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem 0.9rem;
  }
  .checks label.check {
    margin-bottom: 0;
  }
  label.check {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  input,
  textarea,
  select {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.35rem 0.5rem;
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
