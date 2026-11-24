// The words of the view "Notes & sources" (`views/LearnNotesView.svelte`), English and German. They live here and not
// in `i18n`: the view is a chunk of its own, and its words come with it instead of with the start of the page (the start
// has a budget, tools/check-bundle-size.py). The menu entry and its hint stay in `i18n`.
import type { Lang } from './i18n';

const EN = {
  'learnnotes.title': 'Notes & sources',
  'learnnotes.intro':
    'The notes (the > lines below a point), links and images of the learning points of every path, in one place. The engine searches the label, the note and the link; Enter on a hit opens the point in its path.',
  'learnnotes.search': 'Search notes and sources',
  'learnnotes.search_placeholder': 'Search … (/)',
  'learnnotes.kind': 'Show',
  'learnnotes.kind.all': 'All',
  'learnnotes.kind.note': 'Notes',
  'learnnotes.kind.link': 'Links',
  'learnnotes.kind.image': 'Images',
  'learnnotes.path': 'Path',
  'learnnotes.path.all': 'All paths',
  'learnnotes.competence': 'Competence',
  'learnnotes.competence.all': 'All competences',
  'learnnotes.state': 'State',
  'learnnotes.state.all': 'Every state',
  'learnnotes.state.open': 'open',
  'learnnotes.state.learned': 'learned',
  'learnnotes.state.seen': 'seen',
  'learnnotes.state.dropped': 'does not apply',
  'learnnotes.state.blocked': 'blocked',
  'learnnotes.state.partial': 'partly',
  'learnnotes.done': 'Finished paths too',
  'learnnotes.list': '{n} hits',
  'learnnotes.count': '{n} hits',
  'learnnotes.count_one': '1 hit',
  'learnnotes.truncated': 'Showing {shown} of {total}: narrow the search to see the rest.',
  'learnnotes.open': 'Open in the path: {crumbs}',
  'learnnotes.crumbs': '{path} › {stage} › {point}',
  'learnnotes.path_done': 'finished path',
  'learnnotes.more': 'more',
  'learnnotes.less': 'less',
  'learnnotes.more_of': 'The whole note of {point}',
  'learnnotes.link': 'Link',
  'learnnotes.image': 'Image: {name}',
  'learnnotes.none': 'No notes yet.',
  'learnnotes.none_how': 'A note on a learning point (a > line below it), a link or an image shows up here.',
  'learnnotes.to_paths': 'To the learning paths',
  'learnnotes.no_hit': 'Nothing matches "{text}".',
  'learnnotes.no_hit_filtered': 'No hit with these filters.',
  'learnnotes.no_engine': 'The engine of this hub does not gather the notes of the paths (tasks.nvim with the capability learn_notes).',
  'learnnotes.failed': 'The notes could not be read.',
  'learnnotes.retry': 'Read again',
  'learnnotes.reading': 'Reading the notes …',
  'learnnotes.incomplete': 'Not every area could be read: {list}',
  'learnnotes.too_long': 'The search is too long: at most 200 bytes (fewer characters with umlauts or emoji).',
  'learnnotes.hint.search': 'A part of the label, the note or the link, without case; the engine searches once you pause (Enter: at once). / puts the focus here.',
  'learnnotes.hint.kind': 'Only the points with a note, a link or an image.',
  'learnnotes.hint.path': 'Only the points of one path.',
  'learnnotes.hint.competence': 'Only the paths that serve this competence (competence: in the path).',
  'learnnotes.hint.state': 'Only the points in this state.',
  'learnnotes.hint.done': 'The finished paths of the Backlogs too.',
};

type LearnNotesKey = keyof typeof EN;

const DE: Record<LearnNotesKey, string> = {
  'learnnotes.title': 'Notizen & Quellen',
  'learnnotes.intro':
    'Die Notizen (die > Zeilen unter einem Punkt), Links und Bilder der Lernpunkte aller Pfade an einem Ort. Die Engine durchsucht Label, Notiz und Link; Enter auf einem Treffer öffnet den Punkt in seinem Pfad.',
  'learnnotes.search': 'Notizen und Quellen durchsuchen',
  'learnnotes.search_placeholder': 'Suchen … (/)',
  'learnnotes.kind': 'Zeigen',
  'learnnotes.kind.all': 'Alle',
  'learnnotes.kind.note': 'Notizen',
  'learnnotes.kind.link': 'Links',
  'learnnotes.kind.image': 'Bilder',
  'learnnotes.path': 'Pfad',
  'learnnotes.path.all': 'Alle Pfade',
  'learnnotes.competence': 'Kompetenz',
  'learnnotes.competence.all': 'Alle Kompetenzen',
  'learnnotes.state': 'Stand',
  'learnnotes.state.all': 'Jeder Stand',
  'learnnotes.state.open': 'offen',
  'learnnotes.state.learned': 'gelernt',
  'learnnotes.state.seen': 'angeschaut',
  'learnnotes.state.dropped': 'nicht zutreffend',
  'learnnotes.state.blocked': 'blockiert',
  'learnnotes.state.partial': 'teilweise',
  'learnnotes.done': 'Auch fertige Pfade',
  'learnnotes.list': '{n} Treffer',
  'learnnotes.count': '{n} Treffer',
  'learnnotes.count_one': '1 Treffer',
  'learnnotes.truncated': '{shown} von {total} gezeigt: die Suche eingrenzen, um den Rest zu sehen.',
  'learnnotes.open': 'Im Pfad öffnen: {crumbs}',
  'learnnotes.crumbs': '{path} › {stage} › {point}',
  'learnnotes.path_done': 'fertiger Pfad',
  'learnnotes.more': 'mehr',
  'learnnotes.less': 'weniger',
  'learnnotes.more_of': 'Die ganze Notiz von {point}',
  'learnnotes.link': 'Link',
  'learnnotes.image': 'Bild: {name}',
  'learnnotes.none': 'Keine Notizen.',
  'learnnotes.none_how': 'Eine Notiz an einem Lernpunkt (eine > Zeile darunter), ein Link oder ein Bild erscheint hier.',
  'learnnotes.to_paths': 'Zu den Lernpfaden',
  'learnnotes.no_hit': 'Nichts passt zu „{text}“.',
  'learnnotes.no_hit_filtered': 'Kein Treffer mit diesen Filtern.',
  'learnnotes.no_engine': 'Die Engine dieses Hubs sammelt keine Notizen der Pfade (tasks.nvim mit der Fähigkeit learn_notes).',
  'learnnotes.failed': 'Die Notizen ließen sich nicht lesen.',
  'learnnotes.retry': 'Neu lesen',
  'learnnotes.reading': 'Die Notizen werden gelesen …',
  'learnnotes.incomplete': 'Nicht jeder Bereich ließ sich lesen: {list}',
  'learnnotes.too_long': 'Die Suche ist zu lang: höchstens 200 Bytes (mit Umlauten oder Emoji weniger Zeichen).',
  'learnnotes.hint.search': 'Ein Teil von Label, Notiz oder Link, ohne Groß/Klein; die Engine sucht, sobald du innehältst (Enter: sofort). / setzt den Fokus hierher.',
  'learnnotes.hint.kind': 'Nur die Punkte mit Notiz, Link oder Bild.',
  'learnnotes.hint.path': 'Nur die Punkte eines Pfads.',
  'learnnotes.hint.competence': 'Nur die Pfade, die dieser Kompetenz dienen (competence: im Pfad).',
  'learnnotes.hint.state': 'Nur die Punkte in diesem Stand.',
  'learnnotes.hint.done': 'Auch die fertigen Pfade aus den Backlogs.',
};

export type { LearnNotesKey };

/** Whether `key` is a word of the view (else one of the page, `i18n`). */
export function isLearnNotesKey(key: string): key is LearnNotesKey {
  return Object.hasOwn(EN, key);
}

export function learnNotesText(lang: Lang, key: LearnNotesKey, params: Record<string, string | number> = {}): string {
  const text: string = lang === 'de' ? DE[key] : EN[key];
  return text.replace(/\{(\w+)\}/g, (all, k: string) => (Object.hasOwn(params, k) ? String(params[k]) : all));
}
