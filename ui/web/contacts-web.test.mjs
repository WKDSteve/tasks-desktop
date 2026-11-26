// The export of contacts in the web variant without an engine: the query of `contacts_export` judged as the Rust hub
// judges it (`contacts_export_request`), and `contacts_import` let through as an operation of `ops`.
//
//   node --experimental-strip-types --test web/contacts-web.test.mjs        (from ui/)

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkOpsRequest, contactsExportParams } from '../src/web/hub.ts';

test('the query of contacts_export is judged as the hub judges it', () => {
  assert.deepEqual(contactsExportParams('format=csv&area=work&delimiter=semicolon&bom=1&raw=1&tag=a%20b&org=X%26Y'), {
    format: 'csv',
    area: 'work',
    delimiter: ';',
    bom: true,
    raw: true,
    tag: 'a b',
    org: 'X&Y',
  });
  assert.deepEqual(contactsExportParams('format=vcf&version=3'), { format: 'vcf', version: '3' });
  assert.equal(contactsExportParams(''), 'format is vcf or csv');
  assert.equal(contactsExportParams('format=pdf'), 'format is vcf or csv');
  assert.equal(contactsExportParams('format=csv&version=4'), 'version is 3 or 4, for vcf');
  assert.equal(contactsExportParams('format=vcf&delimiter=comma'), 'delimiter is for csv');
  assert.equal(contactsExportParams('format=csv&delimiter=pipe'), 'delimiter is comma, semicolon or tab');
  assert.equal(contactsExportParams('format=csv&delimiter=__proto__'), 'delimiter is comma, semicolon or tab');
  assert.equal(contactsExportParams('format=vcf&raw=1'), 'bom and raw are 1 or absent, for csv');
  assert.equal(contactsExportParams('format=csv&area=..'), 'area is not a name');
  assert.equal(contactsExportParams('format=csv&tag=a&tag=b'), 'a query parameter is given twice');
  assert.equal(typeof contactsExportParams('format=csv&tag=%01'), 'string', 'a control character');
  assert.equal(typeof contactsExportParams('format=csv&out=x'), 'string', 'no path of the hub');
});

test('contacts_import is an operation the web variant sends on', () => {
  const request = { ops: [{ op: 'contacts_import', area: 'pub', text: 'BEGIN:VCARD', as: 'vcf' }] };
  const checked = checkOpsRequest(JSON.stringify(request));
  assert.equal(typeof checked, 'object', String(checked));
});
