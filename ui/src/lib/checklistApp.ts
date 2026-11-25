// What the tab Lists does with the app: read the entries a filter lets through (every page, for an export), make an
// entry (and the first list, when the vault has none yet), take a picture off the clipboard. It lives beside the view
// (not in `app.svelte.ts`) so the start of the page does not carry it. The rules of the lists (the `#tags` of a line,
// the filter, the order) are the engine's (WEB-13): the page sends what was typed and shows what comes back.

import type { App } from './app.svelte';
import type { ChecklistQuery, Op } from './api';
import type { ChecklistEntry } from './contract';
import type { Lang } from './i18n';

/** The pages (100 entries each) an export reads at most. */
export const CHECKLIST_PAGES = 20;

/** The filter of the tab as the person set it; empty fields filter nothing. */
export interface ChecklistFilter {
  q: string;
  tag: string;
  since: string;
  until: string;
  state: 'all' | 'open' | 'done';
}

export const NO_CHECKLIST_FILTER: ChecklistFilter = { q: '', tag: '', since: '', until: '', state: 'all' };

/** The question of `checklist` for list `id` and `filter`: only the fields that filter something. */
export function checklistQuery(id: string, filter: ChecklistFilter, page: { limit?: number; offset?: number } = {}): ChecklistQuery {
  const q = filter.q.trim();
  return {
    id,
    ...(q !== '' ? { q } : {}),
    ...(filter.tag !== '' ? { tag: filter.tag } : {}),
    ...(filter.since !== '' ? { since: filter.since } : {}),
    ...(filter.until !== '' ? { until: filter.until } : {}),
    ...(filter.state !== 'all' ? { state: filter.state } : {}),
    ...page,
  };
}

/** Whether `filter` filters anything. */
export function filtering(filter: ChecklistFilter): boolean {
  return filter.q.trim() !== '' || filter.tag !== '' || filter.since !== '' || filter.until !== '' || filter.state !== 'all';
}

/** Every entry of list `id` that `filter` lets through, all pages (an export); `total` is the engine's count. */
export async function checklistAll(
  app: App,
  id: string,
  filter: ChecklistFilter,
  signal?: AbortSignal,
): Promise<{ items: ChecklistEntry[]; matching: number }> {
  const items: ChecklistEntry[] = [];
  let matching = 0;
  let offset: number | undefined = 0;
  for (let page = 0; page < CHECKLIST_PAGES && offset !== undefined; page += 1) {
    const answer = await app.env.hub.checklist(checklistQuery(id, filter, { limit: 100, offset }), signal);
    items.push(...answer.items);
    matching = answer.matching;
    offset = answer.next_offset;
  }
  return { items, matching };
}

/**
 * The id of the first list of a vault, made when the first entry is typed into a vault without one: a fixed id per
 * language (the slug of its name), so the entry can be added in the same request.
 */
export function firstListId(lang: Lang): string {
  return lang === 'de' ? '_list-schnellliste' : '_list-quick-list';
}

/**
 * The operations that add an entry with `title` to list `list`; with `list` null, the first list (`firstTitle`) is made
 * in the same request. `title` goes as typed: its `#words` become tags in the engine.
 */
export function addOps(list: string | null, title: string, firstTitle: string, lang: Lang): { ops: Op[]; list: string } {
  const target = list ?? firstListId(lang);
  const ops: Op[] = [];
  if (list === null) ops.push({ op: 'checklist_new', title: firstTitle, id: target });
  ops.push({ op: 'entry_add', list: target, title });
  return { ops, list: target };
}

/** The tags typed into the field of an entry: words apart by blanks or commas, a leading `#` dropped, each once. */
export function tagsOfInput(text: string): string[] {
  const out: string[] = [];
  for (const word of text.split(/[\s,]+/)) {
    const tag = word.replace(/^#+/, '').toLowerCase();
    if (tag !== '' && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/** The first picture among the files of a paste (a screenshot copied, an image copied in a browser); null: none. */
export function pastedImage(data: Pick<DataTransfer, 'files'> | null): File | null {
  for (const file of Array.from(data?.files ?? [])) {
    if (file.type.startsWith('image/')) return file;
  }
  return null;
}

/** The name a pasted picture gets as a file: the browser names every one `image.png`. */
export function pastedName(file: File, at: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  const ext = file.type === 'image/jpeg' ? 'jpg' : (file.type.split('/')[1] ?? 'png').replace(/[^a-z0-9]/g, '') || 'png';
  return `pasted-${at.getFullYear()}${two(at.getMonth() + 1)}${two(at.getDate())}-${two(at.getHours())}${two(at.getMinutes())}${two(at.getSeconds())}.${ext}`;
}
