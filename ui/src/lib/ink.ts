// The page's own whiteboard (concept 7.8, format `ink`): strokes of a pen with pressure on pages, kept as
// `<name>.ink.json` below `assets/boards/` and shown everywhere else as its SVG preview. This file is the model only:
// what a stroke is, how it is drawn as an outline that follows the pressure, how the eraser takes strokes away, the
// history of undo and redo, and the SVG of the whole board. The drawing surface (`views/BoardEditor.svelte`) holds the
// pointer and the view; the engine writes the files (`board_save`, WEB-13).

/** The schema word of a board file. */
export const INK_SCHEMA = 'tasks-ink/1';

/** The six colours of a pen: tokens of the palette (the preview reads their values when it is made). */
export const INK_COLORS = ['text', 'bad', 'chart-2', 'ok', 'chart-5', 'chart-3'] as const;
export type InkColor = (typeof INK_COLORS)[number];

/** The three widths of a pen, in units of the page. */
export const INK_WIDTHS = [3, 6, 12] as const;
export type InkWidth = (typeof INK_WIDTHS)[number];

/** A marker is wider than its pen and lets what is below shine through. */
export const MARKER_FACTOR = 4;
export const MARKER_OPACITY = 0.35;

/** The size of a page, in its units: what the preview shows of an empty page and where its background lies. */
export const PAGE_W = 1600;
export const PAGE_H = 1000;
/** The room between two pages in the preview. */
const PAGE_GAP = 40;
/** The step of the grid and of the lines of a background. */
export const RULE_STEP = 40;

/** Most pages of a board and most strokes of a page: a board stays a sketch, not a file that no page can draw. */
export const MAX_PAGES = 50;
export const MAX_STROKES = 5000;
/** Most points of a stroke (a pen sends about 200 a second: a stroke of more than a minute is two). */
export const MAX_POINTS = 12000;

export type InkTool = 'pen' | 'marker';
export type InkBackground = 'none' | 'grid' | 'lines';

export interface InkStroke {
  tool: InkTool;
  color: InkColor;
  width: InkWidth;
  /** `x, y, pressure` of each point, one after the other, in units of the page (pressure 0..1). */
  points: number[];
}

/** A picture behind the strokes (a slide, a photo), as a `data:` address, in units of the page. */
export interface InkImage {
  href: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface InkPage {
  background: InkBackground;
  image?: InkImage;
  strokes: InkStroke[];
}

export interface InkDoc {
  schema: typeof INK_SCHEMA;
  pages: InkPage[];
}

export function emptyPage(background: InkBackground = 'none'): InkPage {
  return { background, strokes: [] };
}

export function emptyDoc(): InkDoc {
  return { schema: INK_SCHEMA, pages: [emptyPage()] };
}

/** A picture the preview may carry: a raster `data:` address, nothing that could close an attribute. */
const DATA_IMAGE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function strokeOf(raw: unknown): InkStroke | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (s.tool !== 'pen' && s.tool !== 'marker') return null;
  if (!INK_COLORS.includes(s.color as InkColor)) return null;
  if (!INK_WIDTHS.includes(s.width as InkWidth)) return null;
  const points = s.points;
  if (!Array.isArray(points) || points.length === 0 || points.length % 3 !== 0 || points.length > MAX_POINTS * 3) return null;
  if (!points.every(finite)) return null;
  return { tool: s.tool, color: s.color as InkColor, width: s.width as InkWidth, points: points as number[] };
}

function imageOf(raw: unknown): InkImage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const i = raw as Record<string, unknown>;
  if (typeof i.href !== 'string' || !DATA_IMAGE.test(i.href)) return undefined;
  if (![i.x, i.y, i.w, i.h].every(finite) || (i.w as number) <= 0 || (i.h as number) <= 0) return undefined;
  return { href: i.href, x: i.x as number, y: i.y as number, w: i.w as number, h: i.h as number };
}

/** A board file read back: null when it is none; strokes, pictures and pages that do not read are left out. */
export function parseInk(text: string): InkDoc | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || (raw as { schema?: unknown }).schema !== INK_SCHEMA) return null;
  const pagesRaw = (raw as { pages?: unknown }).pages;
  if (!Array.isArray(pagesRaw)) return null;
  const pages: InkPage[] = [];
  for (const p of pagesRaw.slice(0, MAX_PAGES)) {
    if (!p || typeof p !== 'object') continue;
    const rec = p as Record<string, unknown>;
    const background: InkBackground = rec.background === 'grid' || rec.background === 'lines' ? rec.background : 'none';
    const strokes = (Array.isArray(rec.strokes) ? rec.strokes : [])
      .slice(0, MAX_STROKES)
      .map(strokeOf)
      .filter((s): s is InkStroke => s !== null);
    const image = imageOf(rec.image);
    pages.push(image ? { background, image, strokes } : { background, strokes });
  }
  return { schema: INK_SCHEMA, pages: pages.length > 0 ? pages : [emptyPage()] };
}

/** One decimal: a board is points of a hand, a tenth of a unit is finer than any pen. */
const r1 = (n: number): number => Math.round(n * 10) / 10;
const r2 = (n: number): number => Math.round(n * 100) / 100;

/** The text of the board file (points rounded, so that the file stays small). */
export function serializeInk(doc: InkDoc): string {
  const pages = doc.pages.map((p) => ({
    background: p.background,
    ...(p.image ? { image: p.image } : {}),
    strokes: p.strokes.map((s) => ({
      tool: s.tool,
      color: s.color,
      width: s.width,
      points: s.points.map((n, i) => (i % 3 === 2 ? r2(n) : r1(n))),
    })),
  }));
  return JSON.stringify({ schema: INK_SCHEMA, pages });
}

/** The pressure a point is drawn with: a mouse (or a pen that sends none) presses half. */
export function pressureOf(pointerType: string, pressure: number): number {
  if (pointerType !== 'pen' || !(pressure > 0)) return 0.5;
  return Math.min(1, pressure);
}

/** The radius of a stroke at a point: a pen grows with the pressure, a marker stays as wide as it is. */
export function radiusAt(stroke: Pick<InkStroke, 'tool' | 'width'>, pressure: number): number {
  if (stroke.tool === 'marker') return (stroke.width * MARKER_FACTOR) / 2;
  return (stroke.width / 2) * (0.35 + 0.65 * Math.min(1, Math.max(0, pressure)));
}

interface Pt {
  x: number;
  y: number;
  r: number;
}

/** The points of a stroke made smooth (each moves halfway towards the hand: a shaky hand draws a calm line). */
export function smoothed(stroke: InkStroke): Pt[] {
  const out: Pt[] = [];
  const p = stroke.points;
  for (let i = 0; i + 2 < p.length; i += 3) {
    const x = p[i] ?? 0;
    const y = p[i + 1] ?? 0;
    const r = radiusAt(stroke, p[i + 2] ?? 0.5);
    const last = out[out.length - 1];
    if (!last) {
      out.push({ x, y, r });
      continue;
    }
    const next = { x: last.x + (x - last.x) * 0.5, y: last.y + (y - last.y) * 0.5, r: last.r + (r - last.r) * 0.5 };
    // A point on the last one adds nothing to the outline (and has no direction).
    if (Math.hypot(next.x - last.x, next.y - last.y) < 0.3) continue;
    out.push(next);
  }
  // The end is where the hand was, not halfway to it.
  const end = out[out.length - 1];
  const lx = p[p.length - 3];
  const ly = p[p.length - 2];
  if (end && out.length > 1 && lx !== undefined && ly !== undefined && Math.hypot(lx - end.x, ly - end.y) >= 0.3) {
    out.push({ x: lx, y: ly, r: end.r });
  }
  return out;
}

const f = (n: number): string => String(r1(n));

/** A dot: a stroke of one point. */
function dot(p: Pt): string {
  const r = Math.max(p.r, 0.5);
  return `M${f(p.x - r)} ${f(p.y)}A${f(r)} ${f(r)} 0 1 0 ${f(p.x + r)} ${f(p.y)}A${f(r)} ${f(r)} 0 1 0 ${f(p.x - r)} ${f(p.y)}Z`;
}

/** A smooth line through `pts`: quadratic curves from midpoint to midpoint (`M` not included). */
function through(pts: { x: number; y: number }[]): string {
  let d = '';
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i] as { x: number; y: number };
    const b = pts[i + 1] as { x: number; y: number };
    d += `Q${f(a.x)} ${f(a.y)} ${f((a.x + b.x) / 2)} ${f((a.y + b.y) / 2)}`;
  }
  const last = pts[pts.length - 1];
  if (last) d += `L${f(last.x)} ${f(last.y)}`;
  return d;
}

/**
 * The outline of a stroke as the `d` of a filled path: both edges of the line, each as far from the middle as the
 * pressure was there, joined by round caps. Empty for a stroke without points.
 */
export function strokePath(stroke: InkStroke): string {
  const pts = smoothed(stroke);
  const first = pts[0];
  if (!first) return '';
  if (pts.length === 1) return dot(first);
  const left: { x: number; y: number }[] = [];
  const right: { x: number; y: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as Pt;
    const a = pts[Math.max(0, i - 1)] as Pt;
    const b = pts[Math.min(pts.length - 1, i + 1)] as Pt;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    left.push({ x: p.x + nx * p.r, y: p.y + ny * p.r });
    right.push({ x: p.x - nx * p.r, y: p.y - ny * p.r });
  }
  const last = pts[pts.length - 1] as Pt;
  const l0 = left[0] as { x: number; y: number };
  const rEnd = right[right.length - 1] as { x: number; y: number };
  const r0 = right[0] as { x: number; y: number };
  const back = [...right].reverse();
  return (
    `M${f(l0.x)} ${f(l0.y)}` +
    through(left) +
    `A${f(last.r)} ${f(last.r)} 0 0 1 ${f(rEnd.x)} ${f(rEnd.y)}` +
    through(back) +
    `A${f(first.r)} ${f(first.r)} 0 0 1 ${f(l0.x)} ${f(l0.y)}Z`
  );
}

/** The distance of `(px, py)` to the segment from `a` to `b`. */
function toSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Whether the eraser at `(x, y)` with `radius` touches the stroke (its line, as wide as it is drawn). */
export function touches(stroke: InkStroke, x: number, y: number, radius: number): boolean {
  const p = stroke.points;
  const reach = radius + radiusAt(stroke, 1);
  if (p.length === 3) return Math.hypot(x - (p[0] ?? 0), y - (p[1] ?? 0)) <= reach;
  for (let i = 0; i + 5 < p.length; i += 3) {
    if (toSegment(x, y, p[i] ?? 0, p[i + 1] ?? 0, p[i + 3] ?? 0, p[i + 4] ?? 0) <= reach) return true;
  }
  return false;
}

/** The page without the strokes the eraser touches at `(x, y)`; the same page when it touches none. */
export function eraseAt(page: InkPage, x: number, y: number, radius: number): InkPage {
  const kept = page.strokes.filter((s) => !touches(s, x, y, radius));
  return kept.length === page.strokes.length ? page : { ...page, strokes: kept };
}

/** Undo and redo: the boards before and after, newest last. */
export interface InkHistory {
  past: InkDoc[];
  future: InkDoc[];
}

/** Most steps back. */
export const MAX_HISTORY = 100;

/** A change: the board before it can be had back; what was undone before is gone. */
export function recorded(h: InkHistory, before: InkDoc): InkHistory {
  return { past: [...h.past, before].slice(-MAX_HISTORY), future: [] };
}

/** One step back: the board to show, and the history after it; null when there is nothing to undo. */
export function undone(h: InkHistory, now: InkDoc): { doc: InkDoc; history: InkHistory } | null {
  const doc = h.past[h.past.length - 1];
  if (!doc) return null;
  return { doc, history: { past: h.past.slice(0, -1), future: [...h.future, now] } };
}

/** One step forward again; null when nothing was undone. */
export function redone(h: InkHistory, now: InkDoc): { doc: InkDoc; history: InkHistory } | null {
  const doc = h.future[h.future.length - 1];
  if (!doc) return null;
  return { doc, history: { past: [...h.past, now], future: h.future.slice(0, -1) } };
}

/** A new page after `index`, with the background of that page. */
export function withPageAfter(doc: InkDoc, index: number): InkDoc {
  if (doc.pages.length >= MAX_PAGES) return doc;
  const pages = [...doc.pages];
  pages.splice(index + 1, 0, emptyPage(doc.pages[index]?.background ?? 'none'));
  return { ...doc, pages };
}

/** `doc` with page `index` replaced. */
export function withPage(doc: InkDoc, index: number, page: InkPage): InkDoc {
  return { ...doc, pages: doc.pages.map((p, i) => (i === index ? page : p)) };
}

/** The colours of the preview: each token's value as a CSS colour, and the paper and the rules. */
export interface InkPalette {
  colors: Record<InkColor, string>;
  paper: string;
  rule: string;
}

/** A colour as the preview may carry it: what a computed style gives (`rgb(…)`, `#…`), nothing else. */
const SAFE_COLOR = /^(?:#[0-9a-fA-F]{3,8}|rgba?\([0-9., %/]+\)|color\([a-z0-9-]+(?: [0-9.e+-]+){3}(?: \/ [0-9.]+)?\))$/;

function safe(color: string, fallback: string): string {
  return SAFE_COLOR.test(color) ? color : fallback;
}

/** The lines of a background of a page at `top`, as one path. */
export function rulesPath(background: InkBackground, top: number): string {
  if (background === 'none') return '';
  let d = '';
  for (let y = RULE_STEP; y < PAGE_H; y += RULE_STEP) d += `M0 ${top + y}H${PAGE_W}`;
  if (background === 'grid') for (let x = RULE_STEP; x < PAGE_W; x += RULE_STEP) d += `M${x} ${top}V${top + PAGE_H}`;
  return d;
}

/** The space a page takes in the preview: the page, and every stroke that went beyond it. */
export function pageBounds(page: InkPage): { x: number; y: number; w: number; h: number } {
  let x0 = 0;
  let y0 = 0;
  let x1 = PAGE_W;
  let y1 = PAGE_H;
  for (const s of page.strokes) {
    const pad = radiusAt(s, 1);
    for (let i = 0; i + 1 < s.points.length; i += 3) {
      const x = s.points[i] ?? 0;
      const y = s.points[i + 1] ?? 0;
      x0 = Math.min(x0, x - pad);
      y0 = Math.min(y0, y - pad);
      x1 = Math.max(x1, x + pad);
      y1 = Math.max(y1, y + pad);
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const attr = (text: string): string => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * The SVG of the whole board: its pages one below the other, each with its paper, its rules, its picture and its
 * strokes in the colours of `palette` (the preview is a file, it knows no tokens). `title` names it for a reader.
 */
export function boardSvg(doc: InkDoc, palette: InkPalette, title: string): string {
  const parts: string[] = [];
  let top = 0;
  let left = 0;
  let right = PAGE_W;
  for (const page of doc.pages) {
    const b = pageBounds(page);
    const shift = top - b.y;
    left = Math.min(left, b.x);
    right = Math.max(right, b.x + b.w);
    parts.push(`<g transform="translate(0 ${f(shift)})">`);
    parts.push(`<rect x="${f(b.x)}" y="${f(b.y)}" width="${f(b.w)}" height="${f(b.h)}" fill="${safe(palette.paper, 'white')}"/>`);
    const rules = rulesPath(page.background, 0);
    if (rules) parts.push(`<path d="${rules}" stroke="${safe(palette.rule, 'silver')}" stroke-width="1" fill="none"/>`);
    if (page.image && DATA_IMAGE.test(page.image.href)) {
      const i = page.image;
      parts.push(`<image href="${attr(i.href)}" x="${f(i.x)}" y="${f(i.y)}" width="${f(i.w)}" height="${f(i.h)}"/>`);
    }
    for (const s of page.strokes) {
      const d = strokePath(s);
      if (!d) continue;
      const fill = safe(palette.colors[s.color], 'black');
      const opacity = s.tool === 'marker' ? ` fill-opacity="${MARKER_OPACITY}"` : '';
      parts.push(`<path d="${d}" fill="${fill}"${opacity}/>`);
    }
    parts.push('</g>');
    top += b.h + PAGE_GAP;
  }
  const height = Math.max(PAGE_H, top - PAGE_GAP);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(left)} 0 ${f(right - left)} ${f(height)}" width="${f(right - left)}" height="${f(height)}">` +
    `<title>${attr(title)}</title>${parts.join('')}</svg>`
  );
}

/** The name of a new board: `board-YYYY-MM-DD-HHMM` of the wall clock. */
export function boardName(ms: number): string {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, '0');
  return `board-${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
}

/** The name of the board a path below `assets/boards/` belongs to (`.svg`, `.png`, `.ink.json`); null for another. */
export function boardOfAsset(asset: string): string | null {
  const m = /^assets\/boards\/([^/]+?)(?:\.ink\.json|\.svg|\.png)$/.exec(asset);
  return m?.[1] ?? null;
}

/** The etag the engine gives the board file (`sha256:` and the first 16 hex digits of the SHA-256 of its bytes). */
export async function inkEtag(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex.slice(0, 16)}`;
}

/**
 * Whether a pointer may draw (palm rejection): once a pen was seen, a touch never draws, it only moves the view; before
 * that a finger draws as well. A mouse and a pen always draw.
 */
export function drawsWith(pointerType: string, penSeen: boolean): boolean {
  return pointerType !== 'touch' || !penSeen;
}

/** Whether a pointer is the eraser: the eraser end of a pen (button 5) or a pen held with its eraser button down. */
export function erasesWith(event: { pointerType: string; button: number; buttons: number }): boolean {
  return event.pointerType === 'pen' && (event.button === 5 || (event.buttons & 32) !== 0);
}
