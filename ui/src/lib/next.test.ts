import { describe, expect, it } from 'vitest';
import { effortWords, laterWords } from './next';

describe('the next task of the overview', () => {
  it('says the effort as words, and "no effort" instead of a sign', () => {
    expect(effortWords('en', 'M')).toBe('effort M');
    expect(effortWords('de', 'M')).toBe('Aufwand M');
    expect(effortWords('en', undefined)).toBe('no effort');
    expect(effortWords('de', undefined)).toBe('kein Aufwand');
    expect(effortWords('en', '')).not.toContain('?');
  });
});

describe('the tasks the engine leaves for later', () => {
  it('are said with their count, in both languages', () => {
    expect(laterWords('en', 2)).toBe('Later: 2 ready task(s) whose start day has not come yet.');
    expect(laterWords('de', 1)).toBe('Später: 1 bereite Task(s), deren Beginn noch nicht da ist.');
  });

  it('are not said when there are none (the engine leaves the count out then)', () => {
    expect(laterWords('en', undefined)).toBeNull();
    expect(laterWords('en', 0)).toBeNull();
  });
});
