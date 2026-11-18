import { describe, expect, it } from 'vitest';
import { agentJob, agentNews, claimClass, cleanClaimName } from './claims';
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

describe('the claim of an agent of ai-desktop', () => {
  const since = '2026-01-01T00:00:00Z';
  const held = (id: string, job: string, expired = false, extra = {}) =>
    task(id, { title: `T ${id}`, claim: { by: `ai-desktop:${job}`, since, until, expired }, ...extra });

  it('is named ai-desktop:<job>, nothing else', () => {
    expect(agentJob('ai-desktop:3f9c0a1b2c3d4e5f')).toBe('3f9c0a1b2c3d4e5f');
    expect(agentJob('ai-desktop:')).toBeNull();
    expect(agentJob('cdx:3f9c')).toBeNull();
    expect(agentJob('ai-desktop:a b')).toBeNull();
    expect(agentJob(undefined)).toBeNull();
  });

  it('says what an agent did between two lists: took, finished, gave back, ran out', () => {
    const before = [task('a/one', { title: 'T a/one' }), held('a/two', 'j2'), held('a/three', 'j3'), held('a/four', 'j4'), held('a/five', 'j5')];
    const after = [
      held('a/one', 'j1'),
      // a/two is no longer open: finished.
      task('a/three', { title: 'T a/three', status: 'open' }),
      held('a/four', 'j4', true),
      held('a/five', 'j5'),
    ];
    expect(agentNews(before, after)).toEqual([
      { kind: 'claimed', id: 'a/one', title: 'T a/one', job: 'j1' },
      { kind: 'finished', id: 'a/two', title: 'T a/two', job: 'j2' },
      { kind: 'released', id: 'a/three', title: 'T a/three', job: 'j3' },
      { kind: 'expired', id: 'a/four', title: 'T a/four', job: 'j4' },
    ]);
  });

  it('counts a task that stands done in the list as finished, and says nothing of other claims or of an old run-out', () => {
    expect(agentNews([held('a/x', 'j')], [task('a/x', { title: 'T a/x', status: 'done' })])).toEqual([
      { kind: 'finished', id: 'a/x', title: 'T a/x', job: 'j' },
    ]);
    expect(agentNews([theirs], [mine])).toEqual([]);
    expect(agentNews([held('a/y', 'j', true)], [held('a/y', 'j', true)])).toEqual([]);
    expect(agentNews([held('a/z', 'j', true)], [])).toEqual([]);
    // A task that is new in the list and already held by an agent was not taken under the eyes of the page.
    expect(agentNews([], [held('a/new', 'j')])).toEqual([]);
  });
});
