<script lang="ts" module>
  import type { FinishedItem, TaskEntry } from '../lib/contract';

  /** A group of the float: the tasks behind one number of the tile Today. */
  export interface DailyGroup {
    /** The evaluation (`finished`, `created`, ...), also the group's `data-group`. */
    key: string;
    /** The number and its word, as the tile shows them ("≥ 12 finished"). */
    heading: string;
    /** More were finished than were read: the list shows part of them. */
    cut: boolean;
    open?: TaskEntry[];
    finished?: FinishedItem[];
    /** What a finished row shows beside its date: its effort or its commit. */
    extra?: 'effort' | 'commit';
    /** Opens the same tasks in the list or in the view Done; missing where no view keeps exactly these. */
    list?: () => void;
  }
</script>

<script lang="ts">
  // The tasks behind a number of the tile Today, in a float over the page: the open tasks (made or changed in the
  // period) or the finished ones (all, or the part an evaluation counts). The tile hands over the groups, chosen with the
  // functions it counts with, so a number and its list cannot part. A task opens its detail as in the list; "in the list"
  // opens the same tasks in the list (or the view Done) where one keeps exactly these.
  import { closeOnBackdrop } from 'appkit-ui/backdrop';
  import type { App } from '../lib/app.svelte';
  import { floating } from '../lib/floating';
  import { labelOf, translate, type Key } from '../lib/i18n';
  import { markHidden } from '../lib/text';

  let { app, title, groups, onclose }: { app: App; title: string; groups: DailyGroup[] | null; onclose: () => void } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  let dialog: HTMLDialogElement | undefined = $state();

  $effect(() => {
    if (!dialog) return;
    if (groups !== null && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLButtonElement>('button[data-close]')?.focus();
    }
    if (groups === null && dialog.open) dialog.close();
  });

  function openTask(id: string): void {
    onclose();
    app.peek(id);
  }

  function openFinished(item: FinishedItem): void {
    onclose();
    app.finishedPeek = item;
  }

  function toList(go: () => void): void {
    onclose();
    go();
  }
</script>

<dialog
  bind:this={dialog}
  use:floating={{ kind: 'daily', moveLabel: t('float.move'), moveHint: t('hint.float.move') }}
  use:closeOnBackdrop
  class="daily-list"
  aria-labelledby="daily-list-title"
  onclose={() => {
    if (groups !== null) onclose();
  }}
>
  <div class="bar">
    <h2 id="daily-list-title">{title}</h2>
    <button type="button" data-close onclick={() => dialog?.close()}>{t('peek.close')}</button>
  </div>
  {#each groups ?? [] as group (group.key)}
    <section data-group={group.key} aria-label={group.heading}>
      <div class="head">
        <h3>{group.heading}</h3>
        {#if group.list}
          <button type="button" class="link" data-list onclick={() => toList(group.list!)}>{t('daily.list.open')}</button>
        {/if}
      </div>
      {#if group.cut}<p class="muted cut" data-cut>{t('daily.list.cut')}</p>{/if}
      {#if (group.open?.length ?? 0) + (group.finished?.length ?? 0) === 0}
        <p class="muted">{t('daily.list.empty')}</p>
      {:else}
        <ul>
          {#each group.open ?? [] as task (task.id)}
            <li data-task={task.id}>
              <button type="button" class="link" onclick={() => openTask(task.id)}>{markHidden(task.title)}</button>
              <span class="muted">{task.area} · {labelOf(app.lang, 'status', task.status)} · {String(group.key === 'created' ? task.created : task.updated)}</span>
            </li>
          {/each}
          {#each group.finished ?? [] as item (item.file)}
            <li data-task={item.id}>
              <button type="button" class="link" onclick={() => openFinished(item)}>{markHidden(item.title)}</button>
              <span class="muted"
                >{item.area} · {item.done ?? t('done.undated_row')}{#if group.extra === 'effort' && item.effort_days !== undefined}
                  · {t('daily.list.days', { n: item.effort_days })}{:else if group.extra === 'commit' && item.done_in}
                  · <code>{markHidden(item.done_in)}</code>{/if}</span
              >
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/each}
</dialog>

<style>
  dialog {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0.8rem 1rem;
    width: min(36rem, calc(100vw - 2rem));
    max-height: min(32rem, calc(100vh - 4rem));
    overflow: auto;
  }
  .bar,
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.8rem;
  }
  h2 {
    font-size: 1rem;
    margin: 0;
  }
  h3 {
    font-size: 0.95rem;
    margin: 0.8rem 0 0.3rem;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem 0.6rem;
    padding: 0.2rem 0;
    border-top: 1px solid var(--line);
  }
  .link {
    background: none;
    border: 0;
    color: var(--accent);
    cursor: pointer;
    padding: 0;
    text-align: left;
  }
  .bar button[data-close] {
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    color: var(--text);
    cursor: pointer;
    padding: 0.2rem 0.6rem;
  }
  .cut {
    margin: 0 0 0.3rem;
  }
</style>
