// How a list of tasks shows the areas they are of (a trial, Options > "Separate areas in lists"). The page reckons
// nothing of the tasks here: it looks at the order it was given. Where that order keeps every area together, each area
// gets a head; where it mixes them, each row gets a band in the colour of its area and the area's name. One area alone
// gets neither.

/** How many colours the bands have (`--area-1` ... `--area-8` in app.css); more areas than that share colours. */
export const AREA_COLOURS = 8;

/**
 * The colour of an area, 1 to `AREA_COLOURS`: from its name alone (FNV-1a), so the same area has the same colour in
 * every list, on every page and after every reload, whatever other areas there are. Two areas can get the same colour;
 * the name stands beside the band for that.
 */
export function areaColour(name: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % AREA_COLOURS) + 1;
}

/** `none`: one area or no task; `groups`: the order keeps each area together; `bands`: it mixes them. */
export type AreaLayout = 'none' | 'groups' | 'bands';

/** The tasks of one area that follow each other in a list. */
export interface AreaRun<T> {
  area: string;
  tasks: T[];
}

/** The list cut where the area changes, in its order. */
export function areaRuns<T extends { area: string }>(tasks: readonly T[]): AreaRun<T>[] {
  const runs: AreaRun<T>[] = [];
  for (const task of tasks) {
    const last = runs[runs.length - 1];
    if (last && last.area === task.area) last.tasks.push(task);
    else runs.push({ area: task.area, tasks: [task] });
  }
  return runs;
}

/**
 * The list with the tasks of each area together (the list's "Group by area"): the areas in the order their first task
 * has in the list, the tasks of an area in the order they had. Nothing is reckoned: the order the engine gave is kept
 * inside every area. The same array when the order keeps the areas together already.
 */
export function groupedByArea<T extends { area: string }>(tasks: readonly T[]): readonly T[] {
  if (areaLayout(tasks) !== 'bands') return tasks;
  const byArea = new Map<string, T[]>();
  for (const task of tasks) {
    const list = byArea.get(task.area);
    if (list) list.push(task);
    else byArea.set(task.area, [task]);
  }
  return [...byArea.values()].flat();
}

/** What the order of `tasks` allows: heads only when no area comes back after another one. */
export function areaLayout(tasks: readonly { area: string }[]): AreaLayout {
  const seen = new Set<string>();
  let last: string | undefined;
  let mixed = false;
  for (const task of tasks) {
    if (task.area === last) continue;
    if (seen.has(task.area)) mixed = true;
    seen.add(task.area);
    last = task.area;
  }
  if (seen.size < 2) return 'none';
  return mixed ? 'bands' : 'groups';
}

/** How many tasks each area has in `tasks`. */
export function areaTotals(tasks: readonly { area: string }[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const task of tasks) totals.set(task.area, (totals.get(task.area) ?? 0) + 1);
  return totals;
}
