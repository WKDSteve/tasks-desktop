// The catalogue of the competences: the ladder of a stage (halves too), the rung a target marks, the distance to the
// target, the names of the scale, the evidence counted per field, and the filters, groups and orders.
import { describe, expect, it } from 'vitest';
import type { LearnEvidence, PathEntry } from './contract';
import {
  competenceGroups,
  distance,
  evidenceCounts,
  ladder,
  pathsOf,
  pathsWithoutCompetence,
  stageText,
  targetRung,
  type Competence,
  type Scale,
} from './competences';

const SCALE = [
  'Unbekannt',
  'Gehört',
  'Grundlagen',
  'Profi',
  'Bachelor',
  'Master',
  'Experte',
  'Koryphäe',
  'Mastermind',
].map((name, level) => ({ level, name })) as unknown as Scale;

const item = (id: string, over: Partial<Competence> = {}): Competence => ({
  id: `ALL/${id}`,
  area: 'ALL',
  slug: id,
  title: id,
  body: '',
  paths: [],
  file: `ALL/ROADMAP/competences/${id}.md`,
  valid: true,
  problems: [],
  ...over,
});
const path = (id: string, over: Partial<PathEntry> = {}): PathEntry => ({ id, title: id, ...over }) as PathEntry;

describe('ladder', () => {
  it('fills the reached rungs, half fills a half stage, leaves an unknown stage empty', () => {
    expect(ladder(3)).toEqual(['full', 'full', 'full', 'empty', 'empty', 'empty', 'empty', 'empty']);
    expect(ladder(3.5)).toEqual(['full', 'full', 'full', 'half', 'empty', 'empty', 'empty', 'empty']);
    expect(ladder(0)).toEqual(Array(8).fill('empty'));
    expect(ladder(undefined)).toEqual(Array(8).fill('empty'));
    expect(ladder(8)).toEqual(Array(8).fill('full'));
  });

  it('marks the rung of a target, a half one the rung it reaches into', () => {
    expect(targetRung(4)).toBe(4);
    expect(targetRung(4.5)).toBe(5);
    expect(targetRung(0)).toBeNull();
    expect(targetRung(undefined)).toBeNull();
  });
});

describe('stageText', () => {
  it('names a stage with the scale of the engine, a half one by the whole one below, in the language', () => {
    expect(stageText(SCALE, 3, 'de')).toBe('3 Profi');
    expect(stageText(SCALE, 3.5, 'de')).toBe('3,5 Profi');
    expect(stageText(SCALE, 3.5, 'en')).toBe('3.5 Profi');
    expect(stageText(undefined, 2, 'en')).toBe('2');
  });
});

describe('distance', () => {
  it('is the larger gap of the two axes to the 12-month target (else the 24-month one)', () => {
    expect(distance(item('a', { t: 3, p: 1, target_12: { t: 4, p: 4 } }))).toBe(3);
    expect(distance(item('b', { t: 3, target_24: { t: 5 } }))).toBe(2);
    expect(distance(item('c', { t: 3 }))).toBeNull();
    // not assessed: no gap on that axis
    expect(distance(item('d', { target_12: { t: 4 } }))).toBeNull();
  });
});

describe('evidenceCounts', () => {
  it('counts learned as given and the rest as open, per competence the path serves; dropped ones not', () => {
    const e = (state: LearnEvidence['items'][number]['state'], competence?: string[]) =>
      ({ path: 'p', area: 'a', title: 't', index: 1, label: 'Nachweis: x', stage_index: 0, stage_label: 's', state, ...(competence ? { competence } : {}) }) as LearnEvidence['items'][number];
    const counts = evidenceCounts([e('learned', ['ALL/os']), e('open', ['ALL/os', 'ALL/net']), e('dropped', ['ALL/os']), e('partial', ['ALL/net']), e('open')]);
    expect(counts.get('ALL/os')).toEqual({ given: 1, open: 1 });
    expect(counts.get('ALL/net')).toEqual({ given: 0, open: 2 });
  });
});

describe('competenceGroups', () => {
  const items = [
    item('os', { title: 'Betriebssysteme', group: 'Informatik-Kern', t: 3, p: 1, target_12: { t: 4, p: 4 }, paths: ['lib/os'] }),
    item('net', { title: 'Netze', group: 'Informatik-Kern', t: 2, target_12: { t: 3 } }),
    item('ui', { title: 'UI', group: 'Gestaltung', t: 1 }),
    item('misc', { title: 'Sonstiges' }),
  ];
  const paths = [path('lib/os'), path('lib/done', { competence: ['ALL/ui'] } as Partial<PathEntry>), path('lib/free')];
  const all = { withTarget: false, withPath: false, text: '' };

  it('groups by group, those without one last, by title', () => {
    expect(competenceGroups(items, paths, all, 'name').map((g) => [g.name, g.items.map((i) => i.slug)])).toEqual([
      ['Gestaltung', ['ui']],
      ['Informatik-Kern', ['os', 'net']],
      [null, ['misc']],
    ]);
  });

  it('orders by the distance to the target, the furthest first', () => {
    expect(competenceGroups(items, paths, all, 'distance')[1]!.items.map((i) => i.slug)).toEqual(['os', 'net']);
  });

  it('filters by a target, by a path (a finished one that names it too) and by text', () => {
    const slugs = (f: Partial<typeof all>) => competenceGroups(items, paths, { ...all, ...f }, 'name').flatMap((g) => g.items.map((i) => i.slug));
    expect(slugs({ withTarget: true })).toEqual(['os', 'net']);
    expect(slugs({ withPath: true })).toEqual(['ui', 'os']);
    expect(slugs({ text: 'NETZ' })).toEqual(['net']);
  });

  it('knows the paths of a field and the paths of none', () => {
    expect(pathsOf(items[2]!, paths).map((p) => p.id)).toEqual(['lib/done']);
    expect(pathsWithoutCompetence(paths, items).map((p) => p.id)).toEqual(['lib/free']);
  });
});
