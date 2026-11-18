import { matches } from 'appkit-ui/keymap';
import { describe, expect, it } from 'vitest';
import { chordWatch, keymap, pressOf } from './keymap';

// The tests run without a DOM: an event is the few fields the page reads.
const key = (init: Partial<KeyboardEvent> & { key: string }) =>
  ({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init }) as KeyboardEvent;

describe('the keys of the page', () => {
  it('goes to the views with g and a letter, as the page always did', () => {
    expect(keymap.chord.prefix).toBe('g');
    expect(keymap.chord.targets).toEqual({ h: 'today', l: 'list', p: 'plan', b: 'board', i: 'inbox', a: 'abnahme', s: 'stats', v: 'views', r: 'repos' });
    expect(keymap.chord.timeoutMs).toBe(1500);
  });

  it('opens the palette with Ctrl or Cmd and K, and with nothing else', () => {
    expect(matches(keymap.palette, pressOf(key({ key: 'k', ctrlKey: true })))).toBe(true);
    expect(matches(keymap.palette, pressOf(key({ key: 'K', metaKey: true })))).toBe(true);
    expect(matches(keymap.palette, pressOf(key({ key: 'k' })))).toBe(false);
    expect(matches(keymap.palette, pressOf(key({ key: 'k', ctrlKey: true, altKey: true })))).toBe(false);
  });
});

describe('the chord seen from a view with letters of its own', () => {
  const press = (key: string, at: number, init: Partial<KeyboardEvent> = {}): KeyboardEvent =>
    ({ key, timeStamp: at, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init }) as KeyboardEvent;

  it('leaves g and the next key to the page, and takes the keys after that', () => {
    const ofChord = chordWatch('g', 1500);
    expect(ofChord(press('l', 0))).toBe(false);
    expect(ofChord(press('g', 100))).toBe(true);
    expect(ofChord(press('l', 300))).toBe(true);
    expect(ofChord(press('l', 400)), 'the chord took one key').toBe(false);
  });

  it('lets the chord run out, and does not count a modifier as its key', () => {
    const ofChord = chordWatch('g', 1500);
    expect(ofChord(press('g', 0))).toBe(true);
    expect(ofChord(press('Shift', 100))).toBe(false);
    expect(ofChord(press('h', 200)), 'still the key of the chord').toBe(true);
    expect(ofChord(press('g', 1000))).toBe(true);
    expect(ofChord(press('h', 2600)), 'too late: a step of the view').toBe(false);
    // Ctrl+g or Shift+g open no chord.
    expect(ofChord(press('g', 5000, { ctrlKey: true }))).toBe(false);
    expect(ofChord(press('G', 5100, { shiftKey: true }))).toBe(false);
    expect(ofChord(press('h', 5200))).toBe(false);
  });
});
