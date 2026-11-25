import { describe, expect, it } from 'vitest';
import { checklistCsv, checklistFileName, checklistMarkdown, checklistSheet, dayOf, SHEET_TEXT, type ChecklistWords } from './checklistExport';
import type { ChecklistEntry } from './contract';

const WORDS: ChecklistWords = { title: 'Titel', made: 'Angelegt', done: 'Erledigt', tags: 'Tags', text: 'Text', filter: '' };

function entry(slug: string, more: Partial<ChecklistEntry> = {}): ChecklistEntry {
  return {
    id: `_list-a/${slug}`,
    slug,
    title: `Eintrag ${slug}`,
    created: '2026-01-10T09:00:00Z',
    tags: [],
    text: '',
    file: `_list-a/${slug}.md`,
    etag: `sha256:${slug}`,
    ...more,
  } as ChecklistEntry;
}

describe('the export of a checklist', () => {
  it('names the day of a time stamp and nothing for a file that says none', () => {
    expect(dayOf('2026-01-10T09:00:00Z')).toBe('2026-01-10');
    expect(dayOf('')).toBe('');
  });

  it('writes Markdown in the form of a list kept by hand: an entry per block, apart by ---', () => {
    const md = checklistMarkdown(
      'Aha',
      [
        entry('a', { title: 'Erste', tags: ['ai', 'hiva'], text: '| a | b |\n|---|---|\n| 1 | 2 |' }),
        entry('b', { title: 'Zweite', done: '2026-01-11', assets: ['assets/images/x.png'] }),
      ],
      { ...WORDS, filter: 'Filter: #ai' },
    );
    expect(md).toBe(
      [
        '# Aha',
        '',
        'Filter: #ai',
        '',
        '## Erste',
        '',
        '2026-01-10 · #ai #hiva',
        '',
        '| a | b |\n|---|---|\n| 1 | 2 |',
        '',
        '---',
        '',
        '## ~~Zweite~~',
        '',
        '2026-01-10 · Erledigt 2026-01-11',
        '',
        '- assets/images/x.png',
        '',
      ].join('\n'),
    );
  });

  it('keeps a title on one line in its heading', () => {
    expect(checklistMarkdown('L', [entry('a', { title: 'a\nb' })], WORDS)).toContain('## a b');
  });

  it('writes CSV whose cells are never read as a formula', () => {
    const csv = checklistCsv([entry('a', { title: '=SUM(1)', tags: ['x', 'y'], text: 'a;b' })], WORDS, ';');
    expect(csv).toBe('Titel;Angelegt;Erledigt;Tags;Text\r\n\'=SUM(1);2026-01-10;;x y;"a;b"\r\n');
  });

  it('gives the printer a table with the beginning of a long text', () => {
    const sheet = checklistSheet('Support', [entry('a', { text: 'x'.repeat(SHEET_TEXT + 5), tags: ['t'] })], WORDS);
    expect(sheet.title).toBe('Support');
    expect(sheet.facts).toEqual([]);
    expect(sheet.headers).toEqual(['Titel', 'Angelegt', 'Erledigt', 'Tags', 'Text']);
    const row = sheet.sections[0]?.rows[0] ?? [];
    expect(row.slice(0, 4)).toEqual(['Eintrag a', '2026-01-10', '', 't']);
    expect(row[4]).toBe(`${'x'.repeat(SHEET_TEXT)} ...`);
  });

  it('names a file by the list and the day', () => {
    expect(checklistFileName('_list-support-faelle', '2026-11-25', 'md')).toBe('list-support-faelle-2026-11-25.md');
    expect(checklistFileName('_list-', '2026-11-25', 'csv')).toBe('list-list-2026-11-25.csv');
  });
});
