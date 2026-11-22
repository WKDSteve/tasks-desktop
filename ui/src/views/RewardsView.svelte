<script lang="ts">
  // The rewards of all learning paths (concept "Reiter Lernpläne" 9): Open (reached, not granted: "Granted" as in the
  // view of the paths, without asking, the write can be undone), Granted (latest first, with the day, folded away on
  // request; "Not granted after all" in a row's detail) and Still to come (the nearest first). Reached, granted, missing
  // and the days are the engine's (`tasks.paths` with `levels`, capability `paths_levels`; WEB-13), the writes are
  // `path_reward`. A reward is untrusted text: shown as text. Only with the game on (gamification and `xp`).
  import { tick, untrack } from 'svelte';
  import type { App } from '../lib/app.svelte';
  import type { Key } from '../lib/i18n';
  import type { Paths, PathEntryLevel } from '../lib/contract';
  import Info from 'appkit-ui/Info.svelte';
  import LearnScopeNote from './LearnScopeNote.svelte';
  import { learnScope } from '../lib/learnScope';
  import BadgeMedal from './BadgeMedal.svelte';
  import { AssetImages } from '../lib/assetImages.svelte';
  import { markHidden } from '../lib/text';
  import { rewardOp } from '../lib/paths';
  import { badgeImage, dayDate } from '../lib/badges';
  import { rewardRows, type RewardRow } from '../lib/rewards';
  import { rewardTexts, type RewardKey } from '../lib/rewardTexts';

  let { app }: { app: App } = $props();
  const t = (key: RewardKey | Key, params: Record<string, string | number> = {}) => rewardTexts.t(app.lang, key, params);

  const usable = $derived(app.can('paths') && app.can('paths_levels') && app.can('path_reward'));
  const game = $derived(app.gamification && app.can('xp'));

  let doc = $state<Paths | null>(null);
  let problem = $state(false);
  let asked = 0;
  async function read(): Promise<void> {
    const mine = ++asked;
    try {
      const answer = await app.pathsWithLevels();
      if (mine !== asked) return;
      doc = answer;
      app.rememberPaths(answer.items);
      problem = false;
    } catch {
      if (mine !== asked) return;
      problem = true;
    }
  }
  $effect(() => {
    void app.writes;
    void app.snapshot?.rev;
    if (!usable || !game) return;
    untrack(() => void read());
  });

  // The paths of the areas the area filter of the page shows (lib/learnScope.ts).
  const scope = $derived(learnScope(app.filter.areas, app.matchAreas));
  const rows = $derived(rewardRows(scope.keep(doc?.items ?? [])));
  const count = (r: ReturnType<typeof rewardRows>): number => r.open.length + r.given.length + r.coming.length;
  const none = $derived(count(rows) === 0);
  const hiddenByScope = $derived(none && scope.active && count(rewardRows(doc?.items ?? [])) > 0);
  let givenOpen = $state(true);

  // One store of pictures per path that names a badge below `assets/badges/`.
  const imagePaths = $derived(
    [...new Set([...rows.open, ...rows.given, ...rows.coming].filter((r) => badgeImage(r.tile) !== null).map((r) => r.tile.path))].sort().join('\n'),
  );
  let images = $state<ReadonlyMap<string, AssetImages>>(new Map());
  $effect(() => {
    const ids = imagePaths === '' ? [] : imagePaths.split('\n');
    const stores = new Map(ids.map((id) => [id, new AssetImages((kind, owner, file, held) => app.asset(kind, owner, file, held), 'path', id)] as const));
    images = stores;
    return () => {
      for (const store of stores.values()) store.dispose();
    };
  });
  $effect(() => {
    const stores = images;
    const items = doc?.items ?? [];
    untrack(() => {
      for (const entry of items) stores.get(entry.id)?.refresh(entry.etag, entry.assets);
    });
  });

  const locale = $derived(app.lang === 'de' ? 'de-DE' : 'en-GB');
  const shortDay = $derived(new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }));
  const short = (day: string): string => {
    const date = dayDate(day);
    return date ? shortDay.format(date) : day;
  };

  const levelName = (level: PathEntryLevel): string =>
    level.name ? markHidden(level.name) : level.kind === 'done' ? t('rewards.path_done') : t('rewards.level', { n: level.number ?? level.ref });
  const where = (row: RewardRow): string => t('rewards.where', { level: levelName(row.tile.level), path: markHidden(row.tile.pathTitle) });
  const reward = (row: RewardRow): string => markHidden(row.reward);
  function comingText(row: RewardRow): string {
    const level = row.tile.level;
    const at =
      level.kind === 'done'
        ? t('rewards.state.coming_done')
        : level.threshold === undefined
          ? t('rewards.state.coming')
          : level.kind === 'xp'
            ? t('rewards.state.coming_xp', { n: level.threshold })
            : t('rewards.state.coming_percent', { n: level.threshold });
    const missing =
      level.missing_xp !== undefined
        ? t('rewards.state.missing_xp', { n: level.missing_xp })
        : level.missing_percent !== undefined && level.kind !== 'done'
          ? t('rewards.state.missing_percent', { n: level.missing_percent })
          : '';
    return missing === '' ? at : `${at} (${missing})`;
  }

  let root = $state<HTMLElement | null>(null);
  /**
   * Grant (or take back) a reward. The row leaves its part, so the focus goes to the row now at its place in the part
   * it left, else to the heading of that part: never to the page.
   */
  async function setGiven(row: RewardRow, given: boolean): Promise<void> {
    if (app.saving) {
      app.tell('error', 'write.busy');
      return;
    }
    const part = given ? 'open' : 'given';
    const at = rows[part].findIndex((r) => r.tile.key === row.tile.key);
    const result = await app.write([rewardOp(row.tile.path, row.etag, row.tile.level.ref, given)]);
    if (result === null) return;
    await read();
    await tick();
    const left = rows[part];
    const next = left[Math.min(at, left.length - 1)];
    const target = next
      ? root?.querySelector<HTMLElement>(`[data-reward="${CSS.escape(next.tile.key)}"] [data-reward-focus]`)
      : root?.querySelector<HTMLElement>(`#rewards-${part}`);
    target?.focus();
  }
</script>

<section class="rewards" aria-label={t('nav.rewards')} bind:this={root}>
  <header class="head">
    <h2>{t('nav.rewards')}</h2>
    <Info hint={t('rewards.intro')} label={t('hint.about', { what: t('nav.rewards') })} />
  </header>

  {#if !game}
    <p class="none" role="note">{t('rewards.off')}</p>
  {:else if !usable}
    <p class="none" role="note">{t('rewards.old_engine')}</p>
  {:else if problem && doc === null}
    <p class="none" role="alert">{t('rewards.failed')} <button type="button" onclick={() => void read()}>{t('paths.retry')}</button></p>
  {:else if doc === null}
    <p class="none" role="status">{t('rewards.reading')}</p>
  {:else if hiddenByScope}
    <LearnScopeNote {app} {scope} />
  {:else if none}
    <div class="empty" data-rewards-empty>
      <p>{t('rewards.none')}</p>
      <p class="none">{t('rewards.none_how')}</p>
      <pre><code>## Level

{t('rewards.none_example')}</code></pre>
      <button type="button" onclick={() => app.setView('paths')}>{t('rewards.open_paths')}</button>
    </div>
  {:else}
    <section class="part" aria-labelledby="rewards-open" data-rewards-part="open">
      <h3 id="rewards-open" tabindex="-1">{t('rewards.open')} <span class="count" data-rewards-open-count>({rows.open.length})</span></h3>
      {#if rows.open.length === 0}
        <p class="none">{t('rewards.open_none')}</p>
      {:else}
        <ul aria-label={t('rewards.list', { part: t('rewards.open'), n: rows.open.length })}>
          {#each rows.open as row (row.tile.key)}
            <li class="row open" data-reward={row.tile.key}>
              <BadgeMedal tile={row.tile} images={images.get(row.tile.path)} size={36} />
              <span class="text">
                <span class="reward">{reward(row)}</span>
                <span class="where">{where(row)}</span>
              </span>
              <span class="state open-state"><span aria-hidden="true">🎁</span> {t('rewards.state.open')}</span>
              <button
                type="button"
                class="primary"
                aria-label={t('rewards.grant_of', { reward: reward(row) })}
                aria-disabled={app.saving ? 'true' : undefined}
                data-reward-focus
                data-reward-grant
                onclick={() => void setGiven(row, true)}>{t('rewards.grant')}</button
              >
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="part" aria-labelledby="rewards-given" data-rewards-part="given">
      <details bind:open={givenOpen}>
        <summary><h3 id="rewards-given" tabindex="-1">{t('rewards.given')} <span class="count">({rows.given.length})</span></h3></summary>
        {#if rows.given.length === 0}
          <p class="none">{t('rewards.given_none')}</p>
        {:else}
          <ul aria-label={t('rewards.list', { part: t('rewards.given'), n: rows.given.length })}>
            {#each rows.given as row (row.tile.key)}
              <li class="row given" data-reward={row.tile.key}>
                <details class="one">
                  <summary data-reward-focus>
                    <BadgeMedal tile={row.tile} images={images.get(row.tile.path)} size={36} />
                    <span class="text">
                      <span class="reward">{reward(row)}</span>
                      <span class="where">{where(row)}</span>
                    </span>
                    <span class="state given-state"
                      ><span aria-hidden="true">✓</span>
                      {row.tile.level.given_on ? t('rewards.state.given_on', { date: short(row.tile.level.given_on) }) : t('rewards.state.given')}</span
                    >
                  </summary>
                  <p class="actions">
                    <button type="button" onclick={() => app.openPath(row.tile.path)}>{t('rewards.open_path')}</button>
                    <button
                      type="button"
                      aria-label={t('rewards.ungrant_of', { reward: reward(row) })}
                      aria-disabled={app.saving ? 'true' : undefined}
                      data-reward-ungrant
                      onclick={() => void setGiven(row, false)}>{t('rewards.ungrant')}</button
                    >
                  </p>
                </details>
              </li>
            {/each}
          </ul>
        {/if}
      </details>
    </section>

    <section class="part" aria-labelledby="rewards-coming" data-rewards-part="coming">
      <h3 id="rewards-coming" tabindex="-1">{t('rewards.coming')} <span class="count">({rows.coming.length})</span></h3>
      {#if rows.coming.length === 0}
        <p class="none">{t('rewards.coming_none')}</p>
      {:else}
        <ul aria-label={t('rewards.list', { part: t('rewards.coming'), n: rows.coming.length })}>
          {#each rows.coming as row (row.tile.key)}
            <li class="row coming" data-reward={row.tile.key}>
              <BadgeMedal tile={row.tile} images={images.get(row.tile.path)} size={36} />
              <span class="text">
                <span class="reward">{reward(row)}</span>
                <span class="where">{where(row)}</span>
              </span>
              <span class="state"><span aria-hidden="true">○</span> {comingText(row)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</section>

<style>
  .rewards {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 0;
    max-width: 56rem;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  h2 {
    margin: 0;
    font-size: 1.1rem;
  }
  h3 {
    display: inline;
    margin: 0;
    font-size: 0.95rem;
  }
  .part > h3 {
    display: block;
    margin: 0.3rem 0;
  }
  summary h3 {
    display: inline;
  }
  .count,
  .none,
  .where,
  .state {
    color: var(--muted);
  }
  .none {
    margin: 0;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.4rem;
  }
  .empty p {
    margin: 0;
  }
  pre {
    margin: 0;
    padding: 0.4rem 0.6rem;
    background: var(--surface-2);
    border-radius: var(--radius);
    max-width: 100%;
    overflow-x: auto;
  }
  ul {
    list-style: none;
    margin: 0.3rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .row:not(.given),
  .one > summary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.75rem;
    padding: 0.35rem 0.5rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .row.coming {
    border-style: dashed;
  }
  .one > summary {
    cursor: pointer;
  }
  .text {
    display: flex;
    flex-direction: column;
    flex: 1 1 14rem;
    min-width: 0;
  }
  .reward {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .where {
    font-size: 0.85em;
    overflow-wrap: anywhere;
  }
  .state {
    font-size: 0.9em;
  }
  .open-state {
    color: var(--text);
    font-weight: 600;
  }
  .given-state {
    color: var(--ok);
    font-weight: 600;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 0.3rem 0 0.2rem 0.5rem;
  }
  button {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.2rem 0.6rem;
    min-height: 2rem;
    cursor: pointer;
  }
  button.primary {
    background: var(--accent);
    color: var(--accent-text);
    border-color: var(--accent);
  }
  @media (forced-colors: active) {
    button.primary {
      border-color: ButtonText;
    }
  }
</style>
