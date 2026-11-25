<script lang="ts">
  import { tick } from 'svelte';
  import { leaveGuard } from 'appkit-ui/leaveGuard';
  import LeaveAsk from 'appkit-ui/LeaveAsk.svelte';
  // Add tasks to a plan (or one of its phases) or to a project: a searchable choice of several open tasks (`PickList`),
  // narrowed to the areas of the target at first. A task that belongs to another plan or project is marked and is moved
  // only after a question. One write for all of them (`App.addTasksTo`); what the engine refuses is listed task by task
  // with its words, the rest stays added, and the toast offers the way back. "New task in this plan" opens the capture
  // form filled with the plan, the phase and the area of the plan's file ("New task in this project": the project).
  import { closeOnBackdrop } from 'appkit-ui/backdrop';
  import type { App } from '../lib/app.svelte';
  import { labelOf, translate, type Key } from '../lib/i18n';
  import { areaOfId } from '../lib/cross';
  import { elsewhere, taskOptions, type AddTarget } from '../lib/picker';
  import { markHidden } from '../lib/text';
  import PickList from './PickList.svelte';

  let {
    app,
    target,
    name,
    onclose,
  }: {
    app: App;
    /** Where the tasks go; null: the dialog is closed. */
    target: AddTarget | null;
    /** The title of the plan or project, for the heading. */
    name: string;
    onclose: () => void;
  } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  let dialog: HTMLDialogElement | undefined = $state();
  // Something typed or chosen that closing would lose: Escape asks first (leaveGuard).
  let leaving = $state(false);
  const isDirty = (): boolean => chosen.length > 0;
  let chosen = $state<string[]>([]);
  let onlyAreas = $state(true);
  // The chosen tasks of another plan or project, while the question whether to move them stands.
  let asking = $state<string[] | null>(null);
  let failed = $state<{ id: string; message: string }[]>([]);
  let busy = $state(false);
  // The buttons the focus is handed to when the one that was pressed is gone (the question replaces the row).
  let applyButton = $state<HTMLButtonElement | null>(null);
  let askYes = $state<HTMLButtonElement | null>(null);

  const options = $derived(
    target
      ? taskOptions(app.tasks, target, onlyAreas, {
          status: (s) => labelOf(app.lang, 'status', s ?? 'open'),
          elsewhere: (where) => t('add.elsewhere', { where: titleOf(where) }),
        })
      : [],
  );
  const titles = $derived(
    new Map([
      ...(app.snapshot?.plans ?? []).map((p) => [p.id, p.title] as const),
      ...app.projects.map((p) => [p.id, p.title] as const),
      ...app.tasks.map((x) => [x.id, x.title] as const),
    ]),
  );
  function titleOf(id: string): string {
    return titles.get(id) || id;
  }
  const heading = $derived(
    target?.kind === 'plan' && target.phase !== undefined
      ? t('add.title_phase', { name, phase: target.phase })
      : t('add.title', { name }),
  );

  $effect(() => {
    if (!dialog) return;
    if (target && !dialog.open) {
      chosen = [];
      onlyAreas = true;
      asking = null;
      failed = [];
      leaving = false;
      dialog.showModal();
      // The modal puts the focus on its first control (the switch of the areas): the words are typed first.
      dialog.querySelector<HTMLInputElement>('input[role="combobox"]')?.focus();
    }
    if (!target && dialog.open) dialog.close();
  });

  function toggle(id: string): void {
    chosen = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id];
  }

  function apply(): void {
    if (!target || chosen.length === 0 || busy) return;
    const tasks = new Map(app.tasks.map((x) => [x.id, x] as const));
    const away = chosen.filter((id) => {
      const task = tasks.get(id);
      return task !== undefined && elsewhere(task, target) !== undefined;
    });
    if (away.length > 0) {
      asking = away;
      // The row with Apply is replaced by the question: the focus goes to its first answer, not to the page.
      void tick().then(() => askYes?.focus());
      return;
    }
    void send(chosen);
  }

  async function send(ids: readonly string[]): Promise<void> {
    if (!target || ids.length === 0) {
      asking = null;
      return;
    }
    busy = true;
    asking = null;
    try {
      const answer = await app.addTasksTo(ids, target);
      if (!answer) return;
      failed = answer.failed;
      // The refused ones stay chosen, for a second try; the dialog closes when all went in.
      chosen = answer.failed.map((f) => f.id).filter((id) => ids.includes(id));
      if (answer.failed.length === 0) onclose();
    } finally {
      busy = false;
    }
    // Back to the row (a refused file stays chosen for a second try): the button of the question is gone.
    if (target) void tick().then(() => applyButton?.focus());
  }

  function newTask(): void {
    if (!target) return;
    // The area of the target's file (its id names it); the capture form opens with the plan and the phase, or the project.
    const fill =
      target.kind === 'plan'
        ? { plan: target.id, ...(target.phase !== undefined ? { phase: target.phase } : {}) }
        : { project: target.id };
    const area = areaOfId(target.id);
    onclose();
    app.openCapture('', area, fill);
  }
</script>

<dialog
  bind:this={dialog}
  class="add-tasks"
  aria-labelledby="add-tasks-title"
  use:closeOnBackdrop={{ closeable: () => !isDirty() }} use:leaveGuard={{ dirty: isDirty, ask: () => (leaving = true) }}
  onclose={() => {
    if (target) onclose();
  }}
>
  <h2 id="add-tasks-title">{markHidden(heading)}</h2>
  {#if leaving}<LeaveAsk confirm={t('leave.confirm')} discard={t('leave.discard')} keep={t('leave.keep')} ondiscard={() => { leaving = false; dialog?.close(); }} onkeep={() => (leaving = false)} />{/if}
  {#if target && target.areas.length > 0}
    <label class="check" data-hint={t('hint.ui.add.only_areas')}>
      <input type="checkbox" bind:checked={onlyAreas} />
      <span>{t('add.only_areas', { areas: target.areas.join(', ') })}</span>
    </label>
  {/if}
  {#if target}
    <PickList
      {options}
      selected={chosen}
      multiple
      name="add-tasks"
      searchLabel={t('add.search')}
      hint={t('hint.ui.add.search')}
      emptyLabel={t('pick.empty')}
      autofocus
      onpick={toggle}
      onescape={() => dialog?.close()}
    />
  {/if}
  <p class="muted" role="status">{t('add.chosen', { n: chosen.length })}</p>
  {#if failed.length > 0}
    <div class="failed" role="alert">
      <p>{t('add.failed')}</p>
      <ul>
        {#each failed as f (f.id)}
          <li data-id={f.id}><strong>{markHidden(titleOf(f.id))}</strong>: {markHidden(f.message)}</li>
        {/each}
      </ul>
    </div>
  {/if}
  {#if asking}
    <div class="ask" role="group" aria-label={t('add.ask_move', { n: asking.length })}>
      <p role="alert">{t('add.ask_move', { n: asking.length })}</p>
      <ul>
        {#each asking as id (id)}<li>{markHidden(titleOf(id))}</li>{/each}
      </ul>
      <div class="buttons">
        <button type="button" class="primary" bind:this={askYes} onclick={() => void send(chosen)}>{t('add.move_yes')}</button>
        <button type="button" onclick={() => void send(chosen.filter((id) => !asking?.includes(id)))}
          >{t('add.move_no')}</button
        >
      </div>
    </div>
  {:else}
    <div class="buttons">
      <!-- Locked while nothing is chosen, not an error of a field: the choice is a list with its count ("0 chosen") beside it, and
           a send without a choice has no field to say it at. Locked while it writes (`busy`). -->
      <button
        type="button"
        class="primary"
        bind:this={applyButton}
        disabled={chosen.length === 0 || busy || app.saving}
        onclick={apply}>{t('add.apply')}</button
      >
      <button type="button" data-hint={t('hint.ui.add.new_task')} onclick={newTask}
        >{t(target?.kind === 'project' ? 'add.new_task_project' : 'add.new_task')}</button
      >
      <button type="button" onclick={() => dialog?.close()}>{t('dialog.cancel')}</button>
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
    width: min(36rem, calc(100vw - 2rem));
    max-height: calc(100vh - 2rem);
    overflow: auto;
    box-sizing: border-box;
  }
  dialog::backdrop {
    background: var(--backdrop);
  }
  h2 {
    margin: 0 0 0.75rem;
    font-size: 1.1rem;
    overflow-wrap: anywhere;
  }
  .check {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin-bottom: 0.5rem;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  .failed,
  .ask {
    margin-top: 0.5rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--warn);
    border-radius: var(--radius);
  }
  .failed p,
  .ask p {
    margin: 0 0 0.3rem;
  }
  .failed ul,
  .ask ul {
    margin: 0;
    padding-left: 1.2rem;
  }
  .muted {
    color: var(--muted);
    margin: 0.4rem 0 0;
  }
</style>
