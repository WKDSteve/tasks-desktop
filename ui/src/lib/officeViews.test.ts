// The tab Office: the sections in the order of the concept, a view the engine cannot serve left out (not greyed), a
// section without a view left out, and the views that moved out of the tab View.
import { describe, expect, it } from 'vitest';
import { isMenuView } from './viewTabMenu';
import { isOfficeView, officeMenu, OFFICE_SECTIONS } from './officeViews';

const can = (caps: string[]) => (c: string) => caps.includes(c);

describe('officeViews', () => {
  it('orders Dates before Remind, with the meetings first', () => {
    expect(officeMenu(can(['meetings', 'meeting']))).toEqual([
      { section: 'dates', views: ['meetings', 'calendar', 'timeline'] },
      { section: 'remind', views: ['reminders'] },
    ]);
  });

  it('puts the contacts under People, after Remind, only when the engine reads them', () => {
    expect(officeMenu(can(['meetings', 'meeting', 'contacts', 'contact'])).map((s) => [s.section, s.views])).toEqual([
      ['dates', ['meetings', 'calendar', 'timeline']],
      ['remind', ['reminders']],
      ['people', ['contacts']],
    ]);
    // both documents are needed; one alone is no view
    expect(officeMenu(can(['contacts'])).map((s) => s.section)).toEqual(['dates', 'remind']);
    expect(isOfficeView('contacts')).toBe(true);
    expect(isMenuView('contacts')).toBe(false);
  });

  it('leaves the meetings out, not greyed, when the engine cannot read them', () => {
    expect(officeMenu(can([]))[0]).toEqual({ section: 'dates', views: ['calendar', 'timeline'] });
    expect(officeMenu(can(['meetings']))[0]?.views).not.toContain('meetings');
  });

  it('leaves a section out that has no view', () => {
    expect(officeMenu(can([])).map((s) => s.section)).toEqual(['dates', 'remind']);
    const none = OFFICE_SECTIONS.map((s) => ({ ...s, views: [{ id: 'x', needs: ['nope'] }] }));
    expect(none.every((s) => s.views.every((v) => !can([])(v.needs[0]!)))).toBe(true);
  });

  it('owns the views that left the tab View', () => {
    for (const id of ['meetings', 'calendar', 'timeline', 'reminders']) {
      expect(isOfficeView(id)).toBe(true);
      expect(isMenuView(id)).toBe(false);
    }
    expect(isOfficeView('stats')).toBe(false);
  });
});
