// The words of the task float of a learning point (PathExercise.svelte), English and German. They come with the chunk
// of the float, not with the start of the page (its budget, tools/check-bundle-size.py).
import type { Lang } from '../lib/i18n';

const EN = {
  'ex.open': 'Open the task of {label}',
  'ex.title': 'Task: {label}',
  'ex.aufgabe': 'Task',
  'ex.fertig': 'Done when',
  'ex.nachweis': 'Proof',
  'ex.ergebnis': 'Result',
  'ex.ergebnis_hint': 'Enter your proof here; ticking the point off needs it.',
  'ex.none': 'This point has no task text yet. Tick it off in the list as before, or write the task into the note of the point.',
  'ex.hint': 'Your proof of this exercise, written into the note of the point below its task. Ticking the point off needs it when a proof is asked for; Ctrl+Enter ticks it off; Escape closes.',
  'ex.save': 'Save result',
  'ex.learned': 'Save and mark as learned',
  'ex.tick': 'Mark as learned',
  'ex.untick': 'Set open again',
  'ex.close': 'Close',
  'ex.required': 'Enter your result first: this point is learned with a proof.',
  'ex.refused': 'The engine refused: {message}',
  'ex.needs_result': 'The point needs a result before it can be learned (its proof is written in the field below).',
  'ex.read_only': 'The note of this point cannot be written here.',
  'ex.state': 'State: {state}',
} as const;

export type ExerciseWord = keyof typeof EN;

const DE: Record<ExerciseWord, string> = {
  'ex.open': 'Aufgabe von {label} öffnen',
  'ex.title': 'Aufgabe: {label}',
  'ex.aufgabe': 'Aufgabe',
  'ex.fertig': 'Fertig, wenn',
  'ex.nachweis': 'Nachweis',
  'ex.ergebnis': 'Ergebnis',
  'ex.ergebnis_hint': 'Trage hier deinen Nachweis ein; zum Abhaken ist er nötig.',
  'ex.none': 'Dieser Punkt hat noch keinen Aufgabentext. Hake ihn wie bisher in der Liste ab, oder schreibe die Aufgabe in die Notiz des Punkts.',
  'ex.hint': 'Dein Nachweis zu dieser Aufgabe, in die Notiz des Punkts unter seiner Aufgabe geschrieben. Zum Abhaken nötig, wenn ein Nachweis verlangt ist; Strg+Eingabe hakt ab; Esc schließt.',
  'ex.save': 'Ergebnis speichern',
  'ex.learned': 'Speichern und als gelernt markieren',
  'ex.tick': 'Als gelernt markieren',
  'ex.untick': 'Wieder offen setzen',
  'ex.close': 'Schließen',
  'ex.required': 'Trage zuerst dein Ergebnis ein: dieser Punkt wird mit einem Nachweis gelernt.',
  'ex.refused': 'Die Engine hat abgelehnt: {message}',
  'ex.needs_result': 'Der Punkt braucht ein Ergebnis, bevor er gelernt sein kann (sein Nachweis steht im Feld unten).',
  'ex.read_only': 'Die Notiz dieses Punkts kann hier nicht geschrieben werden.',
  'ex.state': 'Stand: {state}',
};

export function exerciseWord(lang: Lang, key: ExerciseWord, params: Record<string, string | number> = {}): string {
  const text: string = lang === 'de' ? DE[key] : EN[key];
  return text.replace(/\{(\w+)\}/g, (all, k: string) => (Object.hasOwn(params, k) ? String(params[k]) : all));
}
