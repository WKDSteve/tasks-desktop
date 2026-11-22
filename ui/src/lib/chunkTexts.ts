// The words of a view that is a chunk of its own (as lib/pathMapTexts.ts for the competence map): English and German
// side by side, imported only by the view, so that they come with its chunk and not with the start of the page (the
// start has a budget, tools/check-bundle-size.py). The menu entry and its hint stay in `i18n`.
import { translate, type Key, type Lang } from './i18n';

export interface ChunkTexts<K extends string> {
  /** Whether `key` is a word of the view (else one of the page). */
  has(key: string): key is K;
  /** The word in `lang` with its placeholders filled. */
  text(lang: Lang, key: K, params?: Record<string, string | number>): string;
  /** A word of the view or of the page, for the `t` of a view. */
  t(lang: Lang, key: K | Key, params?: Record<string, string | number>): string;
  /** Every key of the view (for the tests). */
  keys(): K[];
}

const fill = (text: string, params: Record<string, string | number>): string =>
  text.replace(/\{(\w+)\}/g, (all, k: string) => (k in params ? String(params[k]) : all));

/** German must name every key English names (the type says so). */
export function chunkTexts<K extends string>(en: Record<K, string>, de: Record<K, string>): ChunkTexts<K> {
  const has = (key: string): key is K => Object.hasOwn(en, key);
  const text = (lang: Lang, key: K, params: Record<string, string | number> = {}): string => fill(lang === 'de' ? de[key] : en[key], params);
  return {
    has,
    text,
    t: (lang, key, params = {}) => (has(key) ? text(lang, key, params) : translate(lang, key as Key, params)),
    keys: () => Object.keys(en) as K[],
  };
}

/** The placeholders of a text, sorted: both languages of a key must name the same. */
export function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
}
