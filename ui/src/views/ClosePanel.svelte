<script lang="ts">
  // Finishing a plan or a project by hand (capabilities `plan_close`, `project_close`): the engine is asked first (a
  // dry run), the panel says what happens or what holds it open, and only then offers the finish. Used by the project
  // page (its plans and the project) and by the plan view (the chosen plan, also one that is in no project).
  import type { App } from '../lib/app.svelte';
  import { translate, type Key } from '../lib/i18n';
  import { markHidden } from '../lib/text';
  import type { ClosePreview } from '../lib/projects';

  let {
    app,
    kind,
    id,
    title,
    names,
    label,
    onclose,
  }: {
    app: App;
    kind: 'plan' | 'project';
    id: string;
    title: string;
    /** Titles of tasks and plans, for what holds it open. */
    names: ReadonlyMap<string, string>;
    /** The name of the group: the words of the button that opened it. */
    label: string;
    /** The panel is done: cancelled or finished. */
    onclose: () => void;
  } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  // The answer belongs to the file it was asked for: another plan chosen meanwhile asks again.
  let preview = $state<{ key: string; value: ClosePreview } | null>(null);
  const key = $derived(`${kind}|${id}`);
  const shown = $derived(preview?.key === key ? preview.value : null);
  $effect(() => {
    const asked = key;
    let gone = false;
    void app.previewClose(kind, id).then((value) => {
      if (!gone) preview = { key: asked, value };
    });
    return () => {
      gone = true;
    };
  });

  async function confirm(): Promise<void> {
    if (shown?.kind !== 'ok') return;
    if (await app.closePlanFile(kind, id)) onclose();
  }
</script>

<div class="close-panel" role="group" aria-label={label}>
  {#if shown === null}
    <p class="muted">{t('state.loading')}</p>
  {:else if shown.kind === 'ok'}
    <p>{t(kind === 'plan' ? 'project.close.will_plan' : 'project.close.will_project', { title: markHidden(title) })}</p>
  {:else if shown.kind === 'holding'}
    <p>{t('project.close.holding')}</p>
    <ul class="holding">
      {#each shown.ids as held (held)}<li>{markHidden(names.get(held) ?? held)} <code>{held}</code></li>{/each}
    </ul>
  {:else if shown.kind === 'refused'}
    <p class="bad">{shown.message}</p>
  {:else}
    <p class="bad">{t('project.close.unknown')}</p>
  {/if}
  <div class="actions">
    {#if shown?.kind === 'ok'}
      <button type="button" class="primary" disabled={app.saving} onclick={() => void confirm()}>{t('project.close.confirm')}</button>
    {/if}
    <button type="button" onclick={onclose}>{t('dialog.cancel')}</button>
  </div>
</div>

<style>
  .close-panel {
    display: grid;
    gap: 0.4rem;
    border-top: 1px solid var(--border);
    padding-top: 0.5rem;
  }
  .close-panel p {
    margin: 0;
  }
  .holding {
    margin: 0;
    padding-left: 1.2rem;
  }
  .bad {
    color: var(--bad);
  }
  .muted {
    color: var(--muted);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
</style>
