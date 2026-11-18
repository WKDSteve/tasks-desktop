import { describe, expect, it } from 'vitest';
import { byUrgency, CI_SIGN, inTurns, LOCAL_SIGN, parseRepoStatus, type CiState, type RepoStatus } from './repoStatus';

const answer = (local: Record<string, unknown>, ci: Record<string, unknown>) => ({ kind: 'hub.repo_status', id: 'abcd1234', local, ci });

describe('the state of a repo, as the hub tells it', () => {
  it('is read with its numbers, the run and the command to approve', () => {
    expect(
      parseRepoStatus(
        answer(
          { state: 'dirty', branch: 'main', changed: 3, ahead: 1, behind: 0, gone: false },
          { state: 'approval', url: 'https://github.com/o/streamtap/actions/runs/5', sha: 'abc1234', trust: 'testing ci trust o/streamtap abc1234' },
        ),
      ),
    ).toEqual({
      local: { state: 'dirty', branch: 'main', changed: 3, ahead: 1, behind: 0, gone: false },
      ci: { state: 'approval', url: 'https://github.com/o/streamtap/actions/runs/5', sha: 'abc1234', trust: 'testing ci trust o/streamtap abc1234' },
    });
  });

  it('drops a link that is no run of GitHub and a command that is not the one to approve', () => {
    const read = (ci: Record<string, unknown>) => parseRepoStatus(answer({ state: 'clean' }, ci)).ci;
    for (const url of ['javascript:alert(1)', 'https://github.com.evil.example/o/r/actions/runs/1', 'https://github.com/o/r/actions/runs/1?x', 'http://github.com/o/r/actions/runs/1']) {
      expect(read({ state: 'red', url }), url).toEqual({ state: 'red' });
    }
    expect(read({ state: 'approval', trust: 'rm -rf ~' })).toEqual({ state: 'approval' });
    expect(read({ state: 'approval', trust: 'testing ci trust o/r abc; id' })).toEqual({ state: 'approval' });
    // The command belongs to a commit that waits for approval, to no other state.
    expect(read({ state: 'red', trust: 'testing ci trust o/r abc' })).toEqual({ state: 'red' });
  });

  it('never shows a state it does not know as fine, and words every reason from a fixed set', () => {
    const odd = parseRepoStatus(answer({ state: 'sparkling' }, { state: 'purple' }));
    expect(odd.local).toMatchObject({ state: 'unavailable', reason: 'failed' });
    expect(odd.ci).toEqual({ state: 'unavailable', reason: 'failed' });
    const known = parseRepoStatus(answer({ state: 'unavailable', reason: 'no_git' }, { state: 'unavailable', reason: 'offline' }));
    expect(known.local.reason).toBe('no_git');
    expect(known.ci.reason).toBe('offline');
    const made = parseRepoStatus(answer({ state: 'unavailable', reason: 'C:\\secret' }, { state: 'unavailable', reason: '<b>x</b>' }));
    expect(made.local.reason).toBe('failed');
    expect(made.ci.reason).toBe('failed');
    expect(parseRepoStatus(answer({ state: 'clean', changed: -1, ahead: 'x' }, { state: 'green' })).local).toMatchObject({ changed: 0, ahead: 0 });
  });

  it('is refused when it is no answer of the hub', () => {
    expect(() => parseRepoStatus({ kind: 'hub.repos' })).toThrow();
    expect(() => parseRepoStatus(null)).toThrow();
  });

  it('has a sign of its own for every state: a light is never a colour alone', () => {
    expect(new Set(Object.values(CI_SIGN)).size).toBe(Object.keys(CI_SIGN).length);
    expect(new Set(Object.values(LOCAL_SIGN)).size).toBe(Object.keys(LOCAL_SIGN).length);
  });
});

describe('the order of the rows', () => {
  const row = (name: string, ci: CiState | null, local: RepoStatus['local']['state'] = 'clean') => ({
    name,
    status: ci === null ? null : ({ local: { state: local, changed: 0, ahead: 0, behind: 0, gone: false }, ci: { state: ci } } satisfies RepoStatus),
  });

  it('puts what needs a look first: red, waiting for approval, then the rest; a changed checkout before a clean one', () => {
    const rows = [row('zeta', 'green'), row('wait', 'approval'), row('asked', null), row('alpha', 'green', 'dirty'), row('bad', 'red'), row('beta', 'green')];
    expect(byUrgency(rows).map((r) => r.name)).toEqual(['bad', 'wait', 'alpha', 'beta', 'zeta', 'asked']);
  });
});

describe('asking in turns', () => {
  it('runs every task, never more than the width at once, and goes on after one that fails', async () => {
    let running = 0;
    let most = 0;
    const done: number[] = [];
    await inTurns([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 2));
      running -= 1;
      if (n === 4) throw new Error('no');
      done.push(n);
    });
    expect(most).toBe(3);
    expect(done.sort()).toEqual([1, 2, 3, 5, 6, 7]);
    await inTurns([], 3, async () => undefined);
  });
});
