// The views of the tab Learning plans: which are offered (the page has them, the engine serves them, gamification for
// badges and rewards), in which order and sections, where a link to one not built yet lands, and the palette.
import { describe, expect, it } from 'vitest';
import { make } from './appDouble';
import { translate } from './i18n';
import { isLearnView, LEARN_SECTIONS, learnFallback, learnMenu, missingLearnView } from './learnViews';
import { paletteActions } from './paletteActions';

const ALL_VIEWS = LEARN_SECTIONS.flatMap((s) => s.views.map((v) => v.id));
const caps = (...list: string[]) => (c: string) => list.includes(c);

describe('learnViews', () => {
  it('names the views of the concept in its order and sections', () => {
    expect(LEARN_SECTIONS.map((s) => [s.section, s.views.map((v) => v.id)])).toEqual([
      ['overview', ['learn', 'learnnext']],
      ['paths', ['paths', 'pathmap', 'competences']],
      ['progress', ['learnstats', 'learntime', 'badges', 'rewards']],
      ['knowledge', ['evidence', 'learnnotes']],
    ]);
  });

  it('offers only the views the page has, today the learning paths and the competence map', () => {
    expect(learnMenu({ can: caps('paths', 'path'), gamification: true })).toEqual([{ section: 'paths', views: ['paths', 'pathmap'] }]);
  });

  it('has no tab without the learning paths of the engine', () => {
    expect(learnMenu({ can: caps('path'), gamification: true })).toEqual([]);
    expect(learnMenu({ can: caps('paths'), gamification: true, built: ALL_VIEWS })).toEqual([]);
  });

  it('leaves out a view whose capability is missing, and badges and rewards without their levels, xp or gamification', () => {
    const every = caps('paths', 'path', 'learn_next', 'competences', 'path_hours', 'xp', 'paths_levels', 'path_reward', 'learn_evidence', 'learn_notes');
    expect(learnMenu({ can: every, gamification: true, built: ALL_VIEWS }).flatMap((s) => s.views)).toEqual(ALL_VIEWS);
    const off = learnMenu({ can: every, gamification: false, built: ALL_VIEWS });
    expect(off.find((s) => s.section === 'progress')?.views).toEqual(['learnstats', 'learntime']);
    const noLevels = caps('paths', 'path', 'path_hours', 'xp', 'path_reward');
    expect(learnMenu({ can: noLevels, gamification: true, built: ALL_VIEWS }).find((s) => s.section === 'progress')?.views).toEqual([
      'learnstats',
      'learntime',
    ]);
    const noReward = caps('paths', 'path', 'path_hours', 'xp', 'paths_levels');
    expect(learnMenu({ can: noReward, gamification: true, built: ALL_VIEWS }).find((s) => s.section === 'progress')?.views).toEqual([
      'learnstats',
      'learntime',
      'badges',
    ]);
    const bare = learnMenu({ can: caps('paths', 'path'), gamification: true, built: ALL_VIEWS });
    expect(bare).toEqual([
      { section: 'overview', views: ['learn'] },
      { section: 'paths', views: ['paths', 'pathmap'] },
      { section: 'progress', views: ['learnstats'] },
    ]);
  });

  it('knows a view of the tab, and a link to one the page does not have yet', () => {
    expect(isLearnView('paths')).toBe(true);
    expect(isLearnView('list')).toBe(false);
    expect(missingLearnView('#view=learnnotes')).toBe('learnnotes');
    expect(missingLearnView('#open=a%2Fb&view=learn')).toBe('learn');
    expect(missingLearnView('#view=paths')).toBeNull();
    expect(missingLearnView('#view=list')).toBeNull();
    expect(missingLearnView('#view=nothing')).toBeNull();
    expect(missingLearnView('')).toBeNull();
    expect(missingLearnView('#view=learn', { built: ['learn'] })).toBeNull();
  });

  it('lands on the learning paths until the overview is built, then on the overview', () => {
    expect(learnFallback()).toBe('paths');
    expect(learnFallback({ built: ['paths', 'learn'] })).toBe('learn');
  });
});

describe('App, a link to a view of the tab that is not built yet', () => {
  it('shows the learning paths and says so once the list is there', async () => {
    const { app, hub } = make({ token: 't' });
    hub.capabilities = ['paths', 'path'];
    app.openMissingLearnView('learnnotes');
    expect(app.view).toBe('paths');
    expect(app.toast).toBeNull();
    await app.start(null);
    expect(app.view).toBe('paths');
    expect(app.toast).toMatchObject({
      kind: 'ok',
      text: translate('de', 'learn.missing', { view: 'learnnotes', target: translate('de', 'nav.paths') }),
    });
    app.stop();
  });

  it('in a page that is already shown: the learning paths and the words at once', async () => {
    const { app, hub } = make({ token: 't' });
    hub.capabilities = ['paths', 'path'];
    await app.start(null);
    app.setView('list');
    app.openMissingLearnView('learnstats');
    expect(app.view).toBe('paths');
    expect(app.toast).toMatchObject({
      kind: 'ok',
      text: translate('de', 'learn.missing', { view: 'learnstats', target: translate('de', 'nav.paths') }),
    });
    app.stop();
  });
});

describe('the palette, the views of the tab', () => {
  it('goes to each view that is offered, and to none without the learning paths', () => {
    const { app } = make();
    app.capabilities = ['paths', 'path'];
    const go = paletteActions(app).filter((a) => a.key === 'go.paths');
    expect(go.map((a) => a.label)).toEqual([translate('de', 'palette.go', { view: translate('de', 'nav.paths') })]);
    go[0]!.run();
    expect(app.view).toBe('paths');
    app.capabilities = ['reorder'];
    expect(paletteActions(app).some((a) => a.key === 'go.paths')).toBe(false);
  });
});
