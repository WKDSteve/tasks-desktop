// The hour grid of the calendar (concept 7.3, decision F9: week and day alike) and the meetings in the month: only
// layout. Where a meeting stands, which ones overlap, what a drag makes of it (the `meeting_set` patch). Whether a
// meeting or a write is valid stays the engine's word: the grid shows the times as the file wrote them (its own zone)
// and a drag writes them back in the same wall time.

import { addDays, parseDate } from './calendar';
import type { MeetingEntry } from './contract';
import { wallMinutes } from './meetings';

/** The minutes of a day the grid shows without scrolling: 07:00 to 20:00 (it scrolls over the whole day). */
export const VISIBLE_FROM = 7 * 60;
export const VISIBLE_TO = 20 * 60;
/** A row of the grid is half an hour; a drag snaps to a quarter. */
export const SLOT_MIN = 30;
export const SNAP_MIN = 15;
export const DAY_MIN = 24 * 60;
/** The shortest meeting a drag makes. */
export const MIN_LENGTH = 15;
/** A meeting without an end is drawn this long. */
export const DEFAULT_LENGTH = 30;

/** One meeting as a block of a day: minutes of that day, and its place beside the overlapping ones. */
export interface Block {
  meeting: MeetingEntry;
  day: string;
  /** Minutes of the day (0..1440) of the part of the meeting on this day. */
  start: number;
  end: number;
  /** The column among the overlapping blocks, and how many columns that cluster has. */
  col: number;
  cols: number;
  /** Overlaps another meeting that is not cancelled. */
  conflict: boolean;
}

const dayOf = (at: string): string => at.slice(0, 10);

/** The days an all-day meeting covers (`date` to the day of `ends_at`), at most 31. */
export function allDayDays(m: Pick<MeetingEntry, 'date' | 'ends_at' | 'starts_at'>): string[] {
  const first = dayOf(m.starts_at ?? String(m.date ?? ''));
  if (!parseDate(first)) return [];
  const last = m.ends_at ? dayOf(m.ends_at) : first;
  const out: string[] = [];
  for (let d = first; d <= last && out.length < 31; d = addDays(d, 1)) out.push(d);
  return out.length > 0 ? out : [first];
}

/** The part of a timed meeting on `day` in minutes of that day, or null when it is all day or not on the day. */
export function spanOn(m: Pick<MeetingEntry, 'starts_at' | 'ends_at' | 'all_day'>, day: string): { start: number; end: number } | null {
  if (m.all_day || !m.starts_at || m.starts_at.length < 16) return null;
  const begin = wallMinutes(m.starts_at);
  const dayStart = wallMinutes(day);
  if (Number.isNaN(begin) || Number.isNaN(dayStart)) return null;
  const finish = m.ends_at && m.ends_at.length >= 16 ? wallMinutes(m.ends_at) : Number.NaN;
  const endAt = !Number.isNaN(finish) && finish > begin ? finish : begin + DEFAULT_LENGTH;
  const start = Math.max(begin - dayStart, 0);
  const end = Math.min(endAt - dayStart, DAY_MIN);
  return end > start ? { start, end } : null;
}

/** Put overlapping blocks side by side: the column of each and the number of columns of its cluster. */
export function layoutColumns(blocks: Block[]): Block[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || b.end - a.end || a.meeting.id.localeCompare(b.meeting.id));
  let cluster: Block[] = [];
  let clusterEnd = -1;
  let columnEnds: number[] = [];
  const close = (): void => {
    for (const b of cluster) b.cols = columnEnds.length;
    cluster = [];
    columnEnds = [];
    clusterEnd = -1;
  };
  for (const block of sorted) {
    if (cluster.length > 0 && block.start >= clusterEnd) close();
    let col = columnEnds.findIndex((end) => end <= block.start);
    if (col < 0) {
      col = columnEnds.length;
      columnEnds.push(block.end);
    } else columnEnds[col] = block.end;
    block.col = col;
    cluster.push(block);
    clusterEnd = Math.max(clusterEnd, block.end);
  }
  close();
  // A conflict: two meetings that are not cancelled share some time.
  const live = sorted.filter((b) => b.meeting.status !== 'cancelled');
  for (const block of sorted) {
    block.conflict = block.meeting.status !== 'cancelled' && live.some((o) => o !== block && o.start < block.end && block.start < o.end);
  }
  return sorted;
}

/** The timed blocks of `days`, by day, each day laid out. */
export function blocksByDay(meetings: readonly MeetingEntry[], days: readonly string[]): Map<string, Block[]> {
  const out = new Map<string, Block[]>();
  for (const day of days) {
    const here: Block[] = [];
    for (const meeting of meetings) {
      const span = spanOn(meeting, day);
      if (span) here.push({ meeting, day, ...span, col: 0, cols: 1, conflict: false });
    }
    out.set(day, layoutColumns(here));
  }
  return out;
}

/** The all-day meetings on each of `days`. */
export function allDayByDay(meetings: readonly MeetingEntry[], days: readonly string[]): Map<string, MeetingEntry[]> {
  const out = new Map<string, MeetingEntry[]>(days.map((d) => [d, []]));
  for (const m of meetings) {
    if (!m.all_day) continue;
    for (const day of allDayDays(m)) out.get(day)?.push(m);
  }
  for (const list of out.values()) list.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  return out;
}

/** The meetings that touch each of `days` (all day first, then by beginning): the chips of the month. */
export function meetingsByDay(meetings: readonly MeetingEntry[], days: readonly string[]): Map<string, MeetingEntry[]> {
  const out = new Map<string, MeetingEntry[]>(days.map((d) => [d, []]));
  for (const m of meetings) {
    if (m.all_day) {
      for (const day of allDayDays(m)) out.get(day)?.push(m);
    } else {
      for (const day of days) if (spanOn(m, day)) out.get(day)?.push(m);
    }
  }
  const key = (m: MeetingEntry): string => (m.all_day ? '' : (m.time ?? m.starts_at?.slice(11, 16) ?? ''));
  for (const list of out.values()) list.sort((a, b) => key(a).localeCompare(key(b)) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  return out;
}

/** The sign before a chip: the service or place of a meeting. `⧉` online, `⌖` a place, '' neither. */
export function placeSign(m: Pick<MeetingEntry, 'online' | 'online_service' | 'location'>): string {
  if (m.online || m.online_service) return '⧉';
  return m.location ? '⌖' : '';
}

/** What the filter keeps: a place (online, in person, or one service) and whether participants are named. */
export interface MeetingFilter {
  place: 'all' | 'online' | 'in_person' | string;
  /** `any`, `with` (at least one participant) or `without`. */
  people: 'any' | 'with' | 'without';
}
export const NO_FILTER: MeetingFilter = { place: 'all', people: 'any' };

/** The meetings the filter keeps. A service is the engine's word (`online_service`). */
export function filterMeetings(meetings: readonly MeetingEntry[], filter: MeetingFilter): MeetingEntry[] {
  return meetings.filter((m) => {
    if (filter.place === 'online' && !m.online) return false;
    if (filter.place === 'in_person' && (m.online || !m.location)) return false;
    if (filter.place !== 'all' && filter.place !== 'online' && filter.place !== 'in_person' && m.online_service !== filter.place) return false;
    const n = m.participants?.total ?? 0;
    if (filter.people === 'with' && n === 0) return false;
    if (filter.people === 'without' && n > 0) return false;
    return true;
  });
}

/** `45m`, `2h`, `1h30m`: the duration the engine takes. */
export function durationText(minutes: number): string {
  const n = Math.max(1, Math.round(minutes));
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${h > 0 ? `${h}h` : ''}${m > 0 || h === 0 ? `${m}m` : ''}`;
}

export const hhmm = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** The minute snapped to a quarter hour. */
export const snap = (minutes: number): number => Math.round(minutes / SNAP_MIN) * SNAP_MIN;

/** A drag of a block: the whole block moves, or one of its edges. */
export type DragKind = 'move' | 'resize';

/**
 * Where a block stands after a drag of `delta` minutes: moved (both edges), or its end changed. A move stays in its day
 * (the drag to another column changes `day` by whole days, see `shiftedDay`), a length is at least a quarter.
 */
export function dragged(block: Pick<Block, 'start' | 'end'>, kind: DragKind, delta: number): { start: number; end: number } {
  if (kind === 'resize') return { start: block.start, end: Math.min(DAY_MIN, Math.max(block.start + MIN_LENGTH, snap(block.end + delta))) };
  const length = block.end - block.start;
  const start = Math.min(DAY_MIN - length, Math.max(0, snap(block.start + delta)));
  return { start, end: start + length };
}

/**
 * The `meeting_set` patch that puts a meeting on `day` from `start` for `length` minutes: the date, the beginning and
 * the length as `duration` (a patch keeps one of `end` and `duration`, so `end` goes: the engine refuses both).
 */
export function movePatch(day: string, start: number, length: number): Record<string, unknown> {
  return { date: day, time: hhmm(start), duration: durationText(length), end: null };
}

/** The range a drag over empty time makes: both ends snapped, at least a half hour, in one day. */
export function createRange(from: number, to: number): { start: number; length: number } {
  const a = Math.min(from, to);
  const b = Math.max(from, to);
  const start = Math.min(DAY_MIN - SLOT_MIN, Math.max(0, Math.floor(a / SNAP_MIN) * SNAP_MIN));
  const end = Math.min(DAY_MIN, Math.max(start + SLOT_MIN, Math.ceil(b / SNAP_MIN) * SNAP_MIN));
  return { start, length: end - start };
}

/** The minutes of the day of the wall time `at` (`YYYY-MM-DDTHH:MM`) and its day. */
export function nowOnGrid(at: string): { day: string; minutes: number } {
  return { day: at.slice(0, 10), minutes: Number(at.slice(11, 13)) * 60 + Number(at.slice(14, 16)) };
}

/** How many blocks of a day overlap another one. */
export function conflictCount(blocks: readonly Block[]): number {
  return blocks.filter((b) => b.conflict).length;
}
