// The keys of the page: the keys every app shares are the kit's (`keymap.json`: Ctrl or Cmd and K for the palette, the
// `g` chord with its timeout); this file adds the targets of the chord, the views of this page.

import { defaultKeymap, withChord, type KeyPress } from 'appkit-ui/keymap';
import type { View } from './app.svelte';

/**
 * `g h` is Today, `g l` the list, `g p` the plan, `g b` the board, `g i` the inbox, `g a` the acceptance, `g s` the
 * statistics, `g v` the saved views, `g r` the repo tiles.
 */
export const keymap = withChord(defaultKeymap, {
  h: 'today',
  l: 'list',
  p: 'plan',
  b: 'board',
  i: 'inbox',
  a: 'abnahme',
  s: 'stats',
  v: 'views',
  r: 'repos',
} satisfies Record<string, View>);

/** The press of a key as the kit reads it. */
export function pressOf(event: KeyboardEvent, typing = false): KeyPress {
  return {
    key: event.key,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    typing,
  };
}

const MODIFIER_KEYS: readonly string[] = ['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock'];

/**
 * For a view that takes letters of its own (h, j, k, l over the days of the calendar): tells the keys of the chord
 * of the page from its own. `g` opens the chord and the next key within its time is the chord's target (`g h` is
 * Today, `g l` the list): the view leaves both alone, so the page sees them. The returned function says whether a
 * keydown is such a key; call it before taking any key.
 */
export function chordWatch(prefix: string = keymap.chord.prefix, timeoutMs: number = keymap.chord.timeoutMs): (event: KeyboardEvent) => boolean {
  let openedAt = Number.NEGATIVE_INFINITY;
  return (event) => {
    if (MODIFIER_KEYS.includes(event.key)) return false;
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    if (event.timeStamp - openedAt < timeoutMs) {
      // The key after the prefix: the page's, whatever it is (a key that is no target ends the chord there too).
      openedAt = Number.NEGATIVE_INFINITY;
      return true;
    }
    if (plain && !event.shiftKey && event.key === prefix) {
      openedAt = event.timeStamp;
      return true;
    }
    return false;
  };
}
