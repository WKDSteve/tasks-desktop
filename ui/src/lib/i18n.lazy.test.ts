import { beforeEach, describe, expect, it, vi } from 'vitest';

// The setup of the tests loads both languages (src/test-setup.ts); these cases need the module as the page has it at
// its start, with no language loaded: a fresh copy of it each.
type I18n = typeof import('./i18n');
let i18n: I18n;

beforeEach(async () => {
  vi.resetModules();
  vi.doUnmock('./i18n-de');
  i18n = await import('./i18n');
});

describe('i18n, a language on demand', () => {
  it('has no words before a language is loaded, and the words of the one loaded after', async () => {
    expect(i18n.isLoaded('de')).toBe(false);
    expect(i18n.isLoaded('en')).toBe(false);
    expect(i18n.translate('de', 'nav.today')).toBe('nav.today');
    await i18n.loadLang('de');
    expect(i18n.isLoaded('de')).toBe(true);
    expect(i18n.isLoaded('en')).toBe(false);
    expect(i18n.translate('de', 'nav.today')).toBe('Heute');
    expect(i18n.labelOf('de', 'status', 'done')).not.toBe('done');
    expect(i18n.hasKey('de', 'setup.unknown.title')).toBe(true);
    expect(i18n.hasKey('de', 'setup.no-such-code.title')).toBe(false);
  });

  it('loads a language once, however often it is asked for', async () => {
    let imports = 0;
    vi.doMock('./i18n-de', async (original) => {
      imports += 1;
      return await original();
    });
    vi.resetModules();
    const fresh: I18n = await import('./i18n');
    await Promise.all([fresh.loadLang('de'), fresh.loadLang('de')]);
    await fresh.loadLang('de');
    expect(imports).toBe(1);
  });

  it('switches at once to a language that is there, and only after loading to one that is not', async () => {
    await i18n.loadLang('en');
    const applied: string[] = [];
    const switchTo = i18n.langSwitcher((lang) => applied.push(lang));
    void switchTo('en');
    // Synchronous: no tick in between.
    expect(applied).toEqual(['en']);
    const german = switchTo('de');
    expect(applied).toEqual(['en']);
    await german;
    expect(applied).toEqual(['en', 'de']);
    // Shown only now, and with its words: never a key.
    expect(i18n.translate('de', 'nav.today')).toBe('Heute');
  });

  it('keeps the later choice when an earlier language arrives after it', async () => {
    await i18n.loadLang('en');
    const applied: string[] = [];
    const switchTo = i18n.langSwitcher((lang) => applied.push(lang));
    const german = switchTo('de');
    void switchTo('en');
    await german;
    expect(applied).toEqual(['en']);
  });

  it('keeps the language when the other cannot be loaded, and tries again on the next switch', async () => {
    let fail = true;
    vi.doMock('./i18n-de', async (original) => {
      if (fail) throw new Error('the hub went away');
      return await original();
    });
    vi.resetModules();
    const fresh: I18n = await import('./i18n');
    await fresh.loadLang('en');
    const applied: string[] = [];
    const switchTo = fresh.langSwitcher((lang) => applied.push(lang));
    await expect(switchTo('de')).rejects.toThrow();
    expect(applied).toEqual([]);
    expect(fresh.isLoaded('de')).toBe(false);
    fail = false;
    await switchTo('de');
    expect(applied).toEqual(['de']);
  });
});
