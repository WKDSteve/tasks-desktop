// The tables of a view of figures (the learning statistics) on their way out of the page, for the menu View: as a
// file or the clipboard (CSV and Markdown as a card of the statistics writes them, JSON as they are), and as a sheet
// for the printer and the picture, one section per table with its own heads. Loaded when one of them is asked for:
// the start of the page has a budget (tools/check-bundle-size.py).

import { cardText } from './statsExport';
import type { CsvSeparator, ExportFormat, PrintSheet, ViewTables } from './export';

/** The number of rows of all tables: none means nothing to take out. */
export function rowCount(tables: ReturnType<ViewTables['tables']>): number {
  return tables.reduce((sum, table) => sum + table.rows.length, 0);
}

/** The text of the tables in a format, on a day. */
export function tablesText(own: ViewTables, tables: ReturnType<ViewTables['tables']>, format: ExportFormat, day: string, separator: CsvSeparator): string {
  if (format === 'json') return `${JSON.stringify({ view: own.view, title: own.title, day, tables }, null, 2)}\n`;
  return cardText(own.title, tables, format, separator);
}

/** The tables as a sheet: the title, the day, one section per table with its own heads. */
export function tablesSheet(own: ViewTables, tables: ReturnType<ViewTables['tables']>, day: string): PrintSheet {
  const sections = tables.map((table) => ({ ...(table.title !== undefined ? { heading: table.title } : {}), headers: table.headers, rows: table.rows }));
  return { title: own.title, facts: [`${own.title} · ${day}`], headers: [], sections };
}
