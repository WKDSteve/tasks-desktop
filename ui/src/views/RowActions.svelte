<script lang="ts">
  // The actions at the end of a row of a list (lib/rowActions.ts): the ones the person chose, for this task. The bar
  // keeps its place in every row (nothing moves when the pointer goes over a row) and is drawn in the row under the
  // pointer, with the focus or selected, or in every row when that is switched on. The element around the row and the
  // bar carries the class `row-host`.
  import type { App } from '../lib/app.svelte';
  import type { TaskEntry } from '../lib/contract';
  import { translate, type Key } from '../lib/i18n';
  import { barShown, offeredRowActions } from '../lib/rowActions';
  import { copyText } from '../lib/exportDom';
  import { labelOf } from '../lib/i18n';
  import { tick } from 'svelte';

  let { app, task, selected = false }: { app: App; task: TaskEntry; selected?: boolean } = $props();

  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);
  const offered = $derived(
    offeredRowActions(app.rowActions, { move: app.can('move_area'), write: app.can('ops'), machine: app.machineActions }, task),
  );
  // A status this version does not know stays the chosen one until another is chosen.
  const status = $derived(task.status ?? '');
  const statuses = $derived(app.ranges.statuses.includes(status) ? app.ranges.statuses : [status, ...app.ranges.statuses]);

  const prios = $derived(task.prio === undefined || app.ranges.prios.includes(task.prio) ? app.ranges.prios : [task.prio, ...app.ranges.prios]);

  // A page that is not served securely has no clipboard: the helper says so instead of throwing.
  async function copyId(): Promise<void> {
    if (await copyText(navigator.clipboard, task.id)) app.tell('ok', 'ctx.copied', { id: task.id });
    else app.tell('error', 'about.copy_failed');
  }

  /**
   * A choice of the row is written at once. The choice is held back while the write is on its way, which takes the
   * focus from it; and a write that did not go through (a conflict, nothing sent) leaves the task as it was, while the
   * element still shows what was chosen. Afterwards it shows what the task has, and has the focus again if nothing
   * else took it.
   */
  async function choose(el: HTMLSelectElement, key: 'status' | 'prio', value: string | number, shows: () => string): Promise<void> {
    await app.setField(task.id, key, value);
    await tick();
    if (!el.isConnected) return;
    el.value = shows();
    if (!el.disabled && (document.activeElement === document.body || document.activeElement === null)) el.focus();
  }
</script>

{#if offered.length > 0}
  <span class="row-actions" class:shown={barShown(app.rowActions, selected)} class:always={app.rowActions.always} role="group" aria-label={t('rowact.group', { id: task.id })}>
    {#each offered as action (action)}
      {#if action === 'move'}
        <button
          type="button"
          data-row-action="move"
          aria-label={t('drop.row_button', { id: task.id })}
          data-hint={t('drop.choose')}
          disabled={app.locked}
          onclick={() => app.chooseDropMove(task.id)}>⇄</button
        >
      {:else if action === 'status'}
        <label data-hint={t('hint.form.rowact.status')}>
          <span class="sr-only">{t('rowact.status', { id: task.id })}</span>
          <select
            data-row-action="status"
            value={status}
            disabled={app.locked}
            onchange={(e) => void choose(e.currentTarget, 'status', e.currentTarget.value, () => task.status ?? '')}
          >
            {#each statuses as choice (choice)}<option value={choice}>{labelOf(app.lang, 'status', choice)}</option>{/each}
          </select>
        </label>
      {:else if action === 'prio'}
        <label data-hint={t('hint.form.rowact.prio')}>
          <span class="sr-only">{t('rowact.prio', { id: task.id })}</span>
          <select
            data-row-action="prio"
            value={task.prio === undefined ? '' : String(task.prio)}
            disabled={app.locked}
            onchange={(e) => {
              if (e.currentTarget.value !== '') void choose(e.currentTarget, 'prio', Number(e.currentTarget.value), () => (task.prio === undefined ? '' : String(task.prio)));
            }}
          >
            {#if task.prio === undefined}<option value="">{t('rowact.no_prio')}</option>{/if}
            {#each prios as prio (prio)}<option value={String(prio)}>P{prio}</option>{/each}
          </select>
        </label>
      {:else if action === 'finish'}
        <button
          type="button"
          data-row-action="finish"
          aria-label={t('rowact.finish', { id: task.id })}
          data-hint={t('hint.ui.detail.finish')}
          disabled={app.locked}
          onclick={() => void app.startFinish(task.id)}>✓</button
        >
      {:else if action === 'copy'}
        <button
          type="button"
          data-row-action="copy"
          aria-label={t('rowact.copy', { id: task.id })}
          data-hint={t('hint.ui.rowact.copy')}
          onclick={() => void copyId()}>⧉</button
        >
      {:else if action === 'editor'}
        <button
          type="button"
          data-row-action="editor"
          aria-label={t('rowact.editor', { id: task.id })}
          data-hint={t('hint.ui.detail.open_editor')}
          onclick={() => void app.openInEditor(task.id)}>✎</button
        >
      {/if}
    {/each}
  </span>
{/if}

<style>
  /* The bar lies over the end of its row (the marks of the row that is meant), on the ground of that row: it takes no
     width from the row, so nothing moves when the pointer goes over the list and a narrow window cuts no title for it.
     Hidden, not gone: a hidden button is out of the order of the keyboard until its row has the focus. */
  :global(.row-host) {
    position: relative;
  }
  .row-actions {
    visibility: hidden;
    position: absolute;
    top: 0;
    bottom: 0;
    right: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0 0.4rem;
    background: var(--surface-2);
  }
  /* A row of the list that is narrow (a small window, the columns dragged wide) has no end to spare: its title is cut
     already and the bar would lie on it. There the bar is not drawn; the context menu of the row has the same. The
     rows that are a container say so themselves (`row-line`, TaskRow). */
  @container row-line (max-width: 52rem) {
    .row-actions:not(.always) {
      display: none;
    }
  }
  /* Always shown: beside the marks, in the row (which gives the room), not over them. */
  .row-actions.always {
    position: static;
    flex: none;
    background: none;
  }
  .row-actions.shown,
  :global(.row-host:hover) > .row-actions,
  :global(.row-host:focus-within) > .row-actions {
    visibility: visible;
  }
  button,
  select {
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    cursor: pointer;
    font: inherit;
    font-size: 0.8rem;
    line-height: 1.3;
    padding: 0 0.35rem;
    min-width: 1.6rem;
  }
  select {
    background: var(--surface);
    max-width: 7.5rem;
  }
  button:hover:not(:disabled),
  select:hover:not(:disabled) {
    background: var(--surface-2);
  }
  button:disabled,
  select:disabled {
    cursor: default;
    opacity: 0.55;
  }
</style>
