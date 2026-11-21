// The start check of the hub tests: both pages of the checkout must be built and be the ones the hub serves.
// A missing ui/dist-mobile used to show only as a silent 404 in the six phone cases, after a full run.
//
//   node --experimental-strip-types --test web/e2e-fresh.test.mjs        (from ui/)

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { interfaceProblem } from '../e2e/fresh.ts';
import { testDir } from './tmp.mjs';

const DESKTOP = '<!doctype html><title>desktop</title>\n';
const PHONE = '<!doctype html><title>phone</title>\n';

/** A checkout with the pages given (`null`: not built). */
function checkout(t, { desktop = DESKTOP, phone = PHONE } = {}) {
  const repo = testDir(t, 'fresh');
  for (const [dir, body] of [
    ['dist', desktop],
    ['dist-mobile', phone],
  ]) {
    if (body === null) continue;
    mkdirSync(join(repo, 'ui', dir), { recursive: true });
    writeFileSync(join(repo, 'ui', dir, 'index.html'), body);
  }
  return repo;
}

/** A hub that serves `pages` (path -> body); any other path is a 404. */
const hub = (pages) => async (path) => (path in pages ? pages[path] : null);

test('a hub with both pages of the checkout passes', async (t) => {
  assert.equal(await interfaceProblem(checkout(t), hub({ '/': DESKTOP, '/m/': PHONE })), null);
});

test('a checkout without ui/dist-mobile names build-mobile.py and cargo build', async (t) => {
  const problem = await interfaceProblem(checkout(t, { phone: null }), hub({ '/': DESKTOP, '/m/': PHONE }));
  assert.match(problem ?? '', /ui\/dist-mobile is not built/);
  assert.match(problem ?? '', /python tools\/build-mobile\.py/);
  assert.match(problem ?? '', /cargo build/);
});

test('a hub built without the phone page (404 on /m/) is told apart like an older interface', async (t) => {
  const problem = await interfaceProblem(checkout(t), hub({ '/': DESKTOP }));
  assert.match(problem ?? '', /no or an older phone page/);
});

test('a hub with an older phone page is caught', async (t) => {
  const problem = await interfaceProblem(checkout(t), hub({ '/': DESKTOP, '/m/': '<title>old</title>' }));
  assert.match(problem ?? '', /no or an older phone page/);
});

test('the desktop page keeps its messages', async (t) => {
  assert.match(
    (await interfaceProblem(checkout(t, { desktop: null }), hub({}))) ?? '',
    /ui\/dist is not built: run `pnpm build` and `cargo build`/,
  );
  assert.match(
    (await interfaceProblem(checkout(t), hub({ '/': '<title>old</title>', '/m/': PHONE }))) ?? '',
    /older interface/,
  );
});
