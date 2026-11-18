<script lang="ts">
  // The mark of a task somebody works on now (lib/claims.ts): one of this browser's name, or one of somebody else with
  // the name; an expired claim and a free task have none. The hint says who and until when (the engine's UTC time).
  // A claim of an agent of ai-desktop (`ai-desktop:<job>`) reads "agent", in the same look as any other claim (no
  // highlight), and stays named when it ran out: the agent stopped without giving the task back.
  import type { TaskEntry } from '../lib/contract';
  import { agentJob, claimClass } from '../lib/claims';
  import { translate, type Lang } from '../lib/i18n';

  let { task, lang, me }: { task: Pick<TaskEntry, 'claim'>; lang: Lang; me: string } = $props();
  const cls = $derived(claimClass(task, me));
  const job = $derived(agentJob(task.claim?.by));
  const ranOut = $derived(job !== null && task.claim?.expired === true);
  const hint = $derived.by(() => {
    const claim = task.claim;
    if (!claim) return '';
    if (job !== null) {
      return ranOut
        ? translate(lang, 'claim.agent_expired_hint', { job, until: claim.until })
        : translate(lang, 'claim.agent_hint', { job, since: claim.since, until: claim.until });
    }
    return translate(lang, 'claim.hint', { by: claim.by, since: claim.since, until: claim.until });
  });
  const label = $derived(
    cls === 'own'
      ? translate(lang, 'claim.mine')
      : job !== null
        ? translate(lang, ranOut ? 'claim.agent_expired' : 'claim.agent')
        : (task.claim?.by ?? ''),
  );
  const spoken = $derived(
    cls === 'own'
      ? translate(lang, 'claim.sr_mine')
      : job !== null
        ? translate(lang, ranOut ? 'claim.agent_expired' : 'claim.sr_agent', { job })
        : translate(lang, 'claim.sr_foreign', { by: task.claim?.by ?? '' }),
  );
</script>

{#if (cls !== 'none' || ranOut) && task.claim}
  <span class="tag claim" class:own={cls === 'own'} class:ran-out={ranOut} data-claim={ranOut ? 'expired' : cls} data-agent={job ?? undefined} data-hint={hint}
    ><span aria-hidden="true">⚑ {label}</span><span class="sr-only">{spoken}</span></span
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
  /* A claim that ran out holds nothing any more: said, not stressed. */
  .claim.ran-out {
    color: var(--muted);
    border-color: var(--border);
  }
</style>
