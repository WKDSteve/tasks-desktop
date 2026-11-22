// The minutes of a meeting (concept 7.7): one field, and every entry one `meeting_capture` of the engine. What is typed
// is read here into entries (a shortcut names the kind), and what the engine wrote into `## Protokoll` is read back into
// lines with their time and kind. The page only shows; the engine writes the file (WEB-13).
import type { Op } from './api';
import { sectionText, withComments } from './meetings';

/** The kinds the engine takes (`meeting_capture`). */
export type CaptureKind = 'text' | 'task' | 'decision' | 'question' | 'board' | 'photo' | 'audio';

/** What a typed line becomes: the kind, its text, and a file below `assets/` for a photo, a board or audio. */
export interface Capture {
  kind: CaptureKind;
  text: string;
  asset?: string;
}

/**
 * The shortcuts of the field, each a word at the start of the line (case does not matter). A checklist `[] a; b; c`
 * gives a task per part; a mark `! …` stays a line of the minutes, shown as important. A line that ends with `?` is a
 * question.
 */
export interface Shortcuts {
  task: string;
  decision: string;
  question: string;
  checklist: string;
  mark: string;
}

export const DEFAULT_SHORTCUTS: Shortcuts = { task: 'A:', decision: 'B:', question: 'F:', checklist: '[]', mark: '!' };

/** Longest text of one entry, as the engine takes it (`meeting_write.MAX_CAPTURE`). */
export const MAX_CAPTURE = 2000;

/** Longest shortcut. */
const MAX_SHORTCUT = 8;

/** The kept shortcuts, or the defaults for each one that is missing, empty, too long, taken twice or has a space. */
export function parseShortcuts(raw: string | null): Shortcuts {
  let given: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) given = parsed as Record<string, unknown>;
  } catch {
    given = {};
  }
  const out: Shortcuts = { ...DEFAULT_SHORTCUTS };
  const taken = new Set<string>();
  for (const key of Object.keys(DEFAULT_SHORTCUTS) as (keyof Shortcuts)[]) {
    const value = given[key];
    const word = typeof value === 'string' ? value.trim() : '';
    if (word !== '' && word.length <= MAX_SHORTCUT && !/\s/.test(word) && !taken.has(word.toLowerCase())) out[key] = word;
    taken.add(out[key].toLowerCase());
  }
  // A default that a chosen one took: back to the defaults as a whole (two kinds never share a word).
  const words = Object.values(out).map((w) => w.toLowerCase());
  return new Set(words).size === words.length ? out : { ...DEFAULT_SHORTCUTS };
}

/** The rest of `line` after `word` at its start (case does not matter), or null. */
function after(line: string, word: string): string | null {
  return line.toLowerCase().startsWith(word.toLowerCase()) ? line.slice(word.length).trim() : null;
}

/** The entries one typed line gives: none for an empty line, several for a checklist. */
export function capturesOf(input: string, s: Shortcuts = DEFAULT_SHORTCUTS): Capture[] {
  const line = input.replace(/[\r\n]+/g, ' ').trim();
  if (line === '') return [];
  // The longest shortcut first: `[]` before a `[` someone chose, `A:` before `A`.
  const order = (Object.keys(s) as (keyof Shortcuts)[]).sort((a, b) => s[b].length - s[a].length);
  for (const key of order) {
    const rest = after(line, s[key]);
    if (rest === null) continue;
    if (key === 'checklist') {
      return rest
        .split(';')
        .map((part) => part.trim())
        .filter((part) => part !== '')
        .map((text) => ({ kind: 'task' as const, text }));
    }
    if (rest === '') return [];
    if (key === 'mark') return [{ kind: 'text', text: `${s.mark} ${rest}` }];
    return [{ kind: key, text: rest }];
  }
  if (line.endsWith('?')) return [{ kind: 'question', text: line }];
  return [{ kind: 'text', text: line }];
}

/** The operation of one entry: an append, without `if_match` (two devices at once lose nothing). */
export function captureOp(id: string, capture: Capture, at?: string): Op {
  const entry: Extract<Op, { op: 'meeting_capture' }>['entry'] = { kind: capture.kind };
  if (capture.text !== '') entry.text = capture.text;
  if (capture.asset) entry.asset = capture.asset;
  if (at) entry.at = at;
  return { op: 'meeting_capture', id, entry };
}

/** One line of `## Protokoll` as the engine wrote it. */
export interface MinuteLine {
  /** Its place among the lines of the section (1-based). */
  n: number;
  /** `HH:MM`. */
  at: string;
  kind: 'text' | 'task' | 'decision' | 'question' | 'image' | 'audio';
  text: string;
  /** The file of an image or of audio, below the meeting's folder. */
  asset?: string;
  /** A line the person marked as important (it starts with the mark). */
  marked: boolean;
  /** The line as it is in the file. */
  raw: string;
}

/** The words the engine begins a line with, by kind, German and English (`meeting_write.LABELS`). */
const LABELS: Record<'task' | 'decision' | 'question', readonly string[]> = {
  task: ['Aufgabe', 'Task'],
  decision: ['Beschluss', 'Decision'],
  question: ['Frage', 'Question'],
};

/** The heading of the minutes in `body`: German or English, as the engine wrote it. */
export function minutesHeading(body: string): 'Protokoll' | 'Minutes' {
  return /^## Minutes\s*$/m.test(body) && !/^## Protokoll\s*$/m.test(body) ? 'Minutes' : 'Protokoll';
}

/** The lines of the minutes in `body`, in the order of their time (lines of the same minute in the order written). */
export function minutesOf(body: string, mark = DEFAULT_SHORTCUTS.mark): MinuteLine[] {
  const text = sectionText(body, minutesHeading(body));
  if (text === '') return [];
  const lines: MinuteLine[] = [];
  let n = 0;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '') continue;
    n += 1;
    const m = /^- (\d{2}:\d{2}) (.*)$/.exec(raw.trim());
    if (!m) {
      lines.push({ n, at: '', kind: 'text', text: raw.trim().replace(/^- /, ''), marked: false, raw });
      continue;
    }
    const at = m[1] ?? '';
    const rest = m[2] ?? '';
    const image = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(rest);
    const audio = /^\[(?:Audio): ([^\]]*)\]\(([^)\s]+)\)$/.exec(rest);
    if (image) {
      lines.push({ n, at, kind: 'image', text: image[1] ?? '', asset: image[2] ?? '', marked: false, raw });
      continue;
    }
    if (audio) {
      lines.push({ n, at, kind: 'audio', text: audio[1] ?? '', asset: audio[2] ?? '', marked: false, raw });
      continue;
    }
    let kind: MinuteLine['kind'] = 'text';
    let body = rest;
    for (const k of ['task', 'decision', 'question'] as const) {
      const label = LABELS[k].find((l) => rest.startsWith(`${l}: `));
      if (label) {
        kind = k;
        body = rest.slice(label.length + 2);
        break;
      }
    }
    const marked = kind === 'text' && mark !== '' && body.startsWith(mark);
    lines.push({ n, at, kind, text: marked ? body.slice(mark.length).trim() : body, marked, raw });
  }
  // Stable: the lines of one minute keep the order they were written in.
  return lines
    .map((line, i) => ({ line, i }))
    .sort((a, b) => (a.line.at === b.line.at ? a.i - b.i : a.line.at === '' ? 1 : b.line.at === '' ? -1 : a.line.at < b.line.at ? -1 : 1))
    .map(({ line }) => line);
}

/**
 * Turn a plain line of the minutes into a task, a decision or a question afterwards: the line leaves `## Protokoll`
 * (`set_section` on the version read) and comes back as a capture of the other kind with the same time, which also
 * puts it into its section. Both in one request: the engine writes both or neither. Null when the line is no plain
 * text line or the body was cut (its section cannot be written back whole).
 */
export function convertOps(
  id: string,
  body: string,
  line: MinuteLine,
  to: 'task' | 'decision' | 'question',
  ifMatch: string | undefined,
): Op[] | null {
  if (line.kind !== 'text' || line.at === '' || line.marked) return null;
  const heading = minutesHeading(body);
  const kept: string[] = [];
  let n = 0;
  let removed = false;
  for (const raw of sectionText(body, heading).split(/\r?\n/)) {
    if (raw.trim() === '') continue;
    n += 1;
    if (n === line.n && raw === line.raw) {
      removed = true;
      continue;
    }
    kept.push(raw);
  }
  if (!removed) return null;
  return [
    { op: 'set_section', id, heading: `## ${heading}`, text: withComments(body, heading, kept.join('\n')), ...(ifMatch ? { if_match: ifMatch } : {}) },
    captureOp(id, { kind: to, text: line.text }, line.at),
  ];
}

/** Where this browser keeps the shortcuts and the entries not written yet. */
export const MINUTES_SHORTCUTS_KEY = 'tasks-desktop.minutes-shortcuts';
export const MINUTES_DRAFTS_KEY = 'tasks-desktop.minutes-drafts';

/** An entry that did not reach the hub: written as it was typed (its time kept) once the hub answers. */
export interface MinutesDraft {
  kind: 'text' | 'task' | 'decision' | 'question';
  text: string;
  at: string;
}

/** Most entries kept per meeting, and most meetings with entries (what is kept is small and the profile stays so). */
const MAX_DRAFTS = 200;
const MAX_DRAFT_MEETINGS = 50;

/** The kept drafts by meeting id; whatever does not read as one is dropped. */
export function draftsOf(raw: string | null): Record<string, MinutesDraft[]> {
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, MinutesDraft[]> = {};
  for (const [id, list] of Object.entries(parsed as Record<string, unknown>).slice(0, MAX_DRAFT_MEETINGS)) {
    if (!/^[^/\s]+\/[^/\s]+$/.test(id) || !Array.isArray(list)) continue;
    const drafts = list
      .filter(
        (d): d is MinutesDraft =>
          !!d &&
          typeof d === 'object' &&
          ['text', 'task', 'decision', 'question'].includes((d as MinutesDraft).kind) &&
          typeof (d as MinutesDraft).text === 'string' &&
          (d as MinutesDraft).text.length <= MAX_CAPTURE &&
          /^\d{2}:\d{2}$/.test(String((d as MinutesDraft).at)),
      )
      .slice(0, MAX_DRAFTS);
    if (drafts.length > 0) out[id] = drafts;
  }
  return out;
}

/** `HH:MM` of a wall clock in milliseconds. */
export function clockOf(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
