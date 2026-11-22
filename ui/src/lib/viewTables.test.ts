// The tables of a view of figures (the learning statistics) in the menu View: offered only while that view is shown,
// saved and copied as CSV, JSON and Markdown, printed as one section per table with its own heads, and nothing made
// from no rows.
import { describe, expect, it } from 'vitest';
import { make } from './appDouble';
import type { ViewTables } from './export';
import type { View } from './app.svelte';
import { exportWord } from './exportWord';
import { paletteActions } from './paletteActions';
import { tablesLabel, TABLE_KEYS } from './viewTablesTexts';
import { translate, type Key } from './i18n';

const words: ViewTables['words'] = (what, n) => `${what} ${n}`;
const tables = (rows: string[][] = [['Lua', '3']]): ViewTables => ({
  view: 'learn',
  title: 'Figures',
  words,
  tables: () => [
    { title: 'Per path', headers: ['Path', 'Learned'], rows },
    { title: 'Per week', headers: ['Week', 'Hours'], rows: [['Wk 47', '1,5']] },
  ],
});

async function shown(view: View = 'learn') {
  const made = make({ token: 't', now: Date.UTC(2026, 10, 22, 12) });
  made.hub.capabilities = ['paths', 'path'];
  await made.app.start(null);
  made.app.setView(view);
  return made;
}

describe('App, the tables of a view of figures', () => {
  it('are exported only while their view is shown', async () => {
    const { app } = await shown('learn');
    expect(app.exportable).toBe(false);
    app.viewTables = tables();
    expect(app.exportable).toBe(true);
    app.setView('paths');
    expect(app.exportable).toBe(false);
    app.stop();
  });

  it('saves them as CSV and Markdown as a card of the statistics writes them, and as JSON', async () => {
    const { app, files, copied } = await shown();
    app.viewTables = tables();
    await app.exportView('csv', 'save');
    expect(files[0]!.name).toBe('tasks-learn-2026-11-22.csv');
    expect(files[0]!.text).toContain('Per path');
    expect(files[0]!.text).toContain('Lua');
    expect(app.toast).toMatchObject({ kind: 'ok', text: 'saved 2' });
    await app.exportView('markdown', 'copy');
    expect(copied[0]).toContain('# Figures');
    expect(copied[0]).toContain('| Week | Hours |');
    expect(app.toast).toMatchObject({ kind: 'ok', text: 'copied 2' });
    await app.exportView('json', 'save');
    expect(JSON.parse(files[1]!.text)).toMatchObject({ view: 'learn', title: 'Figures', day: '2026-11-22', tables: [{ headers: ['Path', 'Learned'] }, { rows: [['Wk 47', '1,5']] }] });
    app.stop();
  });

  it('makes nothing from tables without a row, and says so', async () => {
    const { app, files } = await shown();
    app.viewTables = { view: 'learn', title: 'Figures', words, tables: () => [{ headers: ['Path'], rows: [] }] };
    await app.exportView('csv', 'save');
    expect(files).toHaveLength(0);
    expect(app.toast).toMatchObject({ kind: 'error', text: 'empty 0' });
    app.printView();
    await new Promise((r) => setTimeout(r, 0));
    expect(app.toast).toMatchObject({ kind: 'error', text: 'empty 0' });
    app.stop();
  });

  it('says a failure of the way out instead of leaving it unhandled', async () => {
    const { app, files } = await shown();
    app.viewTables = {
      view: 'learn',
      title: 'Figures',
      words,
      tables: () => {
        throw new Error('broken');
      },
    };
    await app.exportView('csv', 'save');
    expect(files).toHaveLength(0);
    expect(app.toast).toMatchObject({ kind: 'error', text: 'save_failed 0' });
    app.printView();
    await new Promise((r) => setTimeout(r, 0));
    expect(app.toast).toMatchObject({ kind: 'error' });
    app.stop();
  });

  it('prints a section per table, each with its own heads', async () => {
    const { app, printed } = await shown();
    app.viewTables = tables();
    app.printView();
    await new Promise((r) => setTimeout(r, 0));
    expect(printed).toHaveLength(1);
    expect(printed[0]).toMatchObject({
      title: 'Figures',
      headers: [],
      sections: [
        { heading: 'Per path', headers: ['Path', 'Learned'], rows: [['Lua', '3']] },
        { heading: 'Per week', headers: ['Week', 'Hours'] },
      ],
    });
    app.stop();
  });
  it('name the export entries "tables" while their view is shown, "tasks" of the page elsewhere', async () => {
    const { app } = await shown('learn');
    const page = (key: string) => translate('en', key as Key);
    const own: ViewTables = { ...tables(), label: (key, params) => tablesLabel('en', key, params) };
    expect(exportWord({ ownTables: own }, 'menu.save_csv', page)).toBe('Save tables as CSV file ...');
    expect(exportWord({ ownTables: own }, 'hint.item.menu.copy_md', page)).toBe('The tables of this view as Markdown on the clipboard.');
    expect(exportWord({ ownTables: own }, 'menu.print_view', page)).toBe('Print tables or save as PDF ...');
    // a word that names no tasks stays the page's
    expect(exportWord({ ownTables: own }, 'export.png', page)).toBe('Save as PNG ...');
    // a view without words of its own, no tables, or another view shown (App.ownTables is null then): the page's
    expect(exportWord({ ownTables: tables() }, 'menu.save_csv', page)).toBe('Save tasks as CSV file ...');
    expect(exportWord({ ownTables: null }, 'menu.save_csv', page)).toBe('Save tasks as CSV file ...');
    app.viewTables = own;
    expect(exportWord(app, 'menu.save_csv', page)).toBe('Save tables as CSV file ...');
    app.setView('paths');
    expect(exportWord(app, 'menu.save_csv', page)).toBe('Save tasks as CSV file ...');
    app.setView('learn');

    // the palette says the same
    await app.setLang('en');
    app.viewTables = own;
    const labels = paletteActions(app).filter((a) => a.key.startsWith('export.')).map((a) => a.label);
    expect(labels).toContain('Export tables: Save as CSV ...');
    expect(labels).toContain('Export tables: Print or save as PDF ...');
    app.viewTables = tables();
    expect(paletteActions(app).find((a) => a.key === 'export.save.csv')?.label).toBe('Export: Save as CSV ...');
    app.stop();
  });

  it('have words in both languages for every entry that names tasks', () => {
    for (const key of TABLE_KEYS) {
      expect(tablesLabel('de', key, { what: 'x' }), key).toBeTruthy();
      expect(tablesLabel('en', key, { what: 'x' }), key).toBeTruthy();
      expect(translate('en', key as Key), key).toBeTruthy();
    }
    expect(tablesLabel('de', 'menu.save_csv')).toBe('Tabellen als CSV-Datei speichern ...');
  });
});
