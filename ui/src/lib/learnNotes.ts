// The view "Notes & sources" (concept "Reiter Lernpläne" 11): the notes, links and images of the learning points of all
// paths, found by the engine (`tasks.learn_notes`, capability `learn_notes`; WEB-13). This file only cuts what is shown
// (a part of a long note around the first hit), marks the hits in it and narrows the list by what the person chose.

import type { LearnNotes } from './contract';

export type NoteItem = LearnNotes['items'][number];
export type NoteKind = '' | 'note' | 'link' | 'image';
export type NoteState = NoteItem['state'];

export const NOTE_STATES: readonly NoteState[] = ['open', 'learned', 'seen', 'dropped', 'blocked', 'partial'];

/** A text in parts, the hits of `query` apart (without case); one part without a hit when nothing matches. */
export function marked(text: string, query: string): { text: string; hit: boolean }[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [{ text, hit: false }];
  const lower = text.toLowerCase();
  // The lower-case text must line up with the text, character by character, for its places to be the text's.
  if (lower.length !== text.length) return [{ text, hit: false }];
  const parts: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (let found = lower.indexOf(q); found >= 0; found = lower.indexOf(q, found + q.length)) {
    if (found > at) parts.push({ text: text.slice(at, found), hit: false });
    parts.push({ text: text.slice(found, found + q.length), hit: true });
    at = found + q.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false });
  return parts.length > 0 ? parts : [{ text, hit: false }];
}

/** The longest part of a note shown before "more", in characters. */
export const SNIPPET = 240;

/**
 * A note as one line, cut to `max` characters around the first hit of `query` (from the start without one), with `…`
 * where it was cut; `cut` says whether there is more to show.
 */
export function snippet(note: string, query: string, max = SNIPPET): { text: string; cut: boolean } {
  const line = note.replace(/\s+/g, ' ').trim();
  const chars = [...line];
  if (chars.length <= max) return { text: line, cut: line !== note.trim() && /\n/.test(note.trim()) };
  const q = query.trim().toLowerCase();
  const lower = line.toLowerCase();
  const found = q === '' ? -1 : lower.indexOf(q);
  // In characters (code points), as `chars` counts them.
  const hit = found < 0 ? -1 : [...lower.slice(0, found)].length;
  // Start a little before the hit, so it stands in its sentence.
  const from = hit < 0 ? 0 : Math.max(0, Math.min(hit - Math.floor(max / 4), chars.length - max));
  const part = chars.slice(from, from + max).join('');
  return { text: `${from > 0 ? '…' : ''}${part}${from + max < chars.length ? '…' : ''}`, cut: true };
}

/** The most bytes of the search the engine takes (UTF-8, as the hub counts them). */
export const QUERY_MAX_BYTES = 200;

/** Whether a search is longer than the engine takes (the hub refuses it before the engine is asked). */
export function tooLong(query: string): boolean {
  return new TextEncoder().encode(query.trim()).length > QUERY_MAX_BYTES;
}

/** What the person narrowed the list to, beyond what the engine was asked. */
export interface NoteFilter {
  /** The ids of the paths that serve the chosen competence; null: no competence chosen. */
  paths: ReadonlySet<string> | null;
  /** The state of the point; '' every state. */
  state: NoteState | '';
}

export function narrowed(items: readonly NoteItem[], filter: NoteFilter): NoteItem[] {
  return items.filter((i) => (filter.paths === null || filter.paths.has(i.path)) && (filter.state === '' || i.state === filter.state));
}

/** The text of a label that is one Markdown link (`[text](url)`), else null: the title of a link beside its domain. */
export function linkTitle(label: string): string | null {
  const m = /^\s*\[([^\]]+)\]\([^)\s]+\)\s*$/.exec(label);
  return m ? m[1]! : null;
}

/** The file name of an image of a point (`assets/images/a.png` → `a.png`). */
export function imageName(file: string): string {
  return file.split('/').pop() ?? file;
}
