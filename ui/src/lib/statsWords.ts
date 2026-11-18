// The words and the colour classes of the statistics: what a stack is called and which class colours it. Shared by
// the view (bars, legend, table) and the tiles of the fields, so a value has one name in both. A value with a meaning
// has one colour too; a value the tasks name freely takes the colour of its place among the named ones of the count
// it is drawn in (a tile counts the tasks the filter keeps, the legend counts as if its field had no choice).

import { NONE } from './filter';
import { labelOf, translate, type Key, type Lang } from './i18n';
import { bucketsOf, DAYS, isMultiDim, isOpenDim, OTHER, TOP, type StatCut, type StatDim } from './stats';
import { markHidden } from './text';

/** The word of a stack: a status, a readiness and a who in the page's words, "none", "in days" and "further", else the value. */
export function bucketLabel(lang: Lang, dim: StatDim, bucket: string): string {
  const t = (key: Key) => translate(lang, key);
  if (bucket === NONE) return dim === 'actor' ? t('actor.none') : t('stats.none');
  if (bucket === OTHER) return t('stats.other');
  if (dim === 'actor') return labelOf(lang, 'actor', bucket);
  if (isOpenDim(dim)) return markHidden(bucket);
  if (dim === 'effort' && bucket === DAYS) return t('stats.days');
  if (dim === 'status' || dim === 'state') {
    // a value this page has no word for shows as it is
    const key = `${dim}.${bucket}` as Key;
    const word = t(key);
    return word === key ? bucket : word;
  }
  if (dim === 'prio') return `P${bucket}`;
  return bucket;
}

/** How many colours the series of the named values has (`.s-0` ...); `TOP` values are named, so none is used twice. */
export const SERIES = 10;

/**
 * The class that colours a stack. A value of a field the tasks name freely has no colour of its own: it takes the
 * series of its place among the named values. A value of another field the page has no colour for (a who or a
 * severity a later engine names) is "other": a class without a rule would leave its part of the bar unseen.
 */
export function bucketClass(cut: StatCut, bucket: string): string {
  if (bucket === NONE) return 'none';
  if (bucket === OTHER) return 'other';
  if (cut.named !== null) return `s-${Math.max(0, cut.named.indexOf(bucket)) % SERIES}`;
  return bucketsOf(cut.dim).includes(bucket) ? `v-${bucket}` : 'other';
}

/** The name of a stack in the markup, for the tests and the styles. */
export const bucketName = (bucket: string): string => (bucket === NONE ? 'none' : bucket === OTHER ? 'other' : bucket);

/** What cutting by a field does, for the hint of its button and of its tile. */
export function dimHint(lang: Lang, dim: StatDim): string {
  const field = translate(lang, `stats.dim.${dim}` as Key);
  const base = translate(lang, isMultiDim(dim) ? 'hint.stats.dim.multi' : 'hint.stats.dim', { field });
  return isOpenDim(dim) ? `${base} ${translate(lang, 'hint.stats.dim.open', { n: TOP })}` : base;
}
