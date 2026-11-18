import { describe, expect, it } from 'vitest';
import { cardRoute, parseCardFolds, routedCard, STATS_CARDS, withCardFolded } from './statsCards';
import { cardFileName, cardText } from './statsExport';

describe('the cards of the statistics', () => {
  it('stand in the order: the headline numbers, bars per area, history, the table', () => {
    expect(STATS_CARDS).toEqual(['figures', 'chart', 'history', 'table']);
  });

  it('remember the folded ones as a list of names; anything else is none folded', () => {
    expect(parseCardFolds(null)).toEqual([]);
    expect(parseCardFolds('not json')).toEqual([]);
    expect(parseCardFolds('{"chart":true}')).toEqual([]);
    // unknown names are dropped, the order is the cards'
    expect(parseCardFolds('["figures","nope","chart"]')).toEqual(['figures', 'chart']);
  });

  it('fold and unfold one card, the others stay as they are', () => {
    expect(withCardFolded([], 'table', true)).toEqual(['table']);
    expect(withCardFolded(['figures'], 'chart', true)).toEqual(['figures', 'chart']);
    expect(withCardFolded(['figures', 'chart'], 'chart', false)).toEqual(['figures']);
    expect(withCardFolded(['chart'], 'chart', true)).toEqual(['chart']);
  });
});

describe('a card alone in a window', () => {
  it('names the card, the field and order, and the filter in the fragment, and reads them back', () => {
    const hash = cardRoute('history', 'state', 'name', '{"status":["open"]}');
    expect(hash).toMatch(/^#view=stats&card=history&stats=state%3Aname&filter=/);
    expect(routedCard(hash)).toEqual({ card: 'history', dim: 'state', sort: 'name' });
  });

  it('leaves out a filter of nothing', () => {
    expect(cardRoute('chart', 'status', 'count', '{}')).toBe('#view=stats&card=chart&stats=status%3Acount');
  });

  it('is no card for another fragment, an unknown card, or another view; an unknown field is left out', () => {
    expect(routedCard('#view=stats')).toBeNull();
    expect(routedCard('#view=list&card=chart')).toBeNull();
    expect(routedCard('#view=stats&card=nope')).toBeNull();
    expect(routedCard('#task=a%2Fb')).toBeNull();
    expect(routedCard('#view=stats&card=table&stats=nope:count')).toEqual({ card: 'table', sort: 'count' });
  });
});

describe('the export of a card', () => {
  const tables = [
    { title: 'Per area', headers: ['Area', 'Total'], rows: [['pub', '3'], ['=cmd', '1']] },
    { title: 'Per field', headers: ['Field', 'Value'], rows: [['Kind', 'a|b']] },
  ];

  it('as CSV: one block per table with its name, a cell a spreadsheet would run is quoted', () => {
    const csv = cardText('Card', tables, 'csv', ';');
    expect(csv).toBe("Per area\r\nArea;Total\r\npub;3\r\n'=cmd;1\r\n\r\nPer field\r\nField;Value\r\nKind;a|b\r\n");
  });

  it('as CSV of one table: no name above it', () => {
    expect(cardText('Card', [tables[0]!], 'csv')).toBe("Area,Total\r\npub,3\r\n'=cmd,1\r\n");
  });

  it('as Markdown: the title, a heading per table, pipes escaped', () => {
    const md = cardText('Card', tables, 'markdown');
    expect(md).toBe(
      '# Card\n\n## Per area\n\n| Area | Total |\n| --- | --- |\n| pub | 3 |\n| =cmd | 1 |\n\n## Per field\n\n| Field | Value |\n| --- | --- |\n| Kind | a\\|b |\n',
    );
  });

  it('is named by the card and the day', () => {
    expect(cardFileName('history', '2026-11-18', 'svg')).toBe('tasks-stats-history-2026-11-18.svg');
    expect(cardFileName('table', '2026-11-18', 'markdown')).toBe('tasks-stats-table-2026-11-18.md');
  });
});
