// The time zones of meetings (concept 4.7): a wall time of a zone in this machine's time and back, across the changes
// of summer time. The machine's zone is given (`local`), so the tests do not depend on where they run. The United States
// change on 2026-03-08 and 2026-11-01, Europe on 2026-03-29 and 2026-10-25: between those days New York and Vienna are
// five hours apart, else six.

import { describe, expect, it } from 'vitest';
import type { MeetingEntry } from './contract';
import { instantOf, knownZone, localized, localWall, originalTime, zoneName, zoneWall } from './zones';

const NY = 'America/New_York';
const VIE = 'Europe/Vienna';

const meeting = (fields: Partial<MeetingEntry>): MeetingEntry =>
  ({ id: 'a/m', area: 'a', slug: 'm', title: 'M', tasks: [], tags: [], file: '', valid: true, problems: [], ...fields }) as MeetingEntry;

describe('a wall time of a zone in this machine', () => {
  it('follows both changes of summer time', () => {
    expect(localWall('2026-03-02T08:00', NY, VIE)).toBe('2026-03-02T14:00'); // winter both: six hours
    expect(localWall('2026-03-16T08:00', NY, VIE)).toBe('2026-03-16T13:00'); // New York changed, Vienna not yet: five
    expect(localWall('2026-04-06T08:00', NY, VIE)).toBe('2026-04-06T14:00'); // summer both: six
    expect(localWall('2026-10-26T08:00', NY, VIE)).toBe('2026-10-26T13:00'); // Vienna back already, New York not: five
    expect(localWall('2026-11-02T08:00', NY, VIE)).toBe('2026-11-02T14:00'); // winter both again
  });
  it('reads a skipped time later and a repeated one as the earlier', () => {
    // 02:30 does not exist in New York on 2026-03-08: read as 03:30 summer time (07:30 UTC)
    expect(new Date(instantOf('2026-03-08T02:30', NY)).toISOString()).toBe('2026-03-08T07:30:00.000Z');
    // 01:30 comes twice in New York on 2026-11-01: the first one, still summer time (05:30 UTC)
    expect(new Date(instantOf('2026-11-01T01:30', NY)).toISOString()).toBe('2026-11-01T05:30:00.000Z');
    // Vienna skips 02:00-03:00 on 2026-03-29 and repeats it on 2026-10-25
    expect(new Date(instantOf('2026-03-29T02:30', VIE)).toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(new Date(instantOf('2026-10-25T02:30', VIE)).toISOString()).toBe('2026-10-25T00:30:00.000Z');
    expect(instantOf('no time', VIE)).toBeNaN();
  });
  it('goes back into the zone of the meeting', () => {
    expect(zoneWall('2026-03-16T13:00', NY, VIE)).toBe('2026-03-16T08:00');
    expect(zoneWall('2026-03-02T14:00', NY, VIE)).toBe('2026-03-02T08:00');
    // a round trip keeps the time on every day around the changes
    for (const day of ['2026-03-07', '2026-03-08', '2026-03-09', '2026-03-28', '2026-03-29', '2026-10-25', '2026-11-01']) {
      const at = `${day}T10:00`;
      expect(zoneWall(localWall(at, NY, VIE), NY, VIE)).toBe(at);
    }
  });
  it('leaves a time alone without a zone or with one it does not know', () => {
    expect(localWall('2026-03-16T08:00', undefined, VIE)).toBe('2026-03-16T08:00');
    expect(localWall('2026-03-16T08:00', 'Mars/Base', VIE)).toBe('2026-03-16T08:00');
    expect(zoneWall('2026-03-16T08:00', 'Mars/Base', VIE)).toBe('2026-03-16T08:00');
    expect(knownZone(NY)).toBe(true);
    expect(knownZone('Mars/Base')).toBe(false);
    expect(knownZone(undefined)).toBe(false);
  });
  it('names the place of a zone', () => {
    expect(zoneName(NY)).toBe('New York');
    expect(zoneName('UTC')).toBe('UTC');
    expect(zoneName('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
  });
});

describe('a meeting as this machine sees it', () => {
  it('moves a meeting of another zone and keeps its own time beside it', () => {
    const m = localized(meeting({ date: '2026-03-16', time: '08:00', starts_at: '2026-03-16T08:00', ends_at: '2026-03-16T09:00', tz: NY }), VIE);
    expect(m.starts_at).toBe('2026-03-16T13:00');
    expect(m.ends_at).toBe('2026-03-16T14:00');
    expect(m.date).toBe('2026-03-16');
    expect(m.time).toBe('13:00');
    expect(originalTime(m)).toBe('08:00 New York');
    // once is enough: a second pass changes nothing
    expect(localized(m, VIE)).toBe(m);
  });
  it('leaves the own zone, an all-day meeting and one without a zone alone', () => {
    const own = meeting({ date: '2026-03-16', time: '08:00', starts_at: '2026-03-16T08:00', tz: VIE });
    expect(localized(own, VIE)).toBe(own);
    const allDay = meeting({ date: '2026-03-16', all_day: true, starts_at: '2026-03-16', tz: NY });
    expect(localized(allDay, VIE)).toBe(allDay);
    const plain = meeting({ date: '2026-03-16', time: '08:00', starts_at: '2026-03-16T08:00' });
    expect(localized(plain, VIE)).toBe(plain);
    expect(originalTime(plain)).toBe('');
  });
});
