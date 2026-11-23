<script lang="ts">
  import { closeOnBackdrop } from 'appkit-ui/backdrop';
  import { parseMarkdown } from 'appkit-ui/markdown';
  import Blocks from 'appkit-ui/Blocks.svelte';
  // "Answer of the agent": a review of a finished task or a prepared decision. It shows where the job of ai-desktop
  // stands, then the answer the engine took apart, as a proposal: nothing is written until "Adopt", and the follow-up
  // task a review proposes is made only on its own click.
  import type { App } from '../lib/app.svelte';
  import { translate, type Key } from '../lib/i18n';
  import { markHidden } from '../lib/text';

  let { app }: { app: App } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  // The words of the hand-over's title stand here, not in the language files: the start of the page does not carry them.
  const handoffTitle = $derived(app.lang === 'de' ? 'Zusammenfassung der Übergabe' : 'Summary of the hand-over');

  let dialog: HTMLDialogElement | undefined = $state();
  const view = $derived(app.answer);
  const text = $derived(
    view?.answer ? view.answer.sections.map((s) => `${s.heading}\n\n${s.text}`).join('\n\n') : '',
  );
  const blocks = $derived(parseMarkdown(text));

  $effect(() => {
    if (!dialog) return;
    if (view !== null && !dialog.open) dialog.showModal();
    if (view === null && dialog.open) dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  class="answer-dialog"
  use:closeOnBackdrop
  aria-labelledby="answer-title"
  onclose={() => app.closeAnswer()}
>
  {#if view}
    <h2 id="answer-title">{view.kind === 'handoff' ? handoffTitle : t(view.kind === 'review-done' ? 'answer.title.review' : 'answer.title.decision')}</h2>
    <p class="what">{markHidden(view.title)} <code>{view.id}</code></p>
    {#if view.phase === 'waiting'}
      <p class="status" role="status">
        {view.job ? t('answer.waiting', { job: view.job }) : t('answer.sending')}
      </p>
    {:else if view.phase === 'confirm'}
      <p class="status" role="alert">{t('answer.confirm')}</p>
      <div class="actions">
        <button type="button" onclick={() => app.confirmAnswer(false)}>{t('answer.confirm_no')}</button>
        <button type="button" class="primary" onclick={() => app.confirmAnswer(true)}>{t('answer.confirm_yes')}</button>
      </div>
    {:else if view.phase === 'failed'}
      <p class="status error" role="alert">{t('answer.failed', { why: view.why ?? '' })}</p>
    {:else if view.answer}
      <p class="note">{t(view.phase === 'adopted' ? 'answer.adopted' : 'answer.proposal')}</p>
      <div class="body prose" data-testid="answer-body"><Blocks {blocks} headingBase={2} /></div>
      {#if view.kind === 'prepare-decision' && view.answer.questionsAdded === false}
        <p class="note">{t('answer.questions_kept')}</p>
      {/if}
      {#if view.answer.followUp}
        <p class="follow">
          {t('answer.follow_up', { title: markHidden(view.answer.followUp.title) })}
          {#if view.followUpMade}<span role="status">{t('answer.follow_up_made', { id: view.followUpMade })}</span>{/if}
        </p>
      {/if}
      <div class="actions">
        {#if view.answer.followUp && !view.followUpMade}
          <button type="button" data-hint={t('hint.form.answer_follow_up')} disabled={app.saving}
            onclick={() => app.createFollowUp()}>{t('answer.follow_up_make')}</button
          >
        {/if}
        {#if view.phase === 'shown'}
          <button type="button" class="primary" data-hint={t('hint.form.answer_adopt')} disabled={app.saving}
            onclick={() => app.adoptAnswer()}>{t('answer.adopt')}</button
          >
        {/if}
      </div>
    {/if}
    <div class="actions close">
      <button type="button" onclick={() => dialog?.close()}>{t('answer.close')}</button>
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
    width: min(44rem, calc(100vw - 2rem));
    max-height: calc(100vh - 3rem);
    overflow: auto;
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
    margin: 0 0 0.5rem;
  }
  .what code {
    font-weight: normal;
    color: var(--muted);
  }
  .note,
  .status {
    color: var(--muted);
  }
  .error {
    color: var(--bad);
  }
  .body {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0 0.75rem;
    margin: 0.5rem 0;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
</style>
