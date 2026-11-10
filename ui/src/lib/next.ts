// The words of the next task of the overview: a value that is missing is said as a word, not as a sign.

import { translate, type Lang } from './i18n';

/** "effort M", or "no effort" when the task has none (a "?" would be a sign without a word for a screen reader). */
export function effortWords(lang: Lang, effort: string | undefined): string {
  return effort ? translate(lang, 'today.next.effort', { effort }) : translate(lang, 'mark.no_effort');
}

/**
 * The engine's count of the ready tasks `next` left out because their `start` day has not come yet (a routine's next
 * round is one of them), as a sentence; null when there is none.
 */
export function laterWords(lang: Lang, later: number | undefined): string | null {
  return later !== undefined && later > 0 ? translate(lang, 'today.later', { n: later }) : null;
}

/** Where a routine's next round counts from, in the order the engine names them (`done`, the default, first). */
export const REPEAT_FROMS = ['done', 'due'] as const;
