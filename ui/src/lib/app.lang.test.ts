import { afterEach, describe, expect, it, vi } from 'vitest';

// The language menu of the page on a fresh copy of the modules where only English is loaded, as at the start of a page
// that shows English (the setup of the tests loads both: src/test-setup.ts).
async function englishOnly(failGerman: boolean) {
  vi.resetModules();
  vi.doMock('./i18n-de', async (original) => {
    if (failGerman) throw new Error('the hub went away');
    return await original();
  });
  const i18n = await import('./i18n');
  const { make } = await import('./appDouble');
  await i18n.loadLang('en');
  const made = make({ prefs: new Map([['tasks-desktop.lang', 'en']]) });
  return { i18n, ...made };
}

afterEach(() => {
  vi.doUnmock('./i18n-de');
  vi.resetModules();
});

describe('App, the language on demand', () => {
  it('shows German only once its words are loaded, then remembers it', async () => {
    const { app, prefs, i18n } = await englishOnly(false);
    expect(app.lang).toBe('en');
    const switched = app.setLang('de');
    // Still English while German loads: no key on the screen.
    expect(app.lang).toBe('en');
    await switched;
    expect(app.lang).toBe('de');
    expect(prefs.get('tasks-desktop.lang')).toBe('de');
    expect(i18n.translate(app.lang, 'nav.today')).toBe('Heute');
  });

  it('stays in its language and says so when the other one cannot be loaded', async () => {
    const { app, prefs } = await englishOnly(true);
    await app.setLang('de');
    expect(app.lang).toBe('en');
    expect(prefs.get('tasks-desktop.lang')).toBe('en');
    expect(app.toast).toMatchObject({ kind: 'error', text: expect.stringContaining('could not be loaded') });
  });
});
