// The words of the question the view of the paths asks before it closes a point under `{safety}`, English and German.
// They come with the chunk of the view (`views/PathsView.svelte`), not with the start of the page (its budget,
// tools/check-bundle-size.py).
import type { Lang } from './i18n';

const EN = {
  'paths.safety.ask': '{label} concerns safety. Mark it as {state}?',
  'paths.safety.yes': 'Yes, mark it',
  'paths.safety.no': 'Cancel',
  'paths.safety.badge': 'Safety',
  'paths.safety.state.learned': 'learned',
  'paths.safety.state.seen': 'seen',
};

export type PathSafetyKey = keyof typeof EN;

const DE: Record<PathSafetyKey, string> = {
  'paths.safety.ask': '{label} betrifft die Sicherheit. Als {state} markieren?',
  'paths.safety.yes': 'Ja, markieren',
  'paths.safety.no': 'Abbrechen',
  'paths.safety.badge': 'Sicherheit',
  'paths.safety.state.learned': 'gelernt',
  'paths.safety.state.seen': 'angeschaut',
};

export function pathSafetyText(lang: Lang, key: PathSafetyKey, params: Record<string, string | number> = {}): string {
  const text: string = lang === 'de' ? DE[key] : EN[key];
  return text.replace(/\{(\w+)\}/g, (all, k: string) => (Object.hasOwn(params, k) ? String(params[k]) : all));
}
