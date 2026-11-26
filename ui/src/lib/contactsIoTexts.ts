// The words of the dialog that imports and exports contacts (`views/ContactsIoDialog.svelte`), English and German.
// They come with the dialog's chunk, not with the start of the page (tools/check-bundle-size.py). No word takes an
// address or a number as a value: the report of the engine names people by name and by the number of the card or row.

import type { Lang } from './i18n';

const EN = {
  'io.import.title': 'Import contacts',
  'io.import.intro':
    'Contacts from a vCard or CSV file into an area. A trial run shows first what would be made, which records are duplicates and what is not taken over; nothing is written until you confirm.',
  'io.import.file': 'File',
  'io.import.file.hint':
    'A vCard (.vcf, version 3.0 or 4.0) or CSV file (.csv) in UTF-8. It is read here and handed to the engine as text; it goes nowhere else.',
  'io.import.area': 'Area',
  'io.import.area.hint': 'The area the new contacts go to: one file each in CONTACTS/ of the area.',
  'io.import.delimiter': 'Delimiter',
  'io.import.delimiter.hint':
    'How the columns of the CSV are separated: found by itself (the trial run names what it found) or chosen. The file is read as UTF-8.',
  'io.delimiter.auto': 'found by itself',
  'io.delimiter.comma': 'comma',
  'io.delimiter.semicolon': 'semicolon',
  'io.delimiter.tab': 'tab',
  'io.import.encoding': 'Encoding: UTF-8.',
  'io.import.trying': 'Trial run ...',
  'io.import.would': 'Trial run: {created} would be made, {duplicates} duplicates, {refused} refused, {problems} notes.',
  'io.import.made': 'Imported: {created} made, {duplicates} duplicates, {refused} refused, {problems} notes.',
  'io.report.created': 'Would be made',
  'io.report.created_done': 'Made',
  'io.report.duplicates': 'Duplicates (never overwritten)',
  'io.report.refused': 'Refused',
  'io.report.problems': 'Not taken over',
  'io.report.messages': 'Notes on the file',
  'io.report.row_created': '#{index} {name}: {id}',
  'io.report.row_duplicate': '#{index} {name}: the mail address is held by {of}',
  'io.report.row_refused': '#{index} {name}: {reason}',
  'io.report.row_problem': '#{index} {name}: {text}',
  'io.report.unnamed': '(no name)',
  'io.import.run': 'Import {n}',
  'io.import.run.hint': 'Makes the contacts the trial run named; duplicates and refused records stay out.',
  'io.import.nothing': 'Nothing to import: no record would be made.',
  'io.import.too_large': 'The file is larger than {kb} kB, more than the engine takes at once. Split it into smaller files.',
  'io.import.no_format': 'Choose a .vcf or .csv file.',
  'io.import.not_utf8': 'The file is not UTF-8. Save it as UTF-8 and choose it again.',
  'io.import.unreadable': 'The file could not be read.',
  'io.import.refused': 'The engine refused the file: {message}',
  'io.failed': 'The engine could not be asked. Try again.',
  'io.close': 'Close',
  'io.close.hint': 'Closes the dialog; nothing is written that you did not confirm.',
  'io.export.title': 'Export contacts',
  'io.export.intro':
    'The contacts as a file to save: all of them, or those of an area, a tag or an organisation. Only valid contacts are written, by id.',
  'io.export.format': 'Format',
  'io.export.vcf': 'vCard (.vcf)',
  'io.export.vcf.hint': 'One card per contact, for an address book (Outlook, Thunderbird, a phone).',
  'io.export.csv': 'CSV (.csv)',
  'io.export.csv.hint':
    'One row per contact with the columns name, org, role, emails, phones, tz, tags, notes; several values in a cell are separated by ;.',
  'io.export.version': 'vCard version',
  'io.export.version.hint': '4.0 is the current version; 3.0 for older programs.',
  'io.export.delimiter': 'Delimiter',
  'io.export.delimiter.hint': 'Semicolon for Excel with German settings, comma elsewhere, tab for a tab-separated file.',
  'io.export.bom': 'Byte order mark (for Excel)',
  'io.export.bom.hint': 'Excel reads the umlauts of a UTF-8 file right only with it; other programs do not need it.',
  'io.export.raw': 'Cells as they are (no formula guard)',
  'io.export.raw.hint':
    'Without this, a cell that starts with =, +, - or @ gets an apostrophe in front, so a spreadsheet shows it as text and runs no formula (a phone number +49 ... stays text). The import takes the apostrophe away again.',
  'io.export.encoding': 'UTF-8, lines end in CRLF.',
  'io.export.area': 'Area',
  'io.export.area.hint': 'Only the contacts of this area.',
  'io.export.tag': 'Tag',
  'io.export.tag.hint': 'Only the contacts with this tag.',
  'io.export.org': 'Organisation',
  'io.export.org.hint': 'Only the contacts of this organisation.',
  'io.export.all': 'all',
  'io.export.save': 'Save file',
  'io.export.save.hint': 'Asks the engine for the file and hands it to the browser to save.',
  'io.export.saving': 'Writing the file ...',
  'io.export.saved': 'Saved {n} contacts as {name}.',
  'io.export.empty': 'No contact fits the filter: nothing saved.',
  'io.export.blocked': 'The browser did not save the file.',
} as const;

type ContactsIoKey = keyof typeof EN;

const DE: Record<ContactsIoKey, string> = {
  'io.import.title': 'Kontakte importieren',
  'io.import.intro':
    'Kontakte aus einer vCard- oder CSV-Datei in einen Bereich. Erst zeigt ein Probelauf, was angelegt würde, welche Einträge Dubletten sind und was nicht übernommen wird; geschrieben wird erst, wenn du bestätigst.',
  'io.import.file': 'Datei',
  'io.import.file.hint':
    'Eine vCard- (.vcf, Version 3.0 oder 4.0) oder CSV-Datei (.csv) in UTF-8. Sie wird hier gelesen und als Text an die Engine gegeben; sonst geht sie nirgendwohin.',
  'io.import.area': 'Bereich',
  'io.import.area.hint': 'Der Bereich, in den die neuen Kontakte kommen: je eine Datei in CONTACTS/ des Bereichs.',
  'io.import.delimiter': 'Trennzeichen',
  'io.import.delimiter.hint':
    'Womit die Spalten der CSV getrennt sind: selbst erkannt (der Probelauf nennt, was er fand) oder gewählt. Die Datei wird als UTF-8 gelesen.',
  'io.delimiter.auto': 'selbst erkennen',
  'io.delimiter.comma': 'Komma',
  'io.delimiter.semicolon': 'Semikolon',
  'io.delimiter.tab': 'Tabulator',
  'io.import.encoding': 'Kodierung: UTF-8.',
  'io.import.trying': 'Probelauf ...',
  'io.import.would': 'Probelauf: {created} würden angelegt, {duplicates} Dubletten, {refused} abgelehnt, {problems} Hinweise.',
  'io.import.made': 'Importiert: {created} angelegt, {duplicates} Dubletten, {refused} abgelehnt, {problems} Hinweise.',
  'io.report.created': 'Würden angelegt',
  'io.report.created_done': 'Angelegt',
  'io.report.duplicates': 'Dubletten (nie überschrieben)',
  'io.report.refused': 'Abgelehnt',
  'io.report.problems': 'Nicht übernommen',
  'io.report.messages': 'Hinweise zur Datei',
  'io.report.row_created': '#{index} {name}: {id}',
  'io.report.row_duplicate': '#{index} {name}: die Mail-Adresse hat schon {of}',
  'io.report.row_refused': '#{index} {name}: {reason}',
  'io.report.row_problem': '#{index} {name}: {text}',
  'io.report.unnamed': '(ohne Namen)',
  'io.import.run': '{n} importieren',
  'io.import.run.hint': 'Legt die Kontakte an, die der Probelauf nannte; Dubletten und abgelehnte Einträge bleiben draußen.',
  'io.import.nothing': 'Nichts zu importieren: kein Eintrag würde angelegt.',
  'io.import.too_large': 'Die Datei ist größer als {kb} kB, mehr als die Engine auf einmal nimmt. Teile sie in kleinere Dateien.',
  'io.import.no_format': 'Wähle eine .vcf- oder .csv-Datei.',
  'io.import.not_utf8': 'Die Datei ist nicht UTF-8. Speichere sie als UTF-8 und wähle sie erneut.',
  'io.import.unreadable': 'Die Datei ließ sich nicht lesen.',
  'io.import.refused': 'Die Engine lehnte die Datei ab: {message}',
  'io.failed': 'Die Engine ließ sich nicht fragen. Versuche es noch einmal.',
  'io.close': 'Schließen',
  'io.close.hint': 'Schließt den Dialog; geschrieben wird nur, was du bestätigt hast.',
  'io.export.title': 'Kontakte exportieren',
  'io.export.intro':
    'Die Kontakte als Datei zum Speichern: alle oder die eines Bereichs, Tags oder einer Organisation. Geschrieben werden nur gültige Kontakte, nach Id.',
  'io.export.format': 'Format',
  'io.export.vcf': 'vCard (.vcf)',
  'io.export.vcf.hint': 'Eine Karte je Kontakt, für ein Adressbuch (Outlook, Thunderbird, ein Handy).',
  'io.export.csv': 'CSV (.csv)',
  'io.export.csv.hint':
    'Eine Zeile je Kontakt mit den Spalten name, org, role, emails, phones, tz, tags, notes; mehrere Werte in einer Zelle sind mit ; getrennt.',
  'io.export.version': 'vCard-Version',
  'io.export.version.hint': '4.0 ist die aktuelle Version; 3.0 für ältere Programme.',
  'io.export.delimiter': 'Trennzeichen',
  'io.export.delimiter.hint': 'Semikolon für Excel mit deutschen Einstellungen, sonst Komma, Tabulator für eine tabgetrennte Datei.',
  'io.export.bom': 'Byte-Order-Mark (für Excel)',
  'io.export.bom.hint': 'Nur damit liest Excel die Umlaute einer UTF-8-Datei richtig; andere Programme brauchen es nicht.',
  'io.export.raw': 'Zellen unverändert (ohne Formelschutz)',
  'io.export.raw.hint':
    'Ohne das bekommt eine Zelle, die mit =, +, - oder @ beginnt, einen Apostroph davor, damit ein Tabellenprogramm sie als Text zeigt und keine Formel ausführt (eine Telefonnummer +49 ... bleibt Text). Der Import nimmt den Apostroph wieder weg.',
  'io.export.encoding': 'UTF-8, Zeilen enden mit CRLF.',
  'io.export.area': 'Bereich',
  'io.export.area.hint': 'Nur die Kontakte dieses Bereichs.',
  'io.export.tag': 'Tag',
  'io.export.tag.hint': 'Nur die Kontakte mit diesem Tag.',
  'io.export.org': 'Organisation',
  'io.export.org.hint': 'Nur die Kontakte dieser Organisation.',
  'io.export.all': 'alle',
  'io.export.save': 'Datei speichern',
  'io.export.save.hint': 'Fragt die Engine nach der Datei und gibt sie dem Browser zum Speichern.',
  'io.export.saving': 'Datei wird geschrieben ...',
  'io.export.saved': '{n} Kontakte als {name} gespeichert.',
  'io.export.empty': 'Kein Kontakt passt zum Filter: nichts gespeichert.',
  'io.export.blocked': 'Der Browser hat die Datei nicht gespeichert.',
};

export type { ContactsIoKey };

/** Whether `key` is a word of the dialog of import and export. */
export function isContactsIoKey(key: string): key is ContactsIoKey {
  return Object.hasOwn(EN, key);
}

/** A word of the dialog of import and export. */
export function contactsIoText(lang: Lang, key: ContactsIoKey, params: Record<string, string | number> = {}): string {
  const text: string = lang === 'de' ? DE[key] : EN[key];
  return text.replace(/\{(\w+)\}/g, (all, k: string) => (Object.hasOwn(params, k) ? String(params[k]) : all));
}
