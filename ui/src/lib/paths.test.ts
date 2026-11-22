// The learning paths as the view draws them (lib/paths.ts): only the turning of the engine's list into what is shown
// and of a choice into the operation; no rule of the engine is tested (or made) here.
import { describe, expect, it } from 'vitest';
import {
  cleanNote,
  cleanReason,
  clickedState,
  indicesOf,
  isMarkable,
  labelText,
  needsReason,
  noteOp,
  openableLink,
  parentIndices,
  pointIds,
  pointRef,
  progressParts,
  promoteOp,
  parseXp,
  REASON_MAX,
  rewardOp,
  stateOp,
  closesSafety,
  visiblePoints,
  XP_MAX,
  xpOp,
  xpPercent,
} from './paths';

describe('paths: XP and rewards', () => {
  it('reads the XP field: a whole number up to the most the engine takes, empty for none, nothing else', () => {
    expect(parseXp(' 25 ')).toBe(25);
    expect(parseXp('0')).toBe(0);
    expect(parseXp(String(XP_MAX))).toBe(XP_MAX);
    expect(parseXp('')).toBe('clear');
    expect(parseXp('   ')).toBe('clear');
    for (const bad of ['100001', '-1', '2.5', '1e3', 'abc', '1 2', '0x10', '1234567']) expect(parseXp(bad), bad).toBeNull();
  });
  it('writes the XP of a point, or takes them away, on the version read', () => {
    expect(xpOp('lib/lua', 'e1', { key: 'meta', index: 3 }, 35)).toEqual({ op: 'node_set', id: 'lib/lua', point: 'meta', xp: 35, if_match: 'e1' });
    expect(xpOp('lib/lua', undefined, { index: 4 }, 'clear')).toEqual({ op: 'node_set', id: 'lib/lua', point: '#4', xp_clear: true });
  });
  it('grants the reward of a level by its number or done', () => {
    expect(rewardOp('lib/lua', 'e1', '2', true)).toEqual({ op: 'path_reward', id: 'lib/lua', level: '2', given: true, if_match: 'e1' });
    expect(rewardOp('lib/lua', undefined, 'done', false)).toEqual({ op: 'path_reward', id: 'lib/lua', level: 'done', given: false });
  });
  it('fills the bar by the share earned, never past its ends', () => {
    expect(xpPercent({ earned: 20, possible: 90 })).toBe(22);
    expect(xpPercent({ earned: 0, possible: 0 })).toBe(0);
    expect(xpPercent({ earned: 120, possible: 100 })).toBe(100);
    expect(xpPercent(undefined)).toBe(0);
  });
});

const tree = [
  { index: 1, children: 2 },
  { index: 2, parent: 1, children: 1 },
  { index: 3, parent: 2, children: 0 },
  { index: 4, parent: 1, children: 0 },
  { index: 5, children: 0 },
];

describe('paths: the tree', () => {
  it('hides every point below a folded parent, however deep, and keeps the rest in document order', () => {
    expect(visiblePoints(tree, new Set()).map((n) => n.index)).toEqual([1, 2, 3, 4, 5]);
    expect(visiblePoints(tree, new Set([2])).map((n) => n.index)).toEqual([1, 2, 4, 5]);
    // A folded root takes its grandchildren with it, even where their own parent is unfolded.
    expect(visiblePoints(tree, new Set([1])).map((n) => n.index)).toEqual([1, 5]);
  });
  it('folds all: the parents only', () => {
    expect(parentIndices(tree)).toEqual([1, 2]);
  });
  it('a point is named by its key, or by #index without one', () => {
    expect(pointRef({ key: 'syntax', index: 2 })).toBe('syntax');
    expect(pointRef({ index: 7 })).toBe('#7');
    expect(pointRef({ key: '', index: 7 })).toBe('#7');
  });
  it('names each point so that a point added above does not rename the others (key, else label and its count)', () => {
    const before = [
      { index: 1, key: 'lua', label: 'Lua' },
      { index: 2, label: 'Read' },
      { index: 3, label: 'Read' },
    ];
    const after = [{ index: 1, label: 'New' }, ...before.map((n) => ({ ...n, index: n.index + 1 }))];
    const a = pointIds(before);
    const b = pointIds(after);
    expect([...a.values()]).toEqual(['key:lua', 'label:0:Read', 'label:1:Read']);
    expect([2, 3, 4].map((i) => b.get(i))).toEqual([...a.values()]);
    // Held by name, the folded parent is found again at its new index; a name no point has any more is dropped.
    expect([...indicesOf(b, new Set(['key:lua', 'label:0:Gone']))]).toEqual([2]);
  });
  it('only a leaf that is not promoted and has a known state has a mark to click', () => {
    expect(isMarkable({ children: 0, state: 'open' })).toBe(true);
    expect(isMarkable({ children: 2, state: 'open' })).toBe(false);
    expect(isMarkable({ children: 0, state: 'open', promoted: 'pub/t' })).toBe(false);
    expect(isMarkable({ children: 0 })).toBe(false);
  });
});

describe('paths: labels and links', () => {
  it('a label that is one link shows its text, an image its alternative text or file name, anything else as written', () => {
    expect(labelText({ label: '[Manual](https://www.lua.org/manual/5.4/)' })).toBe('Manual');
    expect(labelText({ label: '![Syntax](assets/images/lua.svg)' })).toBe('Syntax');
    expect(labelText({ label: '![](assets/images/lua.svg)' })).toBe('lua.svg');
    expect(labelText({ label: '  Metatables <b>x</b> ' })).toBe('Metatables <b>x</b>');
  });
  it('opens http and https only', () => {
    expect(openableLink('https://www.lua.org/pil/')).toBe('https://www.lua.org/pil/');
    expect(openableLink('http://example.org')).toBe('http://example.org/');
    expect(openableLink('javascript:alert(1)')).toBeNull();
    expect(openableLink('file:///C:/x')).toBeNull();
    expect(openableLink('assets/x.svg')).toBeNull();
    expect(openableLink(undefined)).toBeNull();
  });
});

describe('paths: progress', () => {
  it('the engine counts apart, the bar leaves out empty parts and shares by the leaves', () => {
    const parts = progressParts({ learned: 1, seen: 1, dropped: 0, open: 2, blocked: 1, total: 4 });
    expect(parts).toEqual([
      { kind: 'learned', n: 1, share: 0.25 },
      { kind: 'seen', n: 1, share: 0.25 },
      { kind: 'open', n: 2, share: 0.5 },
    ]);
    expect(progressParts({ learned: 0, seen: 0, dropped: 0, open: 0, blocked: 0, total: 0 })).toEqual([]);
  });
});

describe('paths: what is sent', () => {
  it('a click ticks an open point learned and sets any other open again', () => {
    expect(clickedState('open')).toBe('learned');
    expect(clickedState('learned')).toBe('open');
    expect(clickedState('seen')).toBe('open');
    expect(clickedState('blocked')).toBe('open');
  });
  it('seen, dropped and blocked ask for a reason first, learned and open do not', () => {
    expect(['open', 'learned', 'seen', 'dropped', 'blocked'].filter((s) => needsReason(s as never))).toEqual(['seen', 'dropped', 'blocked']);
  });
  it('a reason is one line, trimmed and cut; nothing left is none', () => {
    expect(cleanReason('  nur\nKap. 1\t gebraucht ')).toBe('nur Kap. 1 gebraucht');
    expect(cleanReason(' \n ')).toBeNull();
    expect([...(cleanReason('x'.repeat(REASON_MAX + 20)) ?? '')].length).toBe(REASON_MAX);
  });
  it('a note keeps its lines and loses carriage returns and control characters', () => {
    expect(cleanNote(' a\r\nb\rc\u0007 ')).toBe('a\nb\nc');
  });
  it('the operations name the point, the version read, and only what was chosen', () => {
    expect(stateOp('lib/lua', 'e1', { key: 'pil', index: 4 }, 'seen', 'nur Kap. 1')).toEqual({
      op: 'node_set',
      id: 'lib/lua',
      point: 'pil',
      state: 'seen',
      reason: 'nur Kap. 1',
      if_match: 'e1',
    });
    expect(stateOp('lib/lua', undefined, { index: 4 }, 'learned')).toEqual({ op: 'node_set', id: 'lib/lua', point: '#4', state: 'learned' });
    expect(stateOp('lib/lua', 'e1', { key: 'drv', index: 2 }, 'learned', undefined, true)).toEqual({
      op: 'node_set',
      id: 'lib/lua',
      point: 'drv',
      state: 'learned',
      ack: true,
      if_match: 'e1',
    });
    // Closing (learned, seen) a point under {safety} wants the yes; dropping, blocking, opening it does not.
    expect(closesSafety({ safety: true }, 'learned')).toBe(true);
    expect(closesSafety({ safety: true }, 'seen')).toBe(true);
    expect(closesSafety({ safety: true }, 'dropped')).toBe(false);
    expect(closesSafety({ safety: true }, 'open')).toBe(false);
    expect(closesSafety({}, 'learned')).toBe(false);
    expect(noteOp('lib/lua', 'e1', { key: 'pil', index: 4 }, '')).toEqual({ op: 'node_set', id: 'lib/lua', point: 'pil', note: '', if_match: 'e1' });
    expect(promoteOp('lib/lua', 'e1', { key: 'cc', index: 6 })).toEqual({ op: 'promote', container: 'lib/lua', point: 'cc', if_match: 'e1' });
  });
});
