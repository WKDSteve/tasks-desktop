// Learning paths (concept "Lernplan" 11.3): a tree of learning points, each ticked as learned, seen (looked at, not
// done), dropped (not applicable) or blocked, and a point can become a task of its own. The engine reads the tree
// (`tasks.path`: a flat list in document order), counts the progress and derives the state of a parent; it writes a
// point (`node_set`) and makes a task of it (`promote`). This file only turns that list into what the view draws (which
// points are shown when parents are folded, the text of a label, the parts of a progress bar) and the person's choice
// into the operation the engine takes. It decides no rule (WEB-13): which state a point may take, whether a reason is
// enough, whether a parent is closed is the engine's.

import type { Op } from './api';
import type { LevelsSpec, PathLevel, PathNode, PathProgress } from './contract';

/** The state of a learning point that has a mark of its own (a leaf). */
export type PointState = NonNullable<PathNode['state']>;

/** The four states the person sets by hand besides `open`, in the order of the menu. */
export const MENU_STATES: readonly PointState[] = ['learned', 'seen', 'dropped', 'blocked'];

/**
 * The states that are written with a text beside them: the reason of `seen` and `dropped`, the key a blocked point
 * waits for (the engine writes both as `– Grund: …`). The engine refuses `seen` and `dropped` without one; the page asks
 * for it before it sends, so the person is not refused after the fact.
 */
export function needsReason(state: PointState): boolean {
  return state === 'seen' || state === 'dropped' || state === 'blocked';
}

/** The longest reason the page sends (one line; the engine judges the rest). */
export const REASON_MAX = 300;

/** A reason as one line, trimmed; null when nothing is left. */
export function cleanReason(text: string): string | null {
  const line = text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return line === '' ? null : [...line].slice(0, REASON_MAX).join('');
}

/** The name a point is told by in an operation: its key, or `#<index>` where it has none (the engine's rule). */
export function pointRef(node: Pick<PathNode, 'key' | 'index'>): string {
  return node.key !== undefined && node.key !== '' ? node.key : `#${node.index}`;
}

/** A point with a mark of its own the person can change here: a leaf, not promoted, with a state the engine knows. */
export function isMarkable(node: Pick<PathNode, 'children' | 'promoted' | 'state'>): boolean {
  return node.children === 0 && node.promoted === undefined && node.state !== undefined;
}

/**
 * The points that are shown, in document order: a point is hidden when one of its parents is folded (`folded` holds
 * the `index` of each folded point). The list of the engine names each parent before its children.
 */
export function visiblePoints<N extends Pick<PathNode, 'index' | 'parent'>>(nodes: readonly N[], folded: ReadonlySet<number>): N[] {
  const hidden = new Set<number>();
  const shown: N[] = [];
  for (const node of nodes) {
    const parent = node.parent;
    if (parent !== undefined && (hidden.has(parent) || folded.has(parent))) {
      hidden.add(node.index);
      continue;
    }
    shown.push(node);
  }
  return shown;
}

/** The indices of every point that has children: what "fold all" folds. */
export function parentIndices(nodes: readonly Pick<PathNode, 'index' | 'children'>[]): number[] {
  return nodes.filter((n) => n.children > 0).map((n) => n.index);
}

/**
 * A name of each point (by `index`) that stays the same when the path is read again after a change elsewhere in the
 * file: its key, or, without one, its label with the number of earlier keyless points of the same label. An index or a
 * line moves when a point is added above; this does not. What the view holds across a read (folded points, the field
 * being written) is held by this name.
 */
export function pointIds(nodes: readonly Pick<PathNode, 'index' | 'key' | 'label'>[]): Map<number, string> {
  const ids = new Map<number, string>();
  const seen = new Map<string, number>();
  for (const node of nodes) {
    if (node.key !== undefined && node.key !== '') {
      ids.set(node.index, `key:${node.key}`);
      continue;
    }
    const label = node.label.trim();
    const n = seen.get(label) ?? 0;
    seen.set(label, n + 1);
    ids.set(node.index, `label:${n}:${label}`);
  }
  return ids;
}

/** The indices of the points named in `ids` (see `pointIds`); a name no point has any more is left out. */
export function indicesOf(byIndex: ReadonlyMap<number, string>, ids: ReadonlySet<string>): Set<number> {
  const out = new Set<number>();
  for (const [index, id] of byIndex) if (ids.has(id)) out.add(index);
  return out;
}

const LINK_LABEL = /^\[([^\]]+)\]\(([^)\s]+)\)$/;
const IMAGE_LABEL = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;

/**
 * The text of a label as the view shows it: a label that is one Markdown link shows the link's text (the link itself
 * is `link`, opened by its own control), one that is an image its alternative text or the file's name. Everything else
 * is the label as written: untrusted text, drawn as text, never as markup.
 */
export function labelText(node: Pick<PathNode, 'label'>): string {
  const label = node.label.trim();
  const link = LINK_LABEL.exec(label);
  if (link) return link[1]!;
  const image = IMAGE_LABEL.exec(label);
  if (image) return image[1] !== '' ? image[1]! : (image[2]!.split('/').pop() ?? image[2]!);
  return label;
}

/** A link of a point the page opens: an absolute `http:` or `https:` address, as parsed; anything else is not opened. */
export function openableLink(url: string | undefined): string | null {
  if (url === undefined) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
}

/** One part of a progress bar. */
export interface ProgressPart {
  kind: 'learned' | 'seen' | 'dropped' | 'open';
  n: number;
  /** Its share of the leaves, 0 to 1 (for the width only). */
  share: number;
}

/**
 * The parts of a progress bar, the engine's counts apart: learned, seen, dropped, open (a blocked point is counted as
 * open, and the engine names it once more as `blocked`). Parts without a point are left out.
 */
export function progressParts(progress: PathProgress): ProgressPart[] {
  const total = progress.total;
  const kinds: ProgressPart['kind'][] = ['learned', 'seen', 'dropped', 'open'];
  return kinds
    .map((kind) => ({ kind, n: progress[kind], share: total > 0 ? progress[kind] / total : 0 }))
    .filter((part) => part.n > 0);
}

/** The state a click on the mark of a point sets: an open point is learned, any other is open again. */
export function clickedState(state: PointState): PointState {
  return state === 'open' ? 'learned' : 'open';
}

const match = (etag: string | undefined): { if_match?: string } => (etag ? { if_match: etag } : {});

/**
 * The operation that gives point `node` of path `id` the state `state` (with its reason), on the version read; `ack`
 * when the person confirmed closing a point under `{safety}` (capability `path_marks`).
 */
export function stateOp(
  id: string,
  etag: string | undefined,
  node: Pick<PathNode, 'key' | 'index'>,
  state: PointState,
  reason?: string,
  ack = false,
): Op {
  return {
    op: 'node_set',
    id,
    point: pointRef(node),
    state,
    ...(reason !== undefined ? { reason } : {}),
    ...(ack ? { ack: true as const } : {}),
    ...match(etag),
  };
}

/** Whether giving `node` the state `state` closes a point under `{safety}`: the engine wants `ack`, the page asks first. */
export function closesSafety(node: Pick<PathNode, 'safety'>, state: PointState): boolean {
  return node.safety === true && (state === 'learned' || state === 'seen');
}

/** The operation that writes the note of point `node` (`""` removes it), on the version read (capability `node_note`). */
export function noteOp(id: string, etag: string | undefined, node: Pick<PathNode, 'key' | 'index'>, note: string): Op {
  return { op: 'node_set', id, point: pointRef(node), note, ...match(etag) };
}

/**
 * The operation that writes the result (the `**Ergebnis:**` line of the exercise block) of point `node` and, when given,
 * its state in the same call (capability `node_result`): the engine writes the proof first, so one call closes the point.
 */
export function resultOp(
  id: string,
  etag: string | undefined,
  node: Pick<PathNode, 'key' | 'index'>,
  result: string,
  state?: PointState,
): Op {
  return { op: 'node_set', id, point: pointRef(node), ...(state !== undefined ? { state } : {}), result, ...match(etag) };
}

/** The largest XP of one point the engine takes (`lernbaum.MAX_XP`). */
export const XP_MAX = 100000;

/**
 * What the XP field holds: a whole number from 0 to `XP_MAX` (digits, spaces around them allowed), `'clear'` for an empty
 * field (the point has no XP then), or `null` for anything else (said, never sent).
 */
export function parseXp(text: string): number | 'clear' | null {
  const t = text.trim();
  if (t === '') return 'clear';
  if (!/^\d{1,6}$/.test(t)) return null;
  const n = Number(t);
  return n <= XP_MAX ? n : null;
}

/** The operation that writes the XP of point `node` (`'clear'` removes them), on the version read (capability `xp`). */
export function xpOp(id: string, etag: string | undefined, node: Pick<PathNode, 'key' | 'index'>, xp: number | 'clear'): Op {
  return { op: 'node_set', id, point: pointRef(node), ...(xp === 'clear' ? { xp_clear: true as const } : { xp }), ...match(etag) };
}

/** The operation that marks the reward of level `ref` (its number or `done`) granted or not (capability `path_reward`). */
export function rewardOp(id: string, etag: string | undefined, ref: string, given: boolean): Op {
  return { op: 'path_reward', id, level: ref, given, ...match(etag) };
}

/** The share of the possible XP earned, 0..100, for a bar (none possible: 0). */
export function xpPercent(xp: { earned: number; possible: number } | undefined): number {
  if (!xp || xp.possible <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((xp.earned * 100) / xp.possible)));
}

/** The operation that makes point `node` of the path or task `container` a task of its own. */
export function promoteOp(container: string, etag: string | undefined, node: Pick<PathNode, 'key' | 'index'>): Op {
  return { op: 'promote', container, point: pointRef(node), ...match(etag) };
}

/** A note as the engine takes it: lines kept, the ends of lines as `\n`, trailing space of the whole trimmed. */
export function cleanNote(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
}

// ── the levels of a path, as a form (capability `path_levels`) ──

/** One level as the form holds it: what is typed, as text, before the engine judges it. */
export interface LevelRow {
  threshold: string;
  unit: 'xp' | 'percent';
  name: string;
  badge: string;
  reward: string;
  given: boolean;
}

/** The line for the whole path in the form: whether there is one, its reward and whether that was granted. */
export interface DoneRow {
  on: boolean;
  reward: string;
  given: boolean;
}

/** The most levels the engine writes (`lernlevel.MAX_LEVELS`). */
export const LEVELS_MAX = 20;
/** The longest name and reward of a level the engine takes (`lernlevel.MAX_NAME`, `MAX_REWARD`). */
export const LEVEL_NAME_MAX = 80;
export const LEVEL_REWARD_MAX = 200;

/** The form of the levels a path has (`tasks.path` `levels`, in file order), the line for the whole path apart. */
export function levelRows(levels: readonly PathLevel[] | undefined): { rows: LevelRow[]; done: DoneRow } {
  const rows: LevelRow[] = [];
  let done: DoneRow = { on: false, reward: '', given: false };
  for (const level of levels ?? []) {
    if (level.kind === 'done') {
      done = { on: true, reward: level.reward ?? '', given: level.given };
      continue;
    }
    rows.push({
      threshold: level.threshold !== undefined ? String(level.threshold) : '',
      unit: level.kind,
      name: level.name ?? '',
      badge: level.badge ?? '',
      reward: level.reward ?? '',
      given: level.given,
    });
  }
  return { rows, done };
}

/** A new level for the form: the next threshold above the last one of XP (or 50 XP for the first). */
export function nextRow(rows: readonly LevelRow[]): LevelRow {
  const last = rows.findLast((r) => r.unit === 'xp' && /^\d+$/.test(r.threshold.trim()));
  const threshold = last ? String(Number(last.threshold.trim()) + 50) : '50';
  return { threshold, unit: 'xp', name: '', badge: '', reward: '', given: false };
}

/** The pictures a badge may be: the files of the path below `assets/badges/` (png, jpg, jpeg, webp, svg), sorted. */
export function badgeFiles(assets: readonly string[] | undefined): string[] {
  return (assets ?? []).filter((file) => /^assets\/badges\/[^\s]+\.(png|jpe?g|webp|svg)$/i.test(file) && !file.includes('..')).sort();
}

/**
 * The operation that writes the levels of path `id` as the form holds them, on the version read; or the row whose
 * threshold is no whole number (said, never sent). Every other rule (thresholds that rise, the length of a name, a
 * badge below `assets/badges/`) is the engine's, which refuses with its reason.
 */
export function levelsOp(id: string, etag: string | undefined, rows: readonly LevelRow[], done: DoneRow): Op | { invalid: number } {
  const list: LevelsSpec['list'] = [];
  for (const [i, row] of rows.entries()) {
    const t = row.threshold.trim();
    if (!/^\d{1,6}$/.test(t) || Number(t) < 1) return { invalid: i };
    const name = row.name.trim();
    const badge = row.badge.trim();
    const reward = row.reward.trim();
    list.push({
      threshold: Number(t),
      unit: row.unit,
      ...(name ? { name } : {}),
      ...(badge ? { badge } : {}),
      ...(reward ? { reward, ...(row.given ? { given: true } : {}) } : {}),
    });
  }
  const levels: LevelsSpec = { list };
  if (done.on) {
    const reward = done.reward.trim();
    levels.done = reward ? { reward, ...(done.given ? { given: true } : {}) } : {};
  }
  return { op: 'path_levels', id, levels, ...match(etag) };
}

/**
 * The operation that sets the XP of the task a point was promoted to (`xp:` in its frontmatter; `'clear'` removes it):
 * a `set` on the task, not `node_set`, since the task owns the XP of its point (capability `xp`).
 */
export function taskXpOp(task: string, etag: string | undefined, xp: number | 'clear'): Op {
  return { op: 'set', id: task, patch: { xp: xp === 'clear' ? null : xp }, ...match(etag) };
}
