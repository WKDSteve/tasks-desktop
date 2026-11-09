// Groups: the tasks of a view laid in groups by a field, and the operation that a drag from one group to another is.
// Nothing here knows a field: which fields there are, what values each can have and how each is written is the engine's
// (`tasks.groupings`, WEB-13). The groups, the cells and the neighbours are the kit's (`appkit-ui/groups`); this reads
// the value a task has for a field and turns a drop into the operation the engine names for it (`set`, the list of tags,
// a move of the area).

import { cellsOf as kitCellsOf, groupsOf as kitGroupsOf, NONE, type Cell } from 'appkit-ui/groups';
import type { Op } from './api';
import type { Groupings, TaskEntry } from './contract';

export { countOf, neighbourCell, neighbourGroup, NONE, type Cell, type Group } from 'appkit-ui/groups';

/** A field a view can group by, as the engine describes it. */
export type Grouping = Groupings['fields'][number];

/**
 * The values of a derived field another document of the engine holds (not the task entry): the caller reads them there
 * (`cross` from `tasks.links`). Undefined: the field is read from the entry.
 */
export type Derived = (task: TaskEntry, field: Grouping['field']) => string[] | undefined;

/**
 * The values a task has for a grouping, as the words of `grouping.values`: one, several for a list (tags), or none.
 * The field names the engine gives are the names of the entry, except `state` (the readiness) and what `derived` reads
 * - this reads, it does not judge.
 */
export function valuesOf(task: TaskEntry, grouping: Grouping, derived?: Derived): string[] {
  const read = derived?.(task, grouping.field);
  if (read !== undefined) return read;
  const entry = task as unknown as Record<string, unknown>;
  const raw = grouping.field === 'state' ? task.readiness?.state : entry[grouping.field];
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string' && v !== '').map(String);
  if (raw === undefined || raw === null || raw === '') return [];
  return [String(raw)];
}

/**
 * The tasks in groups: one group for every value the engine names, in its order (an empty group stays: it is a place to
 * drop), a value the engine did not name after them in the order it is met, and the tasks that have none last. A task
 * with several values (tags) stands in each of their groups; the group of none shows only when some task has none.
 */
export function groupsOf<T extends TaskEntry>(items: readonly T[], grouping: Grouping, derived?: Derived) {
  return kitGroupsOf(items, grouping, (task, g) => valuesOf(task, g, derived));
}

/** Whether a drop with `copy` (the Ctrl key) keeps the group it leaves: only a list of tags can; any other field moves. */
export function keepsGroup(grouping: Grouping, copy: boolean): boolean {
  return copy && grouping.mode === 'tags';
}

/** What a drop comes to. */
export type Drop =
  | { kind: 'ops'; ops: Op[] }
  /** The area: not an operation of the field but a move of the file, which the page asks the engine to preview first. */
  | { kind: 'move_area'; id: string; area: string }
  | { kind: 'refused'; reason: 'read_only' | 'same' | 'required' | 'unknown' | 'area' };

/** A field of the file the page turns back to what the file has: a number as a number, the rest as it is. */
function written(grouping: Grouping, value: string): string | number {
  return grouping.value_type === 'number' ? Number(value) : value;
}

/**
 * The drop of `task` from the group `from` onto the group `to` (`NONE` is the group of those that have none). `copy`
 * (the Ctrl key) keeps the group it leaves: only for a list of tags, where a task can be in both.
 *
 * - a field of the file (`set`): one `set` of the field, with the version of the file the card showed (`if_match`); the
 *   group of none takes the key out (`null`), except for a field the file must have (`status`);
 * - the list of tags: one `set` of the whole list - the tag of the group left goes, the tag of the group entered comes
 *   (a tag the task has already is not doubled); with `copy` nothing goes;
 * - the area: not written here (`move_area`);
 * - a field the engine does not write (no `mode`): refused.
 */
export function dropOps(task: TaskEntry, grouping: Grouping, from: string, to: string, copy = false): Drop {
  if (grouping.mode === undefined || !grouping.writable) return { kind: 'refused', reason: 'read_only' };
  if (from === to && !copy) return { kind: 'refused', reason: 'same' };
  if (grouping.mode === 'move_area') {
    if (to === NONE) return { kind: 'refused', reason: 'required' };
    return { kind: 'move_area', id: task.id, area: to };
  }
  if (to !== NONE && !grouping.values.includes(to)) return { kind: 'refused', reason: 'unknown' };
  const guard = task.etag ? { if_match: task.etag } : {};
  if (grouping.mode === 'tags') {
    const has = task.tags ?? [];
    const next = has.filter((tag) => copy || tag !== from);
    if (to !== NONE && !next.includes(to)) next.push(to);
    if (next.length === has.length && next.every((tag, i) => tag === has[i])) return { kind: 'refused', reason: 'same' };
    return { kind: 'ops', ops: [{ op: 'set', id: task.id, patch: { tags: next.length > 0 ? next : null }, ...guard }] };
  }
  if (to === NONE) {
    if (grouping.field === 'status') return { kind: 'refused', reason: 'required' };
    return { kind: 'ops', ops: [{ op: 'set', id: task.id, patch: { [grouping.field]: null }, ...guard }] };
  }
  return { kind: 'ops', ops: [{ op: 'set', id: task.id, patch: { [grouping.field]: written(grouping, to) }, ...guard }] };
}

/**
 * The drop of `task` from the cell `from` onto the cell `to` of a matrix: what changes of the row and of the column, as
 * ONE `set` (both fields on the version shown, so the file is never left with one of them written). A field that stays
 * is not written; a field that cannot be written so (read only, the area) refuses the whole drop.
 */
export function cellDropOps(task: TaskEntry, rows: Grouping, columns: Grouping, from: Cell, to: Cell): Drop {
  const parts: Drop[] = [];
  if (from.row !== to.row) parts.push(dropOps(task, rows, from.row, to.row));
  if (from.column !== to.column) parts.push(dropOps(task, columns, from.column, to.column));
  if (parts.length === 0) return { kind: 'refused', reason: 'same' };
  const patch: Record<string, unknown> = {};
  for (const part of parts) {
    // The area is a move of the file, asked of the engine first: a view grouped by area does that, a matrix does not.
    if (part.kind === 'move_area') return { kind: 'refused', reason: 'area' };
    if (part.kind === 'refused') return part;
    for (const op of part.ops) if (op.op === 'set') Object.assign(patch, op.patch);
  }
  const guard = task.etag ? { if_match: task.etag } : {};
  return { kind: 'ops', ops: [{ op: 'set', id: task.id, patch, ...guard }] };
}

/**
 * The two fields of a matrix: the cells of rows by columns, each with the tasks in both. Rows and columns are the groups
 * of the two groupings over all the tasks (so every row has the same columns, an empty cell included); the task of a list
 * field stands in every cell it belongs to.
 */
export function cellsOf<T extends TaskEntry>(items: readonly T[], rows: Grouping, columns: Grouping, derived?: Derived) {
  return kitCellsOf(items, rows, columns, (task, g) => valuesOf(task, g, derived));
}
