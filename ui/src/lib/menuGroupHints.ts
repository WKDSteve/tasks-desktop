// The hints of the submenus of the tab View and the headings of its submenu Export. They stand here, not in the language files, and the
// page loads this part after its start (App.svelte), so the start stays within its budget (tools/check-bundle-size.py).
const HINTS = {
  en: {
    time: 'The views along the calendar: the month, the open tasks as bars from start to due, and the reminders.',
    review: 'The views that look back: the numbers of the tasks and the tasks that are finished.',
    export: 'What the view shown draws: to a file, to the clipboard or to the printer.',
    save: 'Save',
    copy: 'Copy',
    print: 'Print',
    repos: 'The views of your repos: the tiles of the repos and the light of each one (checkout and CI).',
  },
  de: {
    time: 'Die Ansichten entlang der Zeit: der Monat, die offenen Tasks als Balken von Start bis Fällig und die Erinnerungen.',
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
