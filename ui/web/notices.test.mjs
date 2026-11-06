import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { COMPONENTS, noticesMarkdown, NOTICES_FILE, noticesText, readLock, versionIn } from './notices.mjs';
import { assemble, verifyShell } from './pack.mjs';

const LOCK = `lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      svelte:
        version: 5.0.0(foo@1.0.0)

packages:

  clsx@2.1.1:
    resolution: {integrity: x}

  '@scope/thing@1.0.0':
    resolution: {integrity: x}

  svelte@5.57.1:
    resolution: {integrity: x}

  twice@1.0.0:
    resolution: {integrity: x}

  twice@2.0.0:
    resolution: {integrity: x}

snapshots:

  svelte@9.9.9: {}
`;

test('the version comes from the packages of the lockfile, not from what depends on it', () => {
  assert.equal(versionIn(LOCK, 'svelte'), '5.57.1');
  assert.equal(versionIn(LOCK, 'clsx'), '2.1.1');
});

test('a package that is not in the lockfile, or there twice, stops the build', () => {
  assert.throws(() => versionIn(LOCK, 'gone'), /0 times/);
  assert.throws(() => versionIn(LOCK, 'twice'), /2 times/);
});

test('the file next to the pages is what the lockfile gives', () => {
  assert.equal(readFileSync(NOTICES_FILE, 'utf8').replaceAll('\r\n', '\n'), noticesMarkdown(readLock()));
});

test('every component is named with its version in the text of the pages', () => {
  const text = noticesText(readLock());
  for (const c of COMPONENTS) assert.ok(text.includes(c.name), c.name);
  assert.match(text, new RegExp(`Svelte \\(client runtime\\) ${versionIn(readLock(), 'svelte').replaceAll('.', '\\.')},`));
  assert.ok(text.includes('Permission is hereby granted'));
  assert.ok(text.includes('Redistribution and use'));
});

test('the text may stand in a comment of a page', () => {
  assert.doesNotMatch(noticesText(readLock()), /[<>&]|--/);
});

test('the engine page has the place for the notices', () => {
  assert.ok(readFileSync(new URL('./engine-page.src.html', import.meta.url), 'utf8').includes('__NOTICES__'));
  assert.ok(readFileSync(new URL('./engine-page.mjs', import.meta.url), 'utf8').includes("'__NOTICES__'"));
});

test('a built page carries the notices, and its shell is still fine', () => {
  const parts = { worker: Buffer.from('w'), wasm: Buffer.from('a'), bundle: Buffer.from('b'), shim: Buffer.from('s') };
  const html = assemble({ css: '', js: '', parts, build: 'abc' });
  assert.ok(html.includes('Third-party notices'));
  assert.ok(html.includes('Permission is hereby granted'));
  assert.deepEqual(verifyShell(html), []);
});
