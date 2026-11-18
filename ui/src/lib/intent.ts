// "Paste an intent": another app (testing.nvim, testing-web) hands tasks an intent `wkd-intent/1` (appkit
// `schemas/wkd-intent/1`): "make a task from this finding", "show this task". It comes as text the person pastes or as
// a file they choose; the page never reads the clipboard by itself (the hub's page may not: `clipboard-read=()`).
//
// An intent is untrusted input. The page looks only at what it must before the text leaves it (its size, measured
// before anything is parsed, and that it is one JSON object); the rules of the schema are the engine's (`intent`: the
// actions tasks offers, the class, no absolute path, lengths, control characters), asked through the hub or, in the
// web variant, of the engine in the page. Nothing is written by any of it: the answer is what the engine would do, and
// the page then shows its own form, filled in. A task is made only by *Create*.

/** The most an intent weighs, in UTF-8 bytes, measured before it is parsed (the limit of the schema). */
export const INTENT_MAX_BYTES = 64 * 1024;

/** What the engine answers to an intent that is asked, not carried out (`tasks.intent`). */
export interface IntentAnswer {
  action: string;
  outcome: 'would_create' | 'created' | 'exists' | 'shown' | 'not_found';
  id?: string;
  area?: string;
  title?: string;
}

/** Why a text is not passed on at all. */
export type IntentProblem = 'empty' | 'too_large' | 'not_json';

/** The text as one JSON object, or why it is none. The size is looked at first, on the bytes, before parsing. */
export function readIntent(text: string): { doc: Record<string, unknown> } | { problem: IntentProblem } {
  if (text.trim() === '') return { problem: 'empty' };
  if (new TextEncoder().encode(text).length > INTENT_MAX_BYTES) return { problem: 'too_large' };
  try {
    const doc: unknown = JSON.parse(text);
    if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return { problem: 'not_json' };
    return { doc: doc as Record<string, unknown> };
  } catch {
    return { problem: 'not_json' };
  }
}

/** The answer of the hub as the page takes it, or null when it is no answer to an intent. */
export function parseIntentAnswer(value: unknown): IntentAnswer | null {
  if (typeof value !== 'object' || value === null) return null;
  const doc = value as Record<string, unknown>;
  const outcome = doc['outcome'];
  if (doc['kind'] !== 'tasks.intent' || typeof doc['action'] !== 'string') return null;
  if (outcome !== 'would_create' && outcome !== 'created' && outcome !== 'exists' && outcome !== 'shown' && outcome !== 'not_found') return null;
  const text = (key: string): string | undefined => (typeof doc[key] === 'string' && doc[key] !== '' ? (doc[key] as string) : undefined);
  const out: IntentAnswer = { action: doc['action'], outcome };
  for (const key of ['id', 'area', 'title'] as const) {
    const v = text(key);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** What the new-task form is filled with from a finding: what the person sees and can change before *Create*. */
export interface FindingFill {
  title: string;
  area?: string;
  kind: string;
  tags: string;
  /** Separated by commas, as the form takes them. */
  refs: string;
  links: string;
  summary: string;
  context: string;
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const firstLine = (s: string, max: number): string => {
  const line = (s.split(/\r?\n/)[0] ?? '').trim();
  return [...line].length > max ? `${[...line].slice(0, max - 1).join('')}…` : line;
};

/**
 * The fields of the form for the finding of an intent the engine took (`would_create`): the title, the area, a bug
 * with the tag `testing`, the refs the engine would give it (the key `testing-finding:<fp>` that makes the same
 * finding twice one task, the place `file:line`, `repo@sha`), the run as a link and the excerpt as the context. The
 * engine checked every one of these values; the form applies the limits of its own door again when it is sent.
 */
export function fillOfFinding(doc: Record<string, unknown>, lang: 'de' | 'en'): FindingFill {
  const finding = typeof doc['finding'] === 'object' && doc['finding'] !== null ? (doc['finding'] as Record<string, unknown>) : {};
  const where = typeof finding['where'] === 'object' && finding['where'] !== null ? (finding['where'] as Record<string, unknown>) : {};
  const run = typeof finding['run'] === 'object' && finding['run'] !== null ? (finding['run'] as Record<string, unknown>) : {};
  const fp = text(finding['fp']);
  const refs: string[] = [];
  if (fp !== '') refs.push(`testing-finding:${fp}`);
  const file = text(where['file']);
  if (file !== '') {
    const line = where['line'];
    refs.push(typeof line === 'number' && Number.isInteger(line) && line >= 1 ? `${file}:${line}` : file);
  }
  const repo = text(finding['repo']);
  const sha = text(finding['sha']);
  if (/^[\w.-]+$/.test(repo) && /^[0-9a-f]{7,40}$/i.test(sha)) refs.push(`${repo}@${sha}`);
  const excerpt = text(finding['excerpt']);
  const repro = text(finding['repro']);
  const url = text(run['url']);
  const en = lang === 'en';
  const context: string[] = [];
  if (fp !== '') context.push(en ? `A finding of testing.nvim (\`${fp}\`):` : `Ein Befund von testing.nvim (\`${fp}\`):`);
  if (excerpt !== '') context.push('', '```', excerpt.replaceAll('```', "'''"), '```');
  if (repro !== '') context.push('', `${en ? 'Reproduce' : 'Nachstellen'}: \`${repro.replaceAll('`', "'")}\``);
  const area = text(finding['area']);
  return {
    title: text(finding['title']),
    ...(area !== '' ? { area } : {}),
    kind: 'bug',
    tags: 'testing',
    refs: refs.join(', '),
    links: url.startsWith('https://github.com/') ? url : '',
    summary: firstLine(excerpt, 300),
    context: context.join('\n').trim(),
  };
}

/** What came of an intent on the page. */
export type IntentOutcome =
  /** The form is open, filled in: nothing is written before *Create*. */
  | { kind: 'form' }
  /** The task the intent names is shown. */
  | { kind: 'shown'; id: string }
  /** A task holds this finding already: offered to be opened instead of a second one. */
  | { kind: 'exists'; id: string }
  | { kind: 'not_found'; id: string }
  /** Not taken: the page's own reason (`problem`) or the engine's words (`why`). */
  | { kind: 'refused'; problem?: IntentProblem; why?: string };
