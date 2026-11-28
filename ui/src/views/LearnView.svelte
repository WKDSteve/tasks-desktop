<script lang="ts">
  // The overview of the tab Lernpläne, its start (concept "Reiter Lernpläne" 3): the tile "My learning" with a period
  // (today, week, month, quarter, year; kept on this device) and its figures against the period before (points
  // learned, XP with gamification, learning time, learning days, the streak) and its bars; the next learning steps,
  // the running paths, the levels within reach and the open rewards. Every figure is the engine's (`tasks.paths`,
  // `tasks.learn_history` by day, `tasks.learn_next`; WEB-13): the page adds up the days of a period and draws. Without
  // the series the tile shows the state today and says why. Read only; a step and a path open in the learning paths.
  import { untrack } from 'svelte';
  import type { App } from '../lib/app.svelte';
  import type { Key } from '../lib/i18n';
  import type { LearnHistory, LearnNext, Paths, PathEntry } from '../lib/contract';
  import Info from 'appkit-ui/Info.svelte';
  import ItemIcon from './ItemIcon.svelte';
  import BadgeMedal from './BadgeMedal.svelte';
  import LearnScopeNote from './LearnScopeNote.svelte';
  import { scopeOf } from '../lib/learnScope';
  import LearnBars from './LearnBars.svelte';
  import { AssetImages } from '../lib/assetImages.svelte';
  import { shownIcon } from '../lib/icons';
  import { markHidden } from '../lib/text';
  import { labelText, pointRef } from '../lib/paths';
  import { hoursText } from '../lib/learnNext';
  import { badgeImage, badgeTiles, type BadgeTile } from '../lib/badges';
  import { openRewardCount } from '../lib/rewards';
  import { learnOverviewTexts as texts, type LearnOverviewKey } from '../lib/learnOverviewTexts';
  import {
    barsOf,
    byDate,
    changeOf,
    coverage,
    knownDays,
    LEARN_PERIODS,
    parseLearnPeriod,
    periodFrame,
    sumSpan,
    type Figures,
    type LearnPeriod,
  } from '../lib/learnPeriod';

  let { app }: { app: App } = $props();
  const t = (key: LearnOverviewKey | Key, params: Record<string, string | number> = {}) => texts.t(app.lang, key, params);

  const usable = $derived(app.can('paths'));
  const withHistory = $derived(app.can('learn_history'));
  const withNext = $derived(app.can('learn_next'));
  const withLevels = $derived(app.can('paths_levels'));
  const game = $derived(app.gamification && app.can('xp'));

  let period = $state<LearnPeriod>(untrack(() => parseLearnPeriod(app.viewPref('learn-period'))));
  function choose(next: LearnPeriod): void {
    period = next;
    app.setViewPref('learn-period', next);
  }
  const frame = $derived(periodFrame(period, app.today));

  // The paths (with their levels where the engine has them) and the next steps: read when the view opens, after every
  // write and when the hub tells of a change.
  let doc = $state<Paths | null>(null);
  let problem = $state(false);
  let next = $state<LearnNext | 'failed' | null>(null);
  let asked = 0;
  async function read(): Promise<void> {
    const mine = ++asked;
    try {
      const [paths, steps] = await Promise.all([
        withLevels ? app.pathsWithLevels() : app.paths(),
        withNext ? app.learnNext({ n: 1 }).catch(() => 'failed' as const) : Promise.resolve(null),
      ]);
      if (mine !== asked) return;
      doc = paths;
      next = steps;
      problem = false;
      app.rememberPaths(paths.items);
    } catch {
      if (mine !== asked) return;
      problem = true;
    }
  }
  $effect(() => {
    void app.writes;
    void app.snapshot?.rev;
    if (!usable) return;
    untrack(() => void read());
  });

  // The series by day over the period and the one before: asked again for another period and after a change.
  // Kept with the window it answers: until the answer for another period is there, no figures (the old series over the
  // new window would add up wrong and the live region would say so).
  let got = $state<{ key: string; doc: LearnHistory } | null>(null);
  // The area filter of the page (lib/learnScope.ts): the series is asked for its areas, so that the streak and the first
  // day of the series are theirs too; the paths of the lists are narrowed below.
  const scope = $derived(scopeOf(app));
  const asking = $derived(JSON.stringify(scope.query));
  const askKey = $derived(`${frame.ask.since}..${frame.ask.until}|${asking}`);
  const history = $derived(got !== null && got.key === askKey ? got.doc : null);
  let historyFailed = $state(false);
  let askedHistory = 0;
  $effect(() => {
    void app.writes;
    void app.snapshot?.rev;
    const { since, until } = frame.ask;
    const key = askKey;
    if (!usable || !withHistory) return;
    const mine = ++askedHistory;
    untrack(() => {
      app
        .learnHistory({ since, until, step: 'day', ...scope.query })
        .then((answer) => {
          if (mine !== askedHistory) return;
          got = { key, doc: answer };
          historyFailed = false;
        })
        .catch(() => {
          if (mine !== askedHistory) return;
          got = null;
          historyFailed = true;
        });
    });
  });

  // The figures of the paths of the filter's areas (the area of a path is the part of its id before the slash): the
  // engine narrowed the series already where it could be asked (`scope.query`), this narrows it where it could not.
  const keep = $derived(scope.active ? (id: string) => scope.has(id.includes('/') ? id.slice(0, id.indexOf('/')) : id) : null);
  const items = $derived(scope.keep(doc?.items ?? []));

  const first = $derived(history?.first);
  const days = $derived(byDate(history));
  const now = $derived(history ? sumSpan(days, frame.current, app.today, first, keep) : null);
  const before = $derived(
    history && frame.previous && coverage(frame.previous, first) === 'full' ? sumSpan(days, frame.previous, app.today, first, keep) : null,
  );
  const bars = $derived(history && first !== undefined ? barsOf(days, frame, app.today, first, keep) : []);
  const ofDays = $derived(knownDays(frame.current, app.today, first));

  // The paths that are not finished; the running ones by their last day of activity in the series, else by `updated`.
  const open = $derived(items.filter((p) => p.stage !== 'done' && p.status !== 'done'));
  const lastActive = $derived(new Map((history?.paths ?? []).map((p) => [p.id, p.last_active ?? ''])));
  const isRunning = (p: PathEntry): boolean => (p.stage !== undefined ? p.stage === 'doing' : p.status === 'doing' || p.progress.learned + p.progress.seen > 0);
  const running = $derived(
    open
      .filter(isRunning)
      .map((p, i) => ({ p, i, at: lastActive.get(p.id) || String(p.updated ?? '') }))
      .sort((a, b) => b.at.localeCompare(a.at) || a.i - b.i)
      .map(({ p }) => p),
  );
  const todayState = $derived(open.reduce((sum, p) => ({ learned: sum.learned + p.progress.learned, total: sum.total + p.progress.total }), { learned: 0, total: 0 }));

  // The next level of each open path, the nearest first; the open rewards.
  const reach = $derived(
    badgeTiles(open)
      .filter((tile) => tile.next)
      .sort((a, b) => (b.progress ?? -1) - (a.progress ?? -1))
      .slice(0, 4),
  );
  const rewards = $derived(withLevels ? openRewardCount(items) : 0);

  // One store of pictures per path whose next badge is a picture; given back when it is gone or the view goes.
  const imagePaths = $derived([...new Set(reach.filter((tile) => badgeImage(tile) !== null).map((tile) => tile.path))].sort().join('\n'));
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
  const number = $derived(new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }));
  const longDay = $derived(new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }));
  const dayText = (day: string): string => longDay.format(new Date(`${day}T12:00:00Z`));
  const weekdayLong = $derived(new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }));
  const dayMonth = $derived(new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' }));
  const h = (n: number): string => t('learnov.h', { n: number.format(n) });

  /** A figure against the period before: the mark (a picture only) and the words. */
  function compare(pick: (f: Figures) => number, format: (n: number) => string = String): { mark: string; text: string } | null {
    if (!now) return null;
    if (!before) return first !== undefined ? { mark: '', text: t('learnov.no_compare', { date: dayText(first) }) } : null;
    const change = changeOf(pick(now), pick(before));
    // the days compared, named: "last week to Wednesday", "last month to 22 October"
    const end = frame.previous ? new Date(`${frame.previous.until}T12:00:00Z`) : null;
    const what = t(`learnov.before.${period}`, end ? { day: weekdayLong.format(end), date: dayMonth.format(end) } : {});
    if (change.direction === 'same') return { mark: '=', text: t('learnov.same', { before: what }) };
    return { mark: change.direction === 'up' ? '▲' : '▼', text: t(change.direction === 'up' ? 'learnov.up' : 'learnov.down', { by: format(change.by), before: what }) };
  }

  const percent = (p: PathEntry): number => (p.progress.total > 0 ? Math.round(((p.progress.total - p.progress.open) / p.progress.total) * 100) : 0);
  function levelLine(p: PathEntry): string | null {
    const state = p.level;
    if (!game || !state) return null;
    const head = state.level > 0 ? (state.name ? t('learnov.level_named', { n: state.level, name: markHidden(state.name) }) : t('learnov.level', { n: state.level })) : t('learnov.level_none');
    const ahead = state.next;
    if (ahead?.missing_xp !== undefined) return `${head} · ${t('learnov.next_xp', { n: ahead.missing_xp, level: ahead.number })}`;
    if (ahead?.missing_percent !== undefined) return `${head} · ${t('learnov.next_percent', { n: ahead.missing_percent, level: ahead.number })}`;
    return head;
  }
  function reachLevel(tile: BadgeTile): string {
    const n = tile.level.number;
    const name = tile.level.name ? markHidden(tile.level.name) : '';
    if (tile.level.kind === 'done') return name || t('learnov.level', { n: '✓' });
    return name ? t('learnov.level_named', { n: n ?? tile.level.ref, name }) : t('learnov.level', { n: n ?? tile.level.ref });
  }
  function reachMissing(tile: BadgeTile): string | null {
    if (tile.level.missing_xp !== undefined && tile.level.kind === 'xp') return t('learnov.reach.missing_xp', { n: tile.level.missing_xp });
    if (tile.level.missing_percent !== undefined) return t('learnov.reach.missing_percent', { n: tile.level.missing_percent });
    if (tile.level.missing_xp !== undefined) return t('learnov.reach.missing_xp', { n: tile.level.missing_xp });
    return null;
  }

  const steps = $derived(next !== null && next !== 'failed' ? scope.keep(next.items).slice(0, 3) : []);
  const streak = $derived(history?.streak);
  // A filter the hub cannot be asked for: the series is of all areas (narrowed here only by path), and so is its streak.
  const streakOfAll = $derived(scope.active && Object.keys(scope.query).length === 0);
  function streakText(n: number): string {
    return n === 0 ? t('learnov.streak_none') : n === 1 ? t('learnov.streak_one') : t('learnov.streak', { n });
  }
</script>

<section class="learn" aria-labelledby="learn-title">
  <header class="intro">
    <div class="head">
      <h2 id="learn-title">{t('learnov.title')}</h2>
      <Info hint={t('learnov.intro')} label={t('hint.about', { what: t('learnov.title') })} />
    </div>
  </header>

  {#if !usable}
    <p class="none">{t('paths.no_engine')}</p>
  {:else if problem && !doc}
    <div class="empty" role="alert">
      <p>{t('learnov.failed')}</p>
      <button type="button" onclick={() => void read()}>{t('learnov.retry')}</button>
    </div>
  {:else if !doc}
    <p class="none" role="status">{t('learnov.reading')}</p>
  {:else if items.length === 0 && doc.items.length > 0}
    <LearnScopeNote {app} {scope} />
  {:else if doc.items.length === 0}
    <div class="empty">
      <p><strong>{t('learnov.empty')}</strong></p>
      <p>{t('learnov.empty_how')}</p>
      <button type="button" class="primary" onclick={() => app.setView('paths')}>{t('learnov.to_paths')}</button>
    </div>
  {:else}
    {#if problem}
      <p class="sub" role="alert">{t('learnov.failed')} <button type="button" class="link" onclick={() => void read()}>{t('learnov.retry')}</button></p>
    {/if}
    <div class="tiles">
      <section class="tile wide" aria-labelledby="learn-mine">
        <div class="tile-head">
          <h3 id="learn-mine">{t('learnov.mine')}</h3>
          <fieldset class="periods" data-hint={t('learnov.hint.period')}>
            <legend class="sr-only">{t('learnov.period')}</legend>
            {#each LEARN_PERIODS as p (p)}
              <label class:on={period === p}
                ><input type="radio" name="learn-period" value={p} checked={period === p} onchange={() => choose(p)} />{t(`learnov.period.${p}`)}</label
              >
            {/each}
          </fieldset>
        </div>
        {#if !withHistory || historyFailed || !history || first === undefined}
          <dl class="figs">
            <div class="fig" data-fig="today">
              <dt>{t('learnov.today_state')}</dt>
              <dd class="big">{t('learnov.today_learned', { learned: todayState.learned, total: todayState.total })}</dd>
            </div>
          </dl>
          <p class="note" role="note">
            {#if !withHistory}{t('learnov.no_history')}{:else if historyFailed}{t('learnov.history_failed')}{:else if history}{t('learnov.series_none')}{:else}{t('learnov.reading_history')}{/if}
          </p>
        {:else}
          {@const learned = compare((f) => f.learned)}
          {@const xp = compare((f) => f.xp)}
          {@const time = compare((f) => f.done_h, (n) => h(n))}
          {@const learning = compare((f) => f.days)}
          <dl class="figs" aria-live="polite">
            <div class="fig" data-fig="learned">
              <dt>{t('learnov.fig.learned')}</dt>
              <dd class="big">{now?.learned ?? 0}</dd>
              {#if learned}<dd class="cmp" data-dir={learned.mark}><span aria-hidden="true">{learned.mark}</span> {learned.text}</dd>{/if}
            </div>
            {#if game}
              <div class="fig" data-fig="xp">
                <dt>{t('learnov.fig.xp')}</dt>
                <dd class="big">{now?.xp ?? 0}</dd>
                {#if xp}<dd class="cmp" data-dir={xp.mark}><span aria-hidden="true">{xp.mark}</span> {xp.text}</dd>{/if}
              </div>
            {/if}
            <div class="fig" data-fig="hours">
              <dt>{t('learnov.fig.hours')}</dt>
              <dd class="big">{h(now?.done_h ?? 0)}</dd>
              {#if time}<dd class="cmp" data-dir={time.mark}><span aria-hidden="true">{time.mark}</span> {time.text}</dd>{/if}
            </div>
            <div class="fig" data-fig="days">
              <dt>{t('learnov.fig.days')}</dt>
              <dd class="big">{t('learnov.days_of', { n: now?.days ?? 0, m: ofDays })}</dd>
              {#if learning}<dd class="cmp" data-dir={learning.mark}><span aria-hidden="true">{learning.mark}</span> {learning.text}</dd>{/if}
            </div>
            <div class="fig" data-fig="streak">
              <dt>{t(streakOfAll ? 'learnov.fig.streak_all' : 'learnov.fig.streak')}</dt>
              <dd class="big"><span aria-hidden="true">🔥</span> {streakText(streak?.current ?? 0)}</dd>
              <dd class="cmp">{t('learnov.longest', { n: streak?.longest ?? 0 })}</dd>
            </div>
          </dl>
          {#if coverage(frame.current, first) === 'partial'}<p class="note" role="note">{t('learnov.partial', { date: dayText(first) })}</p>{/if}
          <LearnBars
            {app}
            id="learn-bars"
            {bars}
            bucket={frame.bucket}
            {game}
            short={period === 'day' || period === 'week'}
            caption={t(`bars.per.${frame.bucket}`)}
          />
        {/if}
      </section>

      {#if withNext}
        <section class="tile" aria-labelledby="learn-next">
          <div class="tile-head">
            <h3 id="learn-next">{t('learnov.next')}</h3>
            <button type="button" class="link" onclick={() => app.setView('learnnext')}>{t('learnov.next.all')} <span aria-hidden="true">→</span></button>
          </div>
          {#if next === 'failed'}
            <p class="note" role="alert">{t('learnov.next.failed')}</p>
          {:else if steps.length === 0}
            <p class="sub">{t('learnov.next.none')}</p>
          {:else}
            <ul class="steps">
              {#each steps as item (item.path)}
                {@const point = item.points[0]}
                {@const label = markHidden(labelText(point))}
                {@const hours = hoursText(point)}
                <li data-step={item.path}>
                  <ItemIcon {app} shown={shownIcon({ kind: 'path', id: item.path, icon: item.icon })} />
                  <span class="what">
                    <strong>{markHidden(item.title)}</strong>
                    <span class="sub">{markHidden(labelText({ label: point.stage_label }))} · {label}</span>
                    {#if hours || (game && point.xp !== undefined)}
                      <span class="sub">{#if hours}{t('learnov.h', { n: hours })}{/if}{#if hours && game && point.xp !== undefined}{' · '}{/if}{#if game && point.xp !== undefined}{point.xp} XP{/if}</span>
                    {/if}
                  </span>
                  <button type="button" aria-label={t('learnov.open_of', { label, path: markHidden(item.title) })} onclick={() => app.openPath(item.path, pointRef(point))}>{t('learnov.open')}</button>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/if}

      <section class="tile" aria-labelledby="learn-running">
        <div class="tile-head">
          <h3 id="learn-running">{t('learnov.running')}</h3>
          <button type="button" class="link" onclick={() => app.setView('paths')}>{t('learnov.running.all')} <span aria-hidden="true">→</span></button>
        </div>
        {#if running.length === 0}
          <p class="sub">{t('learnov.running.none')}</p>
        {:else}
          <ul class="running" aria-label={t('learnov.running.list', { n: running.length })}>
            {#each running.slice(0, 6) as p (p.id)}
              {@const line = levelLine(p)}
              {@const share = percent(p)}
              <li data-path={p.id}>
                <span class="name">
                  <span class="mark" aria-hidden="true">◐</span>
                  <span class="sr-only">{t('learnov.state.doing')}:</span>
                  <ItemIcon {app} shown={shownIcon({ kind: 'path', id: p.id, icon: p.icon })} />
                  <button type="button" class="link" onclick={() => app.openPath(p.id)}>{markHidden(p.title)}</button>
                </span>
                <span class="barline">
                  <progress max="100" value={share} aria-label={t('learnov.progress', { percent: share })}></progress>
                  <span class="sub" aria-hidden="true">{share} %</span>
                </span>
                {#if line}<span class="sub">{line}</span>{/if}
              </li>
            {/each}
          </ul>
          {#if running.length > 6}<p class="sub">{t('learnov.running.more', { n: running.length - 6 })}</p>{/if}
        {/if}
      </section>

      {#if withLevels}
        <section class="tile" aria-labelledby="learn-reach">
          <div class="tile-head"><h3 id="learn-reach">{t('learnov.reach')}</h3></div>
          {#if reach.length === 0}
            <p class="sub">{t('learnov.reach.none')}</p>
          {:else}
            <ul class="reach">
              {#each reach as tile (tile.key)}
                {@const missing = reachMissing(tile)}
                <li data-reach={tile.key}>
                  <BadgeMedal {tile} images={images.get(tile.path)} size={36} />
                  <span class="what">
                    <button type="button" class="link" onclick={() => app.openPath(tile.path)}>{t('learnov.reach.item', { level: reachLevel(tile), path: markHidden(tile.pathTitle) })}</button>
                    {#if missing}<span class="sub">{missing}</span>{/if}
                    {#if game && tile.level.reward}<span class="sub">{t('learnov.reach.reward', { reward: markHidden(tile.level.reward) })}</span>{/if}
                  </span>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/if}

      {#if game && withLevels}
        <section class="tile" aria-labelledby="learn-rewards">
          <div class="tile-head"><h3 id="learn-rewards">{t('learnov.rewards')}</h3></div>
          <p class="big" data-rewards={rewards}>
            <span aria-hidden="true">🎁</span>
            {rewards === 0 ? t('learnov.rewards.none') : rewards === 1 ? t('learnov.rewards.one') : t('learnov.rewards.count', { n: rewards })}
          </p>
          <button type="button" class="link" onclick={() => app.setView('rewards')}>{t('learnov.rewards.go')} <span aria-hidden="true">→</span></button>
        </section>
      {/if}
    </div>
  {/if}
</section>

<style>
  .learn {
    display: grid;
    gap: 1rem;
    min-inline-size: 0;
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
    margin: 0;
    font-size: 1rem;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
    gap: 1rem;
  }
  .tile {
    display: grid;
    align-content: start;
    gap: 0.6rem;
    padding: 0.9rem 1rem;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    min-inline-size: 0;
  }
  .tile.wide {
    grid-column: 1 / -1;
  }
  .tile-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .periods {
    display: flex;
    flex-wrap: wrap;
    gap: 0;
    margin: 0;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 6px;
    overflow: hidden;
  }
  .periods label {
    position: relative;
    padding: 0.3rem 0.7rem;
    cursor: pointer;
    color: var(--text);
  }
  .periods label + label {
    border-inline-start: 1px solid var(--line);
  }
  .periods label.on {
    background: var(--accent);
    color: var(--accent-text);
    font-weight: 600;
  }
  .periods input {
    position: absolute;
    opacity: 0;
    inset: 0;
    margin: 0;
    cursor: pointer;
  }
  .periods label:has(input:focus-visible) {
    outline: 2px solid var(--focus);
    outline-offset: -2px;
  }
  .figs {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 9.5rem), 1fr));
    gap: 0.75rem 1rem;
    margin: 0;
  }
  .fig {
    display: grid;
    align-content: start;
    gap: 0.15rem;
  }
  dt {
    color: var(--muted);
    font-size: 0.9em;
  }
  dd {
    margin: 0;
  }
  .big {
    font-size: 1.4rem;
    font-weight: 700;
    margin: 0;
  }
  .cmp {
    font-size: 0.85em;
    color: var(--muted);
  }
  .cmp[data-dir='▲'] span {
    color: var(--ok);
  }
  .cmp[data-dir='▼'] span {
    color: var(--warn);
  }
  .note {
    margin: 0;
    color: var(--muted);
    font-size: 0.9em;
  }
  .sub {
    color: var(--muted);
    font-size: 0.9em;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.6rem;
  }
  .steps li,
  .reach li {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 0.6rem;
  }
  .reach li {
    grid-template-columns: auto 1fr;
  }
  .what {
    display: grid;
    gap: 0.1rem;
    min-inline-size: 0;
    overflow-wrap: anywhere;
  }
  .running li {
    display: grid;
    gap: 0.2rem;
  }
  .name {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    min-inline-size: 0;
    overflow-wrap: anywhere;
  }
  .mark {
    color: var(--accent);
  }
  .barline {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  progress {
    flex: 1;
    accent-color: var(--accent);
    block-size: 0.6rem;
  }
  .empty {
    display: grid;
    gap: 0.4rem;
    justify-items: start;
  }
  .none {
    color: var(--muted);
  }
  .sr-only {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  button:not(.link) {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.25rem 0.6rem;
    min-height: 2rem;
    font: inherit;
    cursor: pointer;
  }
  button.primary {
    background: var(--accent);
    color: var(--accent-text);
    border-color: var(--accent);
  }
  .link {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    text-decoration: underline;
    text-align: start;
  }
</style>
