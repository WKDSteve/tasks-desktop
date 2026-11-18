// The acceptance view: the one list of the open live checks, in three groups. Two come from the test-sheet block
// testing.nvim writes into a live-check task (`testing sheets report --tasks`): a sheet green by machine that waits for
// a judgement (`inbox`) and a sheet done by hand (`manual`). The third is the live checks without a sheet (`hand`: the
// tag `needs-live-test`, no block; real accounts, another machine, use over days), with the boxes of their acceptance
// section. The page reads the text as a work list. The page reads the text the report wrote (the criteria as checkboxes, the snapshot names); it
// decides nothing about the state of a sheet (the engine reads the states line, `TaskEntry.sheets`) and writes a tick
// back as the one changed line of the body (`set_body` on the version read).

import type { TaskEntry } from './contract';
import { BOX, type Item, type Sheet } from './sheets';

export { parseSheets, type Item, type Sheet } from './sheets';

/** The sheets that wait for a person: green by machine (`inbox`) or by hand only (`manual`), with something to tick. */
export function waiting(sheets: readonly Sheet[]): Sheet[] {
  return sheets.filter((s) => (s.state === 'inbox' || s.state === 'manual') && s.items.length > 0);
}

/** Whether every criterion of the waiting sheets is ticked (and there is one): then the page offers `done`. */
export function allTicked(sheets: readonly Sheet[]): boolean {
  const open = waiting(sheets);
  return open.length > 0 && open.every((s) => s.items.every((i) => i.checked));
}

/** How many criteria are ticked and how many there are, over the waiting sheets. */
export function progress(sheets: readonly Sheet[]): { ticked: number; total: number } {
  let ticked = 0;
  let total = 0;
  for (const sheet of waiting(sheets)) {
    for (const item of sheet.items) {
      total++;
      if (item.checked) ticked++;
    }
  }
  return { ticked, total };
}

/**
 * The body with the box of `item` set to `checked`: only that line changes. Null when the line is not that box any
 * more (the body changed since it was read): the page then reads it again instead of writing over the new text.
 */
export function tickItem(body: string, item: Pick<Item, 'line' | 'text'>, checked: boolean): string | null {
  const lines = body.split('\n');
  const box = BOX.exec(lines[item.line] ?? '');
  if (!box || box[3] !== item.text) return null;
  lines[item.line] = `${box[1]}- [${checked ? 'x' : ' '}] ${item.text}${box[4]}`;
  return lines.join('\n');
}

/** The groups of the acceptance, in the order the page shows them. */
export type Group = 'inbox' | 'manual' | 'hand';
export const GROUPS: readonly Group[] = ['inbox', 'manual', 'hand'];

/** The tag of a live check (`tasks list --tag=needs-live-test`). */
export const LIVE_TAG = 'needs-live-test';
// A live check by hand that is parked, blocked or finished waits for nothing a person can do now.
const HAND_STATUSES: ReadonlySet<string> = new Set(['open', 'doing', 'decision']);

/**
 * The group of a task in the acceptance, or null when it waits for no person here. A task with the block waits when one
 * of its sheets does (`inbox` before `manual`), whatever its other sheets say: a red sheet beside a waiting one does not
 * hide the waiting points (`troubleOf` names the red one). A task without the block waits when it is a live check
 * (`needs-live-test`) that is open, doing or a decision. The same groups as the engine's lists `abnahme-inbox`,
 * `abnahme-manual` and `abnahme-by-hand`, but for a task with a red and a waiting sheet: the engine sorts by the worst
 * sheet (`red`), the page by the waiting one.
 */
export function groupOf(task: TaskEntry): Group | null {
  const sheets = task.sheets;
  if (sheets) {
    if ((sheets.counts?.inbox ?? 0) > 0) return 'inbox';
    if ((sheets.counts?.manual ?? 0) > 0) return 'manual';
    return null;
  }
  if (task.tags.includes(LIVE_TAG) && task.status !== undefined && HAND_STATUSES.has(task.status)) return 'hand';
  return null;
}

/** The open live checks that wait for a person, by group, each in the order given. */
export function abnahmeOf(tasks: readonly TaskEntry[]): Record<Group, TaskEntry[]> {
  const out: Record<Group, TaskEntry[]> = { inbox: [], manual: [], hand: [] };
  for (const task of tasks) {
    const group = groupOf(task);
    if (group) out[group].push(task);
  }
  return out;
}

/** The sheets of a task that are not fine and not waiting (red, stale, never ran): while there is one, no `done`. */
export function troubleOf(task: TaskEntry): { red: number; stale: number; never: number } | null {
  const c = task.sheets?.counts;
  if (!c || c.red + c.stale + c.never === 0) return null;
  return { red: c.red, stale: c.stale, never: c.never };
}

const FENCE = /^\s{0,3}(```|~~~)/;
const ACCEPTANCE = /^##\s+(Akzeptanz|Acceptance)\s*$/;
const HEADING = /^##?\s/;

/**
 * The boxes of the acceptance section (`## Akzeptanz` / `## Acceptance`, up to the next heading of level one or two),
 * as points to tick; a box in a fenced code block is text. What the engine counts as the acceptance of a task.
 */
export function parseAcceptance(body: string): Item[] {
  const lines = body.split('\n');
  const out: Item[] = [];
  let inside = false;
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const bare = line.replace(/\r$/, '');
    if (FENCE.test(bare)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (ACCEPTANCE.test(bare)) inside = true;
    else if (HEADING.test(bare)) inside = false;
    else if (inside) {
      const box = BOX.exec(line);
      if (box) out.push({ kind: 'acceptance', text: box[3] ?? '', checked: box[2] !== ' ', line: i });
    }
  }
  return out;
}

/** How many of the points are ticked, and how many there are. */
export function tickedOf(items: readonly Item[]): { ticked: number; total: number } {
  return { ticked: items.filter((i) => i.checked).length, total: items.length };
}

/** A snapshot as the rows of a grid: the text, a trailing newline not an extra row. */
export function rowsOf(text: string): string[] {
  const rows = text.replace(/\r\n/g, '\n').split('\n');
  if (rows.length > 1 && rows[rows.length - 1] === '') rows.pop();
  return rows;
}
