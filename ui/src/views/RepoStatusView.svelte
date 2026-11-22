<script lang="ts">
  // The state of the repos of the tiles, a light for each (see `lib/repoStatus.ts`): the checkout (clean, changed,
  // ahead, behind) and the CI of the newest pushed commit (green, red, running, queued, waiting for approval). The hub
  // asks `git` and `gh` in the folder of each tile and throttles the questions; the page asks a few repos at a time,
  // again every quarter of a minute while it is in view, and at once by the button. A click opens the run on
  // github.com; a commit that waits for approval shows the command that approves it, to copy. The web variant has no
  // hub and says so.
  import { untrack } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import type { App } from '../lib/app.svelte';
  import { translate, type Key } from '../lib/i18n';
  import { byUrgency, CI_SIGN, inTurns, LOCAL_SIGN, type RepoStatus } from '../lib/repoStatus';
  import Info from 'appkit-ui/Info.svelte';
  import { markHidden } from '../lib/text';

  let { app }: { app: App } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  /** Repos asked at the same time (each is a `git` and a `gh` on the machine of the hub). */
  const WIDTH = 3;
  /** How often the page asks again while it is in view; the hub holds its answers longer than that for `gh`. */
  const EVERY_MS = 15_000;

  const rs = $derived(app.reposState);
  $effect(() => {
    if (app.machineActions) void rs.load();
  });
  const repos = $derived(
    Object.entries(rs.doc?.repos ?? {})
      .map(([id, repo]) => ({ id, name: repo.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
  const ids = $derived(repos.map((r) => r.id).join(' '));

  // What the hub said of each repo: its state, or that it did not answer. A repo not in here was not asked yet.
  // A SvelteMap: the ids come from the hub, and a key like `__proto__` is no special case in a map.
  const states = new SvelteMap<string, RepoStatus | 'failed'>();
  let asking = $state(false);
  // Only a round the person asked for is said ("Asking…"): the rounds the view starts by itself every quarter of a
  // minute would be read out by a screen reader again and again.
  let saying = $state(false);
  let table = $state<HTMLElement | null>(null);
  // The order of the rows: by name until a round is through, then what needs a look first. It changes only at the
  // end of a round, so that a row does not jump away under the pointer while the answers come in.
  let order = $state<string[]>([]);
  const rows = $derived.by(() => {
    const known = new Map(repos.map((r) => [r.id, r]));
    const placed = order.filter((id) => known.has(id));
    const rest = repos.filter((r) => !placed.includes(r.id)).map((r) => r.id);
    return [...placed, ...rest].map((id) => ({ ...known.get(id)!, state: states.get(id) }));
  });

  // The view is in the page: a round that is under way when it goes asks the hub for nothing more.
  let alive = true;
  $effect(() => {
    alive = true;
    return () => {
      alive = false;
    };
  });
  async function round(fresh: boolean): Promise<void> {
    if (asking || repos.length === 0) return;
    asking = true;
    saying = fresh;
    const asked = repos.map((r) => r.id);
    await inTurns(asked, WIDTH, async (id) => {
      if (!alive) return;
      try {
        states.set(id, await app.repoStatus(id, fresh));
      } catch {
        states.set(id, 'failed');
      }
    });
    // A row that moves loses the focus: while a link or a button of the table has it, the order stays as it is (the
    // next round sorts).
    if (!table?.contains(document.activeElement)) {
      order = byUrgency(
        repos.map((r) => {
          const state = states.get(r.id);
          return { name: r.name, id: r.id, status: state === undefined || state === 'failed' ? null : state };
        }),
      ).map((r) => r.id);
    }
    asking = false;
    saying = false;
  }
  $effect(() => {
    if (ids === '' || !app.machineActions) return;
    untrack(() => void round(false));
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void round(false);
    }, EVERY_MS);
    return () => clearInterval(timer);
  });

  let copied = $state('');
  async function copy(name: string, command: string): Promise<void> {
    copied = (await app.copyText(command)) ? t('repostatus.copied', { name }) : t('repostatus.copy_failed');
  }

  function localWords(status: RepoStatus): string {
    const l = status.local;
    if (l.state === 'unavailable') return t(`repostatus.local.reason.${l.reason ?? 'failed'}` as Key);
    const parts: string[] = [];
    if (l.changed > 0) parts.push(t('repostatus.changed', { n: l.changed }));
    if (l.ahead > 0) parts.push(t('repostatus.ahead', { n: l.ahead }));
    if (l.behind > 0) parts.push(t('repostatus.behind', { n: l.behind }));
    if (l.gone) parts.push(t('repostatus.gone'));
    return parts.length > 0 ? parts.join(', ') : t('repostatus.local.clean');
  }
  const ciWords = (status: RepoStatus): string =>
    status.ci.state === 'unavailable' ? t(`repostatus.ci.reason.${status.ci.reason ?? 'failed'}` as Key) : t(`repostatus.ci.${status.ci.state}` as Key);
</script>

<section class="repostatus" aria-label={t('nav.repostatus')}>
  <header class="intro">
    <div class="head">
      <h2>{t('repostatus.title')}</h2>
      <Info hint={t('repostatus.intro')} label={t('hint.about', { what: t('nav.repostatus') })} />
    </div>
    {#if app.machineActions && repos.length > 0}
      <div class="tools">
        <button type="button" data-ask disabled={asking} onclick={() => void round(true)}>{t('repostatus.ask')}</button>
        <span role="status" data-asking>{saying ? t('repostatus.asking') : ''}</span>
      </div>
    {/if}
  </header>

  {#if !app.machineActions}
    <p class="note" data-repostatus-web>{t('repostatus.web')}</p>
  {:else if rs.read === 'unavailable' || rs.read === 'failed'}
    <p class="note">{t('repostatus.no_hub')}</p>
  {:else if rs.read === 'ready' && repos.length === 0}
    <p class="note">
      {t('repostatus.none')}
      <button type="button" class="link" onclick={() => app.setView('repos')}>{t('repostatus.to_tiles')}</button>
    </p>
  {:else}
    <table bind:this={table}>
      <thead>
        <tr>
          <th scope="col">{t('repostatus.col.repo')}</th>
          <th scope="col">{t('repostatus.col.local')}</th>
          <th scope="col">{t('repostatus.col.ci')}</th>
          <th scope="col"><span class="sr-only">{t('repostatus.col.do')}</span></th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row (row.id)}
          {@const state = row.state}
          <tr data-repo={row.id} data-ci={state && state !== 'failed' ? state.ci.state : ''} data-local={state && state !== 'failed' ? state.local.state : ''}>
            <th scope="row">{markHidden(row.name)}</th>
            {#if state === undefined}
              <td colspan="3" class="muted">{t('repostatus.asking')}</td>
            {:else if state === 'failed'}
              <td colspan="3" class="muted">{t('repostatus.no_answer')}</td>
            {:else}
              <td>
                <span class="light local-{state.local.state}" aria-hidden="true">{LOCAL_SIGN[state.local.state]}</span>
                <span>{localWords(state)}</span>
                {#if state.local.branch}<small class="branch">{state.local.branch}</small>{/if}
              </td>
              <td>
                <span class="light ci-{state.ci.state}" aria-hidden="true">{CI_SIGN[state.ci.state]}</span>
                <span class="word">{ciWords(state)}</span>
                {#if state.ci.sha}<small class="sha">{state.ci.sha.slice(0, 7)}</small>{/if}
              </td>
              <td>
                <div class="do">
                {#if state.ci.url}
                  <a href={state.ci.url} target="_blank" rel="noopener noreferrer" aria-label={t('repostatus.open_of', { name: row.name })}>{t('repostatus.open')}</a>
                {/if}
                {#if state.ci.trust}
                  {@const command = state.ci.trust}
                  <span class="trust">
                    <code>{command}</code>
                    <button type="button" data-copy aria-label={t('repostatus.copy_of', { name: row.name })} onclick={() => void copy(row.name, command)}>
                      {t('repostatus.copy')}
                    </button>
                  </span>
                  <small class="hint">{t('repostatus.trust_note')}</small>
                {/if}
                </div>
              </td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
    <!-- Always in the page, so that a screen reader hears it fill. -->
    <p class="copied" role="status" data-copied>{copied}</p>
  {/if}
</section>

<style>
  .repostatus {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 0;
  }
  .intro .head,
  .tools {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .tools {
    margin-top: 0.4rem;
  }
  h2 {
    margin: 0;
  }
  button:not(.link) {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0.25rem 0.6rem;
    cursor: pointer;
  }
  button:disabled {
    cursor: default;
    opacity: 0.6;
  }
  .link {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th,
  td {
    text-align: left;
    padding: 0.3rem 0.5rem;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
  }
  thead th {
    color: var(--muted);
    font-weight: 600;
  }
  tbody th {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .light {
    display: inline-block;
    min-width: 1.2rem;
    text-align: center;
    font-weight: 700;
  }
  .ci-green,
  .local-clean {
    color: var(--ok);
  }
  .ci-red {
    color: var(--bad);
  }
  .ci-approval,
  .ci-running,
  .local-unpushed,
  .local-behind {
    color: var(--accent);
  }
  .ci-queued,
  .local-dirty,
  .local-diverged {
    color: var(--warn);
  }
  .ci-cancelled,
  .ci-skipped,
  .ci-none,
  .ci-unavailable,
  .local-unavailable,
  .muted {
    color: var(--muted);
  }
  tr[data-ci='red'] .word {
    font-weight: 700;
  }
  .branch,
  .sha {
    margin-left: 0.4rem;
    color: var(--muted);
  }
  .do {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
  }
  .trust {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
  }
  code {
    overflow-wrap: anywhere;
    background: var(--surface);
    padding: 0.1rem 0.3rem;
    border-radius: var(--radius);
  }
  .note,
  .hint {
    color: var(--muted);
    font-size: 0.85rem;
    margin: 0;
  }
  .copied {
    margin: 0;
  }
  .copied:empty {
    display: none;
  }
</style>
