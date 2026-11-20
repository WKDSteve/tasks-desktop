<script lang="ts">
  // The list of the tile Follow-up (concept 7.5), loaded when the tile first has a meeting to name: each meeting that is
  // over and still planned, or done without a result. Its title opens its page (on the tab Result); "Mark as done" closes
  // a planned one (`meeting_close`, taken back by the toast); "No result is fine" puts it away in this browser only.
  import type { App } from '../lib/app.svelte';
  import { translate, type Key } from '../lib/i18n';
  import { whenText } from '../lib/meetings';
  import { markHidden } from '../lib/text';

  let { app }: { app: App } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);
  const canWrite = $derived(app.can('meeting_ops') && !app.readOnly);

  async function close(id: string, etag: string | undefined): Promise<void> {
    if (app.saving) {
      app.tell('error', 'write.busy');
      return;
    }
    await app.write([{ op: 'meeting_close', id, ...(etag ? { if_match: etag } : {}) }], {
      saidAs: (result) => (result.results[0]?.without_result ? 'meeting.closed_without_result' : undefined),
    });
  }
</script>

<ul class="plain review">
  {#each app.review as m (m.id)}
    <li>
      <button type="button" class="link" onclick={() => app.openMeeting(m.id)}>{markHidden(m.title)}</button>
      <span class="muted">{whenText(m, t('meeting.all_day'))}{m.status === 'done' ? ` · ${t('review.no_result')}` : ''}</span>
      {#if canWrite && m.status === 'planned'}
        <button type="button" class="clear" disabled={app.locked} onclick={() => close(m.id, m.etag)}>{t('review.close')}</button>
      {/if}
      <button
        type="button"
        class="clear"
        aria-label={`${t('review.dismiss')}: ${markHidden(m.title)}`}
        onclick={() => app.dismissReview(m.id)}>{t('review.dismiss')}</button
      >
    </li>
  {/each}
</ul>

<style>
  .review {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.3rem;
  }
  .review li {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: baseline;
  }
  .muted {
    color: var(--muted);
    font-size: 0.85rem;
  }
  button.link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent);
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
    text-align: left;
  }
  button.clear {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0 0.5rem;
    font-size: 0.85rem;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
