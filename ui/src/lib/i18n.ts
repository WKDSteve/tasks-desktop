// A typed dictionary, German and English, and `Intl` for numbers and dates.
// The UI language is not the language of the data: titles stay as written.
//
// The words of each language are a chunk of their own (`i18n-en.ts`, `i18n-de.ts`), loaded on demand: the start of
// the page carries only the language it shows (about 190 kB less to parse), the other one comes when the person
// switches to it. `translate` stays synchronous; it reads the languages loaded so far. The page loads its language
// before it draws (`main.ts`, `main.web.ts`), and a switch shows the new language only once its words are there
// (`langSwitcher`), so no key ever stands in for a word.

import { ago as kitAgo, formatNumber as kitFormatNumber, hintOf as kitHintOf, kitTexts, labelOf as kitLabelOf, lookup, pickLang } from 'appkit-ui/i18n';

export type Lang = 'de' | 'en';

/** A key of the page's own words (`i18n-en.ts`). */
export type PageKey = keyof typeof import('./i18n-en').default;
/** A key of the page's words or of the kit's (`kit.ago.minutes`), which the kit's parts look up in the same table. */
export type Key = PageKey | keyof typeof kitTexts.en;

/** The page's own words of one language, as its chunk has them. */
export type PageWords = Readonly<Record<PageKey, string>>;
/** The words of one language: every key. */
export type Dictionary = Readonly<Record<Key, string>>;

const loaded: Partial<Record<Lang, Dictionary>> = {};
const loading: Partial<Record<Lang, Promise<void>>> = {};
const importers: Record<Lang, () => Promise<{ default: PageWords }>> = {
  en: () => import('./i18n-en'),
  de: () => import('./i18n-de'),
};

/** Whether the words of `lang` are there: `translate` gives them at once. */
export function isLoaded(lang: Lang): boolean {
  return loaded[lang] !== undefined;
}

/**
 * Hand the page's words of a language over directly (the tests, which have both at once). The kit's words are added
 * here: the language chunks import nothing, so that they share no code with the start (a shared module would be cut
 * out of the main chunk into a chunk of its own, and the start would be made of dozens of small files).
 */
export function provideLang(lang: Lang, words: PageWords): void {
  loaded[lang] = { ...kitTexts[lang], ...words };
}

/**
 * Load the words of `lang`, once: a second call while it loads waits for the same import. A failed import (the hub
 * went away) is forgotten, so that the next call tries again.
 */
export function loadLang(lang: Lang): Promise<void> {
  if (isLoaded(lang)) return Promise.resolve();
  const pending =
    loading[lang] ??
    importers[lang]().then(
      (module) => provideLang(lang, module.default),
      (error: unknown) => {
        delete loading[lang];
        throw error;
      },
    );
  loading[lang] = pending;
  return pending;
}

/**
 * A switch of the language: `apply` takes the new language at once when its words are there, else once they are
 * loaded, and only if no later switch came in the meantime (German asked for, English chosen before German arrived:
 * the page stays English). The promise rejects when the words could not be loaded; the page keeps its language.
 */
export function langSwitcher(apply: (lang: Lang) => void): (lang: Lang) => Promise<void> {
  let wanted: Lang | null = null;
  return async (lang) => {
    wanted = lang;
    // Synchronous when the words are there: a switch to a loaded language is seen in the same tick.
    if (isLoaded(lang)) {
      apply(lang);
      return;
    }
    try {
      await loadLang(lang);
    } catch (error) {
      if (wanted === lang) throw error;
      return;
    }
    if (wanted === lang) apply(lang);
  };
}

/** Is `key` a word of `lang` (a code of the hub that this version may or may not know)? */
export function hasKey(lang: Lang, key: string): key is Key {
  return Object.hasOwn(dictionary(lang), key);
}

/**
 * The words of `lang`; before they are loaded those of the other language (never on the screen in practice: the page
 * waits for its language), and before any language nothing, so that a key shows as itself.
 */
function dictionary(lang: Lang): Partial<Dictionary> {
  return loaded[lang] ?? loaded[lang === 'de' ? 'en' : 'de'] ?? {};
}

/** The languages of the page. */
export const LANGS: readonly Lang[] = ['de', 'en'];

/** Is this one of the languages we have? */
export function isLang(value: unknown): value is Lang {
  return value === 'de' || value === 'en';
}

/** The language a browser asks for, German or else English. */
export function detectLang(preferred: readonly string[]): Lang {
  return pickLang(preferred, ['de', 'en'], 'en');
}

export function translate(
  lang: Lang,
  key: Key,
  params: Record<string, string | number> = {},
): string {
  // A key that is not there (never from the code, which is typed) shows as
  // itself rather than breaking the page.
  return lookup(dictionary(lang), key, params);
}

/** "5 min", "2 h": how long ago, in the unit that fits. */
export function ago(lang: Lang, milliseconds: number): string {
  return kitAgo((key, params) => translate(lang, key, params), milliseconds);
}

export function formatNumber(lang: Lang, value: number): string {
  return kitFormatNumber(lang, value);
}

/**
 * The short explanation of a value or a label (`hint.state.freed`), or '' when there is none: the hint is an
 * addition, and a word this version does not know has no explanation yet.
 */
export function hintOf(lang: Lang, prefix: string, value: string | undefined): string {
  return kitHintOf(dictionary(lang), prefix, value);
}

/**
 * The word for a value the engine named (`status.doing`, `state.ready`). A value this version does not know
 * shows as it is: the contract may grow a new word, and the page must not break on it.
 */
export function labelOf(lang: Lang, prefix: string, value: string | undefined): string {
  return kitLabelOf(dictionary(lang), prefix, value);
}
