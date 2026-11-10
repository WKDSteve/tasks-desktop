import { describe, expect, it } from 'vitest';
import { applyOrder, orderOf, parseSort, SORT_GROUPS, SORTS, sortStamp } from './sort';
import { translate, type Key } from './i18n';
import { task } from './fixtures';
import type { TaskEntry } from './contract';

const ids = (tasks: { id: string }[]) => tasks.map((t) => t.id);

describe('sort', () => {
  it('knows our words and falls back to the plan order for anything else', () => {
    expect(parseSort('roi')).toBe('roi');
    expect(parseSort('prio-effort')).toBe('prio-effort');
    for (const bad of ['', 'ROI', 'sideways', null, undefined, 3]) expect(parseSort(bad)).toBe('default');
  });

  it('lays the tasks along the order of the engine', () => {
    const tasks = [task('a/one'), task('a/two'), task('a/three')];
    expect(ids(applyOrder(tasks, orderOf(['a/three', 'a/one', 'a/two'])))).toEqual(['a/three', 'a/one', 'a/two']);
  });

  it('keeps the plan order without an order, and puts a task the order does not name after the named ones', () => {
    const tasks = [task('a/one'), task('a/new'), task('a/two'), task('a/newer')];
    expect(ids(applyOrder(tasks, null))).toEqual(['a/one', 'a/new', 'a/two', 'a/newer']);
    expect(ids(applyOrder(tasks, orderOf(['a/two', 'a/one'])))).toEqual(['a/two', 'a/one', 'a/new', 'a/newer']);
  });

  it('does not change the list it was given', () => {
    const tasks = [task('a/one'), task('a/two')];
    applyOrder(tasks, orderOf(['a/two', 'a/one']));
    expect(ids(tasks)).toEqual(['a/one', 'a/two']);
  });
});

describe('the orders by date and title', () => {
  const dated = ['due', 'created-desc', 'created-asc', 'updated-desc', 'updated-asc', 'remind', 'title'] as const;

  it('are words of ours and stay remembered', () => {
    for (const word of dated) expect(parseSort(word)).toBe(word);
  });

  it('come in groups, every word once and in the order of SORTS', () => {
    expect(SORT_GROUPS.map((g) => g.group)).toEqual(['plan', 'date', 'title']);
    expect(SORT_GROUPS.flatMap((g) => g.words)).toEqual([...SORTS]);
    expect(SORT_GROUPS[1].words).toEqual(['due', 'created-desc', 'created-asc', 'updated-desc', 'updated-asc', 'remind']);
  });

  it('read as the person says them, in both languages', () => {
    const label = (lang: 'de' | 'en', word: string) => translate(lang, `sort.${word}` as Key);
    expect(dated.map((w) => label('de', w))).toEqual([
      'Fälligkeit',
      'Neu angelegt zuerst',
      'Älteste zuerst',
      'Zuletzt geändert',
      'Am längsten unverändert',
      'Nächste Erinnerung',
      'Titel A–Z',
    ]);
    expect(dated.map((w) => label('en', w))).toEqual([
      'Due date',
      'Newest created first',
      'Oldest created first',
      'Last changed',
      'Longest unchanged',
      'Next reminder',
      'Title A–Z',
    ]);
    expect(SORT_GROUPS.map((g) => translate('de', `sort.group.${g.group}` as Key))).toEqual(['Plan und Wert', 'Datum', 'Titel']);
    expect(SORT_GROUPS.map((g) => translate('en', `sort.group.${g.group}` as Key))).toEqual(['Plan and value', 'Date', 'Title']);
  });

  it('carry a hint each that says more than the name', () => {
    for (const lang of ['de', 'en'] as const) {
      const hints = SORTS.map((w) => translate(lang, `sort.hint.${w}` as Key));
      for (const [i, hint] of hints.entries()) {
        expect(hint).not.toBe(`sort.hint.${SORTS[i]}`);
        expect(hint).not.toBe(translate(lang, `sort.${SORTS[i]}` as Key));
      }
      expect(new Set(hints).size).toBe(SORTS.length);
    }
  });

  it('name the date the list goes by, for the row to show', () => {
    const t = {
      ...task('a/one'),
      created: '2026-11-05',
      updated: '2026-11-09T10:00:00Z',
      remind: '2026-12-01',
      due: '2027-01-02',
    } as unknown as TaskEntry;
    expect(sortStamp(t, 'created-desc')).toEqual({ kind: 'created', date: '2026-11-05' });
    expect(sortStamp(t, 'created-asc')).toEqual({ kind: 'created', date: '2026-11-05' });
    expect(sortStamp(t, 'updated-asc')).toEqual({ kind: 'updated', date: '2026-11-09' });
    expect(sortStamp(t, 'remind')).toEqual({ kind: 'remind', date: '2026-12-01' });
    expect(sortStamp(t, 'due')).toEqual({ kind: 'due', date: '2027-01-02' });
    for (const word of ['default', 'prio-effort', 'severity', 'frecency', 'roi', 'title'] as const) {
      expect(sortStamp(t, word)).toBeUndefined();
    }
    expect(sortStamp(task('a/two'), 'created-desc')).toBeUndefined();
    expect(sortStamp({ ...task('a/three'), created: 'soon' } as unknown as TaskEntry, 'created-desc')).toBeUndefined();
  });
});
