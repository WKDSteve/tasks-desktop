// The meetings on the timeline (concept 7.4): a diamond on the day of the meeting on the row of each of its tasks, and a
// row "Meetings" in a group for the meetings that have no task among its bars. Only layout; the status is the engine's.

import { parseDate } from './calendar';
import type { MeetingEntry } from './contract';
import { phaseOf } from './meetings';
import { localized } from './zones';
import type { BaseRow, Bar, Row, TimelineGrouping } from './timeline';

/** How a diamond is filled: planned hollow, over but still planned half, done full, cancelled struck through. */
export type DiamondFill = 'hollow' | 'half' | 'full' | 'cancelled';

export function fillOf(m: Pick<MeetingEntry, 'status' | 'starts_at' | 'ends_at' | 'all_day' | 'tz'>, nowMs: number): DiamondFill {
  if (m.status === 'cancelled') return 'cancelled';
  if (m.status === 'done') return 'full';
  return phaseOf(m, nowMs) === 'result' ? 'half' : 'hollow';
}

/**
 * The day of a meeting (`YYYY-MM-DD`) on this machine (`local`, for the tests): a meeting of another zone stands on the
 * day its beginning falls on here. Null for one without a valid day.
 */
export function dayOfMeeting(m: Pick<MeetingEntry, 'starts_at' | 'date' | 'ends_at' | 'all_day' | 'tz'>, local?: string): string | null {
  const here = localized(m as MeetingEntry, local);
  const day = (here.starts_at ?? String(m.date ?? '')).slice(0, 10);
  return parseDate(day) ? day : null;
}

/** The meetings of each task that has a bar, the earlier first: the diamonds on its row. */
export function diamondsByTask(meetings: readonly MeetingEntry[], bars: readonly Bar[]): Map<string, MeetingEntry[]> {
  const known = new Set(bars.map((b) => b.task.id));
  const out = new Map<string, MeetingEntry[]>();
  for (const m of meetings) {
    if (dayOfMeeting(m) === null) continue;
    for (const id of m.tasks) {
      if (!known.has(id)) continue;
      const list = out.get(id) ?? [];
      list.push(m);
      out.set(id, list);
    }
  }
  for (const list of out.values()) list.sort((a, b) => (dayOfMeeting(a) ?? '').localeCompare(dayOfMeeting(b) ?? '') || a.id.localeCompare(b.id));
  return out;
}

/**
 * The rows with a row "Meetings" under each group that has meetings of its own: those with no task that has a bar. By
 * area, a meeting goes to the group of its area; by plan, to the group of the tasks without a plan. One that fits no
 * group (or whose group is not there) gets a row at the end. A folded group shows its head only.
 */
export function withMeetingRows(rows: readonly BaseRow[], meetings: readonly MeetingEntry[], bars: readonly Bar[], grouping: TimelineGrouping): Row[] {
  const known = new Set(bars.map((b) => b.task.id));
  const own = meetings.filter((m) => dayOfMeeting(m) !== null && !m.tasks.some((id) => known.has(id)));
  if (own.length === 0) return [...rows];
  const keys = new Set(rows.flatMap((r) => (r.type === 'group' ? [r.key] : [])));
  const homeOf = (m: MeetingEntry): string => {
    const key = grouping === 'area' ? `area:${m.area}` : 'none';
    return keys.has(key) ? key : 'rest';
  };
  const by = new Map<string, MeetingEntry[]>();
  for (const m of own) {
    const key = homeOf(m);
    by.set(key, [...(by.get(key) ?? []), m]);
  }
  const sort = (list: MeetingEntry[]): MeetingEntry[] => list.sort((a, b) => (dayOfMeeting(a) ?? '').localeCompare(dayOfMeeting(b) ?? '') || a.id.localeCompare(b.id));
  const out: Row[] = [];
  for (const row of rows) {
    out.push(row);
    if (row.type !== 'group' || row.folded) continue;
    const mine = by.get(row.key);
    if (mine) out.push({ type: 'meetings', key: `meetings:${row.key}`, level: row.level + 1, meetings: sort(mine) });
  }
  const rest = by.get('rest');
  if (rest) out.push({ type: 'meetings', key: 'meetings:rest', level: 0, meetings: sort(rest) });
  return out;
}
