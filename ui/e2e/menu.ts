// The menu bar from the tests: the tab View shows the view that is shown as its `current` ("View, current: Today"), so
// it is found by the start of its name, and a view in a submenu (Time, Review, Repos) is chosen through its parent.
import type { Locator, Page } from '@playwright/test';

/** The submenu a view of the tab View sits in (English and German names), by the name of the view. */
const SUBMENU: Record<string, string> = {
  Calendar: 'Time',
  Timeline: 'Time',
  Reminders: 'Time',
  Kalender: 'Zeit',
  Zeitleiste: 'Zeit',
  Erinnerungen: 'Zeit',
  Statistics: 'Review',
  Finished: 'Review',
  Statistik: 'Auswertung',
  Erledigt: 'Auswertung',
  Repos: 'Repos',
  'Repo status': 'Repos',
  Repostatus: 'Repos',
};

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The tab of the bar named `name`, with or without the word of its `current`. */
export const menuTab = (page: Page, name: string): Locator =>
  page.getByRole('menuitem', { name: new RegExp(`^${escape(name)}(,|$)`) });

/** A submenu of the open menu, with or without the word of its `current`. */
export const submenu = (page: Page, name: string): Locator =>
  page.getByRole('menuitem', { name: new RegExp(`^${escape(name)}(,|$)`) });

/** Open the menu `menu` and choose the view `item`, through its submenu where it has one. */
export async function chooseFromMenu(page: Page, menu: string, item: string): Promise<void> {
  await menuTab(page, menu).click();
  const radio = page.getByRole('menuitemradio', { name: item, exact: true });
  // A view of a submenu is not in the page until the submenu is open; one that stands alone (a submenu with one view
  // left is a plain entry, as Repos in the web variant) is there at once.
  const parent = SUBMENU[item];
  if (parent !== undefined && (await radio.count()) === 0) await submenu(page, parent).click();
  await radio.click();
}

/** Open the submenu Export of the tab View: what the view shown draws, as a file, on the clipboard or on paper. */
export async function openExportMenu(page: Page): Promise<void> {
  await menuTab(page, 'View').click();
  await submenu(page, 'Export').click();
}
