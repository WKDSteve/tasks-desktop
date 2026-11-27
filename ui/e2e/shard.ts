// The part of the browser tests one CI job runs. CI splits them over parallel jobs (`E2E_SHARD=2/4`,
// .github/workflows/ci.yml); each job is a Playwright run of its own with its own hub (e2e/global.ts), so the tests of
// one part never meet those of another. Without the variable the whole suite runs, as on a developer's machine.

export interface Shard {
  current: number;
  total: number;
}

/** `E2E_SHARD` as Playwright's `shard`, or null when it is not set. A value that is set but malformed is an error: a
 *  typo in the workflow must not quietly run the whole suite in every job, nor none of it. */
export function shardOf(env: Record<string, string | undefined>): Shard | null {
  const raw = env['E2E_SHARD'];
  if (raw === undefined || raw === '') return null;
  const m = /^([1-9]\d*)\/([1-9]\d*)$/.exec(raw);
  const current = m ? Number(m[1]) : NaN;
  const total = m ? Number(m[2]) : NaN;
  if (!m || current > total) throw new Error(`E2E_SHARD must be <part>/<parts> with 1 <= part <= parts, not "${raw}"`);
  return { current, total };
}
