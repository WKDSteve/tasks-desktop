// The words of the view "Next learning step" (`views/LearnNextView.svelte`), English and German. They live here and not
// in `i18n`: the view is a chunk of its own, and its words come with it instead of with the start of the page (the start
// has a budget, tools/check-bundle-size.py). The menu entry and its hint stay in `i18n`.
import type { Lang } from './i18n';

const EN = {
  'learnnext.title': 'Next learning step',
  'learnnext.intro':
    'For every running learning path the next point you can learn now: open, not blocked, not optional, in the order of the file. The engine chooses it; the paths that saw activity last come first. Mark it here without looking for the path.',
  'learnnext.keys': 'On a card: l learned, s seen, n does not apply, Enter opens it in the path.',
  'learnnext.project': 'Project',
  'learnnext.project.all': 'All projects',
  'learnnext.machine': 'Machine',
  'learnnext.machine.all': 'Every machine',
  'learnnext.machine.private': 'Private computer',
  'learnnext.machine.workstation': 'Workstation',
  'learnnext.machine.wsl': 'WSL',
  'learnnext.list': 'Next steps of {n} paths',
  'learnnext.card': '{path}: {point}',
  'learnnext.stage': 'Stage: {label}',
  'learnnext.path_stage.doing': 'in progress',
  'learnnext.path_stage.idle': 'project running, path not started',
  'learnnext.hours': '{h} h planned',
  'learnnext.xp': '{n} XP',
  'learnnext.safety': 'Safety',
  'learnnext.safety_hint': 'This point is marked {safety}: closing it asks you to confirm first.',
  'learnnext.machines': 'On: {list}',
  'learnnext.promoted': 'Task {id}',
  'learnnext.source': 'Source: {host}',
  'learnnext.learned': 'Learned',
  'learnnext.seen': 'Seen…',
  'learnnext.dropped': 'Does not apply…',
  'learnnext.open': 'Open in the path',
  'learnnext.learned_of': 'Learned: {label}',
  'learnnext.seen_of': 'Seen: {label}',
  'learnnext.dropped_of': 'Does not apply: {label}',
  'learnnext.open_of': 'Open {label} in the path',
  'learnnext.reason.seen': 'Why was it only looked at?',
  'learnnext.reason.dropped': 'Why does it not apply?',
  'learnnext.reason.save': 'Save',
  'learnnext.reason.cancel': 'Cancel',
  'learnnext.reason.required': 'A reason is needed.',
  'learnnext.confirm': 'This point concerns safety. Mark it as {state}?',
  'learnnext.confirm.yes': 'Yes, mark it',
  'learnnext.confirm.no': 'Cancel',
  'learnnext.state.learned': 'learned',
  'learnnext.state.seen': 'seen',
  'learnnext.after': 'After that ({n})',
  'learnnext.none': 'Everything learned, or nothing started.',
  'learnnext.none_how':
    'A path shows up here once it runs: a point of it learned or seen, status: doing, or its project doing. Open the learning paths and begin one.',
  'learnnext.none_filtered': 'No running path of this project has a next step.',
  'learnnext.begin': 'Begin a learning path',
  'learnnext.no_engine': 'The engine of this hub does not choose the next step (tasks.nvim with the capability learn_next).',
  'learnnext.failed': 'The next steps could not be read.',
  'learnnext.retry': 'Read again',
  'learnnext.reading': 'Reading the next steps …',
  'learnnext.saving': 'Saving…',
  'learnnext.incomplete': 'Not every area could be read: {list}',
  'learnnext.hint.project': 'Only the paths of one project.',
  'learnnext.hint.machine': 'Only the points that may be practised on this machine; the engine leaves out the others ({machine=...}).',
  'learnnext.hint.reason': 'Why it is only seen, or does not apply: one line, written beside the point in the file.',
};

type LearnNextKey = keyof typeof EN;

const DE: Record<LearnNextKey, string> = {
  'learnnext.title': 'Nächster Lernschritt',
  'learnnext.intro':
    'Für jeden laufenden Lernpfad der nächste Punkt, den du jetzt lernen kannst: offen, nicht blockiert, nicht optional, in der Reihenfolge der Datei. Die Engine wählt ihn; die zuletzt aktiven Pfade stehen oben. Hier abhaken, ohne den Pfad zu suchen.',
  'learnnext.keys': 'Auf einer Karte: l gelernt, s angeschaut, n nicht zutreffend, Enter öffnet sie im Pfad.',
  'learnnext.project': 'Projekt',
  'learnnext.project.all': 'Alle Projekte',
  'learnnext.machine': 'Maschine',
  'learnnext.machine.all': 'Jede Maschine',
  'learnnext.machine.private': 'Privater Rechner',
  'learnnext.machine.workstation': 'Workstation',
  'learnnext.machine.wsl': 'WSL',
  'learnnext.list': 'Nächste Schritte aus {n} Pfaden',
  'learnnext.card': '{path}: {point}',
  'learnnext.stage': 'Stufe: {label}',
  'learnnext.path_stage.doing': 'läuft',
  'learnnext.path_stage.idle': 'Projekt läuft, Pfad nicht begonnen',
  'learnnext.hours': '{h} h geplant',
  'learnnext.xp': '{n} XP',
  'learnnext.safety': 'Sicherheit',
  'learnnext.safety_hint': 'Dieser Punkt trägt {safety}: vor dem Abhaken fragt die Seite nach.',
  'learnnext.machines': 'Auf: {list}',
  'learnnext.promoted': 'Aufgabe {id}',
  'learnnext.source': 'Quelle: {host}',
  'learnnext.learned': 'Gelernt',
  'learnnext.seen': 'Angeschaut…',
  'learnnext.dropped': 'Nicht zutreffend…',
  'learnnext.open': 'Im Pfad öffnen',
  'learnnext.learned_of': 'Gelernt: {label}',
  'learnnext.seen_of': 'Angeschaut: {label}',
  'learnnext.dropped_of': 'Nicht zutreffend: {label}',
  'learnnext.open_of': '{label} im Pfad öffnen',
  'learnnext.reason.seen': 'Warum nur angeschaut?',
  'learnnext.reason.dropped': 'Warum trifft es nicht zu?',
  'learnnext.reason.save': 'Speichern',
  'learnnext.reason.cancel': 'Abbrechen',
  'learnnext.reason.required': 'Ein Grund ist nötig.',
  'learnnext.confirm': 'Dieser Punkt betrifft die Sicherheit. Als {state} markieren?',
  'learnnext.confirm.yes': 'Ja, markieren',
  'learnnext.confirm.no': 'Abbrechen',
  'learnnext.state.learned': 'gelernt',
  'learnnext.state.seen': 'angeschaut',
  'learnnext.after': 'Danach ({n})',
  'learnnext.none': 'Alles gelernt oder nichts begonnen.',
  'learnnext.none_how':
    'Ein Pfad erscheint hier, sobald er läuft: ein Punkt gelernt oder angeschaut, status: doing oder sein Projekt auf doing. Öffne die Lernpfade und beginne einen.',
  'learnnext.none_filtered': 'Kein laufender Pfad dieses Projekts hat einen nächsten Schritt.',
  'learnnext.begin': 'Lernpfad beginnen',
  'learnnext.no_engine': 'Die Engine dieses Hubs wählt keinen nächsten Schritt (tasks.nvim mit der Fähigkeit learn_next).',
  'learnnext.failed': 'Die nächsten Schritte ließen sich nicht lesen.',
  'learnnext.retry': 'Neu lesen',
  'learnnext.reading': 'Die nächsten Schritte werden gelesen …',
  'learnnext.saving': 'Wird gespeichert…',
  'learnnext.incomplete': 'Nicht jeder Bereich ließ sich lesen: {list}',
  'learnnext.hint.project': 'Nur die Pfade eines Projekts.',
  'learnnext.hint.machine': 'Nur die Punkte, die auf dieser Maschine geübt werden können; die anderen lässt die Engine weg ({machine=...}).',
  'learnnext.hint.reason': 'Warum nur angeschaut oder nicht zutreffend: eine Zeile, sie steht dann neben dem Punkt in der Datei.',
};

export type { LearnNextKey };

/** Whether `key` is a word of the view (else one of the page, `i18n`). */
export function isLearnNextKey(key: string): key is LearnNextKey {
  return Object.hasOwn(EN, key);
}

export function learnNextText(lang: Lang, key: LearnNextKey, params: Record<string, string | number> = {}): string {
  const text: string = lang === 'de' ? DE[key] : EN[key];
  return text.replace(/\{(\w+)\}/g, (all, k: string) => (k in params ? String(params[k]) : all));
}
