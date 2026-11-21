// The state of the repos of the tiles: the checkout of each (clean, changed, ahead, behind) and the CI of its newest
// pushed commit (green, red, running, queued, waiting for approval). The hub asks `git` and `gh` and judges; this
// reads its answer strictly and says how a state is shown. A light is never a colour alone: each state has its own
// sign and its word.

/** The checkout of a repo, or why the hub could not look at it. */
export type LocalState = 'clean' | 'dirty' | 'unpushed' | 'behind' | 'diverged' | 'unavailable';
/** The CI of the newest pushed commit. `approval`: the runner refused the job until the commit is approved. */
export type CiState = 'green' | 'red' | 'running' | 'queued' | 'approval' | 'cancelled' | 'skipped' | 'none' | 'unavailable';

/** The answer of the hub for one repo (`hub.repo_status`). */
export interface RepoStatus {
  local: {
    state: LocalState;
    branch?: string;
    changed: number;
    ahead: number;
    behind: number;
    gone: boolean;
    /** Why the checkout could not be looked at (`no_git`, `not_a_repo`, `no_folder`, `failed`). */
    reason?: string;
  };
  ci: {
    state: CiState;
    /** The run to open on github.com. */
    url?: string;
    sha?: string;
    /** The command that approves the commit (only with `approval`). */
    trust?: string;
    /** Why there is no answer (`no_gh`, `login`, `offline`, `no_remote`, `failed`). */
    reason?: string;
  };
}

const LOCAL: readonly string[] = ['clean', 'dirty', 'unpushed', 'behind', 'diverged', 'unavailable'];
const CI: readonly string[] = ['green', 'red', 'running', 'queued', 'approval', 'cancelled', 'skipped', 'none', 'unavailable'];
const LOCAL_REASONS: readonly string[] = ['no_git', 'not_a_repo', 'no_folder', 'failed'];
const CI_REASONS: readonly string[] = ['no_gh', 'login', 'offline', 'no_remote', 'failed'];
/** The only address the page links to: a run of GitHub Actions. */
const RUN_URL = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/actions\/runs\/\d+$/;
/** The only command the page offers to copy. */
const TRUST = /^testing ci trust [A-Za-z0-9._-]+\/[A-Za-z0-9._-]+ [0-9a-fA-F]{1,64}$/;

const count = (value: unknown): number => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0);
const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

/**
 * Read an answer of the hub, refusing what is not one. A state this page does not know is `unavailable` (never shown
 * as green); a link that is no run of GitHub and a command that is not the one to approve a commit are dropped.
 */
export function parseRepoStatus(value: unknown): RepoStatus {
  const doc = (value ?? {}) as Record<string, unknown>;
  if (doc['kind'] !== 'hub.repo_status') throw new Error('not a repo status of the hub');
  const local = (doc['local'] ?? {}) as Record<string, unknown>;
  const ci = (doc['ci'] ?? {}) as Record<string, unknown>;
  const localState = LOCAL.includes(local['state'] as string) ? (local['state'] as LocalState) : 'unavailable';
  const ciState = CI.includes(ci['state'] as string) ? (ci['state'] as CiState) : 'unavailable';
  const branch = text(local['branch']);
  const localReason = text(local['reason']);
  const url = text(ci['url']);
  const sha = text(ci['sha']);
  const trust = text(ci['trust']);
  const ciReason = text(ci['reason']);
  return {
    local: {
      state: localState,
      ...(branch !== undefined ? { branch } : {}),
      changed: count(local['changed']),
      ahead: count(local['ahead']),
      behind: count(local['behind']),
      gone: local['gone'] === true,
      ...(localState === 'unavailable' ? { reason: localReason !== undefined && LOCAL_REASONS.includes(localReason) ? localReason : 'failed' } : {}),
    },
    ci: {
      state: ciState,
      ...(url !== undefined && RUN_URL.test(url) ? { url } : {}),
      ...(sha !== undefined && /^[0-9a-fA-F]{1,64}$/.test(sha) ? { sha } : {}),
      ...(ciState === 'approval' && trust !== undefined && TRUST.test(trust) ? { trust } : {}),
      ...(ciState === 'unavailable' ? { reason: ciReason !== undefined && CI_REASONS.includes(ciReason) ? ciReason : 'failed' } : {}),
    },
  };
}

/** The sign of a CI state: a shape of its own for each, beside its word. */
export const CI_SIGN: Record<CiState, string> = {
  green: '●',
  red: '▲',
  running: '◐',
  queued: '◌',
  approval: '⏸',
  cancelled: '⊘',
  skipped: '↷',
  none: '–',
  unavailable: '?',
};

/** The sign of a checkout. */
export const LOCAL_SIGN: Record<LocalState, string> = {
  clean: '●',
  dirty: '✎',
  unpushed: '↑',
  behind: '↓',
  diverged: '⇅',
  unavailable: '?',
};

/** How urgent a row is: what needs a look comes first (red, then waiting for approval, ...). */
const URGENCY: readonly CiState[] = ['red', 'approval', 'queued', 'running', 'unavailable', 'cancelled', 'none', 'skipped', 'green'];

/** Rows in the order of the view: the more urgent CI state first, then a checkout that is not clean, then by name. */
export function byUrgency<T extends { name: string; status: RepoStatus | null }>(rows: readonly T[]): T[] {
  const rank = (row: T): number => (row.status === null ? URGENCY.length : URGENCY.indexOf(row.status.ci.state));
  const dirty = (row: T): number => (row.status === null || row.status.local.state === 'clean' ? 1 : 0);
  return rows.toSorted((a, b) => rank(a) - rank(b) || dirty(a) - dirty(b) || a.name.localeCompare(b.name));
}

/**
 * Run `task` for every item, `width` at a time (the hub starts a `git` and a `gh` for each repo: a page with thirty
 * tiles must not start sixty processes at once). Resolves when all are through; a task that fails stops nothing.
 */
export async function inTurns<T>(items: readonly T[], width: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next]!;
      next += 1;
      try {
        await task(item);
      } catch {
        // The task says its own failure (a row that shows it); the others go on.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(width, items.length)) }, worker));
}
