<script lang="ts">
  import { leaveGuard } from '../lib/leaveGuard';
  import LeaveAsk from './LeaveAsk.svelte';
  // Give tags to a task, or to all the marked ones at once, or take tags away: a searchable choice of several
  // (`PickList`) of the tags the open tasks carry; a typed word that is no tag yet can be added as a new one. One write
  // for all the tasks (`App.editTags`); what the engine refuses is listed task by task with its words, the rest stays
  // written, and the toast offers the way back. "Show all with this tag" filters the list by a ticked tag.
  import { closeOnBackdrop } from 'appkit-ui/backdrop';
  import type { App } from '../lib/app.svelte';
  import { translate, type Key } from '../lib/i18n';
  import { addTagOptions, changedBy, newTags, removeTagOptions, tagCounts, typedTag, type TagTexts } from '../lib/tagging';
  import { markHidden } from '../lib/text';
  import PickList from './PickList.svelte';

  let { app }: { app: App } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  let dialog: HTMLDialogElement | undefined = $state();
  // Something typed or chosen that closing would lose: Escape asks first (leaveGuard).
  let leaving = $state(false);
  const isDirty = (): boolean => chosen.length > 0;
  let chosen = $state<string[]>([]);
  // The tags typed here that no task carries yet: listed with the others, so they can be unticked again.
  let made = $state<string[]>([]);
  let failed = $state<{ id: string; message: string }[]>([]);
  let busy = $state(false);

  const asked = $derived(app.tagging);
  const mode = $derived(asked?.mode ?? 'add');
  const tasks = $derived(app.tasks.filter((x) => asked?.ids.includes(x.id)));
  const texts: TagTexts = {
    count: (n) => t('tags.count', { n }),
    all: t('tags.held_all'),
    some: (n, of) => t('tags.held_some', { n, m: of }),
  };
  const all = $derived(tagCounts(app.tasks));
  // A tag typed here is listed as new only until a task carries it (after a write that went through for some of the
  // tasks the dialog stays open, and the list of the vault names the tag itself): every entry once.
  const fresh = $derived(newTags(made, all));
  const options = $derived(
    mode === 'add'
      ? [...fresh.map((tag) => ({ value: tag, label: tag, detail: t('tags.new_mark'), near: true })), ...addTagOptions(all, tasks, texts)]
      : removeTagOptions(tasks, texts),
  );
  const listed = $derived(options.map((o) => o.value));
  const titleOf = $derived(new Map(app.tasks.map((x) => [x.id, x.title] as const)));
  const heading = $derived(
    tasks.length === 1
      ? t(mode === 'add' ? 'tags.add.title_one' : 'tags.remove.title_one', { title: tasks[0]?.title ?? '' })
      : t(mode === 'add' ? 'tags.add.title_many' : 'tags.remove.title_many', { n: tasks.length }),
  );
  // How many of the tasks the ticked tags would change: the button says it.
  const changes = $derived(asked ? changedBy(app.tasks, asked.ids, mode, chosen).length : 0);

  $effect(() => {
    if (!dialog) return;
    if (asked && !dialog.open) {
      chosen = [];
      made = [];
      failed = [];
      leaving = false;
      dialog.showModal();
      dialog.querySelector<HTMLInputElement>('input[role="combobox"]')?.focus();
    }
    if (!asked && dialog.open) dialog.close();
  });

  function toggle(tag: string): void {
    chosen = chosen.includes(tag) ? chosen.filter((x) => x !== tag) : [...chosen, tag];
  }

  function create(typed: string): void {
    const tag = typedTag(typed, listed);
    if (tag === null) return;
    made = [...made, tag];
    chosen = [...chosen, tag];
  }

  async function apply(): Promise<void> {
    if (!asked || chosen.length === 0 || busy) return;
    busy = true;
    try {
      const answer = await app.editTags(asked.ids, mode === 'add' ? { add: chosen, remove: [] } : { add: [], remove: chosen });
      if (!answer) return;
      failed = answer.failed;
      if (answer.failed.length === 0) app.closeTagging();
    } finally {
      busy = false;
    }
  }
</script>

<dialog
  bind:this={dialog}
  class="tag-dialog"
  aria-labelledby="tag-dialog-title"
  use:closeOnBackdrop={{ closeable: () => !isDirty() }} use:leaveGuard={{ dirty: isDirty, ask: () => (leaving = true) }}
  onclose={() => {
    if (asked) app.closeTagging();
  }}
>
  <h2 id="tag-dialog-title">{markHidden(heading)}</h2>
  {#if leaving}<LeaveAsk {app} ondiscard={() => { leaving = false; dialog?.close(); }} onkeep={() => (leaving = false)} />{/if}
  {#if asked}
    <PickList
      {options}
      selected={chosen}
      multiple
      name="tags"
      searchLabel={t(mode === 'add' ? 'tags.search' : 'tags.search_remove')}
      hint={t(mode === 'add' ? 'hint.ui.tags.search' : 'hint.ui.tags.search_remove')}
      emptyLabel={t(mode === 'add' ? 'pick.empty' : 'tags.none_to_remove')}
      autofocus
      onpick={toggle}
      onescape={() => dialog?.close()}
      createLabel={mode === 'add'
        ? (typed) => {
            const tag = typedTag(typed, listed);
            return tag === null ? null : t('tags.new', { tag });
          }
        : undefined}
      oncreate={create}
    />
  {/if}
  <p class="muted" role="status">{chosen.length === 0 ? t('tags.chosen_none') : t('tags.chosen', { tags: chosen.join(', ') })}</p>
  {#if failed.length > 0}
    <div class="failed" role="alert">
      <p>{t('tags.failed')}</p>
      <ul>
        <!-- By place: a failure whose task the answer does not name has no id of its own. -->
        {#each failed as f, i (i)}
          <li data-id={f.id}><strong>{markHidden(titleOf.get(f.id) ?? f.id)}</strong>: {markHidden(f.message)}</li>
        {/each}
      </ul>
    </div>
  {/if}
  <div class="buttons">
    <button type="button" class="primary" disabled={chosen.length === 0 || busy || app.saving} onclick={() => void apply()}
      >{t(mode === 'add' ? 'tags.apply_add' : 'tags.apply_remove', { n: changes })}</button
    >
    {#if chosen.length === 1}
      <button type="button" data-hint={t('hint.ui.tags.show')} onclick={() => app.showTag(chosen[0] ?? '')}
        >{t('tags.show', { tag: chosen[0] ?? '' })}</button
      >
    {/if}
    <button type="button" onclick={() => dialog?.close()}>{t('dialog.cancel')}</button>
  </div>
</dialog>

<style>
  dialog {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem 1.25rem;
    width: min(30rem, calc(100vw - 2rem));
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
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  .failed {
    margin-top: 0.5rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--warn);
    border-radius: var(--radius);
  }
  .failed p {
    margin: 0 0 0.3rem;
  }
  .failed ul {
    margin: 0;
    padding-left: 1.2rem;
  }
  .muted {
    color: var(--muted);
    margin: 0.4rem 0 0;
    overflow-wrap: anywhere;
  }
</style>
