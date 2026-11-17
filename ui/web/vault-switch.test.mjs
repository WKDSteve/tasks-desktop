// Switching between the vaults used before, in the web variant (src/web/vault-switch.ts): the list with the access of
// each folder, the click that asks the browser for a dropped access and loads the page again with the folder, the id
// handed to the next page once, the preferences kept per vault, and the hook for what hangs on a vault. No browser.
//
//   node --experimental-strip-types --test web/vault-switch.test.mjs        (from ui/)

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FolderVaults,
  forgetVaultPrefs,
  onVaultOpened,
  SWITCH_KEY,
  takeSwitch,
  UNREMEMBERED,
  VAULT_KEYS,
  vaultKeyOf,
  vaultOpened,
  vaultPrefs,
} from '../src/web/vault-switch.ts';

function storage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  };
}

/** Two folders used before; `perm` per name is what the browser says now, `grant` what asking again gives. */
function setup({ perm = {}, grant = {}, active = 'a' } = {}) {
  const log = [];
  const handles = { a: { kind: 'directory', name: 'tasks-vault' }, b: { kind: 'directory', name: 'tricentis-vault' } };
  const recent = {
    list: async () => [
      { id: 'a', name: 'tasks-vault', handle: handles.a, lastUsed: 2 },
      { id: 'b', name: 'tricentis-vault', handle: handles.b, lastUsed: 1 },
    ],
  };
  const tab = storage();
  const nameOf = (h) => (h === handles.a ? 'a' : 'b');
  const vaults = new FolderVaults({
    recent,
    active,
    tab,
    reload: () => log.push('reload'),
    permissionOf: async (h) => {
      log.push(`query ${nameOf(h)}`);
      const p = perm[nameOf(h)] ?? 'granted';
      if (p instanceof Error) throw p;
      return p;
    },
    grantAccess: async (h) => {
      log.push(`grant ${nameOf(h)}`);
      return grant[nameOf(h)] ?? 'granted';
    },
  });
  return { vaults, tab, log };
}

test('the list names every folder used before, marks the one read now and says the access each has', async () => {
  const { vaults } = setup({ perm: { b: 'prompt' } });
  assert.deepEqual(await vaults.list(), [
    { id: 'a', name: 'tasks-vault', active: true, access: 'granted' },
    { id: 'b', name: 'tricentis-vault', active: false, access: 'prompt' },
  ]);
  // A folder whose permission cannot be read is listed as one without access, not dropped and not thrown.
  const broken = setup({ perm: { b: new Error('boom') } });
  assert.equal((await broken.vaults.list())[1].access, 'denied');
});

test('a click on a folder with access loads the page again with it, and only its id goes into the tab', async () => {
  const { vaults, tab, log } = setup();
  assert.equal(await vaults.select('b'), 'switched');
  assert.deepEqual(log, ['query b', 'reload']);
  assert.deepEqual([...tab.map], [[SWITCH_KEY, 'b']]);
});

test('a dropped access is asked for inside the click, before the page loads again', async () => {
  const { vaults, tab, log } = setup({ perm: { b: 'prompt' } });
  assert.equal(await vaults.select('b'), 'switched');
  assert.deepEqual(log, ['query b', 'grant b', 'reload']);
  assert.equal(tab.getItem(SWITCH_KEY), 'b');
});

test('a refused access, a folder that is gone or one not in the list leaves the page as it is', async () => {
  for (const [opts, id, want] of [
    [{ perm: { b: 'prompt' }, grant: { b: 'denied' } }, 'b', 'denied'],
    [{ perm: { b: 'denied' } }, 'b', 'denied'],
    [{ perm: { b: 'gone' } }, 'b', 'gone'],
    [{ perm: { b: new Error('boom') } }, 'b', 'denied'],
    [{}, 'nope', 'gone'],
  ]) {
    const { vaults, tab, log } = setup(opts);
    assert.equal(await vaults.select(id), want, JSON.stringify([opts, id]));
    assert.ok(!log.includes('reload'), 'no reload');
    assert.equal(tab.getItem(SWITCH_KEY), null, 'nothing for the next page');
  }
});

test('the vault read now is not opened again', async () => {
  const { vaults, log } = setup();
  assert.equal(await vaults.select('a'), 'same');
  assert.deepEqual(log, []);
});

test('a tab that keeps nothing still switches: the next page shows the way in', async () => {
  const log = [];
  const blocked = new FolderVaults({
    recent: { list: async () => [{ id: 'b', name: 'x', handle: {}, lastUsed: 1 }] },
    active: 'a',
    tab: { getItem: () => null, setItem: () => { throw new Error('blocked'); }, removeItem: () => {} },
    reload: () => log.push('reload'),
    permissionOf: async () => 'granted',
  });
  assert.equal(await blocked.select('b'), 'switched');
  assert.deepEqual(log, ['reload']);
});

test('the next page takes the folder once', () => {
  const tab = storage();
  assert.equal(takeSwitch(tab), null);
  tab.setItem(SWITCH_KEY, 'b');
  assert.equal(takeSwitch(tab), 'b');
  assert.equal(takeSwitch(tab), null, 'taken out: a reload later does not switch again');
  tab.setItem(SWITCH_KEY, '');
  assert.equal(takeSwitch(tab), null);
  assert.equal(takeSwitch({ getItem: () => { throw new Error('blocked'); }, removeItem: () => {} }), null);
});

test("filter, order, view, lists and the rest of a vault are kept per vault; the person's own are the same in every vault", () => {
  const prefs = storage();
  const a = vaultPrefs(prefs, 'a');
  const b = vaultPrefs(prefs, 'b');
  a.setItem('tasks-desktop.filter', 'area=pub');
  a.setItem('tasks-desktop.view', 'board');
  a.setItem('tasks-desktop.lang', 'de');
  b.setItem('tasks-desktop.view', 'list');
  assert.equal(a.getItem('tasks-desktop.filter'), 'area=pub');
  assert.equal(b.getItem('tasks-desktop.filter'), null, 'the other vault does not see the filter');
  assert.equal(a.getItem('tasks-desktop.view'), 'board');
  assert.equal(b.getItem('tasks-desktop.view'), 'list');
  assert.equal(b.getItem('tasks-desktop.lang'), 'de', "the language is the person's");
  assert.equal(prefs.getItem('tasks-desktop.filter'), null, 'nothing under the plain key');
  for (const key of ['filter', 'sort', 'view', 'view-open', 'lists', 'folds', 'graph-order', 'frecency', 'defaults']) {
    assert.ok(VAULT_KEYS.includes(`tasks-desktop.${key}`), key);
  }
  // A folder the browser could not remember keeps them apart from the others, never under the plain key.
  vaultPrefs(prefs, null).setItem('tasks-desktop.filter', 'x');
  assert.equal(prefs.getItem('tasks-desktop.filter'), null);
  assert.equal(prefs.getItem(`tasks-desktop.filter@${UNREMEMBERED}`), 'x');
  assert.equal(b.getItem('tasks-desktop.filter'), null);
  // Forgetting a folder drops its preferences (the task ids the palette ranks among them), not the other's.
  a.setItem('tasks-desktop.frecency', '{"pub/one":3}');
  forgetVaultPrefs(prefs, 'a');
  assert.equal(a.getItem('tasks-desktop.view'), null);
  assert.equal(a.getItem('tasks-desktop.frecency'), null);
  assert.equal(b.getItem('tasks-desktop.view'), 'list');
  assert.equal(prefs.getItem('tasks-desktop.lang'), 'de');
});

test('what was kept before the page kept it per vault goes to the first vault opened, and no other reads it', () => {
  const prefs = storage();
  prefs.setItem('tasks-desktop.filter', 'area=old');
  prefs.setItem('tasks-desktop.sort', 'prio');
  prefs.setItem('tasks-desktop.lang', 'de');
  prefs.setItem(vaultKeyOf('tasks-desktop.sort', 'a'), 'due');
  const a = vaultPrefs(prefs, 'a');
  assert.equal(a.getItem('tasks-desktop.filter'), 'area=old', 'taken over');
  assert.equal(a.getItem('tasks-desktop.sort'), 'due', "a vault's own value is not written over");
  assert.equal(prefs.getItem('tasks-desktop.filter'), null, 'the plain key is gone');
  assert.equal(prefs.getItem('tasks-desktop.sort'), null);
  assert.equal(prefs.getItem('tasks-desktop.lang'), 'de', "the person's own stay");
  const b = vaultPrefs(prefs, 'b');
  assert.equal(b.getItem('tasks-desktop.filter'), null, 'the next vault starts with its own, empty');
  assert.equal(b.getItem('tasks-desktop.sort'), null);
  // Blocked storage: the page still gets its preferences object.
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => {}, removeItem: () => {} };
  assert.ok(vaultPrefs(blocked, 'a'));
});

test('a change that began while the browser asked for the folder keeps the page where it is', async () => {
  let writing = false;
  const log = [];
  const tab = storage();
  const vaults = new FolderVaults({
    recent: { list: async () => [{ id: 'b', name: 'x', handle: {}, lastUsed: 1 }] },
    active: 'a',
    tab,
    reload: () => log.push('reload'),
    permissionOf: async () => 'prompt',
    // The first question takes long enough for a write to begin; the second one does not.
    grantAccess: async () => {
      if (log.length === 0) writing = true;
      log.push('asked');
      return 'granted';
    },
    writing: () => writing,
  });
  assert.equal(await vaults.select('b'), 'busy');
  assert.deepEqual(log, ['asked'], 'no reload');
  assert.equal(tab.getItem(SWITCH_KEY), null, 'nothing that a later reload would take for a switch');
  writing = false;
  assert.equal(await vaults.select('b'), 'switched');
  assert.deepEqual(log, ['asked', 'asked', 'reload']);
});

test('the hooks are told of the vault opened; one that throws keeps no other from it, and a hook can leave', () => {
  const seen = [];
  const offBad = onVaultOpened(() => {
    throw new Error('boom');
  });
  const off = onVaultOpened((v) => seen.push(v));
  vaultOpened({ folder: 'b', name: 'tricentis-vault' });
  assert.deepEqual(seen, [{ folder: 'b', name: 'tricentis-vault' }]);
  off();
  offBad();
  vaultOpened({ folder: 'a', name: 'tasks-vault' });
  assert.equal(seen.length, 1);
});
