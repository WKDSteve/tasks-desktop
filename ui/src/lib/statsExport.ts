// What a card of the statistics is exported as: its tables as CSV or Markdown, and the name of the file. Only the
// statistics view (loaded when it is shown) needs it.

import { csvCell, type CsvSeparator } from './export';
import type { StatsCard } from './statsCards';

/** A table of a card as it is exported: the heads of the columns and the rows, every cell a text. */
export interface CardTable {
  /** The name of the table, a heading of its own when a card has more than one. */
  title?: string;
  headers: string[];
  rows: string[][];
}

export type CardFormat = 'csv' | 'markdown';

/** The file of a format: its ending and its media type. */
export const CARD_FILES: Record<CardFormat | 'svg', { ext: string; type: string }> = {
  csv: { ext: 'csv', type: 'text/csv;charset=utf-8' },
  markdown: { ext: 'md', type: 'text/markdown;charset=utf-8' },
  svg: { ext: 'svg', type: 'image/svg+xml;charset=utf-8' },
};

/** The name of the file: the card and the day, e.g. `tasks-stats-history-2026-11-18.svg`. */
export function cardFileName(card: StatsCard, day: string, format: CardFormat | 'svg'): string {
  return `tasks-stats-${card}-${day}.${CARD_FILES[format].ext}`;
}

/** A cell of a Markdown table: a pipe, a backslash and a line break would break it. */
function mdCell(text: string): string {
  return text.replace(/[\\|]/g, (c) => `\\${c}`).replace(/\s+/g, ' ').trim();
}

/** The tables as CSV: one block per table, an empty line and the name of the next one between them. */
function tablesCsv(tables: readonly CardTable[], separator: CsvSeparator): string {
  const blocks = tables.map((table) => {
    const lines = [table.headers, ...table.rows].map((row) => row.map(csvCell).join(separator));
    return tables.length > 1 && table.title !== undefined ? [csvCell(table.title), ...lines] : lines;
  });
  return blocks.map((lines) => lines.join('\r\n')).join('\r\n\r\n') + '\r\n';
}

/** The tables as Markdown under the title of the card: one table each, with a heading when there is more than one. */
function tablesMarkdown(title: string, tables: readonly CardTable[]): string {
  const parts = [`# ${mdCell(title)}`];
  for (const table of tables) {
    if (tables.length > 1 && table.title !== undefined) parts.push(`## ${mdCell(table.title)}`);
    const head = `| ${table.headers.map(mdCell).join(' | ')} |`;
    const rule = `| ${table.headers.map(() => '---').join(' | ')} |`;
    parts.push([head, rule, ...table.rows.map((row) => `| ${row.map(mdCell).join(' | ')} |`)].join('\n'));
  }
  return parts.join('\n\n') + '\n';
}

/** The text of a card's tables in a format. */
export function cardText(title: string, tables: readonly CardTable[], format: CardFormat, separator: CsvSeparator = ','): string {
  return format === 'csv' ? tablesCsv(tables, separator) : tablesMarkdown(title, tables);
}
