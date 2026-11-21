import { describe, expect, it } from 'vitest';
import type { Result } from './contract';
import { discardAsk, everyOf, intervalsOf, pathOfRef, roundOf, routinesStarted, waitsFor } from './routine';

describe('a routine as the engine wrote it', () => {
  it('reads one interval or a ladder', () => {
    expect(intervalsOf(undefined)).toEqual([]);
    expect(intervalsOf('8w')).toEqual(['8w']);
    expect(intervalsOf('1w,4w,12w')).toEqual(['1w', '4w', '12w']);
    expect(everyOf('1w,4w,12w')).toBe('1w, 4w, 12w');
  });

  it('tells the round of a ladder, the first when repeat_step is absent, none for a single interval', () => {
    expect(roundOf({ repeat: '1w,4w,12w', repeat_step: 2 })).toEqual({ step: 2, of: 3 });
    expect(roundOf({ repeat: '1w,4w' })).toEqual({ step: 1, of: 2 });
    expect(roundOf({ repeat: '8w', repeat_step: 2 })).toBeNull();
    expect(roundOf({})).toBeNull();
  });

  it('waits for a finish only while it has no due date', () => {
    expect(waitsFor({ repeat_after: 'pub/b' })).toBe('pub/b');
    expect(waitsFor({ repeat_after: 'pub/b', due: '2027-01-05' })).toBeNull();
    expect(waitsFor({})).toBeNull();
    expect(pathOfRef('pub/p#k1')).toBe('pub/p');
    expect(pathOfRef('pub/p')).toBe('pub/p');
  });

  it('asks before discarding a ladder with its intervals and its round', () => {
    expect(discardAsk({ repeat: '1w,4w,12w', repeat_step: 2 })).toEqual({
      key: 'discard.routine.ask_ladder',
      params: { every: '1w, 4w, 12w', step: 2, of: 3 },
    });
    expect(discardAsk({ repeat: '4w' })).toEqual({ key: 'discard.routine.ask', params: { every: '4w' } });
  });

  it('takes the routines started from the entries that went through', () => {
    const result = {
      results: [
        { n: 1, ok: true, routines_started: [{ id: 'a/r', due: '2027-01-05', after: 'a/x' }] },
        { n: 2, ok: false, routines_started: [{ id: 'a/s', due: '2027-01-05', after: 'a/y' }] },
        { n: 3, ok: true },
      ],
    } as unknown as Result;
    expect(routinesStarted(result)).toEqual([{ id: 'a/r', due: '2027-01-05', after: 'a/x' }]);
  });
});
