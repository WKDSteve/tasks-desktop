// The import and the export of contacts (the dialog `views/ContactsIoDialog.svelte`): a vCard or CSV file the person
// picked is read as text and judged by the engine (`contacts_import`, first as a dry run, then for real); the export is
// the engine's file text (`contacts_export`) handed to the person as a download. The engine decides what a card or a
// row is, what a duplicate is and what is not taken over; the page only shows its report. A contact is a person of a
// third party: no message made here names an address or a number, and the export text goes to the file only.

import type { App } from './app.svelte';
import { ApiError, type ContactsExportQuery, type Op } from './api';
import type { ContactImportReport, Result } from './contract';
import { saveBlob } from './exportDom';

/** The longest file text the engine takes for `contacts_import` (`ops.MAX_IMPORT_TEXT`, bytes). */
export const MAX_IMPORT_BYTES = 240_000;

/** The format of a picked file by its name (`.vcf`/`.vcard`, `.csv`), as `tasks contacts import` judges it; else null. */
export function formatOfName(name: string): 'vcf' | 'csv' | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.vcf') || lower.endsWith('.vcard')) return 'vcf';
  if (lower.endsWith('.csv')) return 'csv';
  return null;
}

/** The delimiter of a CSV as the dialog offers it: found by the engine, or named. */
export type DelimiterChoice = 'auto' | 'comma' | 'semicolon' | 'tab';

/** What the dialog sends for an import: the file's text and how to read it. */
export interface ImportInput {
  area: string;
  text: string;
  as: 'vcf' | 'csv';
  delimiter: DelimiterChoice;
  lang: 'de' | 'en';
}

/** The operation of an import (`contacts_import`). */
export function importOp(input: ImportInput): Op {
  const delimiter = input.as === 'csv' ? ({ auto: undefined, comma: ',', semicolon: ';', tab: 'tab' } as const)[input.delimiter] : undefined;
  return {
    op: 'contacts_import',
    area: input.area,
    text: input.text,
    as: input.as,
    ...(delimiter ? { delimiter } : {}),
    lang: input.lang,
  };
}

/** A key of an input: the dry run shown holds for exactly this input (another file, area or delimiter asks again). */
export function inputKey(input: ImportInput): string {
  return JSON.stringify([input.area, input.as, input.delimiter, input.lang, input.text.length, input.text]);
}

/** What the engine said about an import: its report, or why it refused (its words, which name no address). */
export type ImportAnswer = { kind: 'report'; report: ContactImportReport; dryRun: boolean } | { kind: 'refused'; message: string };

/** The answer of the one entry of a result of `contacts_import`. */
export function answerOf(result: Result): ImportAnswer {
  const entry = result.results[0];
  if (entry?.ok && entry.report) return { kind: 'report', report: entry.report, dryRun: result.dry_run };
  return { kind: 'refused', message: entry?.error?.message ?? entry?.error?.code ?? '' };
}

/** The counts of a report, for the summary line. */
export function countsOf(report: ContactImportReport): { created: number; duplicates: number; refused: number; problems: number } {
  return {
    created: report.created.length,
    duplicates: report.duplicates.length,
    refused: report.refused.length,
    problems: report.problems.length,
  };
}

/** A file larger than the engine takes is refused here, before it is read: the dialog says so with the limit. */
export function tooLarge(bytes: number): boolean {
  return bytes > MAX_IMPORT_BYTES;
}

/** The dry run of an import: nothing is written. A hub that refuses the request (400) gives its reason. */
export async function previewImport(app: App, input: ImportInput, signal?: AbortSignal): Promise<ImportAnswer> {
  try {
    const result = await app.env.hub.ops({ client_op_id: app.opId(), dry_run: true, ops: [importOp(input)] }, signal);
    return answerOf(result);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 413)) return { kind: 'refused', message: error.message };
    throw error;
  }
}

/**
 * The import for real, through the app's one way to write (refused when read-only, the list read again afterwards).
 * The dialog shows the report itself, so the app says nothing of its own; `null` when nothing was sent.
 */
export async function runImport(app: App, input: ImportInput): Promise<ImportAnswer | null> {
  let answer: ImportAnswer | null = null;
  await app.write([importOp(input)], {
    undoable: false,
    onAnswer: (result) => {
      answer = answerOf(result);
      return true;
    },
  });
  return answer;
}

/** What the dialog asks of an export. */
export interface ExportForm {
  format: 'vcf' | 'csv';
  version: '3' | '4';
  delimiter: 'comma' | 'semicolon' | 'tab';
  bom: boolean;
  raw: boolean;
  area: string;
  tag: string;
  org: string;
}

/** The form of an export as it opens: vCard 4.0; for a CSV a semicolon and the byte order mark Excel in German wants. */
export const EXPORT_DEFAULTS: ExportForm = { format: 'vcf', version: '4', delimiter: 'semicolon', bom: true, raw: false, area: '', tag: '', org: '' };

/** The query of `contacts_export` for a form: only the options of its format, only the filters that are set. */
export function exportQuery(form: ExportForm): ContactsExportQuery {
  const filters = {
    ...(form.area ? { area: form.area } : {}),
    ...(form.tag ? { tag: form.tag } : {}),
    ...(form.org ? { org: form.org } : {}),
  };
  if (form.format === 'vcf') return { format: 'vcf', version: form.version, ...filters };
  return { format: 'csv', delimiter: form.delimiter, ...(form.bom ? { bom: 1 } : {}), ...(form.raw ? { raw: 1 } : {}), ...filters };
}

/** The day of `date` on this machine's calendar, `YYYY-MM-DD` (the name of the saved file carries it). */
export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The text of a picked file as UTF-8, or why not: too large for the engine, not a .vcf or .csv, not UTF-8. A byte order
 * mark is dropped by the decoder (the engine would drop it as well).
 */
export async function readPicked(file: Pick<File, 'name' | 'size' | 'arrayBuffer'>): Promise<
  { kind: 'ok'; text: string; as: 'vcf' | 'csv' } | { kind: 'no_format' } | { kind: 'too_large' } | { kind: 'not_utf8' } | { kind: 'unreadable' }
> {
  const as = formatOfName(file.name);
  if (as === null) return { kind: 'no_format' };
  if (tooLarge(file.size)) return { kind: 'too_large' };
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    return { kind: 'unreadable' };
  }
  try {
    return { kind: 'ok', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), as };
  } catch {
    return { kind: 'not_utf8' };
  }
}

/** The name of the saved file: `contacts-<day>.vcf` (`kontakte-` in German), with the area when one is chosen. */
export function exportFileName(form: ExportForm, day: string, lang: 'de' | 'en'): string {
  const base = lang === 'de' ? 'kontakte' : 'contacts';
  const area = form.area ? `-${form.area.replace(/[^A-Za-z0-9._-]+/g, '_')}` : '';
  return `${base}${area}-${day}.${form.format}`;
}

/** The type of the saved file. */
export function exportMime(format: 'vcf' | 'csv'): string {
  return format === 'vcf' ? 'text/vcard;charset=utf-8' : 'text/csv;charset=utf-8';
}

/** The outcome of an export: how many contacts went into the file, or that the browser did not save it. */
export type ExportOutcome = { kind: 'saved'; count: number; name: string } | { kind: 'empty' } | { kind: 'blocked' };

/**
 * Ask the engine for the file text and hand it to the person as a download. An export of no contact saves nothing.
 * The text is not kept: it goes from the answer into the file.
 */
export async function runExport(app: App, form: ExportForm, day: string, doc: Document, signal?: AbortSignal): Promise<ExportOutcome> {
  const answer = await app.env.hub.contactsExport(exportQuery(form), signal);
  if (answer.count === 0) return { kind: 'empty' };
  const name = exportFileName(form, day, app.lang === 'de' ? 'de' : 'en');
  const saved = saveBlob(doc, name, new Blob([answer.text], { type: exportMime(form.format) }));
  return saved ? { kind: 'saved', count: answer.count, name } : { kind: 'blocked' };
}
