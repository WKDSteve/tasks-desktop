// Numbers a person reads, in the language of the page (`app.lang`), never put together by hand: `Math.round(x * 100) + ' %'`
// writes `75 %` in German as `75%` and 1.5 as `1.5`, where German reads `75 %` and `1,5`. Machine formats (file names, ISO
// dates, ETags, SVG coordinates) stay as they are and are not made here.

import type { Lang } from './i18n';

const percents = new Map<string, Intl.NumberFormat>();
const decimals = new Map<string, Intl.NumberFormat>();

function formatter(cache: Map<string, Intl.NumberFormat>, lang: Lang, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  let f = cache.get(lang);
  if (!f) {
    f = new Intl.NumberFormat(lang, options);
    cache.set(lang, f);
  }
  return f;
}

/** A share (0.75) as a whole percent: `75 %` in German, `75%` in English. */
export function percentText(lang: Lang, fraction: number): string {
  return formatter(percents, lang, { style: 'percent', maximumFractionDigits: 0 }).format(fraction);
}

/** A number with up to two decimals and the separator of the language: `1,5` in German, `1.5` in English. */
export function decimalText(lang: Lang, value: number): string {
  return formatter(decimals, lang, { maximumFractionDigits: 2 }).format(value);
}
