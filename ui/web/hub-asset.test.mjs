// The images of a container in the web variant (`GET /api/tasks/asset`, as the Rust hub answers it): the query is
// checked before anything is asked, the folder comes from the engine's `file` (task, path, meeting) or the layout
// (plan, project), the file is read from the folder itself, sealed, and nothing else is ever read.
//
//   node --experimental-strip-types --test web/hub-asset.test.mjs        (from ui/)

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assetContentType, assetRequest, createWebHub, MAX_ASSET_SVG_BYTES, parseQuery, validAssetPath } from '../src/web/hub.ts';
import { readFileAt } from '../src/web/vault-files.ts';
import { fakeDisk } from './fake-folder.mjs';

const EVIL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><foreignObject><iframe src="https://tracker.example/"></iframe></foreignObject></svg>';

const entry = (kind, id, file, folder = true) => JSON.stringify({ kind: `tasks.${kind}`, [kind]: { id, file, folder } });

function hub(disk, docs = {}) {
  const calls = [];
  const reads = [];
  const api = createWebHub({
    version: '9.9.9',
    build: null,
    pinned: { engine: null, lib: null },
    async call(method, request) {
      calls.push([method, request === null ? null : JSON.parse(request)]);
      const doc = docs[method];
      if (doc === undefined) return { text: JSON.stringify({ code: 'not_found', message: 'no such item' }), code: 'not_found' };
      return { text: doc, code: null };
    },
    asset: disk
      ? (path, max) => {
          reads.push(path);
          return readFileAt(disk.root, path, max);
        }
      : undefined,
  });
  return { calls, reads, get: (path) => api.fetch(`/api/tasks/${path}`) };
}

test('what an asset path and its query may be', () => {
  for (const ok of ['assets/x.png', 'assets/images/a.SVG', 'assets/b.jpeg', 'assets/c.webp', 'assets/d.gif']) {
    assert.equal(validAssetPath(ok), true, ok);
  }
  for (const bad of [
    '',
    'x.png',
    'assets/',
    'assets/x.txt',
    'assets/../t.md',
    'assets/./x.png',
    'assets//x.png',
    '/assets/x.png',
    'C:/assets/x.png',
    'assets\\x.png',
    'assets/x.svgz',
    `assets/${'a'.repeat(600)}.png`,
  ]) {
    assert.equal(validAssetPath(bad), false, bad);
  }
  assert.equal(assetContentType('a.JPG'), 'image/jpeg');
  assert.equal(assetContentType('a.svg'), 'image/svg+xml');
  assert.equal(assetContentType('a.mp4'), null);
  const q = (text) => assetRequest(parseQuery(text, ['kind', 'id', 'file']));
  assert.deepEqual(q('kind=task&id=a/t&file=assets/x.png'), { kind: 'task', id: 'a/t', file: 'assets/x.png' });
  assert.equal(q('kind=board&id=a/t&file=assets/x.png'), 'kind is task, plan, project, path or meeting');
  assert.equal(q('kind=task&id=../x&file=assets/x.png'), 'id must be <area>/<slug>');
  assert.equal(q('kind=task&id=a/t&file=x.png'), 'file is an image below assets/');
});

test('a query the Rust hub refuses never reaches the engine or the folder', async () => {
  const disk = fakeDisk({ 'a/ROADMAP/tasks/t/assets/x.png': 'png' });
  const h = hub(disk);
  for (const path of [
    'asset',
    'asset?kind=task&id=a/t',
    'asset?kind=task&id=a/t&file=assets/../t.md',
    'asset?kind=task&id=a/t&file=assets%2Fx.png',
    'asset?kind=task&id=a/t&file=assets/x.png&url=https://x',
    'asset?kind=task&id=a/t&file=assets/x.txt',
    'asset?kind=board&id=a/t&file=assets/x.png',
  ]) {
    const r = await h.get(path);
    assert.equal(r.status, 400, path);
    assert.equal((await r.json()).error.code, 'bad_query', path);
  }
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.reads, []);
});

test('the images of a task, a path, a meeting, a plan and a project come from their folder, sealed', async () => {
  const disk = fakeDisk({
    'a/ROADMAP/tasks/t/t.md': '---\ntitle: t\n---\n',
    'a/ROADMAP/tasks/t/assets/images/evil.svg': EVIL_SVG,
    'a/ROADMAP/paths/p/assets/badges/star.gif': 'GIF89a',
    'a/MEETINGS/m/assets/cover.png': 'png',
    'a/ROADMAP/plans/pl/assets/c.webp': 'RIFF',
    'a/ROADMAP/projects/pr/assets/d.jpg': 'jpg',
  });
  const h = hub(disk, {
    task: entry('task', 'a/t', 'a/ROADMAP/tasks/t/t.md'),
    path: entry('path', 'a/p', 'a/ROADMAP/paths/p/p.md'),
    meeting: entry('meeting', 'a/m', 'a/MEETINGS/m/m.md'),
  });
  for (const [query, type, body] of [
    ['kind=task&id=a/t&file=assets/images/evil.svg', 'image/svg+xml', EVIL_SVG],
    ['kind=path&id=a/p&file=assets/badges/star.gif', 'image/gif', 'GIF89a'],
    ['kind=meeting&id=a/m&file=assets/cover.png', 'image/png', 'png'],
    ['kind=plan&id=a/pl&file=assets/c.webp', 'image/webp', 'RIFF'],
    ['kind=project&id=a/pr&file=assets/d.jpg', 'image/jpeg', 'jpg'],
  ]) {
    const r = await h.get(`asset?${query}`);
    assert.equal(r.status, 200, query);
    assert.equal(r.headers.get('content-type'), type, query);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('content-security-policy') ?? '', /^default-src 'none'.*sandbox$/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(await r.text(), body, query);
  }
  assert.deepEqual(h.reads, [
    'a/ROADMAP/tasks/t/assets/images/evil.svg',
    'a/ROADMAP/paths/p/assets/badges/star.gif',
    'a/MEETINGS/m/assets/cover.png',
    'a/ROADMAP/plans/pl/assets/c.webp',
    'a/ROADMAP/projects/pr/assets/d.jpg',
  ]);
});

test('a file that is not there, a container without a folder or one the engine does not know is missing', async () => {
  const disk = fakeDisk({ 'a/ROADMAP/tasks/t/assets/x.png': 'png', 'a/ROADMAP/tasks/plain.md': 'x' });
  const h = hub(disk, {
    task: (() => entry('task', 'a/t', 'a/ROADMAP/tasks/t/t.md'))(),
  });
  for (const query of [
    'kind=task&id=a/t&file=assets/none.png',
    'kind=plan&id=a/none&file=assets/x.png',
    'kind=path&id=a/t&file=assets/x.png',
  ]) {
    const r = await h.get(`asset?${query}`);
    assert.equal(r.status, 404, query);
    assert.equal((await r.json()).error.code, 'no_asset', query);
  }
  // A task whose entry has no folder, or names another id, or a file that is not plain: nothing is read.
  for (const doc of [
    entry('task', 'a/plain', 'a/ROADMAP/tasks/plain.md', false),
    entry('task', 'a/other', 'a/ROADMAP/tasks/t/t.md'),
    entry('task', 'a/plain', '../outside/t.md'),
  ]) {
    const one = hub(disk, { task: doc });
    const r = await one.get('asset?kind=task&id=a/plain&file=assets/x.png');
    assert.equal(r.status, 404, doc);
    assert.deepEqual(one.reads, [], doc);
  }
  // Without a way to the folder every asset is missing.
  const none = hub(null, { task: entry('task', 'a/t', 'a/ROADMAP/tasks/t/t.md') });
  assert.equal((await none.get('asset?kind=task&id=a/t&file=assets/x.png')).status, 404);
});

test('a drawing over its limit is refused, and readFileAt finds a file only by its exact path', async () => {
  const big = new Uint8Array(MAX_ASSET_SVG_BYTES + 1);
  const disk = fakeDisk({ 'a/ROADMAP/plans/pl/assets/big.svg': big, 'a/ROADMAP/plans/pl/assets/x.png': 'png' });
  const h = hub(disk);
  const r = await h.get('asset?kind=plan&id=a/pl&file=assets/big.svg');
  assert.equal(r.status, 413);
  assert.equal((await r.json()).error.code, 'too_large');

  assert.deepEqual(await readFileAt(disk.root, 'a/ROADMAP/plans/pl/assets/x.png', 10), { bytes: new TextEncoder().encode('png') });
  assert.equal(await readFileAt(disk.root, 'a/ROADMAP/plans/pl/assets/x.png', 2), 'too_large');
  for (const path of ['a/ROADMAP/plans/pl/assets/X.PNG', 'a/ROADMAP/plans/pl/assets', 'a/ROADMAP/plans/pl/assets/x.png/y', 'a/../a/x.png', 'a//x.png']) {
    assert.equal(await readFileAt(disk.root, path, 1e9), 'missing', path);
  }
});

test('a file with a space or a letter of any language comes percent-encoded and is read; an escape for a separator, a way up or a control character is refused', async () => {
  const disk = fakeDisk({
    'a/ROADMAP/tasks/t/t.md': '---\ntitle: t\n---\n',
    'a/ROADMAP/tasks/t/assets/mein bild.png': 'png',
    'a/ROADMAP/tasks/t/assets/übersicht.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
  });
  const h = hub(disk, { task: entry('task', 'a/t', 'a/ROADMAP/tasks/t/t.md') });
  for (const [query, type] of [
    ['kind=task&id=a/t&file=assets/mein%20bild.png', 'image/png'],
    ['kind=task&id=a/t&file=assets/%C3%BCbersicht.svg', 'image/svg+xml'],
  ]) {
    const r = await h.get(`asset?${query}`);
    assert.equal(r.status, 200, query);
    assert.equal(r.headers.get('content-type'), type, query);
  }
  assert.deepEqual(h.reads, ['a/ROADMAP/tasks/t/assets/mein bild.png', 'a/ROADMAP/tasks/t/assets/übersicht.svg']);
  for (const query of [
    'kind=task&id=a/t&file=assets/%2e%2e/t.png',
    'kind=task&id=a/t&file=assets%2fx.png',
    'kind=task&id=a/t&file=assets/x%5c..%5ct.png',
    'kind=task&id=a/t&file=assets/x%0a.png',
    'kind=task&id=a/t&file=assets/x%7f.png',
    'kind=task&id=a/t&file=assets/x%c2%85.png',
    'kind=task&id=a/t&file=assets/x%zz.png',
    'kind=task&id=a/t&file=assets/x%+5.png',
    'kind=task&id=a/t&file=assets/x%ff.png',
    'kind=task&id=a/t&file=assets/x%3a.png',
    'kind=task&id=a/t&file=assets/x.png&file=assets/y.png',
    'kind=task&id=a%2ft&file=assets/x.png',
  ]) {
    const r = await h.get(`asset?${query}`);
    assert.equal(r.status, 400, query);
    assert.equal((await r.json()).error.code, 'bad_query', query);
  }
  assert.equal(h.reads.length, 2);
});

test('an asset carries the tag of its bytes; the same tag answers 304, other bytes under the same name 200', async () => {
  const files = { 'a/ROADMAP/tasks/t/assets/shot.png': 'old picture' };
  const api = createWebHub({
    version: '9.9.9',
    build: null,
    pinned: { engine: null, lib: null },
    async call() {
      return { text: entry('task', 'a/t', 'a/ROADMAP/tasks/t/t.md'), code: null };
    },
    async asset(path) {
      const text = files[path];
      return text === undefined ? 'missing' : { bytes: new TextEncoder().encode(text) };
    },
  });
  const ask = (held) =>
    api.fetch('/api/tasks/asset?kind=task&id=a/t&file=assets/shot.png', held ? { headers: { 'If-None-Match': held } } : undefined);
  const first = await ask();
  assert.equal(first.status, 200);
  const tag = first.headers.get('etag');
  assert.match(tag ?? '', /^"a11-[0-9a-f]{16}"$/);
  const same = await ask(tag);
  assert.equal(same.status, 304, 'the same bytes');
  assert.equal(await same.text(), '');
  // replaced by hand: the same length, other bytes
  files['a/ROADMAP/tasks/t/assets/shot.png'] = 'new picture';
  const other = await ask(tag);
  assert.equal(other.status, 200, 'other bytes');
  assert.equal(await other.text(), 'new picture');
  assert.notEqual(other.headers.get('etag'), tag);
});
