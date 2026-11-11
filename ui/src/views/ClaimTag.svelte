<script lang="ts">
  // The mark of a task somebody works on now (lib/claims.ts): one of this browser's name, or one of somebody else with
  // the name; an expired claim and a free task have none. The hint says who and until when (the engine's UTC time).
  import type { TaskEntry } from '../lib/contract';
  import { claimClass } from '../lib/claims';
  import { translate, type Lang } from '../lib/i18n';

  let { task, lang, me }: { task: Pick<TaskEntry, 'claim'>; lang: Lang; me: string } = $props();
  const cls = $derived(claimClass(task, me));
  const hint = $derived(
    task.claim ? translate(lang, 'claim.hint', { by: task.claim.by, since: task.claim.since, until: task.claim.until }) : '',
  );
</script>

{#if cls !== 'none' && task.claim}
  <span class="tag claim" class:own={cls === 'own'} data-claim={cls} data-hint={hint}
    ><span aria-hidden="true">⚑ {cls === 'own' ? translate(lang, 'claim.mine') : task.claim.by}</span><span class="sr-only"
      >{cls === 'own' ? translate(lang, 'claim.sr_mine') : translate(lang, 'claim.sr_foreign', { by: task.claim.by })}</span
    ></span
  >
{/if}

<style>
  /* The shape of the marks around it (each view styles its own): a small framed word. */
  .claim {
    font-size: 0.75rem;
    border: 1px solid var(--warn);
    border-radius: var(--radius);
    padding: 0 0.35rem;
    white-space: nowrap;
    color: var(--warn);
  }
  .claim.own {
    color: var(--ok);
    border-color: var(--ok);
  }
</style>
