// The hints of the tab Office and some of its views, and of the submenus of the tab View and the headings of its submenu Export. They stand here, not in the language files, and the
// page loads this part after its start (App.svelte), so the start stays within its budget (tools/check-bundle-size.py).

const HINTS = {
  en: {
    'nav.calendar': 'The open tasks on their days: a month or a week, with the bar from start to due. Drag a task onto a day to set its due date.',
    'nav.timeline': 'The open tasks as bars from start to due, grouped by plan or area, with a line for today and the dependencies as arrows. Drag a bar or one of its ends to change the dates.',
    'nav.reminders': 'Every reminder, of open and of finished tasks, by day, with a mark on those that are due. Choose some and send them to an e-mail address.',
    'nav.stats': 'The whole vault at a glance: per area how many open tasks, by status, effort, kind, priority or readiness.',
    'nav.abnahme': 'The open live checks: a test sheet that waits for your judgement, one by hand, and the checks without a sheet. Look, tick the points.',
    'nav.repostatus': 'A light for each repo of your tiles: its checkout (clean, changed, ahead, behind) and the CI of its newest push (green, red, running, queued, waiting for approval).',
    'nav.repos': 'Your repos as tiles in groups: a click opens the tasks of the area of a repo.',
    'nav.cross': 'How the areas hang together: the links between the open tasks of different areas.',
    'nav.board': 'The tasks as cards in columns by status; drag a card to change its status.',
    'nav.inbox': 'Tasks that are still unsorted: without a priority, an effort or an actor.',
    office: 'Appointments, reminders and people: the meetings, the calendar, the timeline, the reminders and the contacts, and a new meeting or contact.',
    'nav.contacts': 'The people you work with, one file each: name, organisation, role, mail addresses and phone numbers (a click writes or calls), time zone, tags and notes, with a search and filters.',
    'menu.contact': 'A contact of its own (a file in CONTACTS/ of the area): a name, and if you like an organisation, a role, mail addresses, phone numbers, a time zone, tags and notes.',
    'nav.meetings': 'Every meeting of the vault in one list: today, this week, later, the series and the past ones (with a note when the minutes or the result are missing), with a search and filters.',
    review: 'The views that look back: the numbers of the tasks and the tasks that are finished.',
    export: 'What the view shown draws: to a file, to the clipboard or to the printer.',
    save: 'Save',
    copy: 'Copy',
    print: 'Print',
    repos: 'The views of your repos: the tiles of the repos and the light of each one (checkout and CI).',
  },
  de: {
    'nav.calendar': 'Die offenen Tasks an ihren Tagen: ein Monat oder eine Woche, mit dem Balken von Start bis Fällig. Einen Task auf einen Tag ziehen setzt sein Fälligkeitsdatum.',
    'nav.timeline': 'Die offenen Tasks als Balken von Start bis Fällig, gruppiert nach Plan oder Bereich, mit einer Linie für heute und den Abhängigkeiten als Pfeilen. Einen Balken oder eines seiner Enden ziehen ändert die Daten.',
    'nav.reminders': 'Alle Erinnerungen, von offenen und erledigten Tasks, nach Tag, mit einer Markierung an den fälligen. Einige auswählen und an eine E-Mail-Adresse schicken.',
    'nav.stats': 'Der ganze Vault auf einen Blick: je Bereich wie viele offene Tasks, nach Status, Aufwand, Art, Priorität oder Bereitschaft.',
    'nav.abnahme': 'Die offenen Live-Checks: ein Testblatt, das auf dein Urteil wartet, eines von Hand, und die Checks ohne Blatt. Ansehen, Punkte abhaken.',
    'nav.repostatus': 'Eine Ampel je Repo deiner Kacheln: sein Checkout (sauber, geändert, voraus, zurück) und die CI seines neuesten Push (grün, rot, läuft, wartet, wartet auf Freigabe).',
    'nav.repos': 'Deine Repos als Kacheln in Gruppen: ein Klick öffnet die Tasks des Bereichs eines Repos.',
    'nav.cross': 'Wie die Bereiche zusammenhängen: die Verbindungen zwischen offenen Tasks verschiedener Bereiche.',
    'nav.board': 'Die Tasks als Karten in Spalten nach Status; eine Karte ziehen ändert den Status.',
    'nav.inbox': 'Tasks, die noch nicht eingeordnet sind: ohne Priorität, Aufwand oder Akteur.',
    office: 'Termine, Erinnerungen und Leute: die Meetings, der Kalender, die Zeitleiste, die Erinnerungen und die Kontakte, dazu ein neues Meeting oder ein neuer Kontakt.',
    'nav.contacts': 'Die Leute, mit denen du arbeitest, eine Datei je Person: Name, Organisation, Rolle, Mail-Adressen und Telefonnummern (ein Klick schreibt oder ruft an), Zeitzone, Tags und Notizen, mit Suche und Filter.',
    'menu.contact': 'Ein Kontakt für sich (eine Datei in CONTACTS/ des Bereichs): ein Name und, wenn du magst, Organisation, Rolle, Mail-Adressen, Telefonnummern, Zeitzone, Tags und Notizen.',
    'nav.meetings': 'Alle Meetings des Vaults in einer Liste: heute, diese Woche, später, die Serien und die vergangenen (mit Hinweis, wenn Protokoll oder Ergebnis fehlt), mit Suche und Filter.',
    review: 'Die Ansichten, die zurückblicken: die Zahlen der Tasks und die erledigten Tasks.',
    export: 'Was die gezeigte Ansicht zeichnet: in eine Datei, in die Zwischenablage oder zum Drucker.',
    save: 'Speichern',
    copy: 'Kopieren',
    print: 'Drucken',
    repos: 'Die Ansichten deiner Repos: die Kacheln der Repos und die Ampel je Repo (Checkout und CI).',
  },
} as const;

/** The word `group` (the hint of a submenu, or the heading of a part of the export) in the language `lang`. */
export function groupHint(lang: string, group: string): string {
  const words: Record<string, string> = lang === 'de' ? HINTS.de : HINTS.en;
  return words[group] ?? '';
}
