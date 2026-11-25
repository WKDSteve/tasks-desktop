// Time zones of meetings (concept 4.7, decision F5): the engine hands `tz` on as written and reckons no zone; the page
// shows a meeting in its own time (this machine's zone) with the original time beside it ("14:00 (08:00 New York)").
// The reckoning is `Intl.DateTimeFormat` (Baseline widely available; `Temporal` is not yet): a wall time of a zone is
// turned into an instant as `Temporal`'s `disambiguation: 'compatible'` does: a time the clock skipped (spring forward)
// is read with the offset before the change, so it comes out later; a time the clock repeated (fall back) is the
// earlier one.

import type { MeetingEntry } from './contract';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The formatter of the wall time of a zone, made once per zone (a calendar asks for it for every meeting and every
 * comparison of a sort), or null for a zone this browser does not know.
 */
const formatters = new Map<string, Intl.DateTimeFormat | null>();
function formatterOf(tz: string): Intl.DateTimeFormat | null {
  let format = formatters.get(tz);
  if (format === undefined) {
    try {
      format = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      });
    } catch {
      format = null;
    }
    // a zone typed letter by letter into the form leaves a name per letter: the store stays small
    if (formatters.size > 200) formatters.clear();
    formatters.set(tz, format);
  }
  return format;
}

/** `YYYY-MM-DDTHH:MM` in minutes since the epoch (no zone: wall time), or NaN. A day alone is its midnight. */
export function wallMinutes(at: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(at);
  if (!m) return Number.NaN;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
  return ms / 60000;
}

/** The wall time `YYYY-MM-DDTHH:MM` of the instant `ms` in the zone `tz` (an IANA name), or in this machine's zone. */
export function wallTime(ms: number, tz?: string): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  // a zone this browser does not know: the machine's time, as for a meeting without one
  const format = tz ? formatterOf(tz) : null;
  if (format) {
    const parts = format.formatToParts(new Date(ms));
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
  }
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Whether this browser knows the zone `tz` (an IANA name). */
export function knownZone(tz: string | undefined): tz is string {
  return !!tz && formatterOf(tz) !== null;
}

/** The offset of `tz` (or this machine's zone) at the instant `ms`, in minutes: wall time minus UTC. */
function offsetAt(ms: number, tz?: string): number {
  return wallMinutes(wallTime(ms, tz)) - Math.floor(ms / 60000);
}

/**
 * The instant (ms since the epoch) of the wall time `at` (`YYYY-MM-DDTHH:MM`) in the zone `tz`, or in this machine's
 * zone without one; NaN for a time that is no wall time. A skipped time is read with the offset before the change (it
 * comes out later), a repeated time is the earlier of the two.
 */
export function instantOf(at: string, tz?: string): number {
  const wall = wallMinutes(at);
  if (Number.isNaN(wall)) return Number.NaN;
  const t = wall * 60000;
  const before = offsetAt(t - DAY_MS, tz);
  const after = offsetAt(t + DAY_MS, tz);
  const want = at.length >= 16 ? at.slice(0, 16) : `${at}T00:00`;
  const fits = [...new Set([before, after])]
    .map((o) => t - o * 60000)
    .filter((ms) => wallTime(ms, tz) === want)
    .toSorted((a, b) => a - b);
  return fits[0] ?? t - before * 60000;
}

/**
 * The wall time `at` of the zone `tz` as wall time of `local` (this machine's zone without it). Without a zone, or with
 * one this browser does not know, `at` stays as it is: the meeting is read in the machine's time, as the engine says.
 */
export function localWall(at: string, tz: string | undefined, local?: string): string {
  if (!knownZone(tz) || at.length < 16) return at;
  const ms = instantOf(at, tz);
  return Number.isNaN(ms) ? at : wallTime(ms, local);
}

/** The other way: a wall time of `local` (this machine's zone without it) as wall time of the zone `tz`. */
export function zoneWall(at: string, tz: string | undefined, local?: string): string {
  if (!knownZone(tz) || at.length < 16) return at;
  const ms = instantOf(at, local);
  return Number.isNaN(ms) ? at : wallTime(ms, tz);
}

/** The place a zone is named after: `America/New_York` is "New York", `UTC` stays. */
export function zoneName(tz: string): string {
  return (tz.split('/').pop() ?? tz).replaceAll('_', ' ');
}

/** A meeting as this machine sees it, and where its own zone puts it (only when that is another wall time). */
export type LocalMeeting = MeetingEntry & { zoned?: { starts_at: string; tz: string } };

/**
 * A meeting with its beginning and end in this machine's time (`local`): what the calendar draws, compares and drags.
 * An all-day meeting, one without a zone, or one whose zone shows the same wall time stays as it is.
 */
export function localized(m: LocalMeeting, local?: string): LocalMeeting {
  // once is enough: a localized meeting holds this machine's time already
  if (m.zoned || m.all_day || !m.starts_at || m.starts_at.length < 16 || !knownZone(m.tz)) return m;
  const starts = localWall(m.starts_at, m.tz, local);
  const ends = m.ends_at && m.ends_at.length >= 16 ? localWall(m.ends_at, m.tz, local) : m.ends_at;
  if (starts === m.starts_at && ends === m.ends_at) return m;
  return {
    ...m,
    date: starts.slice(0, 10),
    time: starts.slice(11, 16),
    starts_at: starts,
    ends_at: ends,
    zoned: { starts_at: m.starts_at, tz: m.tz },
  };
}

/** The original time beside the own one: `08:00 New York` (with the day when it is another one), or ''. */
export function originalTime(m: Pick<LocalMeeting, 'starts_at' | 'zoned'>): string {
  if (!m.zoned) return '';
  const day = m.zoned.starts_at.slice(0, 10) !== m.starts_at?.slice(0, 10) ? `${m.zoned.starts_at.slice(0, 10)} ` : '';
  return `${day}${m.zoned.starts_at.slice(11, 16)} ${zoneName(m.zoned.tz)}`;
}
