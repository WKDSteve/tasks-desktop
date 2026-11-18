import { describe, expect, it } from 'vitest';
import { make } from './appDouble';
import { translate } from './i18n';
import {
  DEFAULT_ROW_ACTIONS,
  ROW_ACTIONS,
  barShown,
  offeredRowActions,
  parseRowActions,
  serializeRowActions,
  toggleRowAction,
  type RowActionPrefs,
} from './rowActions';
import { rowActionsMenuItems } from './rowActionsMenu';

const all: RowActionPrefs = { shown: ROW_ACTIONS, always: false };
const caps = { move: true, write: true, machine: true };

describe('the actions at the end of a row: the choice', () => {
  it('comes with the one action the rows had before, on the row under the pointer', () => {
    expect(DEFAULT_ROW_ACTIONS).toEqual({ shown: ['move'], always: false });
    expect(parseRowActions(null)).toEqual(DEFAULT_ROW_ACTIONS);
  });

  it('is kept as it was chosen, in the order of the bar, and an emptied bar stays empty', () => {
    const chosen = toggleRowAction(toggleRowAction(DEFAULT_ROW_ACTIONS, 'copy'), 'status');
    expect(chosen.shown).toEqual(['move', 'status', 'copy']);
    expect(parseRowActions(serializeRowActions({ ...chosen, always: true }))).toEqual({ shown: ['move', 'status', 'copy'], always: true });
    const none = toggleRowAction(DEFAULT_ROW_ACTIONS, 'move');
    expect(parseRowActions(serializeRowActions(none))).toEqual({ shown: [], always: false });
  });

  it('reads nothing it does not know: a broken text is the default, an unknown or doubled action is left out', () => {
    expect(parseRowActions('not json')).toEqual(DEFAULT_ROW_ACTIONS);
    expect(parseRowActions('null')).toEqual(DEFAULT_ROW_ACTIONS);
    expect(parseRowActions('{"shown":"move"}')).toEqual(DEFAULT_ROW_ACTIONS);
    expect(parseRowActions('{"shown":["editor","explode","move","move"],"always":"yes"}')).toEqual({ shown: ['move', 'editor'], always: false });
  });
});

describe('the actions at the end of a row: what a task is offered', () => {
  it('offers the chosen actions the page can do', () => {
    expect(offeredRowActions(all, caps, { status: 'open' })).toEqual([...ROW_ACTIONS]);
    expect(offeredRowActions(DEFAULT_ROW_ACTIONS, caps, { status: 'open' })).toEqual(['move']);
    expect(offeredRowActions(all, { move: false, write: true, machine: false }, { status: 'open' })).toEqual(['status', 'prio', 'finish', 'copy']);
    expect(offeredRowActions(all, { move: false, write: false, machine: false }, { status: 'open' })).toEqual(['copy']);
  });

  it('offers a finished task nothing that would change it', () => {
    expect(offeredRowActions(all, caps, { status: 'done' })).toEqual(['copy', 'editor']);
  });

  it('draws the bar without the pointer only on the selected row, or on every row when that is switched on', () => {
    expect(barShown(DEFAULT_ROW_ACTIONS, false)).toBe(false);
    expect(barShown(DEFAULT_ROW_ACTIONS, true)).toBe(true);
    expect(barShown({ ...DEFAULT_ROW_ACTIONS, always: true }, false)).toBe(true);
  });
});

describe('the actions at the end of a row: the page', () => {
  it('keeps the choice in the browser and gives it back with the factory settings', () => {
    const m = make({ token: 't' });
    expect(m.app.rowActions).toEqual(DEFAULT_ROW_ACTIONS);
    m.app.setRowActions({ shown: ['move', 'finish'], always: true });
    const again = make({ token: 't', prefs: m.prefs });
    expect(again.app.rowActions).toEqual({ shown: ['move', 'finish'], always: true });
    again.app.resetToFactory();
    expect(again.app.rowActions).toEqual(DEFAULT_ROW_ACTIONS);
    expect(make({ token: 't', prefs: again.prefs }).app.rowActions).toEqual(DEFAULT_ROW_ACTIONS);
    m.app.stop();
  });

  it('has a switch for every action in the menu Options, and one to show them always', () => {
    const m = make({ token: 't' });
    const checks = () => rowActionsMenuItems(m.app).filter((item) => item.kind === 'check');
    expect(checks().map((item) => [item.label, item.checked])).toEqual([
      ...ROW_ACTIONS.map((action) => [translate(m.app.lang, `menu.rowact.${action}`), action === 'move']),
      [translate(m.app.lang, 'menu.rowact.always'), false],
    ]);
    checks()[3]?.onselect();
    checks()[6]?.onselect();
    expect(m.app.rowActions).toEqual({ shown: ['move', 'finish'], always: true });
    // Switched off again: nothing is forced, the bar can be emptied.
    checks()[0]?.onselect();
    checks()[3]?.onselect();
    expect(m.app.rowActions).toEqual({ shown: [], always: true });
    m.app.stop();
  });
});
