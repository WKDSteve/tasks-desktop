// The words of the view "Meetings" (`views/MeetingsView.svelte`), English and German. They live here and not in
// `i18n`: the view is a chunk of its own, and its words come with it instead of with the start of the page (the start
// has a budget, tools/check-bundle-size.py). The menu entry and its hint stay in `i18n`.
import type { Lang } from './i18n';

const EN = {
  'meetings.title': 'Meetings',
  'meetings.intro':
    'Every meeting of the vault in one list: today, this week and later, the series, and the past ones. A past meeting with no minutes and no result is marked. Choose a row to open the meeting; n makes a new one.',
  'meetings.new': 'New meeting',
  'meetings.search': 'Search',
  'meetings.search.hint': 'Words of the title, the summary, the area or a tag; all of them must be in a meeting.',
  'meetings.area': 'Area',
  'meetings.area.all': 'All areas',
  'meetings.area.hint': 'Only the meetings of one area.',
  'meetings.tag': 'Tag',
  'meetings.tag.all': 'All tags',
  'meetings.tag.hint': 'Only the meetings with this tag.',
  'meetings.people': 'Participants',
  'meetings.online': 'Online only',
  'meetings.online.hint': 'Only the meetings with an address to join.',
  'meetings.filters': 'Filter the meetings',
  'meetings.sec.today': 'Today',
  'meetings.sec.week': 'This week',
  'meetings.sec.later': 'Later',
  'meetings.sec.series': 'Series',
  'meetings.sec.past': 'Past, the last {n} days',
  'meetings.none': 'No meeting in the vault yet.',
  'meetings.none_filtered': 'No meeting matches the filter.',
  'meetings.empty_part': 'Nothing.',
  'meetings.loading': 'Reading the meetings ...',
  'meetings.failed': 'The meetings could not be read.',
  'meetings.followup': 'No minutes and no result yet',
  'meetings.cancelled': 'cancelled',
  'meetings.series_count': '{n} coming, next {date}',
  'meetings.all_day': 'all day',
  'meetings.row': '{title}, {when}',
} as const;

type MeetingsKey = keyof typeof EN;

const DE: Record<MeetingsKey, string> = {
  'meetings.title': 'Meetings',
  'meetings.intro':
    'Alle Meetings des Vaults in einer Liste: heute, diese Woche und später, die Serien und die vergangenen. Ein vergangenes Meeting ohne Protokoll und ohne Ergebnis ist markiert. Eine Zeile öffnet das Meeting; n legt ein neues an.',
  'meetings.new': 'Neues Meeting',
  'meetings.search': 'Suche',
  'meetings.search.hint': 'Wörter aus Titel, Zusammenfassung, Bereich oder einem Tag; alle müssen im Meeting vorkommen.',
  'meetings.area': 'Bereich',
  'meetings.area.all': 'Alle Bereiche',
  'meetings.area.hint': 'Nur die Meetings eines Bereichs.',
  'meetings.tag': 'Tag',
  'meetings.tag.all': 'Alle Tags',
  'meetings.tag.hint': 'Nur die Meetings mit diesem Tag.',
  'meetings.people': 'Teilnehmer',
  'meetings.online': 'Nur online',
  'meetings.online.hint': 'Nur die Meetings mit einer Adresse zum Beitreten.',
  'meetings.filters': 'Meetings filtern',
  'meetings.sec.today': 'Heute',
  'meetings.sec.week': 'Diese Woche',
  'meetings.sec.later': 'Später',
  'meetings.sec.series': 'Serien',
  'meetings.sec.past': 'Vergangen, die letzten {n} Tage',
  'meetings.none': 'Noch kein Meeting im Vault.',
  'meetings.none_filtered': 'Kein Meeting passt zum Filter.',
  'meetings.empty_part': 'Nichts.',
  'meetings.loading': 'Die Meetings werden gelesen ...',
  'meetings.failed': 'Die Meetings ließen sich nicht lesen.',
  'meetings.followup': 'Noch kein Protokoll und kein Ergebnis',
  'meetings.cancelled': 'abgesagt',
  'meetings.series_count': '{n} kommen, nächstes am {date}',
  'meetings.all_day': 'ganztägig',
  'meetings.row': '{title}, {when}',
};

export type { MeetingsKey };

/** Whether `key` is a word of the view (else one of the page, `i18n`). */
export function isMeetingsKey(key: string): key is MeetingsKey {
  return Object.hasOwn(EN, key);
}

/** A word of the view. */
export function meetingsText(lang: Lang, key: MeetingsKey, params: Record<string, string | number> = {}): string {
  const text: string = lang === 'de' ? DE[key] : EN[key];
  return text.replace(/\{(\w+)\}/g, (all, k: string) => (Object.hasOwn(params, k) ? String(params[k]) : all));
}
