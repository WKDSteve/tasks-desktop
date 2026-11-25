// The entries of a checklist as the tab Lists exports them: what the filter shows, as Markdown (an entry per block, the
// blocks apart by `---`, the form of a list kept by hand), as CSV and as the sheet the printer (and the PNG picture)
// gets. Pure: the view saves or prints what comes out (`exportDom`, `pngExport`). The entries' texts are untrusted:
// Markdown passes them on as they are (it is their own format), CSV through `csvCell`, the sheet as text only.

import type { ChecklistEntry } from './contract';
import { csvCell, type CsvSeparator, type PrintSheet } from './export';

/** The words the export writes (the columns and the line of the filter), in the language of the page. */
export interface ChecklistWords {
  title: string;
  made: string;
  done: string;
  tags: string;
  text: string;
  /** The line under the title naming the filter (`Filter: ...`); empty when nothing is filtered. */
  filter: string;
}

/** The day of an entry's `created` (`2026-01-10T09:00:00Z` -> `2026-01-10`); empty when the file says none. */
export function dayOf(created: string): string {
  return /^\d{4}-\d{2}-\d{2}/.exec(created)?.[0] ?? '';
}

/** A title that stays one line in a heading: a line break (none should be there) becomes a blank. */
function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim();
}

/**
 * The entries as Markdown: the name of the list as the heading, then each entry as `## <title>`, a line with its day,
 * its state and its tags (`#tag`, so that a list kept by hand reads the same), and its text; the entries apart by
 * `---`. An attachment is named by its path below the entry (the picture itself stays in the vault).
 */
export function checklistMarkdown(listTitle: string, entries: readonly ChecklistEntry[], words: ChecklistWords): string {
  const out: string[] = [`# ${oneLine(listTitle)}`, ''];
  if (words.filter !== '') out.push(words.filter, '');
  entries.forEach((e, i) => {
    if (i > 0) out.push('---', '');
    out.push(`## ${e.done ? '~~' + oneLine(e.title) + '~~' : oneLine(e.title)}`, '');
    const facts = [dayOf(e.created), e.done ? `${words.done} ${e.done}` : '', e.tags.map((t) => `#${t}`).join(' ')].filter((f) => f !== '');
    if (facts.length > 0) out.push(facts.join(' · '), '');
    if (e.text !== '') out.push(e.text, '');
    if ((e.assets ?? []).length > 0) {
      for (const asset of e.assets ?? []) out.push(`- ${asset}`);
      out.push('');
    }
  });
  return out.join('\n').replace(/\n+$/, '\n');
}

/** The entries as CSV: title, day made, day done, tags, text (one cell each; a cell is never read as a formula). */
export function checklistCsv(entries: readonly ChecklistEntry[], words: ChecklistWords, separator: CsvSeparator = ','): string {
  const lines = [[words.title, words.made, words.done, words.tags, words.text].map(csvCell).join(separator)];
  for (const e of entries) {
    lines.push([e.title, dayOf(e.created), e.done ?? '', e.tags.join(' '), e.text].map(csvCell).join(separator));
  }
  return lines.join('\r\n') + '\r\n';
}

/** The longest text of an entry on the sheet: the printer gets the beginning, the file the whole. */
export const SHEET_TEXT = 600;

/** The entries as the sheet of the printer (and of the PNG picture): one table, a row per entry. */
export function checklistSheet(listTitle: string, entries: readonly ChecklistEntry[], words: ChecklistWords): PrintSheet {
  const cut = (text: string) => (text.length > SHEET_TEXT ? `${text.slice(0, SHEET_TEXT)} ...` : text);
  return {
    title: oneLine(listTitle),
    facts: words.filter === '' ? [] : [words.filter],
    headers: [words.title, words.made, words.done, words.tags, words.text],
    sections: [{ rows: entries.map((e) => [e.title, dayOf(e.created), e.done ?? '', e.tags.join(', '), cut(e.text)]) }],
  };
}

/** The name of a file of the export: the list and the day, e.g. `list-support-2026-11-25.md`. */
export function checklistFileName(listId: string, day: string, ext: string): string {
  const safe = listId.replace(/^_list-/, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'list';
  return `list-${safe}-${day}.${ext}`;
}
