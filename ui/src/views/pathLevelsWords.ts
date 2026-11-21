// The words of the form of the levels of a path (PathLevels.svelte), in both languages. They are here and not in
// `i18n-de`/`i18n-en` because only that form, which is loaded on demand, uses them: in the tables of the language they
// would be parsed at every start (tools/check-bundle-size.py; the start is at its budget). The words the path view
// itself shows (the button, the title of the form) stay in the tables.

import type { Lang } from '../lib/i18n';

const WORDS = {
  de: {
    'hint': 'Optional. Ein Level ist erreicht ab seiner Schwelle in XP oder in Prozent der möglichen XP; die Schwellen steigen. Die Engine schreibt den Abschnitt „## Level“.',
    'empty': 'Noch keine Level.',
    'threshold': 'Schwelle',
    'unit': 'Einheit der Schwelle',
    'threshold_invalid': 'Eine ganze Zahl ab 1.',
    'name': 'Name',
    'badge': 'Abzeichen',
    'no_badge': '(keins)',
    'no_badges': 'Abzeichen sind Bilder im Ordner assets/badges/ des Pfads; dort liegt noch keins.',
    'reward': 'Belohnung',
    'up': 'Level {n} nach oben',
    'down': 'Level {n} nach unten',
    'remove': 'Level {n} entfernen',
    'remove_short': 'Entfernen',
    'add': 'Level hinzufügen',
    'done': 'Ganzer Pfad',
    'done_on': 'Eine Belohnung, wenn der ganze Pfad fertig ist',
    'save': 'Level speichern',
    'cancel': 'Abbrechen',
    'hint.form': 'Die Level des Pfads; die Engine schreibt sie in den Abschnitt „## Level“ und prüft sie.',
    'hint.threshold': 'Ab wie vielen XP (oder Prozent der möglichen XP) das Level erreicht ist. Die Schwellen steigen von Level zu Level.',
    'hint.name': 'Ein Name für das Level, optional.',
    'hint.badge': 'Ein Bild aus assets/badges/ des Pfads, gezeigt, sobald das Level erreicht ist; optional.',
    'hint.reward': 'Was du dir gönnst, wenn das Level erreicht ist; optional. „Gegönnt“ hakt es ab.',
    'hint.done': 'Eine Belohnung, wenn jeder Punkt des Pfads erledigt ist.',
  },
  en: {
    'hint': 'Optional. A level is reached at its threshold in XP or in percent of the possible XP; the thresholds rise. The engine writes the section "## Level".',
    'empty': 'No levels yet.',
    'threshold': 'Threshold',
    'unit': 'Unit of the threshold',
    'threshold_invalid': 'A whole number from 1.',
    'name': 'Name',
    'badge': 'Badge',
    'no_badge': '(none)',
    'no_badges': 'Badges are pictures in the folder assets/badges/ of the path; there is none yet.',
    'reward': 'Reward',
    'up': 'Move level {n} up',
    'down': 'Move level {n} down',
    'remove': 'Remove level {n}',
    'remove_short': 'Remove',
    'add': 'Add a level',
    'done': 'Whole path',
    'done_on': 'A reward when the whole path is done',
    'save': 'Save levels',
    'cancel': 'Cancel',
    'hint.form': 'The levels of the path; the engine writes them into the section "## Level" and checks them.',
    'hint.threshold': 'From how many XP (or percent of the possible XP) the level is reached. The thresholds rise from level to level.',
    'hint.name': 'A name for the level, optional.',
    'hint.badge': 'A picture from assets/badges/ of the path, shown once the level is reached; optional.',
    'hint.reward': 'What you treat yourself to when the level is reached; optional. "Granted" ticks it off.',
    'hint.done': 'A reward when every point of the path is closed.',
  },
} as const;

export type LevelWord = keyof (typeof WORDS)['en'];

/** A word of the form in the language of the page, `{name}` filled from `params`. */
export function levelWord(lang: Lang, key: LevelWord, params: Record<string, string | number> = {}): string {
  const table: Record<LevelWord, string> = lang === 'de' ? WORDS.de : WORDS.en;
  return table[key].replace(/\{(\w+)\}/g, (all, name: string) => (name in params ? String(params[name]) : all));
}
