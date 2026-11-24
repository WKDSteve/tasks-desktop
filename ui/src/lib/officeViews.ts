// The tab "Office" of the menu bar: the views about appointments, in sections, as the concept orders them (tasks-vault,
// ALL/Reiter-Buero-Termine-und-Kontakte-Konzept-2026-11-23.md, wave 1): Dates (meetings, calendar, timeline) and
// Remind (reminders), and the action "New meeting" under Create (it is not a view; the page adds it when the engine
// makes meetings). The sections are data, like `viewTabMenu.ts` and `learnViews.ts`. A view the engine cannot serve is
// left out, not greyed; a section without a view is left out. The contacts come with wave 3 and are not here.

export type OfficeSection = 'dates' | 'remind';

export interface OfficeView {
  /** The name of the view in `#view=<id>` and in `View`. */
  id: string;
  /** The capabilities of the engine the view needs, all of them; without them the view is left out. */
  needs: readonly string[];
}

/** The views of the tab in the order of the menu. */
export const OFFICE_SECTIONS: readonly { section: OfficeSection; views: readonly OfficeView[] }[] = [
  {
    section: 'dates',
    views: [
      { id: 'meetings', needs: ['meetings', 'meeting'] },
      { id: 'calendar', needs: [] },
      { id: 'timeline', needs: [] },
    ],
  },
  { section: 'remind', views: [{ id: 'reminders', needs: [] }] },
];

const ALL: readonly OfficeView[] = OFFICE_SECTIONS.flatMap((s) => s.views);

/** Whether `view` is a view of the tab (shown in it, not in the menu View). */
export function isOfficeView(view: string): boolean {
  return ALL.some((v) => v.id === view);
}

/** The sections of the tab with the views the engine serves now; a section without one is left out. */
export function officeMenu(can: (capability: string) => boolean): { section: OfficeSection; views: string[] }[] {
  return OFFICE_SECTIONS.map(({ section, views }) => ({
    section,
    views: views.filter((v) => v.needs.every((c) => can(c))).map((v) => v.id),
  })).filter((s) => s.views.length > 0);
}
