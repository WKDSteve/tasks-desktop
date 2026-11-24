// The tab "View" of the menu bar: the views of the page in groups, as the concept of the menu orders them (tasks-vault,
// ALL/Menue-Struktur-tasks-desktop-Konzept-2026-11-23.md). The groups are data: a group changes from a section to a
// submenu (or back) by one word here. A view that is not offered (the engine does not serve it, the variant has not
// got it) is left out, not greyed; a submenu is shown from two views on, with one it becomes a plain entry, with none
// it is missing. The learning plans (learnViews.ts) and the appointments (officeViews.ts: meetings, calendar, timeline,
// reminders) have a tab of their own.

export type ViewGroupId = 'daily' | 'plan' | 'review' | 'saved' | 'repos';

/** How a group is shown: a section with a heading, a submenu, or its views alone (no heading). */
export type ViewGroupForm = 'section' | 'submenu' | 'bare';

export interface ViewEntry {
  /** The name of the view in `#view=<id>` and in `View`. */
  id: string;
  /** The capabilities of the engine the view needs; without them the view is left out. */
  needs?: readonly string[];
  /** Offered only where the hub can run machine actions (the web variant has none). */
  machine?: true;
  /** The capability that lets the view be used; without it the entry is shown greyed (as it always was). */
  usable?: string;
}

export interface ViewGroup {
  id: ViewGroupId;
  form: ViewGroupForm;
  views: readonly ViewEntry[];
}

/** The groups in the order of the menu: from the daily step to the review, then the saved views and the repos. */
export const VIEW_GROUPS: readonly ViewGroup[] = [
  {
    id: 'daily',
    form: 'section',
    views: [
      { id: 'today' },
      { id: 'list' },
      { id: 'board', usable: 'reorder' },
      { id: 'inbox' },
    ],
  },
  { id: 'plan', form: 'section', views: [{ id: 'plan' }, { id: 'cross' }, { id: 'abnahme' }] },
  { id: 'review', form: 'submenu', views: [{ id: 'stats' }, { id: 'done', needs: ['finished'] }] },
  { id: 'saved', form: 'bare', views: [{ id: 'views', needs: ['views'] }] },
  { id: 'repos', form: 'submenu', views: [{ id: 'repos' }, { id: 'repostatus', machine: true }] },
];

/** What decides which views are offered. */
export interface ViewFacts {
  can: (capability: string) => boolean;
  /** The hub can run machine actions (git, gh): not in the web variant. */
  machine: boolean;
}

/** One entry of the menu: a heading, a view, or a submenu with its views. */
export type ViewMenuEntry =
  | { kind: 'section'; group: ViewGroupId }
  | { kind: 'view'; id: string; disabled: boolean }
  | { kind: 'submenu'; group: ViewGroupId; views: { id: string; disabled: boolean }[] };

function offered(view: ViewEntry, facts: ViewFacts): boolean {
  return (view.needs ?? []).every((c) => facts.can(c)) && (view.machine !== true || facts.machine);
}

/** The entries of the tab with what is offered now. */
export function viewMenu(facts: ViewFacts, groups: readonly ViewGroup[] = VIEW_GROUPS): ViewMenuEntry[] {
  const out: ViewMenuEntry[] = [];
  for (const group of groups) {
    const views = group.views
      .filter((v) => offered(v, facts))
      .map((v) => ({ id: v.id, disabled: v.usable !== undefined && !facts.can(v.usable) }));
    if (views.length === 0) continue;
    if (group.form === 'submenu' && views.length >= 2) {
      out.push({ kind: 'submenu', group: group.id, views });
      continue;
    }
    if (group.form === 'section') out.push({ kind: 'section', group: group.id });
    for (const v of views) out.push({ kind: 'view', id: v.id, disabled: v.disabled });
  }
  return out;
}

/** Whether `view` is a view of this tab (and not of the learning plans or one the page keeps to itself). */
export function isMenuView(view: string, groups: readonly ViewGroup[] = VIEW_GROUPS): boolean {
  return groups.some((g) => g.views.some((v) => v.id === view));
}
