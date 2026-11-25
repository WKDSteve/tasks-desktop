// The catalogue of the competences (concept "Reiter Lernpläne" 5): the fields of knowledge with their stage in theory and
// practice, their targets in 12 and 24 months, the learning paths that lead there and the evidence given and open. The
// stages, the targets, the scale and which path serves which field are the engine's (`tasks.competences`,
// `tasks.learn_evidence`, `tasks.paths`; WEB-13): this file draws the ladder, filters, groups and orders.

import type { Competences, CompetenceLevel, LearnEvidence, PathEntry } from './contract';

export type Competence = Competences['items'][number];
export type Scale = Competences['scale'];
export type Axis = 't' | 'p';
export const AXES: readonly Axis[] = ['t', 'p'];

/** The ladder has a field per stage 1..8 (0 is "unknown", no field). */
export const LADDER = 8;
export type Rung = 'full' | 'half' | 'empty';

/** The fields of the ladder of a stage: reached ones full, the half one of a stage n.5 half, the rest empty. */
export function ladder(level: CompetenceLevel | undefined): Rung[] {
  return Array.from({ length: LADDER }, (_, i) => {
    const rung = i + 1;
    if (level === undefined) return 'empty';
    if (level >= rung) return 'full';
    if (level >= rung - 0.5) return 'half';
    return 'empty';
  });
}

/** The rung a target marks (a half target marks the rung it reaches into), or null. */
export function targetRung(level: CompetenceLevel | undefined): number | null {
  if (level === undefined || level <= 0) return null;
  return Math.min(LADDER, Math.ceil(level));
}

/** The target of an axis; a target written as one stage holds for both (the engine gives it as `{t, p}`). */
export const targetOf = (target: Competence['target_12'], axis: Axis): CompetenceLevel | undefined => target?.[axis];

/** How far the 12-month target is, the larger of the two axes; null without a target or a stage to compare. */
export function distance(item: Competence): number | null {
  let out: number | null = null;
  for (const axis of AXES) {
    const target = targetOf(item.target_12, axis) ?? targetOf(item.target_24, axis);
    const now = item[axis];
    if (target === undefined || now === undefined) continue;
    const gap = target - now;
    out = out === null ? gap : Math.max(out, gap);
  }
  return out;
}

export const hasTarget = (item: Competence): boolean => AXES.some((axis) => targetOf(item.target_12, axis) !== undefined || targetOf(item.target_24, axis) !== undefined);

/** The name of a stage on the scale (a half stage takes the name of the whole one below). */
export function stageName(scale: Scale | undefined, level: CompetenceLevel): string {
  const whole = Math.floor(level);
  return scale?.find((s) => s.level === whole)?.name ?? '';
}

/** A stage as a number in the language ("3,5" in German) with its name: "3 Profi". */
export function stageText(scale: Scale | undefined, level: CompetenceLevel, lang: 'de' | 'en'): string {
  const number = new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-GB', { maximumFractionDigits: 1 }).format(level);
  const name = stageName(scale, level);
  return name === '' ? number : `${number} ${name}`;
}

/** The evidence of a competence: given (learned) and still open (open, blocked, partial, seen); dropped ones count not. */
export interface EvidenceCount {
  given: number;
  open: number;
}

export function evidenceCounts(items: LearnEvidence['items']): Map<string, EvidenceCount> {
  const out = new Map<string, EvidenceCount>();
  for (const item of items) {
    if (item.state === 'dropped') continue;
    for (const id of item.competence ?? []) {
      const count = out.get(id) ?? { given: 0, open: 0 };
      if (item.state === 'learned') count.given += 1;
      else count.open += 1;
      out.set(id, count);
    }
  }
  return out;
}

export type CompetenceSort = 'name' | 'distance';
export interface CompetenceFilter {
  withTarget: boolean;
  withPath: boolean;
  /** A part of the title, without case. */
  text: string;
}

export interface CompetenceGroup {
  /** The group as the files name it; null for the fields without one. */
  name: string | null;
  items: Competence[];
}

/** The paths that serve a competence: the engine's `paths` of the field, and the finished ones that name it. */
export function pathsOf(item: Competence, paths: readonly PathEntry[]): PathEntry[] {
  const named = new Set(item.paths);
  return paths.filter((p) => named.has(p.id) || ((p.competence ?? []) as readonly string[]).includes(item.id));
}

/**
 * The fields filtered and grouped: by group (by name, the fields without one last), within a group by title or by the
 * distance to the target (the furthest first, those without one last).
 */
export function competenceGroups(
  items: readonly Competence[],
  paths: readonly PathEntry[],
  filter: CompetenceFilter,
  sort: CompetenceSort,
): CompetenceGroup[] {
  const text = filter.text.trim().toLocaleLowerCase();
  const kept = items.filter(
    (item) =>
      (!filter.withTarget || hasTarget(item)) &&
      (!filter.withPath || pathsOf(item, paths).length > 0) &&
      (text === '' || item.title.toLocaleLowerCase().includes(text) || item.id.toLocaleLowerCase().includes(text)),
  );
  const byTitle = (a: Competence, b: Competence): number => a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  const byDistance = (a: Competence, b: Competence): number => {
    const da = distance(a);
    const db = distance(b);
    if (da === db) return byTitle(a, b);
    if (da === null) return 1;
    if (db === null) return -1;
    return db - da || byTitle(a, b);
  };
  const groups = new Map<string | null, Competence[]>();
  for (const item of kept) {
    const name = item.group?.trim() || null;
    groups.set(name, [...(groups.get(name) ?? []), item]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b)))
    .map(([name, list]) => ({ name, items: list.toSorted(sort === 'distance' ? byDistance : byTitle) }));
}

/** The learning paths that name no competence: the group "Without a field" at the end. */
export function pathsWithoutCompetence(paths: readonly PathEntry[], items: readonly Competence[]): PathEntry[] {
  const served = new Set(items.flatMap((item) => item.paths));
  return paths.filter((p) => (p.competence ?? []).length === 0 && !served.has(p.id));
}
