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

  // The two choices are a `select` with all its options: drawn only in the row that is meant (under the pointer, with the
  // focus, selected, or while its write is on its way), as a placeholder of the same width in every other. With 600 rows
  // that is 1200 `select` and 5000 `option` less (measured: 18567 elements and 260 ms of the list against 9325 and 145 ms
  // without the two actions). The placeholder is not focusable: the row's own button takes the focus first, and with it
  // the choice is there for the next Tab.
  let bar: HTMLElement | undefined = $state();
  let hovered = $state(false);
  let focused = $state(false);
  let writing = $state(false);
  const meant = $derived(selected || hovered || focused || writing);
  // The choice of an area for this task is open (a modal dialog over the page): the row has no pointer and no focus then,
  // and the button that opened it must stay one that can take the focus back when the dialog closes (a hidden one cannot).
  const asking = $derived(app.dropChoose === task.id || app.dropMove?.id === task.id);
  $effect(() => {
    const host = bar?.closest('.row-host');
    if (!host) return;
    hovered = host.matches(':hover');
    focused = host.matches(':focus-within');
    // Not at once: the browser fires `focusout` while Svelte takes an element out of the page (in the middle of an update),
    // and state may not be written there (state_unsafe_mutation).
    const later = (write: () => void) => queueMicrotask(write);
    const enter = () => later(() => (hovered = true));
    const leave = () => later(() => (hovered = false));
    const focusIn = () => later(() => (focused = true));
    const focusOut = (e: Event) => {
      const to = (e as FocusEvent).relatedTarget as Node | null;
      later(() => (focused = host.contains(to)));
    };
    host.addEventListener('pointerenter', enter);
    host.addEventListener('pointerleave', leave);
    host.addEventListener('focusin', focusIn);
    host.addEventListener('focusout', focusOut);
    return () => {
      host.removeEventListener('pointerenter', enter);
      host.removeEventListener('pointerleave', leave);
      host.removeEventListener('focusin', focusIn);
      host.removeEventListener('focusout', focusOut);
    };
  });
  /** As wide as the widest of the choices (the real `select` has the same width, so nothing moves when it replaces the placeholder). */
  const widthOf = (labels: readonly string[]): string => `min(7.5rem, ${Math.max(1, ...labels.map((l) => l.length))}ch + 2.4rem)`;
  const statusWidth = $derived(widthOf(statuses.map((choice) => labelOf(app.lang, 'status', choice))));
  const prioWidth = $derived(widthOf([...prios.map((prio) => `P${prio}`), ...(task.prio === undefined ? [t('rowact.no_prio')] : [])]));

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
    // The select stays while its write is on its way, also when the pointer leaves the row.
    writing = true;
    try {
      await app.setField(task.id, key, value);
    } finally {
      writing = false;
    }
    await tick();
    if (!el.isConnected) return;
    el.value = shows();
    if (!el.disabled && (document.activeElement === document.body || document.activeElement === null)) el.focus();
  }
</script>

{#if offered.length > 0}
  <span bind:this={bar} class="row-actions" class:shown={barShown(app.rowActions, selected) || asking} class:always={app.rowActions.always} role="group" aria-label={t('rowact.group', { id: task.id })}>
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
        {#if meant}
          <label data-hint={t('hint.form.rowact.status')}>
            <span class="sr-only">{t('rowact.status', { id: task.id })}</span>
            <select
              data-row-action="status"
              style:width={statusWidth}
              value={status}
              disabled={app.locked}
              onchange={(e) => void choose(e.currentTarget, 'status', e.currentTarget.value, () => task.status ?? '')}
            >
              {#each statuses as choice (choice)}<option value={choice}>{labelOf(app.lang, 'status', choice)}</option>{/each}
            </select>
          </label>
        {:else}
          <span class="ghost" class:locked={app.locked} data-row-action="status" aria-hidden="true" style:width={statusWidth}>{labelOf(app.lang, 'status', status)}</span>
        {/if}
      {:else if action === 'prio'}
        {#if meant}
          <label data-hint={t('hint.form.rowact.prio')}>
            <span class="sr-only">{t('rowact.prio', { id: task.id })}</span>
            <select
              data-row-action="prio"
              style:width={prioWidth}
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
        {:else}
          <span class="ghost" class:locked={app.locked} data-row-action="prio" aria-hidden="true" style:width={prioWidth}>{task.prio === undefined ? t('rowact.no_prio') : `P${task.prio}`}</span>
        {/if}
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
    font-size: 1rem;
    line-height: 1.3;
    padding: 0 0.35rem;
    min-width: 1.6rem;
  }
  button {
    font-size: 0.8rem;
  }
  select {
    background: var(--surface);
    max-width: 7.5rem;
  }
  /* The stand-in of a choice in a row that is not meant: looks like the select it is replaced by, and is not reached. */
  .ghost {
    display: inline-block;
    box-sizing: border-box;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-size: 1rem;
    line-height: 1.3;
    min-width: 1.6rem;
    max-width: 7.5rem;
    overflow: hidden;
    padding: 0 0.35rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ghost.locked {
    opacity: 0.55;
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
