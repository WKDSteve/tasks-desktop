// Giving tags quickly: the context menu of a task (and the "+" beside the tags of its detail) opens a searchable choice
// of the tags the open tasks carry, for the task or for all the marked ones at once. What is here: which tasks a menu
// works on, the entries of the choice, and what a typed word adds to them. The operations are those of the bulk bar
// (`bulkSetOps`: one `set` per task that still changes, each with the version shown); whether a tag is a valid one is
// the engine's to say.

import type { TaskEntry } from './contract';
import type { PickOption } from './picker';

/** A tag and how many tasks carry it. */
export interface TagCount {
  tag: string;
  count: number;
}

type Tagged = Pick<TaskEntry, 'tags'>;

/** The tags of a task, each once (a file may name one twice), in the order they are written. */
export function ownTags(task: Tagged): string[] {
  return [...new Set(task.tags ?? [])];
}

/** Every tag the tasks carry, with how many carry it: the most used first, then by name. */
export function tagCounts(tasks: readonly Tagged[]): TagCount[] {
  const counts = new Map<string, number>();
  for (const task of tasks) for (const tag of ownTags(task)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * The tasks a tag menu works on: the marked ones when the task it was opened on is one of them (as a right click on a
 * marked row works on all of them), else that task alone. Only tasks the list still holds.
 */
export function tagTargets(id: string, marks: readonly string[], tasks: readonly Pick<TaskEntry, 'id'>[]): string[] {
  const known = new Set(tasks.map((t) => t.id));
  const ids = marks.includes(id) ? marks : [id];
  return ids.filter((x) => known.has(x));
}

/** The words the entries of the choice need. */
export interface TagTexts {
  /** "n tasks" of the vault carry the tag. */
  count: (n: number) => string;
  /** All of the chosen tasks carry it already (adding it changes nothing). */
  all: string;
  /** `n` of the chosen tasks carry it. */
  some: (n: number, of: number) => string;
}

/**
 * The entries for "Add tag": every tag of the vault, the ones none of the chosen tasks has yet first. A tag all of
 * them have already is still listed (and says so): a choice that hid it would look as if the tag did not exist.
 */
export function addTagOptions(all: readonly TagCount[], chosen: readonly Tagged[], texts: TagTexts): PickOption[] {
  const held = new Map(tagCounts(chosen).map((c) => [c.tag, c.count] as const));
  return all.map(({ tag, count }) => {
    const n = held.get(tag) ?? 0;
    return {
      value: tag,
      label: tag,
      detail: texts.count(count),
      ...(n === 0 ? {} : { note: n === chosen.length ? texts.all : texts.some(n, chosen.length) }),
      ...(n < chosen.length ? { near: true } : {}),
    };
  });
}

/** The entries for "Remove tag": the tags the chosen tasks carry, each with how many of them. */
export function removeTagOptions(chosen: readonly Tagged[], texts: TagTexts): PickOption[] {
  return tagCounts(chosen).map(({ tag, count }) => ({
    value: tag,
    label: tag,
    detail: chosen.length === 1 ? '' : texts.some(count, chosen.length),
  }));
}

/**
 * The tag a typed text would make: the text without the spaces around it, when that is no entry of the choice yet.
 * Null for nothing typed or a tag that is listed (it is chosen from the list). Whether the engine takes it is the
 * engine's answer, told with its words.
 */
export function typedTag(typed: string, listed: readonly string[]): string | null {
  const tag = typed.trim();
  return tag === '' || listed.includes(tag) ? null : tag;
}

/** The ids of `ids` that change when `tags` are added or removed: the others have what was asked for already. */
export function changedBy(tasks: readonly TaskEntry[], ids: readonly string[], mode: 'add' | 'remove', tags: readonly string[]): string[] {
  const byId = new Map(tasks.map((t) => [t.id, t] as const));
  return ids.filter((id) => {
    const own = byId.get(id)?.tags ?? [];
    return mode === 'add' ? tags.some((tag) => !own.includes(tag)) : tags.some((tag) => own.includes(tag));
  });
}
