<script lang="ts">
  // The learning statistics of the tab Lernpläne (concept "Reiter Lernpläne" 6): over a period (week, month, quarter,
  // year as the calendar has them, or two days of one's own; kept on this device) and for a project or one path, the
  // points and XP (points without gamification) per bar with their running sum, the learning time per week stacked by
  // path (five, the rest together), the calendar of the learning days with the streak, and a row per path. Every figure
  // is the engine's (`tasks.learn_history` by day; WEB-13): the page adds up the days and draws. Before the series
  // begins the bars count the finished tasks promoted from a point (`tasks.finished`), marked incomplete. Every chart
  // is a table as well, and the menu View exports and prints the tables (`App.viewTables`). Read only.
  import { untrack } from 'svelte';
  import type { App } from '../lib/app.svelte';
  import type { Key } from '../lib/i18n';
  import type { FinishedItem, LearnHistory, Paths } from '../lib/contract';
  import type { ViewTables } from '../lib/export';
  import Info from 'appkit-ui/Info.svelte';
  import LearnScopeNote from './LearnScopeNote.svelte';
  import { tablesLabel } from '../lib/viewTablesTexts';
  import { learnScope } from '../lib/learnScope';
  import LearnBars from './LearnBars.svelte';
  import { markHidden } from '../lib/text';
  import { addDays } from '../lib/calendar';
  import { learnStatsTexts as texts, type LearnStatsKey } from '../lib/learnStatsTexts';
  import { learnOverviewTexts } from '../lib/learnOverviewTexts';
  import {
    barsOf,
    byDate,
    calendarWeeks,
    cumulative,
    isoWeek,
    parseStatsPeriod,
    parseStatsSpan,
    pathRows,
    MAX_DAYS,
    STATS_PERIODS,
    statsFrame,
    weekHours,
    withFinished,
    type Bar,
    type CalendarDay,
    type Keep,
    type StatsPeriod,
  } from '../lib/learnPeriod';

  let { app }: { app: App } = $props();
  const t = (key: LearnStatsKey | Key, params: Record<string, string | number> = {}) => texts.t(app.lang, key, params);
  const bt = (key: 'bars.week' | 'bars.partial' | 'bars.unknown' | 'bars.not_yet', params: Record<string, string | number> = {}) => learnOverviewTexts.text(app.lang, key, params);

  const usable = $derived(app.can('paths'));
  const withHistory = $derived(app.can('learn_history'));
  const withLevels = $derived(app.can('paths_levels'));
  const withOutcome = $derived(app.can('outcome'));
  const game = $derived(app.gamification && app.can('xp'));

  let period = $state<StatsPeriod>(untrack(() => parseStatsPeriod(app.viewPref('learnstats-period'))));
  let custom = $state(untrack(() => parseStatsSpan(app.viewPref('learnstats-span'))));
  function choose(next: StatsPeriod): void {
    period = next;
    app.setViewPref('learnstats-period', next);
  }
  function setDay(which: 'since' | 'until', value: string): void {
    custom = { ...custom, [which]: value };
    app.setViewPref('learnstats-span', `${custom.since}..${custom.until}`);
  }
  const frame = $derived(statsFrame(period, app.today, custom));

  let project = $state('');
  let path = $state('');

  // The paths: for the choice of a project or path, the titles, and the numbers of their levels.
  let doc = $state<Paths | null>(null);
  let askedPaths = 0;
  $effect(() => {
    void app.writes;
    void app.snapshot?.rev;
    if (!usable) return;
    const mine = ++askedPaths;
    untrack(() => {
      (withLevels ? app.pathsWithLevels() : app.pathsForMap())
        .then((answer) => {
          // an older answer that comes late does not cover a newer one
          if (mine === askedPaths) doc = answer;
        })
        .catch(() => undefined);
    });
  });

  // The series by day over the window, of one path where one is chosen; kept with the question it answers: until the
  // answer for another window or path is there, no figures (the old series under the new choice would be wrong).
  let got = $state<{ key: string; doc: LearnHistory } | null>(null);
  const askKey = $derived(`${frame.ask.since}..${frame.ask.until}|${path}`);
  const history = $derived(got !== null && got.key === askKey ? got.doc : null);
  /** A window that has not begun yet: nothing to ask. */
  const notBegun = $derived(frame.ask.since > frame.ask.until);
  let problem = $state(false);
  let reading = $state(false);
  let asked = 0;
  function readHistory(): void {
    const { since, until } = frame.ask;
    const chosen = path;
    const key = askKey;
    const mine = ++asked;
    reading = true;
    app
      .learnHistory({ since, until, step: 'day', ...(chosen !== '' ? { path: chosen } : {}) })
      .then((answer) => {
        if (mine !== asked) return;
        got = { key, doc: answer };
        problem = false;
        reading = false;
      })
      .catch(() => {
        if (mine !== asked) return;
        problem = true;
        reading = false;
      });
  }
  $effect(() => {
    void app.writes;
    void app.snapshot?.rev;
    void frame.ask.since;
    void frame.ask.until;
    void path;
    if (!usable || !withHistory || notBegun) return;
    untrack(readHistory);
  });

  // Before the series: the finished tasks promoted from a point, in the days of the window before its first day.
  let finished = $state<readonly FinishedItem[]>([]);
  const first = $derived(history?.first);
  // As text: a new read of the series makes a new window object with the same days, and must not read them again.
  const before = $derived.by(() => {
    if (!history || !withOutcome) return '';
    const end = first === undefined ? frame.ask.until : addDays(first, -1);
    return end >= frame.current.since ? `${frame.current.since}..${end}` : '';
  });
  $effect(() => {
    const key = before;
    void app.snapshot?.rev;
    if (key === '') {
      finished = [];
      return;
    }
    const [since = '', until = ''] = key.split('..');
    const span = { since, until };
    let gone = false;
    untrack(() => {
      readFinished(span)
        .then((items) => {
          if (!gone) finished = items;
        })
        .catch(() => {
          if (!gone) finished = [];
        });
    });
    return () => {
      gone = true;
    };
  });

  /** The finished tasks of a span, page by page (the engine gives at most 100 at once), up to `FINISHED_PAGES` pages. */
  const FINISHED_PAGE = 100;
  const FINISHED_PAGES = 10;
  async function readFinished(span: { since: string; until: string }): Promise<FinishedItem[]> {
    const out: FinishedItem[] = [];
    for (let page = 0; page < FINISHED_PAGES; page += 1) {
      const answer = await app.finished({ since: span.since, until: span.until, limit: FINISHED_PAGE, offset: page * FINISHED_PAGE });
      out.push(...answer.items);
      if (answer.items.length < FINISHED_PAGE || out.length >= answer.total) break;
    }
    return out;
  }

  // The area filter of the page (lib/learnScope.ts): the paths of its areas, and of the series the figures of those
  // (the area of a path is the part of its id before the slash, so a finished path no list names counts as well).
  const scope = $derived(learnScope(app.filter.areas, app.matchAreas));
  const entries = $derived(scope.keep(doc?.items ?? []));
  const hiddenByScope = $derived(scope.active && entries.length === 0 && (doc?.items.length ?? 0) > 0);
  const projects = $derived([...new Set(entries.map((p) => p.project).filter((p): p is string => p !== undefined))].sort());
  const pathChoices = $derived(
    entries.filter((p) => project === '' || p.project === project).toSorted((a, b) => a.title.localeCompare(b.title)),
  );
  const projectTitle = (id: string): string => app.snapshot?.projects?.find((p) => p.id === id)?.title ?? id;
  $effect(() => {
    if (path !== '' && doc && !pathChoices.some((p) => p.id === path)) path = '';
  });
  // A path is asked of the engine; a project is a filter of the paths of the series.
  const keep = $derived.by((): Keep => {
    if (path !== '' || (project === '' && !scope.active)) return null;
    const ids = project === '' ? null : new Set(entries.filter((p) => p.project === project).map((p) => p.id));
    return (id: string) => (ids === null || ids.has(id)) && scope.has(id.slice(0, id.indexOf('/')));
  });

  // The finished tasks before the series: of the path chosen alone (the engine asked for it alone), else as the paths.
  const keepTasks = $derived.by((): Keep => {
    if (path === '') return keep;
    const chosen = path;
    return (id: string) => id === chosen;
  });
  const days = $derived(byDate(history));
  const bars = $derived(history ? withFinished(barsOf(days, frame, app.today, first, keep), first, finished, keepTasks) : []);
  const pick = (f: { xp: number; learned: number }): number => (game ? f.xp : f.learned);
  const line = $derived(cumulative(bars, pick));
  const hours = $derived(history ? weekHours(days, frame.current, app.today, first, keep) : null);
  const calendar = $derived(history ? calendarWeeks(days, frame.current, app.today, first, keep) : []);
  const rows = $derived(pathRows(history, frame.current, app.today, keep));
  // The drawing holds a year of weeks (54: a year can touch 54 of them); the table and the export hold every day.
  const drawnWeeks = $derived(calendar.slice(-54));
  const knownCells = $derived(calendar.flat().filter((cell): cell is CalendarDay & { count: number } => cell !== null && cell.count !== null));

  // Names: the titles of the paths, the numbers of their levels.
  const titles = $derived(new Map([...entries.map((p) => [p.id, p.title] as const), ...(history?.paths ?? []).filter((p) => p.title).map((p) => [p.id, p.title!] as const)]));
  const areas = $derived(new Map([...entries.map((p) => [p.id, p.area] as const), ...(history?.paths ?? []).map((p) => [p.id, p.area] as const)]));
  const levelNumbers = $derived(new Map(entries.flatMap((p) => (p.levels ?? []).map((l) => [`${p.id}#${l.ref}`, l.number] as const))));
  const titleOf = (id: string): string => titles.get(id) ?? id;

  const locale = $derived(app.lang === 'de' ? 'de-DE' : 'en-GB');
  const number = $derived(new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }));
  const shortDay = $derived(new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', timeZone: 'UTC' }));
  const longDay = $derived(new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }));
  const fullDay = $derived(new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }));
  const monthLong = $derived(new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }));
  const weekdays = $derived(Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 16 + i, 12)))));
  const at = (day: string): Date => new Date(`${day}T12:00:00Z`);
  const h = (n: number): string => t('learnstats.h', { n: number.format(n) });
  const weekName = (since: string): string => bt('bars.week', { n: isoWeek(since) });
  /** A week in a table: its number and its Monday (the same number comes again in a window over a year). */
  const weekLabel = (since: string): string => `${weekName(since)} (${shortDay.format(at(since))})`;
  const barName = (bar: Bar): string =>
    frame.bucket === 'month' ? monthLong.format(at(bar.since)) : frame.bucket === 'week' ? `${weekName(bar.since)} (${longDay.format(at(bar.since))})` : longDay.format(at(bar.since));
  const dayCount = (n: number): string => (n === 1 ? t('learnstats.day_one') : t('learnstats.days_n', { n }));
  function reachedText(id: string, reached: { ref: string; on: string } | undefined): string {
    if (!reached) return '–';
    const n = levelNumbers.get(`${id}#${reached.ref}`);
    return t('learnstats.level_on', { n: n ?? reached.ref, date: shortDay.format(at(reached.on)) });
  }
  function cellText(cell: { day: string; count: number | null }): string {
    const date = longDay.format(at(cell.day));
    if (cell.count === null) return t('learnstats.cell_unknown', { date });
    return cell.count === 0 ? t('learnstats.cell_none', { date }) : cell.count === 1 ? t('learnstats.cell_one', { date }) : t('learnstats.cell', { date, n: cell.count });
  }

  let hoursTable = $state(false);
  let daysTable = $state(false);
  const hoursTop = $derived(Math.max(1, ...(hours?.weeks ?? []).map((w) => w.total)));
  const seriesNames = $derived([...(hours?.paths ?? []).map((id) => markHidden(titleOf(id))), t('learnstats.rest')]);
  const anyRest = $derived((hours?.weeks ?? []).some((w) => w.rest > 0));
  const anyHours = $derived((hours?.weeks ?? []).some((w) => w.total > 0));
  // The engine's streak ends on the last day asked: it is today's only when the window reaches today.
  const streakWords = $derived(
    history?.streak && frame.ask.until === app.today
      ? t(keep !== null ? 'learnstats.streak_all' : 'learnstats.streak', { current: dayCount(history.streak.current), longest: dayCount(history.streak.longest) })
      : null,
  );

  // The tables of the view, for the menu View; a path of an area that may not leave is not named.
  function exportName(id: string): string {
    // an area not known is held back as a private one
    const area = areas.get(id);
    return area === undefined || !app.areaMayLeave(area) ? t('learnstats.private') : titleOf(id);
  }
  function tables(): ReturnType<ViewTables['tables']> {
    const out: ReturnType<ViewTables['tables']> = [];
    const sum = line;
    out.push({
      title: t(game ? 'learnstats.xp_title' : 'learnstats.points_title'),
      headers: [t('learnstats.col.day'), t('learnstats.col.learned'), learnOverviewTexts.text(app.lang, 'bars.col.seen'), ...(game ? [t('learnstats.col.xp')] : []), t('learnstats.col.hours'), t(game ? 'learnstats.xp_sum' : 'learnstats.points_sum')],
      rows: bars.map((bar, i) => {
        const name = `${barName(bar)}${bar.partial ? ` (${bt('bars.partial')})` : ''}`;
        if (!bar.figures) return [name, '', '', ...(game ? [''] : []), '', ''];
        const f = bar.figures;
        return [name, String(f.learned), String(f.seen), ...(game ? [String(f.xp)] : []), bar.partial ? '' : number.format(f.done_h), String(sum[i] ?? '')];
      }),
    });
    if (hours) {
      out.push({
        title: t('learnstats.hours_title'),
        headers: [t('learnstats.col.week'), ...hours.paths.map(exportName), t('learnstats.rest'), t('learnstats.col.total')],
        rows: hours.weeks.filter((w) => w.known).map((w) => [weekLabel(w.since), ...w.values.map((v) => number.format(v)), number.format(w.rest), number.format(w.total)]),
      });
    }
    out.push({
      title: t('learnstats.days_title'),
      headers: [t('learnstats.col.day'), t('learnstats.col.points')],
      rows: knownCells.map((cell) => [cell.day, String(cell.count)]),
    });
    out.push({
      title: t('learnstats.paths_title'),
      headers: [t('learnstats.col.path'), t('learnstats.col.learned'), ...(game ? [t('learnstats.col.xp')] : []), t('learnstats.col.hours'), t('learnstats.col.level')],
      rows: rows.map((r) => [exportName(r.id), String(r.figures.learned), ...(game ? [String(r.figures.xp)] : []), number.format(r.figures.done_h), r.reached ? reachedText(r.id, r.reached) : '']),
    });
    return out;
  }
  $effect(() => {
    if (!usable || !withHistory) return;
    // the part that writes the tables out, loaded now: the copy then follows the click without waiting
    void import('../lib/viewTablesOut');
    const own: ViewTables = {
      view: 'learnstats',
      title: t('nav.learnstats'),
      tables: () => untrack(tables),
      words: (what, n) => texts.text(app.lang, `learnstats.out.${what}`, { n }),
      label: (key, params) => tablesLabel(app.lang, key, params),
    };
    app.viewTables = own;
    return () => {
      if (app.viewTables === own) app.viewTables = null;
    };
  });
</script>

<section class="learnstats" aria-labelledby="learnstats-title">
  <header class="intro">
    <div class="head">
      <h2 id="learnstats-title">{t('learnstats.title')}</h2>
      <Info hint={t('learnstats.intro')} label={t('hint.about', { what: t('learnstats.title') })} />
    </div>
  </header>

  {#if !usable}
    <p class="none">{t('paths.no_engine')}</p>
  {:else if !withHistory}
    <p class="note" role="note">{t('learnstats.no_history')}</p>
    {#if doc}
      <div class="scroll">
        <table class="cards">
          <caption>{t('learnstats.today_state')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('learnstats.col.path')}</th>
              <th scope="col" class="num">{t('learnstats.col.learned')}</th>
              {#if game}<th scope="col" class="num">{t('learnstats.col.xp')}</th>{/if}
              <th scope="col" class="num">{t('learnstats.col.hours')}</th>
            </tr>
          </thead>
          <tbody>
            {#each entries as p (p.id)}
              <tr data-path={p.id}>
                <th scope="row" data-label={t('learnstats.col.path')}>{markHidden(p.title)}</th>
                <td class="num" data-label={t('learnstats.col.learned')}>{p.progress.learned} / {p.progress.total}</td>
                {#if game}<td class="num" data-label={t('learnstats.col.xp')}>{p.xp?.earned ?? '–'}</td>{/if}
                <td class="num" data-label={t('learnstats.col.hours')}>{p.hours ? h(p.hours.done) : '–'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {:else}
    <div class="tools">
      <fieldset class="periods" data-hint={t('learnstats.hint.period')}>
        <legend class="sr-only">{t('learnstats.period')}</legend>
        {#each STATS_PERIODS as p (p)}
          <label class:on={period === p}
            ><input type="radio" name="learnstats-period" value={p} checked={period === p} onchange={() => choose(p)} />{t(`learnstats.period.${p}`)}</label
          >
        {/each}
      </fieldset>
      {#if period === 'custom'}
        <span class="field" data-hint={t('learnstats.hint.since')}>
          <label for="learnstats-since">{t('learnstats.since')}</label>
          <input id="learnstats-since" type="date" value={custom.since} max={custom.until || undefined} onchange={(e) => setDay('since', e.currentTarget.value)} />
        </span>
        <span class="field" data-hint={t('learnstats.hint.until')}>
          <label for="learnstats-until">{t('learnstats.until')}</label>
          <input id="learnstats-until" type="date" value={custom.until} min={custom.since || undefined} onchange={(e) => setDay('until', e.currentTarget.value)} />
        </span>
      {/if}
      {#if projects.length > 0}
        <span class="field" data-hint={t('learnstats.hint.project')}>
          <label for="learnstats-project">{t('learnstats.project')}</label>
          <select id="learnstats-project" bind:value={project}>
            <option value="">{t('learnstats.project.all')}</option>
            {#each projects as id (id)}<option value={id}>{markHidden(projectTitle(id))}</option>{/each}
          </select>
        </span>
      {/if}
      <span class="field" data-hint={t('learnstats.hint.path')}>
        <label for="learnstats-path">{t('learnstats.path')}</label>
        <select id="learnstats-path" bind:value={path}>
          <option value="">{t('learnstats.path.all')}</option>
          {#each pathChoices as p (p.id)}<option value={p.id}>{markHidden(p.title)}</option>{/each}
        </select>
      </span>
      <span class="since" role="status"
        >{#if reading && history}{t('learnstats.reading')}{:else if first}{t('learnstats.series_since', { date: fullDay.format(at(first)) })}{/if}</span
      >
    </div>

    {#if hiddenByScope}
      <LearnScopeNote {app} {scope} />
    {:else if notBegun}
      <p class="note" role="note">{t('learnstats.not_begun')}</p>
    {:else if problem && !history}
      <div class="empty" role="alert">
        <p>{t('learnstats.failed')}</p>
        <button type="button" onclick={readHistory}>{t('learnstats.retry')}</button>
      </div>
    {:else if !history}
      <p class="none" role="status">{t('learnstats.reading')}</p>
    {:else}
      {#if frame.clamped}
        <p class="note" role="note">{t('learnstats.clamped', { n: MAX_DAYS, date: fullDay.format(at(frame.current.since)) })}</p>
      {:else if period === 'custom' && (frame.current.since !== custom.since || frame.current.until !== custom.until)}
        <p class="note" role="note">{t('learnstats.custom_month')}</p>
      {/if}
      {#if problem}
        <p class="note" role="alert">{t('learnstats.failed')} <button type="button" class="link" onclick={readHistory}>{t('learnstats.retry')}</button></p>
      {/if}
      {#if first === undefined}
        <p class="note" role="note">{t('learnstats.series_none')}</p>
      {:else if first > frame.current.since}
        <p class="note" role="note">{t('learnstats.before_series', { date: fullDay.format(at(first)) })}</p>
      {/if}

      <div class="cards-grid">
        <section class="card" aria-labelledby="learnstats-points">
          <h3 id="learnstats-points">{t(game ? 'learnstats.xp_title' : 'learnstats.points_title')}</h3>
          <LearnBars
            {app}
            id="learnstats-bars"
            {bars}
            bucket={frame.bucket}
            {game}
            seen
            {line}
            lineLabel={t(game ? 'learnstats.xp_sum' : 'learnstats.points_sum')}
            short={period === 'week'}
            caption={learnOverviewTexts.text(app.lang, `bars.per.${frame.bucket}`)}
          />
        </section>

        <section class="card" aria-labelledby="learnstats-hours">
          <div class="card-head">
            <h3 id="learnstats-hours">{t('learnstats.hours_title')}</h3>
            {#if anyHours}
              <button type="button" class="link" aria-pressed={hoursTable} aria-controls="learnstats-hours-table" onclick={() => (hoursTable = !hoursTable)}
                >{hoursTable ? learnOverviewTexts.text(app.lang, 'bars.as_chart') : learnOverviewTexts.text(app.lang, 'bars.as_table')}</button
              >
            {/if}
          </div>
          {#if !hours || !anyHours}
            <p class="sub">{t('learnstats.hours_none')}</p>
          {:else}
            {#if !hoursTable}
              <div class="hchart" aria-hidden="true" style:--n={hours.weeks.length}>
                {#each hours.weeks as w (w.since)}
                  <div class="hcol" title="{weekName(w.since)}: {h(w.total)}">
                    <div class="hstack">
                      {#if w.total > 0 && hours.weeks.length <= 14}<span class="num">{h(w.total)}</span>{/if}
                      {#if w.rest > 0}<span class="seg s5" style:block-size="{(w.rest / hoursTop) * 100}%"></span>{/if}
                      {#each w.values.toReversed() as v, j (j)}
                        {#if v > 0}<span class="seg s{w.values.length - 1 - j}" style:block-size="{(v / hoursTop) * 100}%"></span>{/if}
                      {/each}
                    </div>
                    <span class="tick">{weekName(w.since)}</span>
                  </div>
                {/each}
              </div>
              <ul class="legend" aria-hidden="true">
                {#each hours.paths as id, i (id)}<li><span class="key s{i}"></span> {markHidden(titleOf(id))}</li>{/each}
                {#if anyRest}<li><span class="key s5"></span> {t('learnstats.rest')}</li>{/if}
              </ul>
            {/if}
            <!-- svelte-ignore a11y_no_noninteractive_tabindex (a region that scrolls sideways is reached by the keyboard) -->
            <div class="scroll" class:sr-only={!hoursTable} id="learnstats-hours-table" role="region" aria-labelledby="learnstats-hours-caption" tabindex={hoursTable ? 0 : -1}>
              <table>
                <caption id="learnstats-hours-caption">{t('learnstats.hours_caption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('learnstats.col.week')}</th>
                    {#each seriesNames.slice(0, -1) as name, i (i)}<th scope="col" class="num">{name}</th>{/each}
                    {#if anyRest}<th scope="col" class="num">{t('learnstats.rest')}</th>{/if}
                    <th scope="col" class="num">{t('learnstats.col.total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {#each hours.weeks as w (w.since)}
                    <tr data-week={w.since}>
                      <th scope="row">{weekLabel(w.since)}</th>
                      {#if w.known}
                        {#each w.values as v, i (i)}<td class="num">{h(v)}</td>{/each}
                        {#if anyRest}<td class="num">{h(w.rest)}</td>{/if}
                        <td class="num">{h(w.total)}</td>
                      {:else}
                        <td colspan={w.values.length + (anyRest ? 2 : 1)}>{w.since > app.today ? bt('bars.not_yet') : bt('bars.unknown')}</td>
                      {/if}
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </section>

        <section class="card wide" aria-labelledby="learnstats-days">
          <div class="card-head">
            <h3 id="learnstats-days">{t('learnstats.days_title')}</h3>
            {#if streakWords}<p class="streak" data-streak><span aria-hidden="true">🔥</span> {streakWords}</p>{/if}
            <button type="button" class="link" aria-pressed={daysTable} aria-controls="learnstats-days-table" onclick={() => (daysTable = !daysTable)}
              >{daysTable ? learnOverviewTexts.text(app.lang, 'bars.as_chart') : learnOverviewTexts.text(app.lang, 'bars.as_table')}</button
            >
          </div>
          {#if !daysTable}
            <div class="calendar-wrap" aria-hidden="true">
              <div class="weekdays">{#each weekdays as d, i (i)}<span>{i % 2 === 0 ? d : ''}</span>{/each}</div>
              <div class="calendar" style:--weeks={calendar.length}>
                {#each drawnWeeks as week, wi (wi)}
                  {#each week as cell, di (di)}
                    {#if cell}
                      <span class="cell lv-{cell.level}" class:unk={cell.count === null} title={cellText(cell)} data-day={cell.day}></span>
                    {:else}
                      <span class="cell out"></span>
                    {/if}
                  {/each}
                {/each}
              </div>
            </div>
            <p class="scale" aria-hidden="true">
              {t('learnstats.scale')}
              {#each [0, 1, 2, 3, 4] as lv (lv)}<span class="cell lv-{lv}"></span>{/each}
              {t('learnstats.scale_more')}
            </p>
          {/if}
          <!-- svelte-ignore a11y_no_noninteractive_tabindex (a region that scrolls is reached by the keyboard) -->
          <div class="scroll tall" class:sr-only={!daysTable} id="learnstats-days-table" role="region" aria-labelledby="learnstats-days-caption" tabindex={daysTable ? 0 : -1}>
            <table>
              <caption id="learnstats-days-caption">{t('learnstats.days_caption')}</caption>
              <thead>
                <tr><th scope="col">{t('learnstats.col.day')}</th><th scope="col" class="num">{t('learnstats.col.points')}</th></tr>
              </thead>
              <tbody>
                {#each knownCells as cell (cell.day)}
                  <tr data-day={cell.day}><th scope="row">{longDay.format(at(cell.day))}</th><td class="num">{cell.count}</td></tr>
                {/each}
              </tbody>
            </table>
          </div>
        </section>

        <section class="card wide" aria-labelledby="learnstats-paths">
          <h3 id="learnstats-paths">{t('learnstats.paths_title')}</h3>
          {#if rows.length === 0}
            <p class="sub">{t('learnstats.paths_none')}</p>
          {:else}
            <div class="scroll">
              <table class="cards">
                <caption class="sr-only">{t('learnstats.paths_title')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('learnstats.col.path')}</th>
                    <th scope="col" class="num">{t('learnstats.col.learned')}</th>
                    {#if game}<th scope="col" class="num">{t('learnstats.col.xp')}</th>{/if}
                    <th scope="col" class="num">{t('learnstats.col.hours')}</th>
                    <th scope="col">{t('learnstats.col.level')}</th>
                  </tr>
                </thead>
                <tbody>
                  {#each rows as r (r.id)}
                    <tr data-path={r.id}>
                      <th scope="row" data-label={t('learnstats.col.path')}><button type="button" class="link" onclick={() => app.openPath(r.id)}>{markHidden(titleOf(r.id))}</button></th>
                      <td class="num" data-label={t('learnstats.col.learned')}>{r.figures.learned}</td>
                      {#if game}<td class="num" data-label={t('learnstats.col.xp')}>{r.figures.xp}</td>{/if}
                      <td class="num" data-label={t('learnstats.col.hours')}>{h(r.figures.done_h)}</td>
                      <td data-label={t('learnstats.col.level')}>{reachedText(r.id, r.reached)}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </section>
      </div>
    {/if}
  {/if}
</section>

<style>
  .learnstats {
    display: grid;
    gap: 1rem;
    min-inline-size: 0;
    container-type: inline-size;
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
  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.6rem 1rem;
  }
  .field {
    display: grid;
    gap: 0.15rem;
    font-size: 0.9em;
    color: var(--muted);
  }
  .field select,
  .field input {
    color: var(--text);
  }
  .since {
    margin-inline-start: auto;
    color: var(--muted);
    font-size: 0.9em;
  }
  .periods {
    display: flex;
    flex-wrap: wrap;
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
  .cards-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
    gap: 1rem;
  }
  .card {
    display: grid;
    align-content: start;
    gap: 0.6rem;
    padding: 0.9rem 1rem;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    min-inline-size: 0;
  }
  .card.wide {
    grid-column: 1 / -1;
  }
  .card-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .streak {
    margin: 0;
    font-weight: 600;
  }
  .note,
  .sub,
  .none {
    margin: 0;
    color: var(--muted);
    font-size: 0.9em;
  }
  .empty {
    display: grid;
    gap: 0.4rem;
    justify-items: start;
  }
  .hchart {
    display: grid;
    grid-template-columns: repeat(var(--n), minmax(0, 1fr));
    gap: 4px;
    block-size: 9rem;
  }
  .hcol {
    display: grid;
    grid-template-rows: 1fr auto;
    min-inline-size: 0;
  }
  .hstack {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    min-block-size: 0;
  }
  .seg {
    display: block;
    min-block-size: 0;
  }
  .num {
    text-align: end;
    font-variant-numeric: tabular-nums;
  }
  .hstack .num {
    text-align: center;
    font-size: 0.75em;
  }
  .tick {
    overflow: hidden;
    text-align: center;
    font-size: 0.75em;
    color: var(--muted);
    white-space: nowrap;
  }
  /* Each series in its colour and, every other one, a pattern: never colour alone (the legend names them). */
  .s0 {
    background: var(--chart-1);
  }
  .s1 {
    background: repeating-linear-gradient(45deg, var(--chart-2) 0 4px, var(--surface) 4px 6px);
  }
  .s2 {
    background: var(--chart-3);
  }
  .s3 {
    background: repeating-linear-gradient(-45deg, var(--chart-4) 0 4px, var(--surface) 4px 6px);
  }
  .s4 {
    background: var(--chart-5);
  }
  .s5 {
    background: repeating-linear-gradient(90deg, var(--chart-6) 0 3px, var(--surface) 3px 5px);
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 0.85em;
    color: var(--muted);
  }
  .key {
    display: inline-block;
    inline-size: 0.9em;
    block-size: 0.9em;
    vertical-align: -0.1em;
    outline: 1px solid var(--line);
  }
  .calendar-wrap {
    display: flex;
    gap: 4px;
    overflow-x: auto;
  }
  .weekdays {
    display: grid;
    grid-template-rows: repeat(7, 12px);
    gap: 3px;
    font-size: 0.7em;
    line-height: 12px;
    color: var(--muted);
  }
  .calendar {
    display: grid;
    grid-auto-flow: column;
    grid-template-rows: repeat(7, 12px);
    grid-auto-columns: 12px;
    gap: 3px;
  }
  .cell {
    display: inline-block;
    inline-size: 12px;
    block-size: 12px;
    border-radius: 2px;
    box-sizing: border-box;
  }
  .cell.out {
    visibility: hidden;
  }
  .lv-0 {
    background: var(--surface-2);
    outline: 1px solid var(--line);
    outline-offset: -1px;
  }
  .lv-1 {
    background: light-dark(var(--accent-200), var(--accent-800));
  }
  .lv-2 {
    background: light-dark(var(--accent-400), var(--accent-600));
  }
  .lv-3 {
    background: light-dark(var(--accent-600), var(--accent-400));
  }
  .lv-4 {
    background: light-dark(var(--accent-700), var(--accent-200));
  }
  .cell.unk {
    background: transparent;
    outline: 1px dashed var(--line);
  }
  .scale {
    display: flex;
    align-items: center;
    gap: 3px;
    margin: 0;
    font-size: 0.8em;
    color: var(--muted);
  }
  .scroll {
    overflow-x: auto;
  }
  .scroll.tall:not(.sr-only) {
    max-block-size: 24rem;
    overflow-y: auto;
  }
  table {
    border-collapse: collapse;
    inline-size: 100%;
    font-size: 0.9em;
  }
  caption {
    text-align: start;
    color: var(--muted);
    padding-block-end: 0.3rem;
  }
  th,
  td {
    padding: 0.25rem 0.5rem;
    border-block-end: 1px solid var(--line);
    text-align: start;
  }
  td.num,
  th.num {
    text-align: end;
  }
  .sr-only {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  /* A narrow window: the table of the paths becomes a card per row, each value under its column's name. */
  @container (inline-size < 600px) {
    table.cards,
    table.cards thead,
    table.cards tbody,
    table.cards tr,
    table.cards th,
    table.cards td {
      display: block;
    }
    table.cards thead {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
    table.cards tbody > tr {
      border: 1px solid var(--line);
      border-radius: 6px;
      margin-block-end: 0.5rem;
    }
    table.cards tbody td,
    table.cards tbody th {
      border: 0;
      text-align: start;
    }
    table.cards tbody td[data-label]::before {
      content: attr(data-label) ': ';
      color: var(--muted);
    }
    .since {
      margin-inline-start: 0;
    }
  }
  @media (forced-colors: active) {
    .seg,
    .key,
    .cell:not(.lv-0):not(.unk) {
      background: CanvasText;
    }
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
