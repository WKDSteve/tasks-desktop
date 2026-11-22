// What the palette can do: the actions of the page, as a list for the state it is in (a task that is selected, a
// board the engine can serve, marks that are made). Only what can be done now is listed.

import type { App, View } from './app.svelte';
import { learnMenu } from './learnViews';
import { labelOf, translate, type Key } from './i18n';
import { isColumn } from './board';
import type { PaletteAction } from 'appkit-ui/palette';
import { isViewField, selectOfFilter } from './views';
import { tagCounts } from './tagging';


export function paletteActions(app: App): PaletteAction[] {
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);
  const out: PaletteAction[] = [];
  const add = (key: string, label: string, run: () => void | Promise<void>, hint = ''): void => {
    out.push({ key, label, hint, run });
  };

  add('capture', t('menu.capture'), () => app.openCapture());
  add('intent', t('menu.intent'), () => app.openIntent(), t('hint.item.menu.intent'));
  if (app.can('plan_new')) add('plan.new', t('plan.new.button'), () => app.openPlanWizard());
  if (app.canMakeMeetings) add('meeting.new', t('palette.meeting_new'), () => app.openMeetingForm({ tasks: app.selectedId === null ? [] : [app.selectedId] }));

  // The task that is selected: what the keys of the board and the form do, by name.
  const selected = app.selectedId === null ? undefined : app.tasks.find((x) => x.id === app.selectedId);
  if (selected) {
    const id = selected.id;
    add('task.finish', t('palette.finish'), () => app.startFinish(id), id);
    if (app.can('plan_for')) add('task.graph', t('graph.button'), () => app.openGraph(id), id);
    if (app.aiFeatures && app.agentBlocked === null) add('task.agent', t('palette.agent'), () => app.openAgent(id), id);
    for (const status of app.ranges.statuses) {
      if (status === selected.status) continue;
      // A status of the board goes the way of its column (blocked asks for the blocker); another one is a field.
      const run = isColumn(status) ? () => app.dropOnColumn(id, status) : () => app.setField(id, 'status', status);
      add(`task.status.${status}`, t('palette.status', { status: labelOf(app.lang, 'status', status) }), run, id);
    }
    for (const prio of app.ranges.prios) {
      if (prio === selected.prio) continue;
      add(`task.prio.${prio}`, t('palette.prio', { prio }), () => app.setField(id, 'prio', prio), id);
    }
  }

  add('go.today', t('palette.go', { view: t('nav.today') }), () => app.setView('today'));
  add('go.list', t('palette.go', { view: t('nav.list') }), () => app.setView('list'));
  if (app.can('reorder')) add('go.board', t('palette.go', { view: t('nav.board') }), () => app.setView('board'));
  add('go.plan', t('palette.go', { view: t('nav.plan') }), () => app.setView('plan'));
  add('go.inbox', t('palette.go', { view: t('nav.inbox') }), () => app.setView('inbox'));
  add('go.abnahme', t('palette.go', { view: t('nav.abnahme') }), () => app.setView('abnahme'));
  add('go.cross', t('palette.go', { view: t('nav.cross') }), () => app.setView('cross'));
  add('go.calendar', t('palette.go', { view: t('nav.calendar') }), () => app.setView('calendar'));
  add('go.timeline', t('palette.go', { view: t('nav.timeline') }), () => app.setView('timeline'));
  add('go.reminders', t('palette.go', { view: t('nav.reminders') }), () => app.setView('reminders'));
  add('go.stats', t('palette.go', { view: t('nav.stats') }), () => app.setView('stats'));
  if (app.can('finished')) add('go.done', t('palette.go', { view: t('nav.done') }), () => app.setView('done'));
  add('go.repos', t('palette.go', { view: t('nav.repos') }), () => app.setView('repos'));
  if (app.machineActions) add('go.repostatus', t('palette.go', { view: t('nav.repostatus') }), () => app.setView('repostatus'));
  // The views of the tab Learning plans that are offered now, each by its name (learnViews.ts).
  for (const { views } of learnMenu({ can: (c) => app.can(c), gamification: app.gamification })) {
    // "Overview" alone says not of what: in the palette it is the overview of the learning plans.
    for (const id of views) add(`go.${id}`, t('palette.go', { view: t(id === 'learn' ? 'nav.learn_long' : (`nav.${id}` as Key)) }), () => app.setView(id as View));
  }
  if (app.can('views')) {
    add('go.views', t('palette.go', { view: t('nav.views') }), () => app.setView('views'));
    // Every saved view of the vault, by its name.
    for (const view of app.viewsState.list) add(`view.${view.id}`, t('palette.view', { name: view.title }), () => app.openView(view.id), view.id);
    // The list as it is filtered, grouped by a field the engine names (a view to look with: nothing is saved). Not
    // under `view.`: that is the key of a saved view, whose id names an area (see `App.chose`).
    for (const { field } of app.viewsState.groupingsShown?.fields ?? []) {
      if (!isViewField(field)) continue;
      const name = t(`views.field.${field}` as Key);
      add(`group.${field}`, t('palette.group_by', { field: name }), () =>
        app.tryView({
          title: t('views.list_by', { field: name }),
          display: 'columns',
          group_by: field,
          collapsed: [],
          select: selectOfFilter(app.filter, { projects: app.viewsState.selectsProjects }).select,
        }),
      );
    }
  }
  if (app.can('check')) add('check.open', t('check.open'), () => app.openChecks());
  if (app.can('estimate') && app.view === 'list') add('matrix.open', t('matrix.open'), () => app.openMatrix());

  // The export of what the view shows, by format and way out (the same entries as the button of the view), only where
  // the view shows tasks.
  for (const [format, name] of app.exportable ? ([['csv', 'CSV'], ['json', 'JSON'], ['markdown', 'Markdown']] as const) : []) {
    add(`export.save.${format}`, t('palette.export', { what: t('export.save', { format: name }) }), () => app.exportView(format, 'save'));
    add(`export.copy.${format}`, t('palette.export', { what: t('export.copy', { format: name }) }), () => app.exportView(format, 'copy'));
  }
  if (app.exportable) add('export.print', t('palette.export', { what: t('export.print') }), () => app.printView());
  if (app.exportable && app.canPng) add('export.png', t('palette.export', { what: t('export.png') }), () => app.pngView());

  if (app.conflicts.length > 0) add('conflicts.show', t('palette.conflicts', { n: app.conflicts.length }), () => app.openConflicts());
  add('rescan', t('menu.rescan'), () => app.focused());
  add('about', t('menu.about'), () => app.openAbout('info'));
  add('report', t('menu.report'), () => app.openAbout('report'));
  add('marks.all', t('bulk.all'), () => {
    app.setView('list');
    app.markShown();
  });
  if (app.marks.length > 0) add('marks.clear', t('bulk.clear'), () => app.clearMarks());
  add('filter.reset', t('palette.filter_reset'), () => app.resetFilter());
  // The named lists: the ones kept in this browser, then the ones of the engine. Each shows the list with its filter and order.
  for (const list of app.lists) {
    add(`list.mine.${list.name}`, t('palette.list', { name: list.name }), () => {
      app.setView('list');
      app.applyList(list.name);
    });
  }
  for (const list of app.engineLists) {
    add(`list.engine.${list.name}`, t('palette.list_engine', { name: list.name }), () => {
      app.setView('list');
      app.applyEngineList(list.name);
    }, list.summary);
  }

  add('lang.de', t('palette.lang', { name: 'Deutsch' }), () => app.setLang('de'));
  add('lang.en', t('palette.lang', { name: 'English' }), () => app.setLang('en'));
  for (const theme of ['auto', 'light', 'dark'] as const) {
    add(`theme.${theme}`, t('palette.theme', { name: t(`theme.${theme}` as Key) }), () => app.setTheme(theme));
  }
  // Every tag the open tasks carry: the list filtered by it. Last: an empty palette shows its first entries only,
  // and a vault has many tags.
  for (const { tag, count } of tagCounts(app.tasks)) add(`tag.${tag}`, t('palette.tag', { tag }), () => app.showTag(tag), t('tags.count', { n: count }));
  return out;
}

/**
 * Whether a typed line could name a meeting: it has a digit (a day, a time, a length) or a word of a day (`morgen`,
 * `Mo`, `tomorrow`). Only that decides whether the line is offered; what it means is the engine's to read. Words that
 * name no time (a search for a task) are not offered, so the palette still says when nothing matches.
 */
export function looksLikeMeeting(line: string): boolean {
  if (/\d/.test(line)) return true;
  return line
    .toLowerCase()
    .split(/\s+/)
    .some((word) => DAY_WORDS.has(word.replace(/[.,]$/, '')));
}

const DAY_WORDS: ReadonlySet<string> = new Set([
  'heute', 'morgen', 'übermorgen', 'mo', 'di', 'mi', 'do', 'fr', 'sa', 'so', 'montag', 'dienstag', 'mittwoch',
  'donnerstag', 'freitag', 'samstag', 'sonntag', 'today', 'tomorrow', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]);

/**
 * The quick capture of a meeting (concept 5.4): what is typed into the palette, offered as a line the engine reads into
 * the form of a new meeting. Only for a line that could name one (`looksLikeMeeting`); nothing is saved.
 */
export function quickMeetingAction(app: App, query: string): PaletteAction | null {
  const line = query.trim();
  if (line.length < 3 || line.length > 1000 || !looksLikeMeeting(line) || !app.canMakeMeetings || !app.can('meeting_parse')) return null;
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);
  return { key: 'meeting.quick', label: t('palette.meeting_quick', { line }), hint: t('hint.palette.meeting_quick'), run: () => app.quickMeeting(line) };
}
