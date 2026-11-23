// The exercise block under a learning point (tasks.nvim `tasks_nvim.exercise`, vault note
// `ALL/Lernpunkt-Aufgabenblock-Format-2026-11-23.md`): the note of a point (its `> ` lines joined by newlines) holds up to
// four labelled parts. The page only takes the note apart to show it; whether a point may be ticked is the engine's
// (`learned` without a result is refused there, WEB-13): `needsResult` is the same question asked early, to open the
// float instead of sending a tick the engine would refuse.

/** What the person asked for in the float: a result to write, and/or the state to set after it. */
export interface ExerciseAction {
  result?: string;
  state?: 'learned' | 'open';
}

export type ExerciseKey = 'aufgabe' | 'fertig' | 'nachweis' | 'ergebnis';

export const LABELS: Record<ExerciseKey, string> = {
  aufgabe: 'Aufgabe',
  fertig: 'Fertig, wenn',
  nachweis: 'Nachweis',
  ergebnis: 'Ergebnis',
};

const KEY_OF = new Map<string, ExerciseKey>(Object.entries(LABELS).map(([key, label]) => [label.toLowerCase(), key as ExerciseKey]));

// `**Label:** rest` (the label may hold a comma and spaces: `Fertig, wenn`)
const LABEL_LINE = /^\s*\*\*([^*]*?):\*\*[ \t]*(.*?)\s*$/;

export type ExerciseParts = Partial<Record<ExerciseKey, string>>;

/**
 * The parts of a note: each present label with its text (the lines of a part joined by one space; an empty part is
 * `''`). Text before the first label and parts with an unknown label are no part of the block.
 */
export function parseExercise(note: string | undefined): ExerciseParts {
  const parts: ExerciseParts = {};
  if (!note) return parts;
  let current: ExerciseKey | undefined;
  for (const line of note.replace(/\r\n?/g, '\n').split('\n')) {
    const found = LABEL_LINE.exec(line);
    if (found) {
      current = KEY_OF.get(found[1]!.trim().toLowerCase());
      if (current) parts[current] = parts[current] === undefined ? found[2]! : `${parts[current]} ${found[2]!}`;
    } else if (current) {
      const text = line.trim();
      if (text !== '') parts[current] = `${parts[current] ?? ''} ${text}`.trim();
    }
  }
  for (const key of Object.keys(parts) as ExerciseKey[]) parts[key] = parts[key]!.trim();
  return parts;
}

/** Whether the note carries an exercise block: at least the part `Aufgabe` (as the engine's `has_block`). */
export function hasBlock(note: string | undefined): boolean {
  return parseExercise(note).aufgabe !== undefined;
}

/** Whether ticking the point needs a result: its block names a `Nachweis` and the `Ergebnis` is empty or missing. */
export function needsResult(note: string | undefined): boolean {
  const parts = parseExercise(note);
  return !!parts.nachweis && !parts.ergebnis;
}

const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;

/**
 * The note with its `**Ergebnis:**` part set to `text`: the part is replaced where it stands (its continuation lines
 * with it), or added after the last line. Every other line stays. `null` for a note without a block or a text with a
 * control character (the engine refuses both as well).
 */
export function withResult(note: string, text: string): string | null {
  if (!hasBlock(note)) return null;
  const result = text.replace(/\r\n?/g, '\n').trim();
  if (CONTROL.test(result)) return null;
  const lines = note.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  let first = -1;
  let last = -1;
  for (let i = 0; i < lines.length; i++) {
    const label = LABEL_LINE.exec(lines[i]!)?.[1]?.trim().toLowerCase();
    if (label === 'ergebnis' && first < 0) first = last = i;
    else if (first >= 0 && i === last + 1 && label === undefined) last = i;
    else if (first >= 0 && label !== undefined) break;
  }
  const written = result.split('\n');
  written[0] = `**${LABELS.ergebnis}:**${written[0] !== '' ? ` ${written[0]}` : ''}`;
  if (first >= 0) lines.splice(first, last - first + 1, ...written);
  else lines.push(...written);
  return lines.join('\n');
}
