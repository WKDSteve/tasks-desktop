// The parts of the browser tests that CI runs in parallel (e2e/shard.ts). No page, no hub: only the reading of
// E2E_SHARD, which decides what every CI job runs.

import { expect, test } from '@playwright/test';
import { shardOf } from './shard';

test('without E2E_SHARD the whole suite runs', () => {
  expect(shardOf({})).toBeNull();
  expect(shardOf({ E2E_SHARD: '' })).toBeNull();
});

test('E2E_SHARD names the part and the number of parts', () => {
  expect(shardOf({ E2E_SHARD: '1/4' })).toEqual({ current: 1, total: 4 });
  expect(shardOf({ E2E_SHARD: '4/4' })).toEqual({ current: 4, total: 4 });
  expect(shardOf({ E2E_SHARD: '12/12' })).toEqual({ current: 12, total: 12 });
});

test('a malformed E2E_SHARD fails instead of running everything or nothing', () => {
  for (const bad of ['0/4', '5/4', '1/0', '1', '1/4/2', ' 1/4', 'a/b', '-1/4', '01/4']) {
    expect(() => shardOf({ E2E_SHARD: bad }), bad).toThrow(/E2E_SHARD/);
  }
});
