import { describe, expect, it } from 'vitest';
import { claimClass, cleanClaimName } from './claims';
import { activeFilters, applyFilter, filterOfText, filterText, freshFilter, without } from './filter';
import { task } from './fixtures';
import { selectOfFilter } from './views';

const until = '2099-01-01T00:00:00Z';
const mine = task('a/mine', { claim: { by: 'me@pc', since: '2026-01-01T00:00:00Z', until, expired: false } });
const theirs = task('a/theirs', { claim: { by: 'cdx:abc', since: '2026-01-01T00:00:00Z', until, expired: false } });
const ran = task('a/ran', { claim: { by: 'me@pc', since: '2026-01-01T00:00:00Z', until: '2026-01-02T00:00:00Z', expired: true } });
const free = task('a/free');
const all = [mine, theirs, ran, free];
const ids = (tasks: { id: string }[]) => tasks.map((t) => t.id);

describe('the class of a claim', () => {
  it('is own for this name, foreign for another, none when free or run out (the engine says so)', () => {
    expect(claimClass(mine, 'me@pc')).toBe('own');
    expect(claimClass(theirs, 'me@pc')).toBe('foreign');
    expect(claimClass(ran, 'me@pc')).toBe('none');
    expect(claimClass(free, 'me@pc')).toBe('none');
  });

  it('without a name every valid claim is somebody else\'s', () => {
    expect(claimClass(mine, '')).toBe('foreign');
  });

  it('takes a name as the engine does, and nothing else', () => {
    expect(cleanClaimName('  me@pc ')).toBe('me@pc');
    expect(cleanClaimName('cdx:3f9a1c7e')).toBe('cdx:3f9a1c7e');
    expect(cleanClaimName('two words')).toBe('');
    expect(cleanClaimName('a'.repeat(65))).toBe('');
  });
});

describe('the claim filter', () => {
  it('keeps the tasks of the chosen classes, judged with the name the app sets', () => {
    const f = { ...freshFilter(), claims: ['own' as const], claimant: 'me@pc' };
    expect(ids(applyFilter(all, f))).toEqual(['a/mine']);
    expect(ids(applyFilter(all, { ...f, claims: ['foreign'] }))).toEqual(['a/theirs']);
    expect(ids(applyFilter(all, { ...f, claims: ['none'] }))).toEqual(['a/ran', 'a/free']);
    expect(ids(applyFilter(all, { ...f, claims: [] }))).toEqual(ids(all));
  });

  it('is a chip that is taken off, kept as text without the name, and read back tolerantly', () => {
    const f = { ...freshFilter(), claims: ['foreign' as const, 'none' as const], claimant: 'me@pc' };
    expect(activeFilters(f).filter((a) => a.kind === 'claim')).toEqual([
      { kind: 'claim', value: 'foreign' },
      { kind: 'claim', value: 'none' },
    ]);
    expect(without(f, { kind: 'claim', value: 'none' }).claims).toEqual(['foreign']);
    const text = filterText(f);
    expect(text).not.toContain('me@pc');
    expect(filterOfText(text).claims).toEqual(['foreign', 'none']);
    expect(filterOfText('{"claims":["foreign","mood"]}').claims).toEqual(['foreign']);
  });

  it('is no part of a saved view: saving says it was left out', () => {
    expect(selectOfFilter({ ...freshFilter(), claims: ['own'] }).dropped).toBe(true);
    expect(selectOfFilter(freshFilter()).dropped).toBe(false);
  });
});
