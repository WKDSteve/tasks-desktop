// Who cleans the shared vault of the browser tests. The tests of one run share one vault, and `vaultClean` removes what a
// test made in it. With one worker (the setting of the config) that is a comparison of the folders before and after the
// test. With more workers (`--workers=2` by hand) the tasks another worker made meanwhile are "new" as well, and the
// comparison removed them from under that test (the list of `pick.spec.ts` went empty in the middle of a choice).
//
// So a test that was alone for its whole time removes what is new, as before. A test that was not alone cannot say which
// of the new files are its own: it leaves them and notes that, and the last test to end removes everything that is not in
// the vault of the start (`baseline.json`, written by the setup). Nothing here needs the tests to name their tasks.
//
// No Playwright in this file: `web/vault-share.test.mjs` loads it with Node.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Where a task can land: open tasks of every area, and those a test finished. And the saved views: a test that stops
 *  before it deletes its view would leave it chosen for the next (app.spec "a task moved between the groups of a view"
 *  broke off on the runner, and the board test after it found the view). */
const TASK_DIRS = [join('ROADMAP', 'tasks'), join('Backlog', 'TASKS'), join('ROADMAP', 'views')];

/** The path of every task (a file, or the folder of a folder task) and every saved view in the vault right now. */
export function vaultTasks(vault: string): Set<string> {
  const found = new Set<string>();
  if (!existsSync(vault)) return found;
  for (const area of readdirSync(vault, { withFileTypes: true })) {
    if (!area.isDirectory() || area.name.startsWith('.')) continue;
    for (const dir of TASK_DIRS) {
      const at = join(vault, area.name, dir);
      if (!existsSync(at)) continue;
      for (const entry of readdirSync(at)) found.add(join(at, entry));
    }
  }
  return found;
}

/** The folder of the registry of a run, beside its state file. */
export const registryOf = (stateFile: string): string => join(stateFile, '..', 'vault-share');

const BASELINE = 'baseline.json';

/** The setup writes the vault as it starts: what no test made. */
export function writeBaseline(registry: string, vault: string): void {
  mkdirSync(registry, { recursive: true });
  writeFileSync(join(registry, BASELINE), JSON.stringify([...vaultTasks(vault)]));
}

const lines = (file: string): string[] => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((l) => l !== '') : []);

/** Whether the process of a registered test still exists (a worker that died leaves its entry behind). */
function alive(id: string): boolean {
  const pid = Number.parseInt(id, 10);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** One test's part in the vault. */
export interface Share {
  /** Remove what the test made, if it can tell which it is; otherwise note that the last test has to. Callable often. */
  clean: () => void;
  /** The test is over: clean, leave the registry, and if this was the last test, remove what no test may leave. */
  leave: () => void;
  /** Whether another test was or is running beside this one. */
  shared: () => boolean;
}

/**
 * Join the vault as the test `id` (the process id first: `<pid>-<what you like>`). `remove` deletes a path.
 */
export function joinVault(vault: string, registry: string, id: string, remove: (path: string) => void = (p) => rmSync(p, { recursive: true, force: true })): Share {
  const active = join(registry, 'active');
  const starts = join(registry, 'starts');
  const deferred = join(registry, 'deferred');
  mkdirSync(active, { recursive: true });
  const others = (): string[] => readdirSync(active).filter((entry) => entry !== id && alive(entry));
  const before = vaultTasks(vault);
  const metAtStart = others().length > 0;
  // Counted before the own line is added: a test that starts between the count and the line is in the difference.
  const startedBefore = lines(starts).length;
  appendFileSync(starts, `${id}\n`);
  writeFileSync(join(active, id), '');
  const shared = (): boolean => metAtStart || lines(starts).length > startedBefore + 1 || others().length > 0;

  const clean = (): void => {
    if (shared()) {
      writeFileSync(deferred, '');
      return;
    }
    for (const path of vaultTasks(vault)) if (!before.has(path)) remove(path);
  };

  const leave = (): void => {
    clean();
    rmSync(join(active, id), { force: true });
    if (others().length > 0 || !existsSync(deferred)) return;
    if (!existsSync(join(registry, BASELINE))) return;
    const baseline = new Set(JSON.parse(readFileSync(join(registry, BASELINE), 'utf8')) as string[]);
    for (const path of vaultTasks(vault)) {
      // A test that begins now is not alone to clean for: stop at once.
      if (others().length > 0) return;
      if (!baseline.has(path)) remove(path);
    }
    rmSync(deferred, { force: true });
  };

  return { clean, leave, shared };
}
