// "Split into tasks" of a plan: ai-desktop's job `split-plan` proposes the tasks a plan still needs (docs/JOBS.md
// "Splitting a plan" of ai-desktop). The hub passes on only the block of drafts (`POST /api/tasks/split_job`); this
// file reads it the way tasks.nvim does (`review.parse_split`) and creates the drafts the person ticked, in order,
// through the engine. A draft of the wrong form is shown but cannot be ticked; a value the engine refuses refuses only
// that draft.

/** At most this many drafts are taken from a split (as tasks.nvim). */
export const MAX_DRAFTS = 30;

export interface SplitPhase {
  name: string;
  /** The model says the plan does not have this phase yet. */
  new: boolean;
}

export interface SplitDraft {
  /** The number of the draft, from 1; `#n` in `after`/`blocked_by` names it. */
  n: number;
  title: string;
  area: string;
  kind?: string;
  prio?: number;
  effort?: string;
  value?: number;
  phase?: string;
  summary?: string;
  acceptance: string[];
  after: string[];
  blocked_by: string[];
  /** Why it cannot be created as it is (its form); the engine checks the values later. */
  invalid?: string;
}

export interface Split {
  phases: SplitPhase[];
  drafts: SplitDraft[];
}

/** The job of a split as the hub passes it on (`POST /api/tasks/split`). */
export interface SplitJob {
  job_id: string;
  status: string;
  private: boolean;
  note?: string;
}

/** Where a split stands (`POST /api/tasks/split_job`): only these fields reach the page. */
export interface SplitState {
  status: string;
  block?: string;
  block_error?: string;
  error?: string;
  note?: string;
}

/** The routes of the hub a split uses. */
export interface SplitHub {
  splitPlan(plan: string): Promise<SplitJob>;
  splitJob(job: string): Promise<SplitState>;
  confirmSplit(job: string): Promise<void>;
}

function hasControl(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** One line of text of a draft: undefined when missing, an error when it is not one line. */
function oneLine(value: unknown, what: string): { text?: string; error?: string } {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'string') return { error: `${what} is not text` };
  if (hasControl(value)) return { error: `${what} is not one line of text` };
  return { text: value.trim() };
}

function lineList(value: unknown, what: string): { list: string[]; error?: string } {
  if (value === undefined || value === null) return { list: [] };
  if (!Array.isArray(value)) return { list: [], error: `${what} is not a list` };
  const list: string[] = [];
  for (const item of value) {
    const one = oneLine(item, what);
    if (one.error !== undefined || one.text === undefined) return { list: [], error: one.error ?? `${what} holds an empty entry` };
    if (one.text !== '') list.push(one.text);
  }
  return { list };
}

/**
 * The phases and drafts of a block: an error when it is no JSON object or names no draft (or more than 30); a draft
 * whose form is wrong is kept with `invalid`.
 */
export function parseSplit(block: string): Split | { error: string } {
  if (block.length > 64 * 1024) return { error: 'the drafts are larger than 64 KiB' };
  const json = block.trim().replace(/^```\w*/, '').replace(/```\s*$/, '').trim();
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch {
    return { error: 'the drafts are not one JSON object' };
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return { error: 'the drafts are not one JSON object' };
  const { phases: rawPhases, tasks } = doc as { phases?: unknown; tasks?: unknown };
  if (!Array.isArray(tasks) || tasks.length === 0) return { error: 'the split proposes no task' };
  if (tasks.length > MAX_DRAFTS) return { error: `the split proposes ${tasks.length} tasks, more than ${MAX_DRAFTS}` };
  const phases: SplitPhase[] = [];
  for (const p of Array.isArray(rawPhases) ? rawPhases : []) {
    if (typeof p !== 'object' || p === null) continue;
    const name = oneLine((p as { name?: unknown }).name, 'phase');
    if (name.text) phases.push({ name: name.text, new: (p as { new?: unknown }).new === true });
  }
  const drafts = tasks.map((t: unknown, i: number): SplitDraft => {
    const d: SplitDraft = { n: i + 1, title: '', area: '', acceptance: [], after: [], blocked_by: [] };
    const bad = (why: string): void => {
      d.invalid ??= why;
    };
    if (typeof t !== 'object' || t === null || Array.isArray(t)) {
      d.title = '(not a draft)';
      bad('not an object');
      return d;
    }
    const raw = t as Record<string, unknown>;
    for (const key of ['title', 'area', 'kind', 'effort', 'phase', 'summary'] as const) {
      const one = oneLine(raw[key], key);
      if (one.error) bad(one.error);
      else if (one.text !== undefined && one.text !== '') d[key] = one.text;
    }
    for (const key of ['prio', 'value'] as const) {
      const v = raw[key];
      if (v === undefined || v === null) continue;
      if (typeof v !== 'number' || !Number.isInteger(v)) bad(`${key} is not a whole number`);
      else d[key] = v;
    }
    for (const key of ['acceptance', 'after', 'blocked_by'] as const) {
      const got = lineList(raw[key], key);
      if (got.error) bad(got.error);
      else d[key] = got.list;
    }
    if (d.title === '') {
      d.title = '(no title)';
      bad('it has no title');
    }
    if (d.area === '') bad('it names no area');
    return d;
  });
  return { phases, drafts };
}

/** The phases of the ticked drafts that the plan does not have, each once, in the order of the drafts. */
export function newPhases(drafts: readonly SplitDraft[], ticked: readonly number[], phaseOrder: readonly string[]): string[] {
  const out: string[] = [];
  for (const n of [...ticked].sort((a, b) => a - b)) {
    const d = drafts[n - 1];
    if (d && !d.invalid && d.phase && !phaseOrder.includes(d.phase) && !out.includes(d.phase)) out.push(d.phase);
  }
  return out;
}

/** The body of a created draft: where it comes from, its acceptance, an empty section of notes. */
export function draftBody(draft: SplitDraft, plan: string, job: string, lang: string): string {
  const de = lang !== 'en';
  const lines = de
    ? ['## Kontext', '', `Entwurf aus der Zerlegung des Plans \`${plan}\` (ai-desktop, Auftrag ${job}).`, '', '## Akzeptanz', '']
    : ['## Context', '', `A draft of the split of the plan \`${plan}\` (ai-desktop, job ${job}).`, '', '## Acceptance', ''];
  for (const a of draft.acceptance) lines.push(`- [ ] ${a}`);
  if (draft.acceptance.length === 0) lines.push('- [ ] ');
  lines.push('', de ? '## Notizen' : '## Notes');
  return `${lines.join('\n')}\n`;
}

/** How one ticked draft came out. */
export type DraftResult = { n: number; id: string; warning?: string } | { n: number; refused: string };

/** The writes a creation needs: the engine's `new` and `set`, answered with the id or the reason. */
export interface SplitWriter {
  create(area: string, title: string, fields: Record<string, unknown>, body: string): Promise<{ id: string } | { error: string }>;
  setBlockedBy(id: string, ids: string[]): Promise<string | null>;
}

/**
 * Create the ticked drafts in their order: `#n` in `after`/`blocked_by` becomes the id of draft n once it is made (a
 * reference to one that was not made is left out and said). A draft of the wrong form, or of a new phase without the
 * yes (`phasesOk`), is refused; a value the engine refuses refuses that draft only.
 */
export async function createDrafts(
  writer: SplitWriter,
  split: Split,
  ticked: readonly number[],
  opts: { plan: string; job: string; lang: string; newPhases: readonly string[]; phasesOk: boolean },
): Promise<DraftResult[]> {
  const made = new Map<number, string>();
  const results: DraftResult[] = [];
  for (const n of [...ticked].sort((a, b) => a - b)) {
    const d = split.drafts[n - 1];
    if (!d) {
      results.push({ n, refused: 'there is no such draft' });
      continue;
    }
    if (d.invalid) {
      results.push({ n, refused: d.invalid });
      continue;
    }
    if (d.phase && !opts.phasesOk && opts.newPhases.includes(d.phase)) {
      results.push({ n, refused: `its phase ${d.phase} is not in the plan` });
      continue;
    }
    const left: string[] = [];
    const resolve = (list: string[], what: string): string[] =>
      list.flatMap((ref) => {
        const k = /^#(\d+)$/.exec(ref);
        if (!k) return [ref];
        const id = made.get(Number(k[1]));
        if (id) return [id];
        left.push(`its ${what} #${k[1]} was not created, left out`);
        return [];
      });
    const after = resolve(d.after, 'after');
    const fields: Record<string, unknown> = { plan: opts.plan };
    if (d.kind) fields['kind'] = d.kind;
    if (d.prio !== undefined) fields['prio'] = d.prio;
    if (d.effort) fields['effort'] = d.effort;
    if (d.value !== undefined) fields['value'] = d.value;
    if (d.phase) fields['phase'] = d.phase;
    if (d.summary) fields['summary'] = d.summary;
    if (after.length > 0) fields['after'] = after;
    const res = await writer.create(d.area, d.title, fields, draftBody(d, opts.plan, opts.job, opts.lang));
    if ('error' in res) {
      results.push({ n, refused: res.error });
      continue;
    }
    made.set(n, res.id);
    const blocked = resolve(d.blocked_by, 'blocked_by');
    if (blocked.length > 0) {
      const why = await writer.setBlockedBy(res.id, blocked);
      if (why !== null) left.push(`its blocked_by was refused: ${why}`);
    }
    results.push(left.length > 0 ? { n, id: res.id, warning: left.join('; ') } : { n, id: res.id });
  }
  return results;
}

/** What asking for a split ends with. */
export type SplitOutcome = { kind: 'split'; split: Split; job: string } | { kind: 'declined' } | { kind: 'failed'; why: string };

/**
 * Ask ai-desktop to split `plan` and wait for the drafts: a private area on a model that is not local runs only after
 * `confirm()`. Nothing is created here.
 */
export async function runSplit(
  hub: SplitHub,
  plan: string,
  opts: { confirm(): Promise<boolean>; sleep?(ms: number): Promise<void>; interval?: number; maxMs?: number; now?(): number },
): Promise<SplitOutcome> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = opts.now ?? Date.now;
  const job = await hub.splitPlan(plan);
  if (job.status === 'prefilled') return { kind: 'failed', why: job.note ?? 'ai-desktop runs two jobs already; try again later' };
  if (job.status === 'needs_confirmation') {
    if (!(await opts.confirm())) return { kind: 'declined' };
    await hub.confirmSplit(job.job_id);
  }
  // An agent reads the vault: a split may take minutes.
  const deadline = now() + (opts.maxMs ?? 30 * 60 * 1000);
  for (;;) {
    const state = await hub.splitJob(job.job_id);
    if (state.status === 'done') {
      if (state.block === undefined) return { kind: 'failed', why: state.block_error ?? 'ai-desktop gave no drafts' };
      const split = parseSplit(state.block);
      return 'error' in split ? { kind: 'failed', why: split.error } : { kind: 'split', split, job: job.job_id };
    }
    if (state.status === 'failed' || state.status === 'cancelled') return { kind: 'failed', why: state.error ?? state.status };
    if (now() > deadline) return { kind: 'failed', why: 'the split did not come in time; it is in the dashboard of ai-desktop' };
    await sleep(opts.interval ?? 2000);
  }
}
