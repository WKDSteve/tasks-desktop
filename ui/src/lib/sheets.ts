// The test sheets in a task's body, as the block testing.nvim writes into a live-check task
// (`testing sheets report --tasks`). The detail of a task names them; the acceptance view (`abnahme.ts`, loaded with
// that view) also ticks their criteria. Kept apart from that view so that the main chunk holds only the reading.

const BEGIN = '<!-- testing:sheets:begin -->';
const END = '<!-- testing:sheets:end -->';
const STATES = '<!-- testing:sheets:states';

/**
 * One point to tick: a criterion of a sheet that a person judges (`judge`) or does by hand (`manual`), or a box of the
 * acceptance section of a live check without a sheet (`acceptance`).
 */
export interface Item {
  kind: 'judge' | 'manual' | 'acceptance';
  text: string;
  checked: boolean;
  /** The line of the body (0-based), so that a tick rewrites that line and nothing else. */
  line: number;
}

/** One sheet of the block, with what is left for a person. */
export interface Sheet {
  title: string;
  /** The id of the sheet; absent for a sheet that does not load (it has none). */
  id?: string;
  /** The state its entry of the states line gives: `inbox`, `manual`, `green`, ... */
  state?: string;
  items: Item[];
  /** The snapshots to look at, as the block names them: `<repo>/TESTS/__snapshots__/<path>.snap`. */
  snapshots: string[];
}

export const BOX = /^(\s*)- \[([ xX])\] ([^\r]*)(\r?)$/;
const SHEET = /^- \*\*(.*)\*\* \((.*)\): [\s\S]*$/;

/** The code spans (`...`) of a line, in order. */
function codes(text: string): string[] {
  return [...text.matchAll(/`([^`]*)`/g)].map((m) => m[1] ?? '');
}

/** The `<id>=<state>` pairs of the states line. */
function statesOf(lines: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of lines) {
    if (!line.startsWith(STATES)) continue;
    const rest = line.slice(STATES.length).replace(/-->\s*$/, '').trim();
    for (const part of rest.split(/\s+/)) {
      const at = part.lastIndexOf('=');
      if (at > 0) out.set(part.slice(0, at), part.slice(at + 1));
    }
  }
  return out;
}

/**
 * The sheets of the block in a task's body; none without a block, or with a broken one (two blocks, a begin without
 * its end): a body the report did not write is not read.
 */
export function parseSheets(body: string): Sheet[] {
  const lines = body.split('\n');
  const begins = lines.flatMap((l, i) => (l.trim() === BEGIN ? [i] : []));
  const ends = lines.flatMap((l, i) => (l.trim() === END ? [i] : []));
  if (begins.length !== 1 || ends.length !== 1) return [];
  const from = begins[0] ?? 0;
  const to = ends[0] ?? 0;
  if (to < from) return [];
  const states = statesOf(lines.slice(from, to));
  const sheets: Sheet[] = [];
  let sheet: Sheet | null = null;
  let kind: Item['kind'] | null = null;
  for (let i = from + 1; i < to; i++) {
    const line = lines[i] ?? '';
    const head = SHEET.exec(line);
    if (head) {
      const spans = codes(head[2] ?? '');
      // `(`id`, `where`)`: two spans with an id, one for a sheet that does not load.
      const id = spans.length > 1 ? spans[0] : undefined;
      sheet = { title: head[1] ?? '', ...(id ? { id } : {}), items: [], snapshots: [] };
      // a sheet that does not load has no id: its key in the states line is its file name without `.sheet.lua`, with
      // everything but letters, digits and `_-.` turned into `-` (`state_key` of testing.nvim)
      const file = (spans[0] ?? '').split('/').pop() ?? '';
      const key = id ?? file.replace(/\.sheet\.lua$/, '').replace(/[^\w.-]/g, '-');
      const state = key ? states.get(key) : undefined;
      if (state) sheet.state = state;
      sheets.push(sheet);
      kind = null;
      continue;
    }
    if (!sheet) continue;
    const trimmed = line.trim();
    if (trimmed === '- Judge:') kind = 'judge';
    else if (trimmed === '- By hand:') kind = 'manual';
    else if (trimmed.startsWith('- Look at:')) {
      sheet.snapshots = codes(trimmed);
      kind = null;
    } else {
      const box = BOX.exec(line);
      if (box && kind) sheet.items.push({ kind, text: box[3] ?? '', checked: box[2] !== ' ', line: i });
    }
  }
  return sheets;
}

