// The list of all meetings (the view Meetings of the tab Office): the meetings the engine read, laid into the parts
// Today, This week, Later, Series and Past, with the filters of the view. The rules of a meeting are the engine's;
// this only sorts what it said by day and by what the entry itself carries (`has_protocol`, `has_result`, `series`).

import { addDays } from './calendar';
import type { MeetingEntry } from './contract';
import { filterMeetings, type MeetingFilter } from './timeGrid';

/** How many days the list looks ahead and back (the engine reads a window of days; the pages are `MEETING_PAGES`). */
export const AHEAD_DAYS = 365;
export const BACK_DAYS = 90;

/** The first day of a meeting, `YYYY-MM-DD`, or '' for one with no valid date. */
export function dayOf(m: Pick<MeetingEntry, 'starts_at'>): string {
  return (m.starts_at ?? '').slice(0, 10);
}

/** What the view filters by: the words of the search, an area, a tag, and the place and participants of the grid. */
export interface MeetingListFilter extends MeetingFilter {
  text: string;
  area: string;
  tag: string;
}
export const NO_LIST_FILTER: MeetingListFilter = { place: 'all', people: 'any', text: '', area: '', tag: '' };

/** The meetings the filter keeps; the words of the search must all be in the title, the summary, a tag or the area. */
export function filterList(meetings: readonly MeetingEntry[], filter: MeetingListFilter): MeetingEntry[] {
  const words = filter.text.toLowerCase().split(/\s+/).filter((w) => w !== '');
  return filterMeetings(meetings, filter).filter((m) => {
    if (filter.area !== '' && m.area !== filter.area) return false;
    if (filter.tag !== '' && !m.tags.includes(filter.tag)) return false;
    const hay = `${m.title}\n${m.summary}\n${m.area}\n${m.tags.join(' ')}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

const byStart = (a: MeetingEntry, b: MeetingEntry): number => (a.starts_at ?? '').localeCompare(b.starts_at ?? '') || a.id.localeCompare(b.id);

/** One series with the occurrences that are coming: the next of them opens when the row is chosen. */
export interface SeriesRow {
  series: string;
  title: string;
  next: MeetingEntry;
  count: number;
}

export interface MeetingParts {
  today: MeetingEntry[];
  week: MeetingEntry[];
  later: MeetingEntry[];
  series: SeriesRow[];
  past: MeetingEntry[];
}

/** The day the week of `today` ends (Sunday; on a Sunday, today). */
export function weekEnd(today: string): string {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDays(today, (7 - dow) % 7);
}

/**
 * The meetings in parts, by the day `today`. Coming ones in time order, past ones the latest first. A cancelled
 * meeting is not coming. A meeting with no date is in no part (the engine names those in `undated`).
 */
export function partsOf(meetings: readonly MeetingEntry[], today: string): MeetingParts {
  const end = weekEnd(today);
  const parts: MeetingParts = { today: [], week: [], later: [], series: [], past: [] };
  const series = new Map<string, MeetingEntry[]>();
  for (const m of [...meetings].sort(byStart)) {
    const day = dayOf(m);
    if (day === '') continue;
    if (day < today) {
      parts.past.unshift(m);
      continue;
    }
    if (m.status === 'cancelled') continue;
    (day === today ? parts.today : day <= end ? parts.week : parts.later).push(m);
    if (m.series !== undefined) series.set(m.series, [...(series.get(m.series) ?? []), m]);
  }
  for (const [id, list] of series) parts.series.push({ series: id, title: list[0]!.title, next: list[0]!, count: list.length });
  parts.series.sort((a, b) => byStart(a.next, b.next));
  return parts;
}

/**
 * A past meeting that wants a word: it happened (not cancelled) and has no minutes and no result. The page marks it
 * and says what is missing.
 */
export function wantsFollowUp(m: Pick<MeetingEntry, 'status' | 'has_protocol' | 'has_result'>): boolean {
  return m.status !== 'cancelled' && !m.has_protocol && !m.has_result;
}

/** The areas and tags the meetings carry, for the two choices of the filter. */
export function choicesOf(meetings: readonly MeetingEntry[]): { areas: string[]; tags: string[] } {
  return {
    areas: [...new Set(meetings.map((m) => m.area))].sort(),
    tags: [...new Set(meetings.flatMap((m) => m.tags))].sort(),
  };
}
