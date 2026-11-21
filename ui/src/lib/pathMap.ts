// The competence map of the learning paths (concept "Kompetenzkarte", tasks-desktop): every path a box, every project
// a frame around its paths, every `requires` an arrow from the requirement to the one that builds on it. Whether a
// requirement is met, whether a path waits, and the circles are the engine's (`tasks.paths` with capability
// `requires`, WEB-13); this file only lays them out: columns by the longest chain, rows against crossings, frames,
// arrows as curves. Pure, so it is tested without a page and measured (200 paths well under 50 ms).

import type { PathEntry, PathStage, Requires, WaitingOn } from './contract';

/** A project as the map needs it: the open ones of the snapshot, the finished ones a requirement names. */
export interface MapProject {
  id: string;
  title: string;
  requires?: Requires;
  waiting_on?: WaitingOn;
  done?: boolean;
  parked?: boolean;
}

export interface MapInput {
  /** The paths to draw (already filtered). */
  paths: readonly PathEntry[];
  /** Every project known (open and finished); a frame is drawn for those a shown path belongs to or an arrow names. */
  projects: readonly MapProject[];
  /** The circles of requirements as the engine found them (`requires_cycles`). */
  cycles?: readonly (readonly string[])[];
  /** Ids left out on purpose (finished ones hidden, another project chosen): no arrow to them, no ghost. */
  hidden?: ReadonlySet<string>;
  /** Small boxes (symbol and title only), for a zoom below 70 %. */
  compact?: boolean;
}

export type BoxKind = 'path' | 'ghost';

/** A box: a path, or a ghost for a requirement the map has no box for. Keys: `p:<id>` (path), `g:<id>` (ghost). */
export interface MapBox {
  key: string;
  id: string;
  kind: BoxKind;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The column (1 the roots); 0 in the area of a circle. */
  column: number;
  /** The project the path belongs to (its frame is drawn around it). */
  project?: string;
  cycle: boolean;
  entry?: PathEntry;
  /** A ghost: `unknown` (no path or project of that id) or `missing` (one the answer did not hold). */
  ghost?: 'unknown' | 'missing';
}

/** A frame around the paths of a project (`j:<id>`); a project without a path on the map is a frame of its own. */
export interface MapFrame {
  key: string;
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  members: string[];
  /** The column of a frame without paths (it stands in the chain itself), else 0. */
  column: number;
  project: MapProject;
  cycle: boolean;
}

export interface MapEdge {
  key: string;
  /** Keys of the ends: a box (`p:`, `g:`) or a frame (`j:`). */
  from: string;
  to: string;
  gate: 'soft' | 'hard';
  met: boolean;
  /** Part of a circle, or a requirement that names nothing: drawn red. */
  bad: boolean;
  d: string;
}

export interface CycleArea {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Each circle by its ids, the first again at the end (`A → B → A`). */
  cycles: string[][];
}

export interface PathMap {
  boxes: MapBox[];
  frames: MapFrame[];
  edges: MapEdge[];
  /** The number of columns (0: no box outside a circle). */
  columns: number;
  /** The left edge of each column (index 0 is column 1), for the column heads. */
  columnX: number[];
  width: number;
  height: number;
  cycleArea: CycleArea | null;
  boxW: number;
  boxH: number;
}

export const BOX = { w: 210, h: 88 } as const;
export const COMPACT = { w: 160, h: 40 } as const;
const COL_GAP = 72;
const ROW_GAP = 16;
const PAD = 16;
/** Room above the boxes for the heads of the columns. */
export const HEAD = 28;
const FRAME_PAD = 12;
const FRAME_TITLE = 28;
const BAND_GAP = 20;
const CYCLE_LINE = 22;

const pathKey = (id: string) => `p:${id}`;
const ghostKey = (id: string) => `g:${id}`;
const frameKey = (id: string) => `j:${id}`;

/**
 * The stage of a path: the engine's (`stage`, capability `requires`); an older engine has none, then what its status
 * and progress say (concept, section 3.6), never `waiting` (that needs the requirements).
 */
export function stageOf(entry: PathEntry): PathStage {
  if (entry.stage) return entry.stage;
  if (entry.status === 'done') return 'done';
  if (entry.status === 'parked') return 'parked';
  if (entry.status === 'doing' || entry.progress.learned + entry.progress.seen > 0) return 'doing';
  return 'idle';
}

/**
 * A requirement of the path that is soft and not met: the box keeps its stage and carries a hint ("!"). One that
 * names nothing is no hint but a fault of the file (a ghost with a red arrow).
 */
export function softOpen(entry: PathEntry): boolean {
  return (entry.requires ?? []).some((r) => r.gate === 'soft' && !r.met && r.kind !== 'unknown');
}

interface Unit {
  key: string;
  title: string;
  /** The units it builds on (keys of units, a frame expanded to its members). */
  deps: string[];
  project?: string;
  cycle: boolean;
  column: number;
  row: number;
}

export function layoutPathMap(input: MapInput): PathMap {
  const size = input.compact ? COMPACT : BOX;
  const hidden = input.hidden ?? new Set<string>();
  const projects = new Map(input.projects.map((p) => [p.id, p] as const));
  const paths = new Map(input.paths.map((p) => [p.id, p] as const));
  const circled = new Set((input.cycles ?? []).flat());

  // Which projects have a frame: those of a shown path, and those an arrow names (a frame of its own then).
  const members = new Map<string, string[]>();
  for (const p of input.paths) {
    if (p.project && projects.has(p.project) && !hidden.has(p.project)) {
      const list = members.get(p.project) ?? [];
      list.push(pathKey(p.id));
      members.set(p.project, list);
    }
  }
  const projectOf = (p: PathEntry): string | undefined => (p.project && members.has(p.project) ? p.project : undefined);
  // A project named by an arrow gets a frame even without a path on the map; its own requirements are followed too.
  const frameIds = new Set<string>(members.keys());
  const ghosts = new Map<string, 'unknown' | 'missing'>();
  const todo: string[] = [];
  const visit = (reqs: Requires | undefined) => {
    for (const r of reqs ?? []) {
      if (hidden.has(r.id)) continue;
      if (r.kind === 'project' && projects.has(r.id)) {
        if (!frameIds.has(r.id)) {
          frameIds.add(r.id);
          todo.push(r.id);
        }
      } else if (r.kind !== 'path' || !paths.has(r.id)) ghosts.set(r.id, r.kind === 'unknown' ? 'unknown' : (ghosts.get(r.id) ?? 'missing'));
    }
  };
  for (const p of input.paths) visit(p.requires);
  for (const id of members.keys()) visit(projects.get(id)!.requires);
  while (todo.length > 0) visit(projects.get(todo.pop()!)!.requires);

  // The end of a requirement as units: a path, a ghost, a frame's members (or the frame itself when it holds none).
  const unitsOf = (r: { id: string; kind: string }): string[] => {
    if (hidden.has(r.id)) return [];
    if (r.kind === 'project' && frameIds.has(r.id)) return members.get(r.id) ?? [frameKey(r.id)];
    if (r.kind === 'path' && paths.has(r.id)) return [pathKey(r.id)];
    return ghosts.has(r.id) ? [ghostKey(r.id)] : [];
  };
  const endOf = (r: { id: string; kind: string }): string | null => {
    if (hidden.has(r.id)) return null;
    if (r.kind === 'project' && frameIds.has(r.id)) return frameKey(r.id);
    if (r.kind === 'path' && paths.has(r.id)) return pathKey(r.id);
    return ghosts.has(r.id) ? ghostKey(r.id) : null;
  };

  const units = new Map<string, Unit>();
  for (const p of input.paths) {
    const project = projectOf(p);
    const reqs = [...(p.requires ?? []), ...(project ? (projects.get(project)!.requires ?? []) : [])];
    units.set(pathKey(p.id), {
      key: pathKey(p.id),
      title: p.title,
      deps: reqs.flatMap(unitsOf),
      ...(project ? { project } : {}),
      cycle: circled.has(p.id) || (project !== undefined && circled.has(project)),
      column: 0,
      row: 0,
    });
  }
  for (const id of ghosts.keys()) units.set(ghostKey(id), { key: ghostKey(id), title: id, deps: [], cycle: false, column: 0, row: 0 });
  for (const id of frameIds) {
    if (members.has(id)) continue;
    const project = projects.get(id)!;
    units.set(frameKey(id), {
      key: frameKey(id),
      title: project.title,
      deps: (project.requires ?? []).flatMap(unitsOf),
      project: id,
      cycle: circled.has(id),
      column: 0,
      row: 0,
    });
  }

  // Columns: the longest chain from a root, plus one. A circle the engine did not name (it cannot happen, but the
  // page must not hang on it) is found on the way and laid with the others.
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const columnOf = (key: string): number => {
    const unit = units.get(key)!;
    if (unit.cycle) return 0;
    const seen = state.get(key);
    if (seen === 2) return unit.column;
    if (seen === 1) {
      for (const k of stack.slice(stack.indexOf(key))) units.get(k)!.cycle = true;
      return 0;
    }
    state.set(key, 1);
    stack.push(key);
    let column = 1;
    for (const dep of unit.deps) {
      if (dep === key) continue;
      const c = columnOf(dep);
      if (c > 0) column = Math.max(column, c + 1);
    }
    stack.pop();
    state.set(key, 2);
    unit.column = unit.cycle ? 0 : column;
    return unit.column;
  };
  for (const key of units.keys()) columnOf(key);
  // A unit found in a circle late: what was laid behind it keeps its column (one more than its other requirements).
  const laid = [...units.values()].filter((u) => !u.cycle);
  const columns = laid.reduce((m, u) => Math.max(m, u.column), 0);

  // Bands: one per project with a frame (by its first column, then title), then the paths without a project.
  const byTitle = (a: { title: string; key: string }, b: { title: string; key: string }) =>
    a.title.localeCompare(b.title) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const bandOf = (u: Unit) => (u.project !== undefined ? u.project : '');
  const bands = new Map<string, Unit[]>();
  for (const u of laid) {
    const band = bands.get(bandOf(u)) ?? [];
    band.push(u);
    bands.set(bandOf(u), band);
  }
  const bandOrder = [...bands.keys()]
    .filter((b) => b !== '')
    .map((b) => ({ id: b, first: Math.min(...bands.get(b)!.map((u) => u.column)), title: projects.get(b)!.title }))
    .sort((a, b) => a.first - b.first || a.title.localeCompare(b.title) || (a.id < b.id ? -1 : 1))
    .map((b) => b.id);
  if (bands.has('')) bandOrder.push('');

  // Rows inside each band and column: by title first, then twice by the mean row of what they build on (left to
  // right) and of what builds on them (right to left), which keeps arrows from crossing (as orderRows of depGraph).
  const cells = new Map<string, Unit[]>();
  const cellKey = (band: string, column: number) => `${band}\u0000${column}`;
  for (const u of [...laid].sort(byTitle)) {
    const k = cellKey(bandOf(u), u.column);
    const cell = cells.get(k) ?? [];
    cell.push(u);
    cells.set(k, cell);
  }
  const rowsOf = new Map(bandOrder.map((b) => [b, Math.max(1, ...[...cells.entries()].filter(([k]) => k.startsWith(`${b}\u0000`)).map(([, c]) => c.length))] as const));
  const offset = new Map<string, number>();
  let acc = 0;
  for (const b of bandOrder) {
    offset.set(b, acc);
    acc += rowsOf.get(b)! + 1;
  }
  const place = () => {
    for (const [k, cell] of cells) {
      const band = k.slice(0, k.indexOf('\u0000'));
      cell.forEach((u, i) => (u.row = offset.get(band)! + i));
    }
  };
  place();
  const dependents = new Map<string, string[]>();
  for (const u of laid) for (const d of u.deps) dependents.set(d, [...(dependents.get(d) ?? []), u.key]);
  const mean = (keys: readonly string[]): number | null => {
    const rows = keys.map((k) => units.get(k)).filter((u): u is Unit => u !== undefined && !u.cycle).map((u) => u.row);
    return rows.length === 0 ? null : rows.reduce((s, r) => s + r, 0) / rows.length;
  };
  const sweep = (next: (u: Unit) => readonly string[], order: number[]) => {
    for (const column of order) {
      for (const [k, cell] of cells) {
        if (!k.endsWith(`\u0000${column}`)) continue;
        // Without neighbours a unit keeps its place.
        const weight = new Map(cell.map((u) => [u.key, mean(next(u)) ?? u.row] as const));
        cell.sort((a, b) => weight.get(a.key)! - weight.get(b.key)! || byTitle(a, b));
      }
      place();
    }
  };
  const ascending = Array.from({ length: columns }, (_, i) => i + 1);
  for (let pass = 0; pass < 2; pass++) {
    sweep((u) => u.deps, ascending);
    sweep((u) => dependents.get(u.key) ?? [], [...ascending].reverse());
  }

  // Geometry.
  const step = size.w + COL_GAP;
  const columnX = ascending.map((c) => PAD + FRAME_PAD + (c - 1) * step);
  const boxes: MapBox[] = [];
  const frames: MapFrame[] = [];
  let y = PAD + HEAD;
  for (const b of bandOrder) {
    const rows = rowsOf.get(b)!;
    const top = y;
    const inner = b === '' ? top : top + FRAME_TITLE;
    const rowY = (row: number) => inner + (row - offset.get(b)!) * (size.h + ROW_GAP);
    const bandUnits = bands.get(b)!;
    for (const u of bandUnits) {
      if (u.key.startsWith('j:')) continue;
      boxes.push(boxOf(u, columnX[u.column - 1]!, rowY(u.row)));
    }
    const height = (b === '' ? 0 : FRAME_TITLE + FRAME_PAD) + rows * (size.h + ROW_GAP) - ROW_GAP;
    if (b !== '') {
      const cols = bandUnits.map((u) => u.column);
      const first = Math.min(...cols);
      const last = Math.max(...cols);
      const own = members.get(b) ?? [];
      frames.push({
        key: frameKey(b),
        id: b,
        title: projects.get(b)!.title,
        x: columnX[first - 1]! - FRAME_PAD,
        y: top,
        w: (last - first) * step + size.w + 2 * FRAME_PAD,
        h: own.length > 0 ? height : FRAME_TITLE + size.h / 2,
        members: own,
        column: own.length > 0 ? 0 : first,
        project: projects.get(b)!,
        cycle: false,
      });
    }
    y = top + height + BAND_GAP;
  }

  // The area of the circles: last, one row, the paths of a project together inside its frame.
  let cycleArea: CycleArea | null = null;
  const circledUnits = [...units.values()].filter((u) => u.cycle).sort(byTitle);
  if (circledUnits.length > 0) {
    const cycles = (input.cycles ?? []).filter((c) => c.length > 0).map((c) => [...c, c[0]!]);
    // A circle found here alone (the engine named none): its units, in order of their titles.
    if (cycles.length === 0) cycles.push([...circledUnits.map((u) => u.key.slice(2)), circledUnits[0]!.key.slice(2)]);
    const top = y;
    const titleH = 8 + CYCLE_LINE * (cycles.length + 1);
    const rowTop = top + titleH + FRAME_TITLE;
    let x = PAD + FRAME_PAD;
    const groups = new Map<string, Unit[]>();
    for (const u of circledUnits) {
      const g = u.project ?? `\u0000${u.key}`;
      groups.set(g, [...(groups.get(g) ?? []), u]);
    }
    for (const [g, list] of groups) {
      const framed = !g.startsWith('\u0000');
      if (framed) x += FRAME_PAD;
      const left = x;
      for (const u of list) {
        // A frame without paths keeps the room of one box.
        if (!u.key.startsWith('j:')) boxes.push(boxOf(u, x, rowTop));
        x += size.w + ROW_GAP;
      }
      if (framed) {
        const project = projects.get(g)!;
        const own = list.filter((u) => !u.key.startsWith('j:')).map((u) => u.key);
        frames.push({
          key: frameKey(g),
          id: g,
          title: project.title,
          x: left - FRAME_PAD,
          y: rowTop - FRAME_TITLE,
          w: x - ROW_GAP - left + 2 * FRAME_PAD,
          h: own.length > 0 ? FRAME_TITLE + size.h + FRAME_PAD : FRAME_TITLE + size.h / 2,
          members: own,
          column: 0,
          project,
          cycle: true,
        });
        x += FRAME_PAD;
      }
      x += COL_GAP / 2;
    }
    const right = x - COL_GAP / 2 + FRAME_PAD;
    cycleArea = { x: PAD, y: top, w: Math.max(right - PAD, 2 * size.w), h: titleH + FRAME_TITLE + size.h + 2 * FRAME_PAD, cycles };
    y = top + cycleArea.h + BAND_GAP;
  }

  function boxOf(u: Unit, x: number, top: number): MapBox {
    const ghost = u.key.startsWith('g:');
    const id = u.key.slice(2);
    const entry = ghost ? undefined : paths.get(id);
    return {
      key: u.key,
      id,
      kind: ghost ? 'ghost' : 'path',
      title: entry?.title ?? id,
      x,
      y: top,
      w: size.w,
      h: size.h,
      column: u.cycle ? 0 : u.column,
      ...(u.project !== undefined ? { project: u.project } : {}),
      cycle: u.cycle,
      ...(entry ? { entry } : {}),
      ...(ghost ? { ghost: ghosts.get(id)! } : {}),
    };
  }

  // Arrows: from the right of the requirement to the left of what builds on it. A path's own requirements start at
  // its box; a project's at its frame.
  const rects = new Map<string, { x: number; y: number; w: number; h: number; cycle: boolean }>();
  for (const b of boxes) rects.set(b.key, b);
  for (const f of frames) rects.set(f.key, f);
  const edges: MapEdge[] = [];
  const seenEdge = new Set<string>();
  const arrow = (to: string, reqs: Requires | undefined) => {
    for (const r of reqs ?? []) {
      const from = endOf(r);
      if (from === null || !rects.has(from) || !rects.has(to)) continue;
      const key = `${from}>${to}`;
      if (seenEdge.has(key)) continue;
      seenEdge.add(key);
      const a = rects.get(from)!;
      const b = rects.get(to)!;
      edges.push({ key, from, to, gate: r.gate, met: r.met, bad: r.kind === 'unknown' || from.startsWith('g:') || (a.cycle && b.cycle), d: curve(a, b) });
    }
  };
  for (const p of input.paths) arrow(pathKey(p.id), p.requires);
  for (const f of frames) arrow(f.key, f.project.requires);

  const width = Math.max(
    columns > 0 ? columnX[columns - 1]! + size.w + FRAME_PAD + PAD : 0,
    cycleArea ? cycleArea.x + cycleArea.w + PAD : 0,
    ...frames.map((f) => f.x + f.w + PAD),
  );
  return { boxes, frames, edges, columns, columnX, width, height: y - BAND_GAP + PAD, cycleArea, boxW: size.w, boxH: size.h };
}

/** A curve from the right middle of `a` to the left middle of `b`; backwards (a circle) a bow below both. */
export function curve(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): string {
  const x1 = a.x + a.w;
  const y1 = a.y + a.h / 2;
  const x2 = b.x;
  const y2 = b.y + b.h / 2;
  if (x2 >= x1 + 8) {
    const dx = Math.max(24, (x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }
  const below = Math.max(a.y + a.h, b.y + b.h) + 28;
  return `M ${x1} ${y1} C ${x1 + 48} ${below}, ${x2 - 48} ${below}, ${x2} ${y2}`;
}

/** The boxes and frames of the chain of `key`: everything it builds on and everything that builds on it. */
export function chainOf(map: PathMap, key: string): Set<string> {
  const frameOf = new Map<string, string>();
  for (const f of map.frames) for (const m of f.members) frameOf.set(m, f.key);
  const members = new Map(map.frames.map((f) => [f.key, f.members] as const));
  const into = new Map<string, string[]>();
  const out = new Map<string, string[]>();
  for (const e of map.edges) {
    into.set(e.to, [...(into.get(e.to) ?? []), e.from]);
    out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  }
  const chain = new Set<string>([key]);
  const walk = (start: string, next: Map<string, string[]>) => {
    const todo = [start];
    const done = new Set<string>();
    while (todo.length > 0) {
      const k = todo.pop()!;
      if (done.has(k)) continue;
      done.add(k);
      // A box is reached through its own arrows and through those of its frame.
      const ends = [...(next.get(k) ?? []), ...(frameOf.has(k) ? (next.get(frameOf.get(k)!) ?? []) : [])];
      for (const end of ends) {
        chain.add(end);
        todo.push(end);
        for (const m of members.get(end) ?? []) {
          chain.add(m);
          todo.push(m);
        }
      }
    }
  };
  walk(key, into);
  walk(key, out);
  return chain;
}

/**
 * The boxes `key` builds on (`left`) or that build on it (`right`), top first: through its own arrows and those of
 * its frame, a frame taken as its boxes (a frame without boxes is no stop of the keys).
 */
export function linkedBoxes(map: PathMap, key: string, side: 'left' | 'right'): string[] {
  const frameOf = new Map<string, string>();
  for (const f of map.frames) for (const m of f.members) frameOf.set(m, f.key);
  const members = new Map(map.frames.map((f) => [f.key, f.members] as const));
  const ends = new Set<string>();
  for (const e of map.edges) {
    const near = side === 'left' ? e.to : e.from;
    const far = side === 'left' ? e.from : e.to;
    if (near !== key && near !== frameOf.get(key)) continue;
    for (const k of members.get(far) ?? [far]) if (k !== key && !k.startsWith('j:')) ends.add(k);
  }
  const at = new Map(map.boxes.map((b) => [b.key, b] as const));
  return [...ends].filter((k) => at.has(k)).sort((a, b) => at.get(a)!.y - at.get(b)!.y || at.get(a)!.x - at.get(b)!.x);
}

/** The boxes in reading order: by column (the circle last), then from the top. */
export function readingOrder(map: PathMap): MapBox[] {
  return [...map.boxes].sort((a, b) => (a.column || Infinity) - (b.column || Infinity) || a.x - b.x || a.y - b.y);
}

/** The box above or below `key` in its column (in the area of a circle: left or right in its row). */
export function besideBox(map: PathMap, key: string, side: 'up' | 'down'): string | null {
  const box = map.boxes.find((b) => b.key === key);
  if (!box) return null;
  const same = map.boxes
    .filter((b) => (box.cycle ? b.cycle : b.column === box.column && !b.cycle))
    .sort((a, b) => (box.cycle ? a.x - b.x : a.y - b.y));
  const i = same.findIndex((b) => b.key === key);
  const next = same[side === 'up' ? i - 1 : i + 1];
  return next ? next.key : null;
}

/** The ids that build on each path or project (the arrows turned round): "requirement for". */
export function dependentsOf(paths: readonly PathEntry[], projects: readonly MapProject[]): Map<string, { id: string; gate: 'soft' | 'hard' }[]> {
  const out = new Map<string, { id: string; gate: 'soft' | 'hard' }[]>();
  for (const item of [...paths, ...projects]) {
    for (const r of item.requires ?? []) out.set(r.id, [...(out.get(r.id) ?? []), { id: item.id, gate: r.gate }]);
  }
  return out;
}
