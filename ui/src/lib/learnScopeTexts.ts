// The words of the area filter in the views of the tab "Lernpläne" (`views/LearnScopeNote.svelte`), English and German;
// they come with the chunks of those views (lib/chunkTexts.ts), not with the start of the page.
import { chunkTexts } from './chunkTexts';

const EN = {
  'learnscope.hidden': 'The area filter ({areas}) hides the learning paths here.',
  'learnscope.clear': 'Clear filter',
};

const DE: Record<keyof typeof EN, string> = {
  'learnscope.hidden': 'Der Bereichs-Filter ({areas}) blendet die Lernpfade hier aus.',
  'learnscope.clear': 'Filter aufheben',
};

export type LearnScopeKey = keyof typeof EN;
export const learnScopeTexts = chunkTexts<LearnScopeKey>(EN, DE);
