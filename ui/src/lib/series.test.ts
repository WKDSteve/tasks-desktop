import { describe, expect, it } from 'vitest';
import type { MeetingEntry } from './contract';
import { emptyMeetingForm, meetingFields } from './meetings';
import { exceptDays, foldSeries, repeatLabel, seriesNote, seriesPatch, withExcept } from './series';

/** The instant of a wall time of this machine (the tests run in its zone). */
const at = (wall: string): number => new Date(`${wall}:00`).getTime();

type Entry = Pick<MeetingEntry, 'id' | 'series' | 'virtual' | 'starts_at' | 'ends_at' | 'all_day' | 'tz'>;
const occurrence = (day: string, virtual: boolean, series = 'a/sync'): Entry => ({
  id: `${series}-${day}`,
  series,
  ...(virtual ? { virtual: true as const } : {}),
  starts_at: `${day}T10:00`,
  ends_at: `${day}T11:00`,
  all_day: false,
});

describe('a series of meetings', () => {
  it('goes into meeting_new only when it repeats, with its end and its exceptions', () => {
    const form = { ...emptyMeetingForm('a', '2026-11-19T09:40'), title: 'Sync' };
    expect(meetingFields(form)).not.toHaveProperty('repeat');
    // an end or exceptions without an interval are no series: nothing of them is sent
    expect(meetingFields({ ...form, repeat: '', repeatUntil: '2027-01-01', except: ['2026-12-24'] })).not.toHaveProperty('repeat_until');
    expect(meetingFields({ ...form, repeat: '1w' })).toMatchObject({ repeat: '1w' });
    expect(meetingFields({ ...form, repeat: '1w' })).not.toHaveProperty('except');
    expect(meetingFields({ ...form, repeat: '2w', repeatUntil: '2027-03-31', except: ['2026-12-24'] })).toMatchObject({
      repeat: '2w',
      repeat_until: '2027-03-31',
      except: ['2026-12-24'],
    });
  });

  it('reads the exceptions typed as days, each once and in order, and adds a day to them', () => {
    expect(exceptDays(' 2026-12-31, 2026-12-24;2026-12-24  2027-01-07 ')).toEqual(['2026-12-24', '2026-12-31', '2027-01-07']);
    expect(exceptDays('')).toEqual([]);
    expect(withExcept(undefined, '2026-12-24')).toEqual(['2026-12-24']);
    expect(withExcept(['2026-12-31', '2026-12-24'], '2026-12-24')).toEqual(['2026-12-24', '2026-12-31']);
    expect(withExcept(['2026-12-31'], '2026-12-03')).toEqual(['2026-12-03', '2026-12-31']);
  });

  it('patches of a series only what was changed, a value cleared as null', () => {
    const read = { repeat: '1w', except: ['2026-12-24'] };
    expect(seriesPatch(read, { repeat: '1w', until: '', except: '2026-12-24' })).toEqual({});
    expect(seriesPatch({ repeat: '1w' }, { repeat: '1w', until: '', except: '' })).toEqual({});
    expect(seriesPatch(read, { repeat: '2w', until: '2027-06-30', except: '2026-12-31, 2026-12-24' })).toEqual({
      repeat: '2w',
      repeat_until: '2027-06-30',
      except: ['2026-12-24', '2026-12-31'],
    });
    expect(seriesPatch({ ...read, repeat_until: '2027-01-01' }, { repeat: '', until: '', except: '' })).toEqual({
      repeat: null,
      repeat_until: null,
      except: null,
    });
  });

  it('names an interval in words, any other as the engine wrote it, and tells an occurrence without a file', () => {
    expect(repeatLabel('de', '1w')).toBe('wöchentlich');
    expect(repeatLabel('en', '2w')).toBe('every 2 weeks');
    expect(repeatLabel('en', '10d')).toBe('10d');
    expect(repeatLabel('de', '')).toBe('keine');
    expect(seriesNote('en', { series: undefined })).toBe('');
    expect(seriesNote('en', { series: 'a/sync' })).toBe('Series');
    expect(seriesNote('de', { series: 'a/sync', virtual: true })).toBe('Serie, noch ohne Datei');
  });

  it('lists of a series the occurrences with a file and the next one without, not every week of all time', () => {
    const now = at('2026-11-20T12:00');
    const items = [
      occurrence('2026-11-06', true),
      occurrence('2026-11-13', false),
      occurrence('2026-11-20', true), // over at 11:00: past, nothing in it
      occurrence('2026-11-27', true),
      occurrence('2026-12-04', true),
      occurrence('2026-12-11', false), // moved or prepared: it has a file
      occurrence('2026-11-27', true, 'a/one'),
      { id: 'a/plain', starts_at: '2026-11-21T09:00', all_day: false },
    ];
    expect(foldSeries(items, now).map((m) => m.id)).toEqual(['a/sync-2026-11-13', 'a/sync-2026-11-27', 'a/sync-2026-12-11', 'a/one-2026-11-27', 'a/plain']);
    // one going on now is the next one
    expect(foldSeries([occurrence('2026-11-20', true), occurrence('2026-11-27', true)], at('2026-11-20T10:30')).map((m) => m.id)).toEqual([
      'a/sync-2026-11-20',
    ]);
  });
});
