// "Suggest fields" of the new-task form: a free text goes to the hub (`POST /api/tasks/draft`), which adds the values of
// the vault it asks of the engine (WEB-13: the page sends no list) and hands both to ai-desktop as a job of the kind
// `draft-task`; its checked draft fills the form, and only "Create" makes the task. ai-desktop checks the draft already (`draft::check`, schema `tasks-draft/1`); `checkDraft` holds it once more to
// the lists of this page, which may have changed since, with the same rules (docs/JOBS.md "Drafts" of ai-desktop).

/** The values the vault allows: what the form offers. */
export interface DraftChoices {
  areas: string[];
  kinds: string[];
  tags: string[];
  categories: string[];
  plans: string[];
}

/** A checked draft: only the fields with an allowed value are there. */
export interface TaskDraft {
  title: string;
  area?: string;
  kind?: string;
  prio?: number;
  effort?: string;
  value?: number;
  tags?: string[];
  category?: string[];
  plan?: string;
  summary?: string;
  acceptance?: string[];
  /** What was left out: `key: value` for each value of no list or out of range. */
  dropped: string[];
}

/** The job of a draft as the hub passes it on (`POST /api/tasks/draft`). */
export interface DraftJob {
  job_id: string;
  /** `running`, `needs_confirmation` (a model that is not local) or `prefilled` (two jobs run already). */
  status: string;
  private: boolean;
  note?: string;
}

/** Where a draft stands (`POST /api/tasks/draft_job`): only these fields of the job reach the page. */
export interface DraftState {
  status: string;
  draft?: unknown;
  draft_error?: string;
  error?: string;
  note?: string;
}

/** The routes of the hub a draft uses. */
export interface DraftHub {
  sendDraft(text: string): Promise<DraftJob>;
  draftJob(job: string): Promise<DraftState>;
  confirmDraft(job: string): Promise<void>;
  /** Put a job away that nobody waits for (a no to its question): it would stay in the dashboard of ai-desktop. */
  dropDraft(job: string): Promise<void>;
}

const NAME = /^[A-Za-z0-9._/-]{1,200}$/;
const EFFORTS = ['XS', 'S', 'M', 'L', 'XL'];
// C0 (in one line also tab and line breaks), DEL, C1, soft hyphen, zero-width and bidirectional controls, line and
// paragraph separators, word joiners, byte order mark: the character rule of ai-desktop.
// Built from code points, so this file holds no invisible character itself.
const INVISIBLE: Array<[number, number]> = [
  [0x7f, 0x9f],
  [0xad, 0xad],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];
function refused(code: number, multiline: boolean): boolean {
  if (code < 0x20) return !(multiline && (code === 0x09 || code === 0x0a || code === 0x0d));
  return INVISIBLE.some(([from, to]) => code >= from && code <= to);
}
function hasControl(text: string, multiline: boolean): boolean {
  for (const ch of text) if (refused(ch.codePointAt(0) ?? 0, multiline)) return true;
  return false;
}

/** The text of the free text a draft takes at most (the hub refuses more). */
export const DRAFT_TEXT_MAX = 64 * 1024;

/** The lists of the page as choices: names only (ai-desktop takes no other), each once, sorted. */
export function draftChoices(lists: DraftChoices): DraftChoices {
  const clean = (list: string[]): string[] => [...new Set(list.filter((n) => NAME.test(n) && n !== '.' && n !== '..'))].sort();
  return {
    areas: clean(lists.areas),
    kinds: clean(lists.kinds),
    tags: clean(lists.tags),
    categories: clean(lists.categories),
    plans: clean(lists.plans),
  };
}

function bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** A one-line text of at most `max` bytes, trimmed; a string with the reason when it is none. */
function oneLine(value: unknown, key: string, max: number): { text: string } | { error: string } {
  if (typeof value !== 'string') return { error: `'${key}' must be a string` };
  const text = value.trim();
  if (bytes(text) > max) return { error: `'${key}' is longer than ${max} bytes` };
  if (hasControl(text, false)) return { error: `'${key}' holds a control character` };
  return { text };
}

/**
 * The draft checked against the lists of this page. A value of the wrong type, a missing or empty title or a control
 * character make it invalid (`error`, nothing is filled in); a value of no list or out of range is left out and named
 * in `dropped`.
 */
export function checkDraft(raw: unknown, choices: DraftChoices): { draft: TaskDraft } | { error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { error: 'the draft is not an object' };
  const doc = raw as Record<string, unknown>;
  const present = (key: string): boolean => doc[key] !== undefined && doc[key] !== null;
  if (!present('title')) return { error: 'the draft has no title' };
  const title = oneLine(doc['title'], 'title', 300);
  if ('error' in title) return title;
  if (title.text === '') return { error: 'the title of the draft is empty' };
  const draft: TaskDraft = { title: title.text, dropped: [] };

  for (const [key, list] of [
    ['area', choices.areas],
    ['kind', choices.kinds],
    ['plan', choices.plans],
  ] as const) {
    if (!present(key)) continue;
    const got = oneLine(doc[key], key, 200);
    if ('error' in got) return got;
    if (got.text === '') continue;
    if (list.includes(got.text)) draft[key] = got.text;
    else draft.dropped.push(`${key}: ${got.text}`);
  }
  for (const [key, list] of [
    ['tags', choices.tags],
    ['category', choices.categories],
  ] as const) {
    if (!present(key)) continue;
    const given = typeof doc[key] === 'string' ? [doc[key]] : doc[key];
    if (!Array.isArray(given)) return { error: `'${key}' must be a list of names` };
    const kept: string[] = [];
    for (const entry of given) {
      const got = oneLine(entry, key, 200);
      if ('error' in got) return got;
      if (got.text === '' || kept.includes(got.text)) continue;
      if (list.includes(got.text) && kept.length < 20) kept.push(got.text);
      else draft.dropped.push(`${key}: ${got.text}`);
    }
    draft[key] = kept;
  }
  for (const [key, max] of [
    ['prio', 3],
    ['value', 5],
  ] as const) {
    if (!present(key)) continue;
    const v = doc[key];
    const n = typeof v === 'number' && Number.isInteger(v) ? v : typeof v === 'string' && /^\d$/.test(v) ? Number(v) : null;
    if (n === null) return { error: `'${key}' must be a whole number` };
    if (n >= 1 && n <= max) draft[key] = n;
    else draft.dropped.push(`${key}: ${n}`);
  }
  if (present('effort')) {
    const got = oneLine(doc['effort'], 'effort', 8);
    if ('error' in got) return got;
    if (EFFORTS.includes(got.text)) draft.effort = got.text;
    else if (got.text !== '') draft.dropped.push(`effort: ${got.text}`);
  }
  if (present('summary')) {
    const s = doc['summary'];
    if (typeof s !== 'string') return { error: "'summary' must be a string" };
    if (bytes(s) > 2000) return { error: "'summary' is longer than 2000 bytes" };
    if (hasControl(s, true)) return { error: "'summary' holds a control character" };
    draft.summary = s;
  }
  if (present('acceptance')) {
    const given = doc['acceptance'];
    if (!Array.isArray(given) || given.length > 20) return { error: "'acceptance' must be a list of at most 20 lines" };
    const lines: string[] = [];
    for (const entry of given) {
      const got = oneLine(entry, 'acceptance', 500);
      if ('error' in got) return got;
      const line = got.text.replace(/^(- \[[ x]\] |\[ \] |- )/, '');
      if (line !== '') lines.push(line);
    }
    draft.acceptance = lines;
  }
  return { draft };
}

/** The `dropped` of a draft of ai-desktop: one-line texts only, at most 50. */
function droppedBy(raw: unknown): string[] {
  const list = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>)['dropped'] : undefined;
  if (!Array.isArray(list)) return [];
  return list
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '' && bytes(v) <= 300 && !hasControl(v, false))
    .slice(0, 50);
}

/** What `runDraft` ends with. */
export type DraftOutcome =
  | { kind: 'draft'; draft: TaskDraft }
  | { kind: 'declined' }
  | { kind: 'failed'; why: string };

export interface DraftOptions {
  /** Asked when the job waits for a yes (the text would leave this machine); false: nothing runs. */
  confirm(): Promise<boolean>;
  /** False once nobody waits for the draft (the form was closed): the job is no longer asked after. */
  wanted?(): boolean;
  /** Waits between two looks at the job (default: a timer of `interval` ms). */
  sleep?(ms: number): Promise<void>;
  interval?: number;
  /** How long the job is watched at most (default 10 minutes). */
  maxMs?: number;
  /** The clock (default `Date.now`). */
  now?(): number;
}

/**
 * Asks ai-desktop for a draft of `text` and waits for it: the job goes as private (the area is not chosen yet), a
 * model that is not local runs only after `confirm()`, then the job is watched until it has ended. A no (also the
 * one a closed form gives) puts the waiting job away in ai-desktop. The draft is checked against `choices`, the lists
 * of this page (the hub sends its own, of the engine); nothing is written anywhere.
 */
export async function runDraft(hub: DraftHub, text: string, choices: DraftChoices, options: DraftOptions): Promise<DraftOutcome> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const wanted = options.wanted ?? (() => true);
  const job = await hub.sendDraft(text);
  // Not started (two jobs of ai-desktop run already): it would wait in the dashboard, not come back here.
  if (job.status === 'prefilled') return { kind: 'failed', why: job.note ?? 'ai-desktop runs two jobs already; try again later' };
  if (job.status === 'needs_confirmation') {
    // Nobody is there to be asked any more (the form was closed while the hub answered): that is a no.
    if (!wanted() || !(await options.confirm())) {
      // Nothing was sent to a model; the job (with the text, in the memory of ai-desktop) is put away. That it could
      // not be (ai-desktop ended meanwhile) changes nothing for the form: it is tidying, not a refusal.
      try {
        await hub.dropDraft(job.job_id);
      } catch {
        // it stays in the dashboard, where it can be put away by hand
      }
      return { kind: 'declined' };
    }
    await hub.confirmDraft(job.job_id);
  }
  const deadline = now() + (options.maxMs ?? 10 * 60 * 1000);
  for (;;) {
    // A closed form leaves the job to the dashboard of ai-desktop; asking on would cost a request every interval.
    if (!wanted()) return { kind: 'declined' };
    const state = await hub.draftJob(job.job_id);
    if (state.status === 'done') {
      if (state.draft === undefined) return { kind: 'failed', why: state.draft_error ?? 'ai-desktop gave no draft' };
      const checked = checkDraft(state.draft, choices);
      if ('error' in checked) return { kind: 'failed', why: checked.error };
      // What ai-desktop left out already is named too (the check here sees only what it kept).
      checked.draft.dropped = [...droppedBy(state.draft), ...checked.draft.dropped];
      return { kind: 'draft', draft: checked.draft };
    }
    if (state.status === 'failed' || state.status === 'cancelled') {
      return { kind: 'failed', why: state.error ?? state.status };
    }
    if (now() > deadline) return { kind: 'failed', why: 'the draft did not come in time; it is in the dashboard of ai-desktop' };
    await sleep(options.interval ?? 1000);
  }
}
