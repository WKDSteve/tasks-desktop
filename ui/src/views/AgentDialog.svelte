<script lang="ts">
  import { closeOnBackdrop } from 'appkit-ui/backdrop';
  import { floating } from '../lib/floating';
  // "Hand to an agent": the small choice before a task goes to ai-desktop (only fill in the job or run it at once, and
  // what it asks for), with a word on the data class of the area. The hub sends it; the page never speaks to ai-desktop.
  import type { App } from '../lib/app.svelte';
  import type { AgentKind, AgentTab } from '../lib/api';
  import { translate, type Key } from '../lib/i18n';
  import { markHidden } from '../lib/text';

  let { app }: { app: App } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  let dialog: HTMLDialogElement | undefined = $state();
  const id = $derived(app.agentFor);
  const task = $derived(id === null ? undefined : app.tasks.find((x) => x.id === id));
  const kinds = $derived(app.agentKinds(task?.status));
  const shared = $derived(id === null ? false : app.agentAreaShared(task?.area ?? id.split('/')[0] ?? ''));
  let mode = $state<'prefill' | 'run'>('prefill');
  let kind = $state<AgentKind>('handoff');
  let dashboard = $state(false);

  /**
   * The tab of the dashboard is opened in the click itself (a tab opened after the answer would be a popup the browser
   * blocks), empty and without a way back to this page; it gets its address once ai-desktop said the job.
   */
  function openTab(): AgentTab | null {
    const tab = window.open('', '_blank');
    if (!tab) return null;
    tab.opener = null;
    return { go: (url) => tab.location.replace(url), close: () => tab.close() };
  }

  function send(): void {
    void app.handToAgent(mode, kind, dashboard, dashboard ? openTab() : null);
  }

  $effect(() => {
    if (!dialog) return;
    if (id !== null && !dialog.open) {
      // Each time it opens: the mode chosen last, and the plain hand-over.
      mode = app.agentMode;
      kind = 'handoff';
      dashboard = app.agentDashboard;
      dialog.showModal();
    }
    if (id === null && dialog.open) dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  class="agent-dialog"
  use:floating={{ kind: 'agent', moveLabel: t('float.move'), moveHint: t('hint.float.move') }}
  use:closeOnBackdrop
  aria-labelledby="agent-title"
  onclose={() => app.closeAgent()}
>
  {#if id !== null}
    <h2 id="agent-title">{t('agent.title')}</h2>
    <p class="what">{markHidden(task?.title ?? id)}</p>
    <p class="id"><code>{id}</code></p>
    <fieldset>
      <legend>{t('agent.mode.label')}</legend>
      {#each ['prefill', 'run'] as const as value (value)}
        <label data-hint={t('hint.form.agent_mode')}>
          <input type="radio" name="agent-mode" {value} bind:group={mode} />
          {t(`agent.mode.${value}`)}
        </label>
      {/each}
    </fieldset>
    {#if kinds.length > 1}
      <label class="kind" data-hint={t('hint.form.agent_kind')}>
        <span>{t('agent.kind.label')}</span>
        <select bind:value={kind}>
          {#each kinds as value (value)}
            <option {value}>{t(`agent.kind.${value}`)}</option>
          {/each}
        </select>
      </label>
    {/if}
    <label class="dashboard" data-hint={t('hint.form.agent_dashboard')}>
      <input type="checkbox" bind:checked={dashboard} />
      {t('agent.dashboard')}
    </label>
    <p class="class">{t(shared ? 'agent.shared' : 'agent.private')}</p>
    <div class="actions">
      <button type="button" onclick={() => app.closeAgent()}>{t('dialog.cancel')}</button>
      <button type="button" class="primary" disabled={app.agentSending} onclick={send}
        >{t('agent.send')}</button
      >
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
    width: min(30rem, calc(100vw - 2rem));
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
    margin: 0;
  }
  .id {
    margin: 0.1rem 0 0.6rem;
    color: var(--muted);
  }
  fieldset {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    margin: 0 0 0.6rem;
    padding: 0.4rem 0.6rem;
    display: grid;
    gap: 0.25rem;
  }
  .kind {
    display: grid;
    gap: 0.2rem;
    margin: 0 0 0.6rem;
  }
  .dashboard {
    display: block;
    margin: 0 0 0.6rem;
  }
  .class {
    color: var(--muted);
    margin: 0 0 0.8rem;
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
