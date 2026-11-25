// The meetings of the page (concept 7.1, 7.2): the form that makes one, the proposal of the quick capture laid into it,
// the tab a meeting opens on by the clock, and the meetings of a task split into the coming and the past ones. The
// rules of a meeting are the engine's: the form is judged by a dry run of `meeting_new`, the quick line is read by
// `meeting_parse`, and the service of an address is the engine's word (`online_service`). Nothing here reckons a rule
// of its own; it only lays out what the engine said.

import type { Op } from './api';
import { addDays } from './calendar';
import type { MeetingEntry, MeetingParse } from './contract';
import { DEFAULT_LENGTH, durationMinutes } from './timeGrid';
import { instantOf, knownZone, localized, originalTime, wallMinutes, wallTime } from './zones';

export { wallMinutes, wallTime };

/** What a dry run of `meeting_new` said: the id the meeting would get, the engine's refusal, or nothing yet. */
export type MeetingPreview = { kind: 'ok'; id: string } | { kind: 'refused'; message: string } | { kind: 'unknown' };

/** One participant of the form: a line `Name <email> (Rolle)` of `## Teilnehmer`. */
export interface Participant {
  name: string;
  email: string;
  role: string;
}

/** What the form holds. Every text as typed; `meetingNewOp` makes the operation of it. */
export interface MeetingForm {
  title: string;
  area: string;
  date: string;
  allDay: boolean;
  time: string;
  /** The end is given as a time (`end`) or as a length (`duration`); the engine takes one of them. */
  endMode: 'end' | 'duration';
  end: string;
  duration: string;
  tz: string;
  location: string;
  online: string;
  tasks: string[];
  participants: Participant[];
  notify: string[];
  icon: string;
  /** Comma separated, as in the task form. */
  tags: string;
  /** A series (capability `meeting_series`): the interval (`1w`, `2w`, `1m`; '' none), its last day, the days without one. */
  repeat?: string;
  repeatUntil?: string;
  except?: string[];
  /** A preparation task due the day before, made with the meeting (capability `meeting_prep`; the engine makes it). */
  prep?: boolean;
  /** `overlap: ok`: the meeting may share its time with another one (capability `meeting_overlap_ok`). */
  overlapOk?: boolean;
}

/** The notifications offered as chips (concept 4.7); any other is typed. */
export const NOTIFY_PRESETS = ['-15m', '-1h', '-1d@18:00', '-0d@08:00'] as const;

/** The most notifications a meeting takes (`meetings.MAX_NOTIFY` of the engine; it refuses more). */
export const MAX_NOTIFY = 5;

/** The most participants the form takes (a line each; a meeting of more is a list in the file). */
export const MAX_PARTICIPANTS = 50;

/** The window of days that holds every meeting a person writes: the meetings of a task are asked over it. */
export const MEETINGS_EVER = { since: '1900-01-01', until: '2999-12-31' } as const;

/** The pages (100 meetings each) a window of the calendar or the timeline reads at most. */
export const MEETING_PAGES = 5;

/** The meetings of a window as read: `total` is more than `items.length` when the pages ran out before the end. */
export interface MeetingWindow {
  items: MeetingEntry[];
  total: number;
}

/** How long before its beginning a meeting opens on the tab "In the meeting" (concept 7.2: ±15 min). */
export const DURING_MARGIN_MIN = 15;

/**
 * A new form: the area, a beginning at the next full hour of `now` (after 23 o'clock: midnight of the next day, never
 * an hour that has begun), an hour long; the tasks it is for.
 */
export function emptyMeetingForm(area: string, now: string, tasks: readonly string[] = []): MeetingForm {
  const next = Number(now.slice(11, 13) || '8') + 1;
  const day = next > 23 ? addDays(now.slice(0, 10), 1) : now.slice(0, 10);
  const hour = next > 23 ? 0 : next;
  return {
    title: '',
    area,
    date: day,
    allDay: false,
    time: `${String(hour).padStart(2, '0')}:00`,
    endMode: 'duration',
    end: '',
    duration: '60m',
    tz: '',
    location: '',
    online: '',
    tasks: [...tasks],
    participants: [],
    notify: [],
    icon: '',
    tags: '',
  };
}

/** The form with the proposal of the quick capture laid over it (`tasks.meetingparse`); the area stays. */
export function formOfProposal(base: MeetingForm, proposal: Pick<MeetingParse, 'title' | 'fields' | 'all_day'>): MeetingForm {
  const f = proposal.fields;
  const tasks = [...base.tasks];
  for (const id of f.tasks ?? []) if (!tasks.includes(id)) tasks.push(id);
  return {
    ...base,
    title: proposal.title.trim() !== '' ? proposal.title.trim() : base.title,
    date: f.date,
    allDay: proposal.all_day,
    time: f.time ?? (proposal.all_day ? '' : base.time),
    endMode: f.end !== undefined ? 'end' : 'duration',
    end: f.end ?? '',
    duration: f.end !== undefined ? '' : (f.duration ?? (proposal.all_day ? '' : base.duration)),
    location: f.location ?? base.location,
    online: f.online ?? base.online,
    tasks,
    notify: f.notify !== undefined && f.notify.length > 0 ? [...f.notify].slice(0, MAX_NOTIFY) : base.notify,
  };
}

/** The tags typed, one each, without blanks and doubles. */
export function tagsOf(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(',')) {
    const tag = part.trim();
    if (tag !== '' && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/** The frontmatter keys of `meeting_new` from the form: only what is filled in; the engine judges the values. */
export function meetingFields(form: MeetingForm): Record<string, unknown> {
  const fields: Record<string, unknown> = { date: form.date.trim() };
  if (!form.allDay && form.time.trim() !== '') {
    fields.time = form.time.trim();
    if (form.endMode === 'end' && form.end.trim() !== '') fields.end = form.end.trim();
    if (form.endMode === 'duration' && form.duration.trim() !== '') fields.duration = form.duration.trim();
  }
  if (form.tz.trim() !== '') fields.tz = form.tz.trim();
  if (form.location.trim() !== '') fields.location = form.location.trim();
  if (form.online.trim() !== '') fields.online = form.online.trim();
  if (form.tasks.length > 0) fields.tasks = [...form.tasks];
  if (form.notify.length > 0) fields.notify = form.notify.slice(0, MAX_NOTIFY);
  if (form.icon.trim() !== '') fields.icon = form.icon.trim();
  const tags = tagsOf(form.tags);
  if (tags.length > 0) fields.tags = tags;
  if (form.repeat) {
    fields.repeat = form.repeat;
    if (form.repeatUntil) fields.repeat_until = form.repeatUntil;
    if (form.except?.length) fields.except = [...form.except];
  }
  if (form.overlapOk) fields.overlap = 'ok';
  return fields;
}

/**
 * The time the meeting of the form takes, as wall times of this machine (`local`, for the tests): its beginning in its
 * zone (`tz`, the machine's without one) turned into the machine's time, and its end after the duration or at the end
 * time (a meeting without either lasts `DEFAULT_LENGTH`). Null for an all-day meeting or one without a valid time: it
 * conflicts with nothing. Only for showing conflicts before it is saved; the engine judges the times.
 */
export function formSpan(form: MeetingForm, local?: string): { start: string; end: string } | null {
  if (form.allDay || !/^\d{4}-\d{2}-\d{2}$/.test(form.date) || !/^\d{2}:\d{2}$/.test(form.time)) return null;
  const at = `${form.date}T${form.time}`;
  let minutes = DEFAULT_LENGTH;
  if (form.endMode === 'end' && form.end !== '') minutes = wallMinutes(`${form.date}T${form.end}`) - wallMinutes(at);
  else if (form.endMode === 'duration' && form.duration.trim() !== '') minutes = durationMinutes(form.duration);
  // an end before the beginning or a duration that is none: the engine refuses it, there is nothing to compare
  if (!(minutes > 0)) return null;
  const tz = form.tz.trim();
  const ms = instantOf(at, knownZone(tz) ? tz : local);
  if (Number.isNaN(ms)) return null;
  return { start: wallTime(ms, local), end: wallTime(ms + minutes * 60000, local) };
}

/** The operation that makes the meeting of the form (with `prep`: and its preparation task, the engine's work). */
export function meetingNewOp(form: MeetingForm, lang: 'de' | 'en'): Op {
  return {
    op: 'meeting_new',
    area: form.area,
    title: form.title.trim(),
    fields: meetingFields(form),
    lang,
    ...(form.prep ? { prep: true } : {}),
  };
}

/** One line of `## Teilnehmer` (`Name <email> (Rolle)`), or null for a row without a name. Breaks become blanks. */
export function participantLine(p: Participant): string | null {
  const clean = (s: string) => s.replace(/[\r\n\t]+/g, ' ').replace(/[<>()]/g, '').trim();
  const name = clean(p.name);
  if (name === '') return null;
  const email = clean(p.email);
  const role = clean(p.role);
  return `- [ ] ${name}${email !== '' ? ` <${email}>` : ''}${role !== '' ? ` (${role})` : ''}`;
}

/** The text of `## Teilnehmer` for the rows of the form; empty when no row has a name. */
export function participantsText(participants: readonly Participant[]): string {
  return participants
    .slice(0, MAX_PARTICIPANTS)
    .map(participantLine)
    .filter((l): l is string => l !== null)
    .join('\n');
}

/** The name of the participants' section in the language the meeting was made in (the engine's template); `set_section` takes it as `## <name>`. */
export function participantsHeading(lang: 'de' | 'en'): string {
  return lang === 'en' ? 'Participants' : 'Teilnehmer';
}

/** The heading of the documents (`## Unterlagen`) in the language of the meeting's body. */
export function documentsHeading(body: string): string {
  return /^## Documents\s*$/m.test(body) && !/^## Unterlagen\s*$/m.test(body) ? 'Documents' : 'Unterlagen';
}

/** The lines of a section `## <heading>` of `body` as written (without the heading), or '' when there is none. */
function sectionRaw(body: string, heading: string): string {
  const lines = body.split(/\r?\n/);
  const at = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (at < 0) return '';
  const out: string[] = [];
  let fence = false;
  for (const line of lines.slice(at + 1)) {
    if (/^\s*```/.test(line)) fence = !fence;
    if (!fence && /^## /.test(line)) break;
    out.push(line);
  }
  return out.join('\n');
}

const COMMENT = /<!--[\s\S]*?-->/g;

/** The text of a section `## <heading>` of `body` (without the heading), or '' when there is none. */
export function sectionText(body: string, heading: string): string {
  // HTML comments are not shown (a placeholder of a hand-made template, a block a tool keeps there), as the engine reads it
  return sectionRaw(body, heading).replace(COMMENT, '').trim();
}

/**
 * The text a write of section `heading` sends when the page changed what it shows (`sectionText`): the HTML comments
 * of the section as they were, then `text`. `set_section` replaces the whole section, and the engine's template has no
 * comments, so every comment there is the person's or a tool's: the page does not show it and must not drop it.
 */
export function withComments(body: string, heading: string, text: string): string {
  const comments = sectionRaw(body, heading).match(COMMENT) ?? [];
  return [...comments, text].filter((part) => part !== '').join('\n');
}

/** The documents section with one line more: a web address or a path, as `- <text>`. */
export function withDocument(body: string, heading: string, entry: string): string {
  const line = entry.replace(/[\r\n]+/g, ' ').trim();
  const before = sectionText(body, heading);
  return withComments(body, heading, before === '' ? `- ${line}` : `${before}\n- ${line}`);
}

export type MeetingTab = 'prep' | 'during' | 'result';
export const MEETING_TABS: readonly MeetingTab[] = ['prep', 'during', 'result'];

/**
 * Where a meeting stands at the instant `nowMs` (its own zone, `tz`): before, during (from 15 minutes before its
 * beginning to its end; all day: the days it covers) or after. A meeting without a valid time is before.
 */
export function phaseOf(m: Pick<MeetingEntry, 'starts_at' | 'ends_at' | 'all_day' | 'tz'>, nowMs: number): MeetingTab {
  if (!m.starts_at) return 'prep';
  const now = wallMinutes(wallTime(nowMs, m.tz));
  const start = wallMinutes(m.starts_at);
  if (Number.isNaN(start)) return 'prep';
  // an all-day meeting ends with its last day; one without an end ends where it began
  const endAt = m.ends_at ?? m.starts_at;
  const end = m.all_day ? wallMinutes(endAt) + 24 * 60 : wallMinutes(endAt);
  const margin = m.all_day ? 0 : DURING_MARGIN_MIN;
  if (now < start - margin) return 'prep';
  if (now < (Number.isNaN(end) ? start : Math.max(end, start + (m.all_day ? 0 : 1)))) return 'during';
  return 'result';
}

/** The tab a meeting opens on: by the clock; a meeting that is done or cancelled opens on its result. */
export function startTab(m: Pick<MeetingEntry, 'starts_at' | 'ends_at' | 'all_day' | 'tz' | 'status'>, nowMs: number): MeetingTab {
  if (m.status === 'done' || m.status === 'cancelled') return 'result';
  return phaseOf(m, nowMs);
}

/** The meetings of a task: the coming ones (not over yet, the next first) and the past ones (the last first). */
export function splitMeetings<T extends Pick<MeetingEntry, 'starts_at' | 'ends_at' | 'all_day' | 'tz' | 'id'>>(
  items: readonly T[],
  nowMs: number,
): { coming: T[]; past: T[] } {
  const coming: T[] = [];
  const past: T[] = [];
  for (const m of items) (phaseOf(m, nowMs) === 'result' ? past : coming).push(m);
  const at = (m: T) => m.starts_at ?? '';
  coming.sort((a, b) => at(a).localeCompare(at(b)) || a.id.localeCompare(b.id));
  past.sort((a, b) => at(b).localeCompare(at(a)) || a.id.localeCompare(b.id));
  return { coming, past };
}

/** How far back the tile Follow-up looks for meetings to follow up, in days. */
export const REVIEW_DAYS = 60;
/** Most meetings the tile names. */
export const REVIEW_MAX = 20;

/**
 * The meetings to follow up (concept 7.5): over and still planned, or done without a result; not the ones the person put
 * away ("no result is fine"). The last first. Of a series only its last occurrence without a file: one that was let
 * pass does not stand there once a week.
 */
export function toReview<
  T extends Pick<MeetingEntry, 'starts_at' | 'ends_at' | 'all_day' | 'tz' | 'id' | 'status' | 'has_result' | 'series' | 'virtual'>,
>(items: readonly T[], nowMs: number, dismissed: ReadonlySet<string>): T[] {
  const seen = new Set<string>();
  return splitMeetings(items, nowMs)
    .past.filter((m) => !dismissed.has(m.id) && (m.status === 'planned' || (m.status === 'done' && !m.has_result)))
    .filter((m) => !m.virtual || !m.series || (!seen.has(m.series) && seen.add(m.series)))
    .slice(0, REVIEW_MAX);
}

/**
 * The time of a meeting as a line: `2026-11-24 14:00–15:00`, `2026-11-24` (all day). A meeting of another zone (`tz`)
 * shows this machine's time (`local`, for the tests) and its own beside it: `2026-11-24 14:00–15:00 (08:00 New York)`;
 * a zone that shows the same wall time adds nothing, one this browser does not know is named as written.
 */
export function whenText(
  entry: Pick<MeetingEntry, 'date' | 'time' | 'ends_at' | 'all_day' | 'tz' | 'starts_at'>,
  allDay: string,
  local?: string,
): string {
  if (!entry.date) return '';
  if (entry.all_day || !entry.time) {
    const last = entry.ends_at && entry.ends_at.slice(0, 10) !== entry.date ? `–${entry.ends_at.slice(0, 10)}` : '';
    return `${entry.date}${last} ${allDay}`;
  }
  const m = localized(entry as MeetingEntry, local);
  const date = m.starts_at?.slice(0, 10) ?? m.date;
  const time = m.starts_at && m.starts_at.length >= 16 ? m.starts_at.slice(11, 16) : m.time;
  const endDay = m.ends_at?.slice(0, 10);
  const end = m.ends_at ? (endDay === date ? m.ends_at.slice(11, 16) : m.ends_at.replace('T', ' ')) : '';
  const original = originalTime(m);
  const note = original !== '' ? ` (${original})` : entry.tz && !knownZone(entry.tz) ? ` (${entry.tz})` : '';
  return `${date} ${time}${end !== '' ? `–${end}` : ''}${note}`;
}

/**
 * The images of a meeting's folder, as the paths `cover` takes: `assets` lists the files of the folder relative to it
 * (`assets/images/a.png`), and a cover is an image (png, jpg, jpeg, webp, svg) below `assets/` (contract `Cover`).
 */
export function coverChoices(m: Pick<MeetingEntry, 'assets'>): string[] {
  if (!Array.isArray(m.assets)) return [];
  return m.assets.filter((path) => typeof path === 'string' && path.startsWith('assets/') && /\.(png|jpe?g|webp|svg)$/i.test(path));
}

/** The cover a meeting shows: `cover`, else its old name `image`. */
export function coverOf(m: Pick<MeetingEntry, 'image'> & { cover?: string }): string | undefined {
  return m.cover ?? m.image;
}
