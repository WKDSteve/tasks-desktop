// Keys from the folder or the hub are foreign keys (rule WSEC-06): `__proto__` must stay an ordinary key.
//
//   node --experimental-strip-types --test web/own-keys.test.mjs        (from ui/)

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filesRecord } from '../src/web/vault-files.ts';

test('filesRecord keeps __proto__ as an own key and does not touch any prototype', () => {
  const evil = new Uint8Array([1, 2, 3]);
  const record = filesRecord([
    ['__proto__', evil],
    ['constructor', new Uint8Array([4])],
    ['a.md', new Uint8Array([5])],
  ]);
  assert.equal(Object.getPrototypeOf(record), null);
  assert.deepEqual(Object.keys(record).sort(), ['__proto__', 'a.md', 'constructor']);
  assert.equal(Object.getOwnPropertyDescriptor(record, '__proto__')?.value, evil);
  // The structured clone of a worker message keeps it an own key, too.
  const copy = structuredClone(record);
  assert.deepEqual(Object.keys(copy).sort(), ['__proto__', 'a.md', 'constructor']);
  assert.equal(Object.getPrototypeOf(copy), Object.prototype);
  assert.equal(({}).constructor, Object);
  assert.equal(Object.entries(copy).length, 3);
});
