// The words of the export entries for a view that gives the menu View its own tables (`ViewTables` of lib/export.ts,
// the learning statistics): "tables" where the page says "tasks". They come with the chunk of such a view, not with the
// start of the page (its budget, tools/check-bundle-size.py); a view passes `tablesLabel` as `ViewTables.label`.

import type { Lang } from './i18n';

const EN = {
  'menu.save_csv': 'Save tables as CSV file ...',
  'menu.save_json': 'Save tables as JSON file ...',
  'menu.save_md': 'Save tables as Markdown file ...',
  'menu.copy_csv': 'Copy tables as CSV',
  'menu.copy_json': 'Copy tables as JSON',
  'menu.copy_md': 'Copy tables as Markdown',
  'menu.print_view': 'Print tables or save as PDF ...',
  'hint.item.menu.save_csv': 'The tables of this view as a CSV file.',
  'hint.item.menu.save_json': 'The tables of this view as a JSON file.',
  'hint.item.menu.save_md': 'The tables of this view as a Markdown file.',
  'hint.item.menu.copy_csv': 'The tables of this view as CSV on the clipboard.',
  'hint.item.menu.copy_json': 'The tables of this view as JSON on the clipboard.',
  'hint.item.menu.copy_md': 'The tables of this view as Markdown on the clipboard.',
  'hint.item.menu.png': 'The tables of this view as one long picture, the same as for the printer. Only in the page without the hub.',
  'palette.export': 'Export tables: {what}',
};

const DE: Record<keyof typeof EN, string> = {
  'menu.save_csv': 'Tabellen als CSV-Datei speichern ...',
  'menu.save_json': 'Tabellen als JSON-Datei speichern ...',
  'menu.save_md': 'Tabellen als Markdown-Datei speichern ...',
  'menu.copy_csv': 'Tabellen als CSV kopieren',
  'menu.copy_json': 'Tabellen als JSON kopieren',
  'menu.copy_md': 'Tabellen als Markdown kopieren',
  'menu.print_view': 'Tabellen drucken oder als PDF sichern ...',
  'hint.item.menu.save_csv': 'Die Tabellen dieser Ansicht als CSV-Datei.',
  'hint.item.menu.save_json': 'Die Tabellen dieser Ansicht als JSON-Datei.',
  'hint.item.menu.save_md': 'Die Tabellen dieser Ansicht als Markdown-Datei.',
  'hint.item.menu.copy_csv': 'Die Tabellen dieser Ansicht als CSV in der Zwischenablage.',
  'hint.item.menu.copy_json': 'Die Tabellen dieser Ansicht als JSON in der Zwischenablage.',
  'hint.item.menu.copy_md': 'Die Tabellen dieser Ansicht als Markdown in der Zwischenablage.',
  'hint.item.menu.png': 'Die Tabellen dieser Ansicht als ein langes Bild, wie für den Drucker. Nur in der Seite ohne Hub.',
  'palette.export': 'Export der Tabellen: {what}',
};

/** The word of an export entry for tables, or undefined where the page's word stands (it names no tasks). */
export function tablesLabel(lang: Lang, key: string, params: Record<string, string | number> = {}): string | undefined {
  const text = ((lang === 'de' ? DE : EN) as Record<string, string | undefined>)[key];
  return text?.replace(/\{(\w+)\}/g, (all, k: string) => (Object.hasOwn(params, k) ? String(params[k]) : all));
}

/** Every key, for the tests (both languages name the same). */
export const TABLE_KEYS = Object.keys(EN);
