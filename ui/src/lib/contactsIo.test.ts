// The import and export of contacts without a DOM: the format of a picked file, what the dialog sends to the engine
// (the delimiter of a CSV only, the options of the export's format only), the name of the saved file, a file that is too
// large or no UTF-8 refused before the engine is asked, and the report read out of the engine's result.
import { describe, expect, it } from 'vitest';
import {
  answerOf,
  countsOf,
  EXPORT_DEFAULTS,
  exportFileName,
  exportQuery,
  formatOfName,
  importOp,
  inputKey,
  localDay,
  MAX_IMPORT_BYTES,
  readPicked,
  type ImportInput,
} from './contactsIo';
import type { Result } from './contract';

function file(name: string, bytes: Uint8Array, size = bytes.length) {
  return { name, size, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
}

const INPUT: ImportInput = { area: 'pub', text: 'name;org\nA;B\n', as: 'csv', delimiter: 'auto', lang: 'de' };

describe('the import', () => {
  it('knows a vCard and a CSV by the name of the file, and nothing else', () => {
    expect(formatOfName('Outlook.VCF')).toBe('vcf');
    expect(formatOfName('a.vcard')).toBe('vcf');
    expect(formatOfName('people.csv')).toBe('csv');
    expect(formatOfName('people.txt')).toBeNull();
    expect(formatOfName('csv')).toBeNull();
  });

  it('sends the delimiter of a CSV only when it is named, and never for a vCard', () => {
    expect(importOp(INPUT)).toEqual({ op: 'contacts_import', area: 'pub', text: INPUT.text, as: 'csv', lang: 'de' });
    expect(importOp({ ...INPUT, delimiter: 'semicolon' })).toMatchObject({ delimiter: ';' });
    expect(importOp({ ...INPUT, delimiter: 'comma' })).toMatchObject({ delimiter: ',' });
    expect(importOp({ ...INPUT, delimiter: 'tab' })).toMatchObject({ delimiter: 'tab' });
    expect(importOp({ ...INPUT, as: 'vcf', delimiter: 'tab' })).not.toHaveProperty('delimiter');
  });

  it('holds a trial run for exactly its input', () => {
    expect(inputKey(INPUT)).toBe(inputKey({ ...INPUT }));
    expect(inputKey(INPUT)).not.toBe(inputKey({ ...INPUT, area: 'other' }));
    expect(inputKey(INPUT)).not.toBe(inputKey({ ...INPUT, delimiter: 'comma' }));
    expect(inputKey(INPUT)).not.toBe(inputKey({ ...INPUT, text: `${INPUT.text}x` }));
  });

  it('reads a picked file as UTF-8 and refuses what the engine would not take, before it is asked', async () => {
    const enc = new TextEncoder();
    expect(await readPicked(file('a.csv', enc.encode('name\nJörg\n')))).toEqual({ kind: 'ok', text: 'name\nJörg\n', as: 'csv' });
    // the byte order mark Excel writes is not part of the text
    expect(await readPicked(file('a.csv', new Uint8Array([0xef, 0xbb, 0xbf, 0x41])))).toEqual({ kind: 'ok', text: 'A', as: 'csv' });
    expect(await readPicked(file('a.vcf', new Uint8Array([0x41, 0xff, 0x42])))).toEqual({ kind: 'not_utf8' });
    expect(await readPicked(file('a.txt', enc.encode('x')))).toEqual({ kind: 'no_format' });
    expect(await readPicked(file('a.vcf', enc.encode('x'), MAX_IMPORT_BYTES + 1))).toEqual({ kind: 'too_large' });
    expect(await readPicked(file('a.vcf', enc.encode('x'), MAX_IMPORT_BYTES))).toMatchObject({ kind: 'ok' });
    const broken = { name: 'a.vcf', size: 1, arrayBuffer: () => Promise.reject(new Error('gone')) };
    expect(await readPicked(broken)).toEqual({ kind: 'unreadable' });
  });

  it('reads the report out of the result, or the refusal', () => {
    const report = { created: [{ index: 1, id: 'pub/a', name: 'A' }], duplicates: [], refused: [], problems: [], messages: [] };
    const ok = { kind: 'tasks.result', ok: true, dry_run: true, results: [{ n: 1, op: 'contacts_import', ok: true, outcome: 'would_create', changed_ids: [], report }] };
    expect(answerOf(ok as unknown as Result)).toEqual({ kind: 'report', report, dryRun: true });
    const refused = { kind: 'tasks.result', ok: false, dry_run: true, results: [{ n: 1, op: 'contacts_import', ok: false, outcome: 'failed', changed_ids: [], error: { code: 'not_found', message: 'unknown area: x' } }] };
    expect(answerOf(refused as unknown as Result)).toEqual({ kind: 'refused', message: 'unknown area: x' });
    expect(countsOf(report)).toEqual({ created: 1, duplicates: 0, refused: 0, problems: 0 });
  });
});

describe('the export', () => {
  it('asks for the options of its format only and for the filters that are set', () => {
    expect(exportQuery(EXPORT_DEFAULTS)).toEqual({ format: 'vcf', version: '4' });
    expect(exportQuery({ ...EXPORT_DEFAULTS, format: 'csv' })).toEqual({ format: 'csv', delimiter: 'semicolon', bom: 1 });
    expect(exportQuery({ ...EXPORT_DEFAULTS, format: 'csv', bom: false, raw: true, delimiter: 'tab', area: 'pub', tag: 't2', org: 'X & Y' })).toEqual({
      format: 'csv',
      delimiter: 'tab',
      raw: 1,
      area: 'pub',
      tag: 't2',
      org: 'X & Y',
    });
    expect(exportQuery({ ...EXPORT_DEFAULTS, version: '3', raw: true })).toEqual({ format: 'vcf', version: '3' });
  });

  it('names the file by the day, the language and the area', () => {
    expect(exportFileName(EXPORT_DEFAULTS, '2026-11-26', 'de')).toBe('kontakte-2026-11-26.vcf');
    expect(exportFileName({ ...EXPORT_DEFAULTS, format: 'csv', area: 'lib.nvim' }, '2026-11-26', 'en')).toBe('contacts-lib.nvim-2026-11-26.csv');
    expect(exportFileName({ ...EXPORT_DEFAULTS, area: 'a b/c' }, '2026-11-26', 'en')).toBe('contacts-a_b_c-2026-11-26.vcf');
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});
