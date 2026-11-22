// The evidence of all paths: given, open and dropped from the engine's state; grouped by competence (a point under every
// field its path serves, those without one last) or by path; filtered by state and competence; a link only as a web address.
import { describe, expect, it } from 'vitest';
import { evidenceCompetences, evidenceGroups, evidenceState, evidenceTotals, webLink, type Evidence } from './evidence';

const ev = (path: string, index: number, state: Evidence['state'], competence?: string[]): Evidence =>
  ({ path, area: 'lib', title: path, index, label: `Nachweis: ${path} ${index}`, stage_index: 0, stage_label: 'S', state, ...(competence ? { competence } : {}) }) as Evidence;

const ITEMS = [
  ev('lib/os', 1, 'learned', ['ALL/os', 'ALL/sys']),
  ev('lib/os', 2, 'open', ['ALL/os', 'ALL/sys']),
  ev('lib/net', 1, 'partial', ['ALL/net']),
  ev('lib/net', 2, 'dropped', ['ALL/net']),
  ev('lib/free', 1, 'seen'),
];

describe('evidenceState', () => {
  it('is given when learned, nothing when dropped, else open', () => {
    expect(ITEMS.map(evidenceState)).toEqual(['given', 'open', 'open', 'dropped', 'open']);
  });
});

describe('evidenceGroups', () => {
  const keys = (groups: ReturnType<typeof evidenceGroups>) => groups.map((g) => [g.key, g.rows.map((r) => r.key)]);

  it('groups by competence in the order given, a point under each field, those without one last', () => {
    expect(keys(evidenceGroups(ITEMS, { filter: 'all', competence: '', grouping: 'competence' }, ['ALL/net', 'ALL/os']))).toEqual([
      ['competence:ALL/net', ['lib/net#1', 'lib/net#2']],
      ['competence:ALL/os', ['lib/os#1', 'lib/os#2']],
      ['competence:ALL/sys', ['lib/os#1', 'lib/os#2']],
      ['none', ['lib/free#1']],
    ]);
  });

  it('groups by path in the engine order', () => {
    expect(evidenceGroups(ITEMS, { filter: 'all', competence: '', grouping: 'path' }).map((g) => g.id)).toEqual(['lib/os', 'lib/net', 'lib/free']);
  });

  it('filters given and open (dropped ones only under all), and one competence', () => {
    const rows = (q: Partial<Parameters<typeof evidenceGroups>[1]>) =>
      evidenceGroups(ITEMS, { filter: 'all', competence: '', grouping: 'path', ...q }).flatMap((g) => g.rows.map((r) => r.key));
    expect(rows({ filter: 'given' })).toEqual(['lib/os#1']);
    expect(rows({ filter: 'open' })).toEqual(['lib/os#2', 'lib/net#1', 'lib/free#1']);
    expect(rows({ competence: 'ALL/net' })).toEqual(['lib/net#1', 'lib/net#2']);
    // one competence grouped by competence: only its group, not the other fields of the same path
    expect(evidenceGroups(ITEMS, { filter: 'all', competence: 'ALL/os', grouping: 'competence' }).map((g) => g.key)).toEqual(['competence:ALL/os']);
  });
});

describe('evidenceTotals and evidenceCompetences', () => {
  it('counts each point once, and names the fields of the evidence', () => {
    expect(evidenceTotals(ITEMS)).toEqual({ given: 1, open: 3 });
    expect(evidenceCompetences(ITEMS)).toEqual(['ALL/net', 'ALL/os', 'ALL/sys']);
  });
});

describe('webLink', () => {
  it('draws only a web address as a link', () => {
    expect(webLink('https://example.org/a')).toBe('https://example.org/a');
    expect(webLink('http://example.org')).toBe('http://example.org/');
    expect(webLink('javascript:alert(1)')).toBeNull();
    expect(webLink('assets/proof.png')).toBeNull();
    expect(webLink(undefined)).toBeNull();
  });
});
