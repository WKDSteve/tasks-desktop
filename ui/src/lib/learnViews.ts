// The tab "Learning plans" of the menu bar: the views of the learning plans, in sections, as the concept of the tab
// orders them (tasks-vault, task tasks-desktop/konzept-reiter-lernplaene-ideen-sammeln-badge-uebersicht). A view is
// offered only when the page has it (`ROUTED_VIEWS`) and the engine serves what it needs; one that is missing is left
// out, not greyed. A view planned but not built yet is named here all the same: a link to it lands on a view that is
// there, with a word that says so (`missingLearnView`). Adding the view to `View` and `ROUTED_VIEWS` (and its words
// `nav.<id>`, `hint.item.nav.<id>`) puts it into the tab.

import { ROUTED_VIEWS } from './route';

export type LearnSection = 'overview' | 'paths' | 'progress' | 'knowledge';

export interface LearnView {
  /** The name of the view in `#view=<id>` and in `View`. */
  id: string;
  /** The capabilities of the engine the view needs, all of them. */
  needs: readonly string[];
  /** Shown only with gamification on (badges, rewards). */
  game?: true;
}

/** What the tab as a whole needs: the learning paths. Without them there is no tab. */
export const LEARN_NEEDS = ['paths', 'path'] as const;

/** The views of the tab, in the order of the menu: from the daily step to the structure, the review and the notes. */
export const LEARN_SECTIONS: readonly { section: LearnSection; views: readonly LearnView[] }[] = [
  {
    section: 'overview',
    views: [
      { id: 'learn', needs: LEARN_NEEDS },
      { id: 'learnnext', needs: [...LEARN_NEEDS, 'learn_next'] },
    ],
  },
  {
    section: 'paths',
    views: [
      { id: 'paths', needs: LEARN_NEEDS },
      { id: 'pathmap', needs: LEARN_NEEDS },
      { id: 'competences', needs: [...LEARN_NEEDS, 'competences'] },
    ],
  },
  {
    section: 'progress',
    views: [
      { id: 'learnstats', needs: LEARN_NEEDS },
      { id: 'learntime', needs: [...LEARN_NEEDS, 'path_hours'] },
      { id: 'badges', needs: [...LEARN_NEEDS, 'xp'], game: true },
      { id: 'rewards', needs: [...LEARN_NEEDS, 'xp'], game: true },
    ],
  },
  {
    section: 'knowledge',
    views: [
      { id: 'evidence', needs: [...LEARN_NEEDS, 'learn_evidence'] },
      { id: 'learnnotes', needs: [...LEARN_NEEDS, 'learn_notes'] },
    ],
  },
];

const ALL: readonly LearnView[] = LEARN_SECTIONS.flatMap((s) => s.views);
const BUILT: readonly string[] = ROUTED_VIEWS;

/** Whether `view` is a view of the tab (shown in it, not in the menu View). */
export function isLearnView(view: string): boolean {
  return ALL.some((v) => v.id === view);
}

/** What decides which views are offered: the capabilities of the engine and the switch of gamification. */
export interface LearnFacts {
  can: (capability: string) => boolean;
  gamification: boolean;
  /** The views the page has; the default is every routed view. A test names its own. */
  built?: readonly string[];
}

function offered(view: LearnView, facts: LearnFacts): boolean {
  const built = facts.built ?? BUILT;
  return built.includes(view.id) && view.needs.every((c) => facts.can(c)) && (view.game !== true || facts.gamification);
}

/** The sections of the tab with the views that are offered now; a section without one is left out, as is the tab. */
export function learnMenu(facts: LearnFacts): { section: LearnSection; views: string[] }[] {
  if (!LEARN_NEEDS.every((c) => facts.can(c))) return [];
  return LEARN_SECTIONS.map(({ section, views }) => ({
    section,
    views: views.filter((v) => offered(v, facts)).map((v) => v.id),
  })).filter((s) => s.views.length > 0);
}

/**
 * The view of the tab an address names that the page does not have (planned, not built yet), or null: a view the
 * page has, another view, no view. The page shows the learning paths then and says so.
 */
export function missingLearnView(hash: string, facts: Pick<LearnFacts, 'built'> = {}): string | null {
  const built = facts.built ?? BUILT;
  const text = hash.startsWith('#') ? hash.slice(1) : hash;
  for (const part of text.split('&')) {
    const at = part.indexOf('=');
    if (at < 0 || part.slice(0, at) !== 'view') continue;
    const view = part.slice(at + 1);
    return isLearnView(view) && !built.includes(view) ? view : null;
  }
  return null;
}

/** Where a link to a view of the tab that is missing lands: the overview once it is there, the learning paths till then. */
export function learnFallback(facts: Pick<LearnFacts, 'built'> = {}): string {
  const built = facts.built ?? BUILT;
  return built.includes('learn') ? 'learn' : 'paths';
}
