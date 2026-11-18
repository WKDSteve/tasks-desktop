<script lang="ts">
  // The actions at the end of a row of a list (lib/rowActions.ts): the ones the person chose, for this task. The bar
  // keeps its place in every row (nothing moves when the pointer goes over a row) and is drawn in the row under the
  // pointer, with the focus or selected, or in every row when that is switched on. The element around the row and the
  // bar carries the class `row-host`.
  import type { App } from '../lib/app.svelte';
  import type { TaskEntry } from '../lib/contract';
  import { translate, type Key } from '../lib/i18n';
  import { barShown, offeredRowActions } from '../lib/rowActions';

  let { app, task, selected = false }: { app: App; task: TaskEntry; selected?: boolean } = $props();

  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);
  const offered = $derived(
    offeredRowActions(app.rowActions, { move: app.can('move_area'), write: app.can('ops'), machine: app.machineActions }, task),
  );
  // A status this version does not know stays the chosen one until another is chosen.
  const status = $derived(task.status ?? '');
  const statuses = $derived(app.ranges.statuses.includes(status) ? app.ranges.statuses : [status, ...app.ranges.statuses]);

  function copyId(): void {
    void navigator.clipboard.writeText(task.id).then(
      () => app.tell('ok', 'ctx.copied', { id: task.id }),
      () => app.tell('error', 'about.copy_failed'),
    );
  }
</script>

{#if offered.length > 0}
  <span class="row-actions" class:shown={barShown(app.rowActions, selected)} role="group" aria-label={t('rowact.group', { id: task.id })}>
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
            onchange={(e) => void app.setField(task.id, 'status', e.currentTarget.value)}
          >
            {#each statuses as choice (choice)}<option value={choice}>{t(`status.${choice}` as Key)}</option>{/each}
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
              if (e.currentTarget.value !== '') void app.setField(task.id, 'prio', Number(e.currentTarget.value));
            }}
          >
            {#if task.prio === undefined}<option value="">{t('rowact.no_prio')}</option>{/if}
            {#each app.ranges.prios as prio (prio)}<option value={String(prio)}>P{prio}</option>{/each}
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
          onclick={copyId}>⧉</button
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
  /* Hidden, not gone: the bar keeps its width in every row, so nothing jumps when the pointer goes over the list, and
     a hidden button is out of the order of the keyboard until its row has the focus. */
  .row-actions {
    visibility: hidden;
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 0.25rem;
    margin: 0 0.4rem;
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
