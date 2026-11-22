// The tables of a view of figures (the learning statistics) in the menu View: offered only while that view is shown,
// saved and copied as CSV, JSON and Markdown, printed as one section per table with its own heads, and nothing made
// from no rows.
import { describe, expect, it } from 'vitest';
import { make } from './appDouble';
import type { ViewTables } from './export';
import type { View } from './app.svelte';

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
});
