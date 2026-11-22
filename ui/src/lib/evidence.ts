// The evidence of all learning paths (concept "Reiter Lernpläne" 10): the rule of the competence matrix made visible,
// "without evidence the stage below counts". Which point is evidence, its state, the stage it proves and the fields its
// path serves are the engine's (`tasks.learn_evidence`; WEB-13): this file filters and groups them.
import type { LearnEvidence } from './contract';

export type Evidence = LearnEvidence['items'][number];
export type EvidenceState = 'given' | 'open' | 'dropped';
export type EvidenceFilter = 'all' | 'given' | 'open';
export type EvidenceGrouping = 'competence' | 'path';
export const EVIDENCE_FILTERS: readonly EvidenceFilter[] = ['all', 'given', 'open'];

/** Given is a learned point; dropped counts for nothing; everything else (open, blocked, partial, seen) is still open. */
export function evidenceState(item: Evidence): EvidenceState {
  if (item.state === 'learned') return 'given';
  if (item.state === 'dropped') return 'dropped';
  return 'open';
}

export interface EvidenceRow {
  /** `<path>#<index>`, unique per point (a point may stand in several groups). */
  key: string;
  item: Evidence;
  state: EvidenceState;
}

export interface EvidenceGroup {
  key: string;
  kind: 'competence' | 'path' | 'none';
  /** The competence or the path; absent for the group without a field. */
  id?: string;
  rows: EvidenceRow[];
}

export interface EvidenceQuery {
  filter: EvidenceFilter;
  /** One competence ('' every one). */
  competence: string;
  grouping: EvidenceGrouping;
}

/** The fields a point's path serves (the engine's list, never empty when present). */
const fieldsOf = (item: Evidence): readonly string[] => item.competence ?? [];

const rowOf = (item: Evidence): EvidenceRow => ({ key: `${item.path}#${item.index}`, item, state: evidenceState(item) });

/**
 * Filtered and grouped. By competence: a point stands under every field its path serves, the fields in the order of
 * `order` (then by id), the points without a field last; by path: in the engine's order. Within a group the engine's order
 * (open paths by id, then the finished ones, each in document order).
 */
export function evidenceGroups(items: readonly Evidence[], query: EvidenceQuery, order: readonly string[] = []): EvidenceGroup[] {
  const rows = items
    .filter((item) => query.competence === '' || fieldsOf(item).includes(query.competence))
    .map(rowOf)
    .filter((row) => query.filter === 'all' || row.state === query.filter);
  const groups = new Map<string, EvidenceGroup>();
  const add = (key: string, kind: EvidenceGroup['kind'], id: string | undefined, row: EvidenceRow): void => {
    let group = groups.get(key);
    if (!group) {
      group = { key, kind, ...(id !== undefined ? { id } : {}), rows: [] };
      groups.set(key, group);
    }
    group.rows.push(row);
  };
  for (const row of rows) {
    if (query.grouping === 'path') {
      add(`path:${row.item.path}`, 'path', row.item.path, row);
      continue;
    }
    const fields = fieldsOf(row.item).filter((id) => query.competence === '' || id === query.competence);
    if (fields.length === 0) add('none', 'none', undefined, row);
    for (const id of fields) add(`competence:${id}`, 'competence', id, row);
  }
  const list = [...groups.values()];
  if (query.grouping === 'path') return list;
  const rank = (id: string | undefined): number => {
    if (id === undefined) return Number.MAX_SAFE_INTEGER;
    const at = order.indexOf(id);
    return at < 0 ? order.length : at;
  };
  return list.toSorted((a, b) => rank(a.id) - rank(b.id) || (a.id ?? '').localeCompare(b.id ?? ''));
}

/** Given and open over the points (each point once), for the counter. */
export function evidenceTotals(items: readonly Evidence[]): { given: number; open: number } {
  let given = 0;
  let open = 0;
  for (const item of items) {
    const state = evidenceState(item);
    if (state === 'given') given += 1;
    else if (state === 'open') open += 1;
  }
  return { given, open };
}

/** The competences named by the evidence, for the filter. */
export function evidenceCompetences(items: readonly Evidence[]): string[] {
  return [...new Set(items.flatMap(fieldsOf))].sort();
}

/** A link of a point drawn as a link only when it is a web address; anything else is shown as text. */
export function webLink(link: string | undefined): string | null {
  if (link === undefined) return null;
  try {
    const url = new URL(link);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}
