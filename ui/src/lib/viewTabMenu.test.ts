// The tab View: the groups of views in the order of the concept, a submenu from two offered views on, one view plain,
// none missing, the capabilities that leave a view out (or grey it), and the web variant without the repo status.
import { describe, expect, it } from 'vitest';
import { isMenuView, viewMenu, VIEW_GROUPS, type ViewFacts, type ViewGroup } from './viewTabMenu';

const facts = (caps: string[], machine = true): ViewFacts => ({ can: (c) => caps.includes(c), machine });
const shape = (f: ViewFacts, groups?: readonly ViewGroup[]) =>
  viewMenu(f, groups).map((e) =>
    e.kind === 'section' ? `§${e.group}` : e.kind === 'view' ? e.id : `${e.group}▸${e.views.map((v) => v.id).join(',')}`,
  );

describe('viewTabMenu', () => {
  it('orders the groups as the concept does', () => {
    expect(shape(facts(['finished', 'views', 'reorder']))).toEqual([
      '§daily', 'today', 'list', 'board', 'inbox',
      '§plan', 'plan', 'cross', 'abnahme',
      'review▸stats,done',
      'views',
      'repos▸repos,repostatus',
    ]);
  });

  it('turns a submenu into a plain entry with one view and leaves it out with none', () => {
    // No finished view: Review has stats only. No machine actions (web): Repos has the repos only.
    const out = shape(facts([], false));
    expect(out).toContain('stats');
    expect(out).toContain('repos');
    expect(out.some((e) => e.startsWith('review▸') || e.startsWith('repos▸'))).toBe(false);
    // The saved views need the engine: without them no entry at all.
    expect(out).not.toContain('views');
    const none: ViewGroup[] = [{ id: 'review', form: 'submenu', views: [{ id: 'x', needs: ['nope'] }] }];
    expect(shape(facts([]), none)).toEqual([]);
  });

  it('keeps the board in the menu greyed without reorder, as it was', () => {
    const board = viewMenu(facts([]))
      .flatMap((e) => (e.kind === 'view' ? [e] : []))
      .find((e) => e.id === 'board');
    expect(board?.disabled).toBe(true);
    expect(viewMenu(facts(['reorder'])).find((e) => e.kind === 'view' && e.id === 'board')).toMatchObject({ disabled: false });
  });

  it('knows which views belong to the tab', () => {
    expect(isMenuView('stats')).toBe(true);
    expect(isMenuView('calendar')).toBe(false);
    expect(isMenuView('learn')).toBe(false);
    expect(VIEW_GROUPS.flatMap((g) => g.views.map((v) => v.id))).toHaveLength(12);
  });
});
