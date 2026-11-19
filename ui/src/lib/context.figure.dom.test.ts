// @vitest-environment jsdom
// The context menu of a number of the statistics ("The vault in numbers"): the history of its figure, where the engine
// keeps a series and the series has the figure; nothing otherwise, so the menu of the browser stays.
import { buildContextMenu } from 'appkit-ui/contextmenu';
import { describe, expect, it } from 'vitest';
import { make, snapshot } from './appDouble';
import { createContextRegistry, figureTarget } from './context';
import { task } from './fixtures';
import { translate } from './i18n';

async function menuOf(name: string, history: boolean) {
  const m = make({ token: 't' });
  if (history) m.hub.capabilities = [...(m.hub.capabilities ?? []), 'history'];
  m.hub.doc = snapshot([task('pub/a', { etag: 'ea' })]);
  await m.app.start(null);
  m.app.setLang('en');
  const items = buildContextMenu(createContextRegistry(m.app), [figureTarget(name, 'Effort')]) as {
    kind: string;
    label?: string;
    onselect?: () => void;
  }[];
  return { app: m.app, items };
}

describe('the context menu of a number of the statistics', () => {
  it('offers the history of the sum of the effort: the effort in days', async () => {
    const { app, items } = await menuOf('effort', true);
    expect(items.map((i) => i.label)).toEqual([translate('en', 'today.tiles.history', { what: 'Effort' })]);
    items[0]?.onselect?.();
    expect(app.statsHistory.metric).toBe('effortDays');
    expect(app.view).toBe('stats');
    app.stop();
  });

  it('offers nothing for a number the series does not keep, or where there is no series', async () => {
    const none = await menuOf('quickWins', true);
    expect(none.items).toEqual([]);
    none.app.stop();
    const old = await menuOf('effort', false);
    expect(old.items).toEqual([]);
    old.app.stop();
  });
});
