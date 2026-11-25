// The checklists in the web variant without an engine: the query of `checklist` judged as the Rust hub judges it, the
// rules of a file the page sends, and the attachments the VM holds as placeholders (read by name, moved and removed on
// disk by the write-back, never written as bytes).
//
//   node --experimental-strip-types --test web/checklist-web.test.mjs        (from ui/)

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checklistParams, decodedText, validListId } from '../src/web/hub.ts';
import { boardRequest, cleanName, extensionAllowed, refusedName, uploadKind } from '../src/web/uploads.ts';
import { isAssetPath, loadsWhole, placeholderOf, placeholderPath, readVaultFolder, vaultStamps } from '../src/web/vault-files.ts';
import { makeBaseline, refusalOfPath, writeBack } from '../src/web/write-back.ts';
import { fakeDisk } from './fake-folder.mjs';

const changes = (part = {}) => ({ added: [], modified: [], removed: [], removedDirs: [], ...part });

test('the query of a checklist is judged as the hub judges it', () => {
  assert.deepEqual(checklistParams('id=_list-a'), { id: '_list-a' });
  assert.deepEqual(
    checklistParams('id=_list-a&since=2026-01-01&until=2026-01-31&tag=hiva&q=%C3%84rger%20mit%20SAP&state=open&limit=50&offset=100'),
    { id: '_list-a', since: '2026-01-01', until: '2026-01-31', tag: 'hiva', q: 'Ärger mit SAP', state: 'open', limit: 50, offset: 100 },
  );
  assert.deepEqual(checklistParams('id=_list-a&q=a/b'), { id: '_list-a', q: 'a/b' }, 'a slash is left as it is');
  assert.equal(checklistParams(''), 'id must be _list-<slug>');
  assert.equal(checklistParams('id=work/x'), 'id must be _list-<slug>');
  assert.equal(checklistParams('id=_list-a&since=2026-02-30'), 'since and until are days, YYYY-MM-DD');
  assert.equal(checklistParams('id=_list-a&state=late'), 'state is open, done or all');
  assert.equal(checklistParams('id=_list-a&limit=0'), 'limit is 1 to 100');
  assert.equal(checklistParams('id=_list-a&q=a&q=b'), 'a query parameter is given twice');
  assert.equal(checklistParams('id=_list-a&q=%0A'), 'q is a text of at most 200 bytes');
  assert.equal(checklistParams('id=_list-a&q=a b'), 'q is a text of at most 200 bytes');
  assert.equal(checklistParams(`id=_list-a&tag=${'a'.repeat(41)}`), 'tag is a word of at most 40 bytes');
  assert.equal(checklistParams('id=_list-a&area=x'), 'unknown query parameter');
  for (const bad of ['support', '_list-', '_list-Support', '_list--x', '_list-x-', '_list-a/b']) assert.equal(validListId(bad), false, bad);
  assert.equal(decodedText('%E2%82%AC', 10), '€');
  assert.equal(decodedText('%FF', 10), null, 'no UTF-8');
  assert.equal(decodedText('%20', 10), null, 'blank only');
});

test('a file of the page: its kind, its name and its ending', () => {
  assert.equal(uploadKind(undefined), undefined);
  assert.equal(uploadKind('audio'), 'audio');
  assert.equal(uploadKind('sound'), null);
  assert.equal(refusedName('a\u0007.png'), true);
  assert.equal(refusedName('a\u202e.png'), true, 'a formatting character');
  assert.equal(refusedName('../a.png'), true);
  assert.equal(refusedName('Bild 1.png'), false);
  assert.equal(cleanName('C:\\x\\Bild 1 (neu).png'), 'Bild-1--neu-.png');
  assert.equal(cleanName('a..b.png'), 'a.b.png');
  assert.equal(cleanName('nul.txt'), '_nul.txt');
  assert.equal(extensionAllowed('a.png', 'image'), true);
  assert.equal(extensionAllowed('a.pdf', 'image'), false);
  assert.equal(extensionAllowed('memo.webm', 'audio'), true);
  assert.equal(extensionAllowed('run.exe', undefined), false);
  assert.equal(extensionAllowed('noending', undefined), false);
});

test('a board is judged before the engine sees it', () => {
  const id = (x) => typeof x === 'string' && /^[^/]+\/[^/]+$/.test(x);
  const ok = boardRequest(JSON.stringify({ id: '_list-a/e', name: 'skizze', ink: '{"strokes":[]}', svg: '<svg/>' }), id);
  assert.deepEqual(ok, { id: '_list-a/e', name: 'skizze', ink: '{"strokes":[]}', svg: '<svg/>' });
  assert.equal(boardRequest('[]', id).code, 'bad_request');
  assert.equal(boardRequest(JSON.stringify({ id: 'x', name: 'a', ink: '{}', svg: '<svg/>' }), id).code, 'bad_id');
  assert.equal(boardRequest(JSON.stringify({ id: 'a/b', name: 'a.b', ink: '{}', svg: '<svg/>' }), id).code, 'bad_name');
  assert.equal(boardRequest(JSON.stringify({ id: 'a/b', name: 'a', if_match: 'x', ink: '{}', svg: '<svg/>' }), id).code, 'bad_if_match');
  assert.equal(boardRequest(JSON.stringify({ id: 'a/b', name: 'a', ink: '[]', svg: '<svg/>' }), id).code, 'bad_board');
  assert.equal(boardRequest(JSON.stringify({ id: 'a/b', name: 'a', ink: '{}', svg: 'x' }), id).code, 'bad_board');
});

test('an attachment is held by name, a board whole', async () => {
  assert.equal(isAssetPath('A/ROADMAP/tasks/t/assets/x.png'), true);
  assert.equal(isAssetPath('assets/x.png'), false, 'never the root of the vault');
  assert.equal(loadsWhole('_list-a/e/assets/boards/b.ink.json'), true);
  assert.equal(loadsWhole('_list-a/e/assets/images/b.png'), false);
  assert.equal(placeholderPath(placeholderOf('a/assets/x.png')), 'a/assets/x.png');
  assert.equal(placeholderPath(new TextEncoder().encode('tasks-web-asset/1\nx\n')), null, 'a text is no placeholder');

  const disk = fakeDisk({
    'A/ROADMAP/tasks/t/t.md': 'task',
    'A/ROADMAP/tasks/t/assets/big.mp4': 'V'.repeat(5000),
    'A/ROADMAP/tasks/t/assets/boards/b.ink.json': '{"strokes":[]}',
  });
  const vault = await readVaultFolder(disk.root, { maxFileBytes: 100 });
  assert.deepEqual(vault.skipped, [], 'an attachment over the size of a text file is no reason to refuse the vault');
  assert.equal(placeholderPath(vault.files.get('A/ROADMAP/tasks/t/assets/big.mp4')), 'A/ROADMAP/tasks/t/assets/big.mp4');
  assert.equal(vault.stamps.get('A/ROADMAP/tasks/t/assets/big.mp4').size, 5000, 'the stamp is the real file');
  assert.equal(new TextDecoder().decode(vault.files.get('A/ROADMAP/tasks/t/assets/boards/b.ink.json')), '{"strokes":[]}');
  const stamps = await vaultStamps(disk.root);
  assert.ok(stamps.has('A/ROADMAP/tasks/t/assets/big.mp4'), 'a changed attachment changes the signature');
  assert.equal(refusalOfPath('A/ROADMAP/tasks/t/assets/x.png'), null);
  assert.match(refusalOfPath('A/ROADMAP/tasks/x.png'), /not a place/);
});

test('a placeholder the engine removed removes the real file; one it changed or made of nothing is refused', async () => {
  const disk = fakeDisk({ 'A/ROADMAP/tasks/t/t.md': 'task', 'A/ROADMAP/tasks/t/assets/x.png': 'PNG' });
  const vault = await readVaultFolder(disk.root);
  const baseline = await makeBaseline(vault);
  assert.equal(baseline.get('A/ROADMAP/tasks/t/assets/x.png').placeholder, true);

  const changed = await writeBack({
    root: disk.root,
    baseline,
    changes: changes({ modified: ['A/ROADMAP/tasks/t/assets/x.png'] }),
    files: new Map([['A/ROADMAP/tasks/t/assets/x.png', placeholderOf('A/ROADMAP/tasks/t/assets/x.png')]]),
  });
  assert.equal(changed.status, 'refused');
  const copied = await writeBack({
    root: disk.root,
    baseline,
    changes: changes({ added: ['A/ROADMAP/tasks/u/assets/x.png'] }),
    files: new Map([['A/ROADMAP/tasks/u/assets/x.png', placeholderOf('A/ROADMAP/tasks/t/assets/x.png')]]),
  });
  assert.equal(copied.status, 'refused', 'a placeholder is moved, never copied');
  assert.equal(disk.read('A/ROADMAP/tasks/u/assets/x.png'), undefined);

  // a real file changed on disk since it was read: by its stamp, a conflict
  disk.touch('A/ROADMAP/tasks/t/assets/x.png');
  const stale = await writeBack({ root: disk.root, baseline, changes: changes({ removed: ['A/ROADMAP/tasks/t/assets/x.png'] }), files: new Map() });
  assert.equal(stale.status, 'conflict');
  assert.equal(disk.read('A/ROADMAP/tasks/t/assets/x.png'), 'PNG');

  const fresh = await makeBaseline(await readVaultFolder(disk.root));
  const gone = await writeBack({ root: disk.root, baseline: fresh, changes: changes({ removed: ['A/ROADMAP/tasks/t/assets/x.png'] }), files: new Map() });
  assert.equal(gone.status, 'written', JSON.stringify(gone));
  assert.equal(disk.read('A/ROADMAP/tasks/t/assets/x.png'), undefined);
});

test('every module the worker imports is in the script of the worker (it is built of WORKER_MODULES, imports dropped)', async () => {
  const { readFileSync } = await import('node:fs');
  const { WORKER_MODULES } = await import('./worker-source.mjs');
  const source = readFileSync(new URL('../src/web/worker.ts', import.meta.url), 'utf8');
  const local = [...source.matchAll(/from '\.\/([\w-]+\.ts)'/g)].map((m) => m[1]);
  for (const file of local) assert.ok(WORKER_MODULES.includes(file), `worker.ts imports ${file}, which the worker script does not hold`);
});
