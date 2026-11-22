// The words of the view "Learning time" (`views/LearnTimeView.svelte`), English and German. They live here and not in
// `i18n`: the view is a chunk of its own, and its words come with it instead of with the start of the page (the start
// has a budget, tools/check-bundle-size.py). The menu entry and its hint stay in `i18n`.
import type { Lang } from './i18n';

const EN = {
  'learntime.title': 'Learning time',
  'learntime.intro':
    'The hours each learning path plans ({h=N} on a point) against the hours done ({done_h=N}), what is left, and how many weeks the rest takes at the pace of the last four weeks. The engine counts every figure.',
  'learntime.project': 'Project',
  'learntime.project.all': 'All projects',
  'learntime.table': 'Planned and done hours of {n} paths',
  'learntime.col.path': 'Path',
  'learntime.col.planned': 'Planned',
  'learntime.col.done': 'Done',
  'learntime.col.left': 'Left',
  'learntime.col.bar': 'Done of planned',
  'learntime.col.forecast': 'Done in',
  'learntime.h': '{n} h',
  'learntime.over': '+{n} h over the plan',
  'learntime.over_short': '+{n} h',
  'learntime.within': '{percent} % of the plan',
  'learntime.weeks': '~{n} weeks',
  'learntime.weeks_one': '~1 week',
  'learntime.weeks_span': '~{min}–{max} weeks',
  'learntime.no_pace': 'no pace yet',
  'learntime.no_pace_hint': 'The forecast needs four weeks of the learning series and some progress in them.',
  'learntime.sessions': 'Sessions',
  'learntime.sessions_of': 'Sessions of {title}',
  'learntime.sessions_none': 'No session: a point with {h=N} as a root or one level below is one.',
  'learntime.sessions_failed': 'The sessions could not be read.',
  'learntime.sessions_reading': 'Reading the sessions …',
  'learntime.col.session': 'Session',
  'learntime.col.state': 'State',
  'learntime.col.result': 'Result',
  'learntime.state.open': 'open',
  'learntime.state.partial': 'partly',
  'learntime.state.done': 'done',
  'learntime.closed': '{closed} of {total} closed',
  'learntime.open_path': 'Open {title}',
  'learntime.none': 'No hours planned.',
  'learntime.none_how': '{h=N} on a point plans it (a span: {h=8-10}); {done_h=N} records what was done.',
  'learntime.to_paths': 'To the learning paths',
  'learntime.none_filtered': 'No path of this project plans hours.',
  'learntime.no_engine': 'The engine of this hub does not count the hours of the paths (tasks.nvim with the capability path_hours).',
  'learntime.failed': 'The learning paths could not be read.',
  'learntime.retry': 'Read again',
  'learntime.reading': 'Reading the learning paths …',
  'learntime.hint.project': 'Only the paths of one project.',
};

type LearnTimeKey = keyof typeof EN;

const DE: Record<LearnTimeKey, string> = {
  'learntime.title': 'Lernzeit',
  'learntime.intro':
    'Die Stunden, die jeder Lernpfad plant ({h=N} an einem Punkt), gegen die geleisteten ({done_h=N}), was übrig ist und wie viele Wochen der Rest beim Tempo der letzten vier Wochen braucht. Jede Zahl zählt die Engine.',
  'learntime.project': 'Projekt',
  'learntime.project.all': 'Alle Projekte',
  'learntime.table': 'Geplante und geleistete Stunden von {n} Pfaden',
  'learntime.col.path': 'Pfad',
  'learntime.col.planned': 'Geplant',
  'learntime.col.done': 'Geleistet',
  'learntime.col.left': 'Rest',
  'learntime.col.bar': 'Geleistet vom Plan',
  'learntime.col.forecast': 'Fertig in',
  'learntime.h': '{n} h',
  'learntime.over': '+{n} h über dem Plan',
  'learntime.over_short': '+{n} h',
  'learntime.within': '{percent} % des Plans',
  'learntime.weeks': '~{n} Wochen',
  'learntime.weeks_one': '~1 Woche',
  'learntime.weeks_span': '~{min}–{max} Wochen',
  'learntime.no_pace': 'noch kein Tempo',
  'learntime.no_pace_hint': 'Die Prognose braucht vier Wochen der Lernreihe und etwas Fortschritt darin.',
  'learntime.sessions': 'Sitzungen',
  'learntime.sessions_of': 'Sitzungen von {title}',
  'learntime.sessions_none': 'Keine Sitzung: ein Punkt mit {h=N} als Wurzel oder eine Ebene darunter ist eine.',
  'learntime.sessions_failed': 'Die Sitzungen ließen sich nicht lesen.',
  'learntime.sessions_reading': 'Die Sitzungen werden gelesen …',
  'learntime.col.session': 'Sitzung',
  'learntime.col.state': 'Stand',
  'learntime.col.result': 'Ergebnis',
  'learntime.state.open': 'offen',
  'learntime.state.partial': 'teilweise',
  'learntime.state.done': 'fertig',
  'learntime.closed': '{closed} von {total} erledigt',
  'learntime.open_path': '{title} öffnen',
  'learntime.none': 'Keine Stunden geplant.',
  'learntime.none_how': '{h=N} an einem Punkt plant ihn ein (eine Spanne: {h=8-10}); {done_h=N} hält fest, was geleistet ist.',
  'learntime.to_paths': 'Zu den Lernpfaden',
  'learntime.none_filtered': 'Kein Pfad dieses Projekts plant Stunden.',
  'learntime.no_engine': 'Die Engine dieses Hubs zählt keine Stunden der Pfade (tasks.nvim mit der Fähigkeit path_hours).',
  'learntime.failed': 'Die Lernpfade ließen sich nicht lesen.',
  'learntime.retry': 'Neu lesen',
  'learntime.reading': 'Die Lernpfade werden gelesen …',
  'learntime.hint.project': 'Nur die Pfade eines Projekts.',
};

export type { LearnTimeKey };

/** Whether `key` is a word of the view (else one of the page, `i18n`). */
export function isLearnTimeKey(key: string): key is LearnTimeKey {
  return Object.hasOwn(EN, key);
}

/** A word of the view; `{h=N}` and the like in a text stay as written (only the named values are put in). */
export function learnTimeText(lang: Lang, key: LearnTimeKey, params: Record<string, string | number> = {}): string {
  const text: string = lang === 'de' ? DE[key] : EN[key];
  return text.replace(/\{(\w+)\}/g, (all, k: string) => (k in params ? String(params[k]) : all));
}
