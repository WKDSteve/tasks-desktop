// "Copy id" of the context menu of a task: it says so when the page has no clipboard (the hub over http in a LAN has none)
// instead of throwing.
import { buildContextMenu } from 'appkit-ui/contextmenu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { make, snapshot } from './appDouble';
import { createContextRegistry, taskTarget } from './context';
import { task } from './fixtures';
import { translate } from './i18n';

const a = task('pub/a', { etag: 'ea' });

async function menuOf(): Promise<{ app: ReturnType<typeof make>['app']; copy: () => Promise<void> }> {
  const m = make({ token: 't' });
  m.hub.doc = snapshot([a]);
  await m.app.start(null);
  m.app.setLang('en');
  const items = buildContextMenu(createContextRegistry(m.app), [taskTarget(a)]) as { label?: string; onselect?: () => void }[];
  const entry = items.find((i) => i.label === translate('en', 'ctx.copy_id', {}));
  expect(entry).toBeDefined();
  return {
    app: m.app,
    copy: async () => {
      entry?.onselect?.();
      // The copy is asked for in a promise: let it settle.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the context menu of a task: copy id', () => {
  it('writes the id to the clipboard and says that it is copied', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { app, copy } = await menuOf();
    await copy();
    expect(writeText).toHaveBeenCalledWith('pub/a');
    expect(app.toast?.kind).toBe('ok');
    expect(app.toast?.text).toBe(translate('en', 'ctx.copied', { id: 'pub/a' }));
    app.stop();
  });

  it('says that it could not copy when the page has no clipboard, and does not throw', async () => {
    vi.stubGlobal('navigator', {});
    const { app, copy } = await menuOf();
    await copy();
    expect(app.toast?.kind).toBe('error');
    expect(app.toast?.text).toBe(translate('en', 'about.copy_failed', {}));
    app.stop();
  });
});
