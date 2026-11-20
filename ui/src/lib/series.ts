// Series of meetings (capability `meeting_series`): what the page shows of them and what it sends. The engine computes
// the occurrences (`meetings` lists a series as its occurrences, an occurrence without a file is `virtual`) and judges
// every value; here is only the layout. Imported by views that load on demand only (the calendar, the form, the page
// of a meeting, the meetings of a task), so its words stay out of the start of the page: they are kept here and not in
// `i18n.ts`, whose tables are part of the start.

import type { MeetingEntry } from './contract';
import { phaseOf } from './meetings';

/** The intervals the form offers ('' is none); the engine writes `weekly` etc. as these. */
export const REPEATS = ['', '1w', '2w', '1m'] as const;

const WORDS = {
  de: {
    series: 'Serie',
    virtual: 'noch ohne Datei',
    occurrence: 'Vorkommen am {day}',
    open: 'Serie öffnen',
    cancel: 'Dieses Vorkommen absagen',
    except: 'Als Ausnahme streichen',
    repeat: 'Wiederholung',
    none: 'keine',
    '1w': 'wöchentlich',
    '2w': 'alle 2 Wochen',
    '1m': 'monatlich',
    until: 'Bis',
    exceptions: 'Ausnahmen (Tage, mit Komma)',
    save: 'Serie speichern',
    hint_repeat: 'Wiederkehrend: jedes Vorkommen steht im Kalender und wird erst beim ersten Eintrag eine Datei.',
    hint_until: 'Der letzte mögliche Tag der Serie; leer: ohne Ende.',
    hint_except: 'Tage ohne Vorkommen, z. B. Feiertage.',
  },
  en: {
    series: 'Series',
    virtual: 'no file yet',
    occurrence: 'Occurrence on {day}',
    open: 'Open series',
    cancel: 'Cancel this occurrence',
    except: 'Skip as exception',
    repeat: 'Repeat',
    none: 'none',
    '1w': 'weekly',
    '2w': 'every 2 weeks',
    '1m': 'monthly',
    until: 'Until',
    exceptions: 'Exceptions (days, comma separated)',
    save: 'Save series',
    hint_repeat: 'Recurring: each occurrence is in the calendar and becomes a file on its first entry.',
    hint_until: 'The last possible day of the series; empty: no end.',
    hint_except: 'Days without an occurrence, e.g. holidays.',
  },
} as const;

export type SeriesWord = keyof (typeof WORDS)['de'];

/** A word of the series in the language of the page, `{day}` filled in. */
export function seriesWord(lang: 'de' | 'en', key: SeriesWord, day = ''): string {
  return (WORDS[lang] ?? WORDS.de)[key].replace('{day}', day);
}

/** The name of an interval: the word for the ones offered, the engine's text (`10d`) for any other. */
export function repeatLabel(lang: 'de' | 'en', repeat: string): string {
  if (repeat === '') return seriesWord(lang, 'none');
  return (REPEATS as readonly string[]).includes(repeat) ? seriesWord(lang, repeat as SeriesWord) : repeat;
}

/** What a chip or a block of the calendar says beside its title: nothing, a series, or a series without a file yet. */
export function seriesNote(lang: 'de' | 'en', m: Pick<MeetingEntry, 'series' | 'virtual'>): string {
  if (!m.series) return '';
  return m.virtual ? `${seriesWord(lang, 'series')}, ${seriesWord(lang, 'virtual')}` : seriesWord(lang, 'series');
}

/** The days typed (`2026-12-24, 2026-12-31`): each once, in order; what is no day is kept as typed for the engine to refuse. */
export function exceptDays(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[,;\s]+/)) {
    const day = part.trim();
    if (day !== '' && !out.includes(day)) out.push(day);
  }
  return out.sort();
}

/** The exceptions of a series with one day more (each once, in order). */
export function withExcept(except: readonly string[] | undefined, day: string): string[] {
  return exceptDays([...(except ?? []), day].join(','));
}

/** Two pages of meetings as one: the first, then those of the later one it does not hold (by id). */
export function joinPages<T extends Pick<MeetingEntry, 'id'>>(first: readonly T[], later: readonly T[]): T[] {
  const held = new Set(first.map((m) => m.id));
  return [...first, ...later.filter((m) => !held.has(m.id))];
}

/**
 * The meetings of a task as a list shows them: a series names the task in every occurrence, and over all time that
 * would be a page of the same meeting. Kept are the occurrences with a file (something was entered or moved) and, of
 * those without, the next coming one of each series; past ones without a file held nothing.
 */
export function foldSeries<T extends Pick<MeetingEntry, 'id' | 'series' | 'virtual' | 'starts_at' | 'ends_at' | 'all_day' | 'tz'>>(
  items: readonly T[],
  nowMs: number,
): T[] {
  const next = new Map<string, T>();
  for (const m of items) {
    if (!m.virtual || !m.series || phaseOf(m, nowMs) === 'result') continue;
    const held = next.get(m.series);
    if (!held || (m.starts_at ?? '') < (held.starts_at ?? '')) next.set(m.series, m);
  }
  return items.filter((m) => !m.virtual || !m.series || next.get(m.series) === m);
}
