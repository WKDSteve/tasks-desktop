// The layout of the competence map (lib/pathMap.ts): columns by the longest chain, a project's requirement counted for
// its paths, frames, ghosts, the circle last, arrows and the chain of a box. Whether a requirement is met or a path
// waits is the engine's: the fixtures say it, the layout only draws it.
import { describe, expect, it } from 'vitest';
import type { PathEntry, Requires } from './contract';
import { besideBox, chainOf, curve, dependentsOf, layoutPathMap, linkedBoxes, readingOrder, softOpen, stageOf, type MapProject } from './pathMap';

function path(id: string, extra: Partial<PathEntry> = {}): PathEntry {
  const [area, slug] = id.split('/') as [string, string];
  return {
    id,
    area,
    slug,
    title: extra.title ?? slug,
    areas: [area],
    summary: '',
    has_tree: true,
    points: 2,
    progress: { learned: 0, seen: 0, dropped: 0, open: 2, blocked: 0, total: 2 },
    file: `${area}/ROADMAP/paths/${slug}.md`,
    valid: true,
    problems: [],
    stage: 'idle',
    ...extra,
  };
}
const req = (id: string, extra: Partial<Requires[number]> = {}): Requires[number] => ({ id, gate: 'soft', kind: 'path', met: false, ...extra });
const col = (map: ReturnType<typeof layoutPathMap>, id: string) => map.boxes.find((b) => b.id === id)?.column;

describe('layoutPathMap', () => {
  it('puts a path one column right of the longest chain before it', () => {
    const map = layoutPathMap({
      paths: [path('a/root'), path('a/mid', { requires: [req('a/root')] }), path('a/end', { requires: [req('a/mid'), req('a/root')] })],
      projects: [],
    });
    expect([col(map, 'a/root'), col(map, 'a/mid'), col(map, 'a/end')]).toEqual([1, 2, 3]);
    expect(map.columns).toBe(3);
    expect(map.edges.map((e) => e.key).sort()).toEqual(['p:a/mid>p:a/end', 'p:a/root>p:a/end', 'p:a/root>p:a/mid']);
    // left to right: an arrow leaves the right side of its box and comes in at the left of the next
    const root = map.boxes.find((b) => b.id === 'a/root')!;
    const mid = map.boxes.find((b) => b.id === 'a/mid')!;
    expect(mid.x).toBeGreaterThan(root.x + root.w);
    expect(map.edges.find((e) => e.key === 'p:a/root>p:a/mid')!.d).toBe(curve(root, mid));
  });

  it("counts a project's requirement for every path of the project, and draws it from frame to frame", () => {
    const projects: MapProject[] = [
      { id: 'e/elektronik', title: 'Elektronik' },
      { id: 'e/digital', title: 'Digitaltechnik', requires: [req('e/elektronik', { kind: 'project', gate: 'hard' })] },
    ];
    const map = layoutPathMap({
      paths: [
        path('e/ohm', { project: 'e/elektronik' }),
        path('e/transistor', { project: 'e/elektronik', requires: [req('e/ohm')] }),
        path('e/gates', { project: 'e/digital' }),
      ],
      projects,
    });
    // gates names nothing itself, but its project builds on Elektronik, whose last path is in column 2
    expect(col(map, 'e/gates')).toBe(3);
    const frames = Object.fromEntries(map.frames.map((f) => [f.id, f]));
    expect(frames['e/elektronik']!.members.sort()).toEqual(['p:e/ohm', 'p:e/transistor']);
    expect(map.edges.map((e) => [e.key, e.gate])).toContainEqual(['j:e/elektronik>j:e/digital', 'hard']);
    // the frame holds its boxes
    const f = frames['e/elektronik']!;
    for (const b of map.boxes.filter((b) => b.project === 'e/elektronik')) {
      expect(b.x).toBeGreaterThanOrEqual(f.x);
      expect(b.x + b.w).toBeLessThanOrEqual(f.x + f.w);
      expect(b.y).toBeGreaterThan(f.y);
      expect(b.y + b.h).toBeLessThanOrEqual(f.y + f.h);
    }
  });

  it('lays the frames by their first column, then title, and the paths without a project below them', () => {
    const map = layoutPathMap({
      paths: [path('a/loose'), path('a/z1', { project: 'a/zeta' }), path('a/b1', { project: 'a/beta', requires: [req('a/z1')] }), path('a/a1', { project: 'a/alpha', requires: [req('a/z1')] })],
      projects: [
        { id: 'a/zeta', title: 'Zeta' },
        { id: 'a/beta', title: 'Beta' },
        { id: 'a/alpha', title: 'Alpha' },
      ],
    });
    expect(map.frames.map((f) => f.title)).toEqual(['Zeta', 'Alpha', 'Beta']);
    const loose = map.boxes.find((b) => b.id === 'a/loose')!;
    for (const f of map.frames) expect(loose.y).toBeGreaterThan(f.y + f.h);
  });

  it('draws a ghost for a requirement that names nothing, with a red arrow', () => {
    const map = layoutPathMap({ paths: [path('a/p', { requires: [req('a/nothing', { kind: 'unknown' })] })], projects: [] });
    const ghost = map.boxes.find((b) => b.kind === 'ghost')!;
    expect(ghost).toMatchObject({ key: 'g:a/nothing', ghost: 'unknown', column: 1 });
    expect(col(map, 'a/p')).toBe(2);
    expect(map.edges).toEqual([expect.objectContaining({ from: 'g:a/nothing', to: 'p:a/p', bad: true })]);
  });

  it('draws no arrow and no ghost for a requirement left out on purpose (finished ones hidden)', () => {
    const map = layoutPathMap({ paths: [path('a/p', { requires: [req('a/done', { met: true })] })], projects: [], hidden: new Set(['a/done']) });
    expect(map.boxes.map((b) => b.key)).toEqual(['p:a/p']);
    expect(map.edges).toEqual([]);
  });

  it('puts the paths of a circle last, in an area of their own, with red arrows; the rest of the map stays', () => {
    const map = layoutPathMap({
      paths: [path('a/x', { requires: [req('a/y')] }), path('a/y', { requires: [req('a/x')] }), path('a/ok'), path('a/next', { requires: [req('a/ok')] })],
      projects: [],
      cycles: [['a/x', 'a/y']],
    });
    expect([col(map, 'a/ok'), col(map, 'a/next'), col(map, 'a/x'), col(map, 'a/y')]).toEqual([1, 2, 0, 0]);
    expect(map.cycleArea).toMatchObject({ cycles: [['a/x', 'a/y', 'a/x']] });
    const area = map.cycleArea!;
    for (const id of ['a/x', 'a/y']) {
      const b = map.boxes.find((x) => x.id === id)!;
      expect(b.cycle).toBe(true);
      expect(b.y).toBeGreaterThan(area.y);
      expect(b.y + b.h).toBeLessThanOrEqual(area.y + area.h);
    }
    expect(map.edges.filter((e) => e.bad).map((e) => e.key).sort()).toEqual(['p:a/x>p:a/y', 'p:a/y>p:a/x']);
    expect(map.edges.find((e) => e.key === 'p:a/ok>p:a/next')!.bad).toBe(false);
    expect(map.height).toBeGreaterThanOrEqual(area.y + area.h);
  });

  it('finds a circle the engine did not name instead of hanging on it', () => {
    const map = layoutPathMap({ paths: [path('a/x', { requires: [req('a/y')] }), path('a/y', { requires: [req('a/x')] })], projects: [] });
    expect(map.boxes.every((b) => b.cycle)).toBe(true);
    expect(map.cycleArea).not.toBeNull();
  });

  it('gives a project without a path on the map a frame of its own in the chain', () => {
    const map = layoutPathMap({
      paths: [path('a/p', { requires: [req('a/basics', { kind: 'project', met: true })] })],
      projects: [{ id: 'a/basics', title: 'Basics', done: true }],
    });
    const frame = map.frames.find((f) => f.id === 'a/basics')!;
    expect(frame).toMatchObject({ members: [], column: 1 });
    expect(col(map, 'a/p')).toBe(2);
    expect(map.edges).toEqual([expect.objectContaining({ from: 'j:a/basics', to: 'p:a/p', met: true })]);
  });

  it('orders the boxes of a column after what they build on, so the arrows do not cross', () => {
    const map = layoutPathMap({
      paths: [path('a/a-top', { title: 'A top' }), path('a/b-low', { title: 'B low' }), path('a/z-after-a', { title: 'After A', requires: [req('a/a-top')] }), path('a/a-after-b', { title: 'After B', requires: [req('a/b-low')] })],
      projects: [],
    });
    const y = (id: string) => map.boxes.find((b) => b.id === id)!.y;
    expect(y('a/a-top')).toBeLessThan(y('a/b-low'));
    // by title "After A" comes first anyway; by the chain too
    expect(y('a/z-after-a')).toBeLessThan(y('a/a-after-b'));
    const swapped = layoutPathMap({
      paths: [path('a/1', { title: 'A' }), path('a/2', { title: 'B' }), path('a/3', { title: 'C', requires: [req('a/2')] }), path('a/4', { title: 'D', requires: [req('a/1')] })],
      projects: [],
    });
    const sy = (id: string) => swapped.boxes.find((b) => b.id === id)!.y;
    // by title C would stand above D; its requirement B stands below A, so D goes up
    expect(sy('a/4')).toBeLessThan(sy('a/3'));
  });

  it('makes the boxes small when asked (zoom below 70 %)', () => {
    const map = layoutPathMap({ paths: [path('a/p')], projects: [], compact: true });
    expect([map.boxW, map.boxH, map.boxes[0]!.w, map.boxes[0]!.h]).toEqual([160, 40, 160, 40]);
  });

  it('lays 200 paths in a chain-rich vault in well under 50 ms', () => {
    const paths: PathEntry[] = [];
    const projects: MapProject[] = [];
    for (let p = 0; p < 10; p++) projects.push({ id: `g/proj${p}`, title: `Project ${p}`, ...(p > 0 ? { requires: [req(`g/proj${p - 1}`, { kind: 'project' })] } : {}) });
    for (let i = 0; i < 200; i++) {
      const requires = [i > 0 ? req(`g/p${(i * 7) % i}`) : null, i > 3 ? req(`g/p${i - 3}`, { gate: 'hard' }) : null].filter((r): r is Requires[number] => r !== null);
      paths.push(path(`g/p${i}`, { ...(i % 3 === 0 ? {} : { project: `g/proj${i % 10}` }), requires }));
    }
    layoutPathMap({ paths, projects }); // warm
    const start = performance.now();
    const map = layoutPathMap({ paths, projects });
    expect(performance.now() - start).toBeLessThan(50);
    expect(map.boxes).toHaveLength(200);
  });
});

describe('the chain and the keys', () => {
  const projects: MapProject[] = [
    { id: 'e/base', title: 'Base' },
    { id: 'e/top', title: 'Top', requires: [req('e/base', { kind: 'project' })] },
  ];
  const map = layoutPathMap({
    paths: [
      path('e/b1', { project: 'e/base' }),
      path('e/b2', { project: 'e/base', requires: [req('e/b1')] }),
      path('e/t1', { project: 'e/top' }),
      path('e/t2', { project: 'e/top', requires: [req('e/t1')] }),
      path('e/alone'),
    ],
    projects,
  });

  it('a box: everything it builds on (through its frame too) and everything that builds on it', () => {
    const chain = chainOf(map, 'p:e/t1');
    expect(chain.has('p:e/b1')).toBe(true);
    expect(chain.has('p:e/b2')).toBe(true);
    expect(chain.has('j:e/base')).toBe(true);
    expect(chain.has('p:e/t2')).toBe(true);
    expect(chain.has('p:e/alone')).toBe(false);
    expect([...chainOf(map, 'p:e/alone')]).toEqual(['p:e/alone']);
  });

  it('left and right go along the chain; up and down in the column; reading order by column', () => {
    expect(linkedBoxes(map, 'p:e/t2', 'left')).toEqual(['p:e/b1', 'p:e/b2', 'p:e/t1'].sort((a, b) => map.boxes.find((x) => x.key === a)!.y - map.boxes.find((x) => x.key === b)!.y));
    expect(linkedBoxes(map, 'p:e/b1', 'right')).toContain('p:e/b2');
    expect(linkedBoxes(map, 'p:e/b2', 'right')).toEqual(expect.arrayContaining(['p:e/t1', 'p:e/t2']));
    const first = readingOrder(map)[0]!;
    expect(first.column).toBe(1);
    const below = besideBox(map, first.key, 'down');
    expect(below === null || map.boxes.find((b) => b.key === below)!.column === 1).toBe(true);
    expect(besideBox(map, first.key, 'up')).toBeNull();
  });
});

describe('stage and hints', () => {
  it("takes the engine's stage; an older engine's path by its status and progress, never waiting", () => {
    expect(stageOf(path('a/p', { stage: 'waiting' }))).toBe('waiting');
    const { stage: _, ...old } = path('a/p');
    expect(stageOf({ ...old, status: 'done' })).toBe('done');
    expect(stageOf({ ...old, status: 'parked' })).toBe('parked');
    expect(stageOf({ ...old, status: 'doing' })).toBe('doing');
    expect(stageOf({ ...old, progress: { learned: 0, seen: 1, dropped: 0, open: 1, blocked: 0, total: 2 } })).toBe('doing');
    expect(stageOf(old)).toBe('idle');
  });
  it('a soft requirement not met is a hint; a hard one or a met one is none', () => {
    expect(softOpen(path('a/p', { requires: [req('a/x')] }))).toBe(true);
    expect(softOpen(path('a/p', { requires: [req('a/x', { met: true })] }))).toBe(false);
    expect(softOpen(path('a/p', { requires: [req('a/x', { gate: 'hard' })] }))).toBe(false);
    // a requirement that names nothing is a fault, drawn as a ghost: no hint
    expect(softOpen(path('a/p', { requires: [req('a/nothing', { kind: 'unknown' })] }))).toBe(false);
  });
  it('turns the arrows round: what each path or project is a requirement for', () => {
    const deps = dependentsOf([path('a/p', { requires: [req('a/x', { gate: 'hard' })] })], [{ id: 'a/j', title: 'J', requires: [req('a/x', { kind: 'path' })] }]);
    expect(deps.get('a/x')).toEqual([
      { id: 'a/p', gate: 'hard' },
      { id: 'a/j', gate: 'soft' },
    ]);
  });
});
