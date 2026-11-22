import { describe, expect, it } from 'vitest';
import { cardKey, hoursText, ofProject, projectsOf, stepNeedsAck, stepNeedsReason, stepOp } from './learnNext';
import { isLearnNextKey, learnNextText } from './learnNextTexts';

const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({ key: k, altKey: false, ctrlKey: false, metaKey: false, ...mods });

describe('the next learning step', () => {
  it('marks a point by its key, or #index without one; a reason and ack only when given', () => {
    expect(stepOp('lib/lua', { key: 'meta', index: 3 }, 'learned')).toEqual({ op: 'node_set', id: 'lib/lua', point: 'meta', state: 'learned' });
    expect(stepOp('lib/lua', { index: 7 }, 'seen', 'skimmed', true)).toEqual({
      op: 'node_set',
      id: 'lib/lua',
      point: '#7',
      state: 'seen',
      reason: 'skimmed',
      ack: true,
    });
  });

  it('asks a reason for seen and does-not-apply, and the confirmation only for closing a safety point', () => {
    expect(stepNeedsReason('learned')).toBe(false);
    expect(stepNeedsReason('seen')).toBe(true);
    expect(stepNeedsReason('dropped')).toBe(true);
    expect(stepNeedsAck({ safety: true }, 'learned')).toBe(true);
    expect(stepNeedsAck({ safety: true }, 'seen')).toBe(true);
    expect(stepNeedsAck({ safety: true }, 'dropped')).toBe(false);
    expect(stepNeedsAck({}, 'learned')).toBe(false);
  });

  it('shows the planned hours as one number or a span', () => {
    expect(hoursText({})).toBeNull();
    expect(hoursText({ h_min: 2, h_max: 2 })).toBe('2');
    expect(hoursText({ h_min: 2, h_max: 3.5 })).toBe('2–3.5');
    expect(hoursText({ h_max: 4 })).toBe('4');
  });

  it('filters by project in the engine order and lists the projects once', () => {
    const items = [{ project: 'a/p' }, {}, { project: 'a/o' }, { project: 'a/p' }];
    expect(projectsOf(items)).toEqual(['a/o', 'a/p']);
    expect(ofProject(items, '')).toEqual(items);
    expect(ofProject(items, 'a/p')).toEqual([items[0], items[3]]);
  });

  it('knows l, s, n and Enter, never with a modifier', () => {
    expect(cardKey(key('l'))).toBe('learned');
    expect(cardKey(key('s'))).toBe('seen');
    expect(cardKey(key('n'))).toBe('dropped');
    expect(cardKey(key('Enter'))).toBe('open');
    expect(cardKey(key('L'))).toBeNull();
    expect(cardKey(key('l', { ctrlKey: true }))).toBeNull();
    expect(cardKey(key('s', { metaKey: true }))).toBeNull();
    expect(cardKey(key('x'))).toBeNull();
  });

  it('has its words in both languages, with the values put in', () => {
    expect(isLearnNextKey('learnnext.title')).toBe(true);
    expect(isLearnNextKey('nav.paths')).toBe(false);
    expect(learnNextText('de', 'learnnext.hours', { h: '2–3' })).toBe('2–3 h geplant');
    expect(learnNextText('en', 'learnnext.after', { n: 2 })).toBe('After that (2)');
  });
});
