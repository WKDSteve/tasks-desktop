import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { make, snapshot } from './appDouble';
import type { Snapshot, View } from './contract';
import { applyFilter, freshFilter } from './filter';
import { task } from './fixtures';
import { isLearning, learningIds, withoutLearning } from './learning';
import { emptySelect } from './views';
import TaskRow from '../views/TaskRow.svelte';

const need = task('pub/need', { category: ['bug'] as never });
const learn = task('pub/learn', { category: ['learning'] as never, tags: ['terminal'] });
const tagged = task('pub/tagged', { category: ['learning', 'docs'] as never, tags: ['learning'] });
const plain = task('pub/plain');

describe('a learning task', () => {
  it('is one whose categories name learning', () => {
    expect([need, learn, tagged, plain].map(isLearning)).toEqual([false, true, true, false]);
    expect([...learningIds([need, learn, tagged, plain])]).toEqual(['pub/learn', 'pub/tagged']);
  });

  it('is left out of a list only when learning tasks are hidden', () => {
    const all = [need, learn, tagged, plain];
    expect(withoutLearning(all, false).map((t) => t.id)).toEqual(['pub/need', 'pub/learn', 'pub/tagged', 'pub/plain']);
    expect(withoutLearning(all, true).map((t) => t.id)).toEqual(['pub/need', 'pub/plain']);
  });

  it('is found by the filter of the list under its category, like any other', () => {
    const only = applyFilter([need, learn, tagged, plain], { ...freshFilter(), fields: { category: ['learning'] } }, '2026-11-18');
    expect(only.map((t) => t.id)).toEqual(['pub/learn', 'pub/tagged']);
  });

  it('carries its mark in a row of the list, with the hint that says what it is', () => {
    const row = (t: typeof learn) =>
      render(TaskRow, {
        props: { task: t, lang: 'en', today: '2026-11-18', onselect: () => undefined, onmark: () => false, markLabel: 'Mark', marker: { markClick: () => false } },
      }).body;
    expect(row(learn)).toContain('data-learning');
    expect(row(learn)).toContain('>learning</span>');
    expect(row(learn)).toContain('A learning task: work done to learn');
    expect(row(need)).not.toContain('data-learning');
  });
});

describe('the page hides learning tasks', () => {
  const view = (select: Partial<View['select']> = {}): View =>
    ({ id: 'pub/v', area: 'pub', title: 'View', display: 'columns', group_by: 'status', collapsed: [], select: { ...emptySelect(), ...select } }) as unknown as View;

  async function ready(prefs?: Map<string, string>) {
    const m = make({ token: 't', ...(prefs ? { prefs } : {}) });
    m.hub.doc = snapshot([need, learn, tagged, plain]) as Snapshot;
    await m.app.start(null);
    m.app.stop();
    return m;
  }

  it('shows them as it comes, and keeps the switch in the browser until the factory settings', async () => {
    const m = await ready();
    expect(m.app.learningHidden).toBe(false);
    m.app.setLearningHidden(true);
    const again = await ready(m.prefs);
    expect(again.app.learningHidden).toBe(true);
    again.app.resetToFactory();
    expect(again.app.learningHidden).toBe(false);
    expect((await ready(again.prefs)).app.learningHidden).toBe(false);
  });

  it('leaves them out of a saved view when hidden; the list keeps them, and a view that asks for them by tag too', async () => {
    const m = await ready();
    const ids = (v: View) => m.app.tasksOfView(v).map((t) => t.id);
    expect(ids(view())).toEqual(['pub/need', 'pub/learn', 'pub/tagged', 'pub/plain']);
    m.app.setLearningHidden(true);
    expect(ids(view())).toEqual(['pub/need', 'pub/plain']);
    expect(m.app.shown.map((t) => t.id)).toEqual(['pub/need', 'pub/learn', 'pub/tagged', 'pub/plain']);
    expect(ids(view({ tags: ['learning'] }))).toEqual(['pub/tagged']);
  });

  it('names the hidden ones by id for the lists of the overview, and none while they are shown', async () => {
    const m = await ready();
    expect([...m.app.hiddenLearning]).toEqual([]);
    m.app.setLearningHidden(true);
    expect([...m.app.hiddenLearning]).toEqual(['pub/learn', 'pub/tagged']);
  });
});
