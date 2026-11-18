// @vitest-environment jsdom
// The statistics in a DOM, with their effects running: the effort is the engine's figure, asked once when the view
// comes and once after the person stopped typing in the search of the filter bar, not for every letter.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import { task } from '../lib/fixtures';
import StatsView from './StatsView.svelte';

type Made = ReturnType<typeof make>;

let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;

async function settle(): Promise<void> {
  await tick();
  flushSync();
}

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

describe('StatsView, the effort of the tasks the filter keeps', () => {
  it('is asked at once when the view comes, and once for a word typed into the search, with the tasks the word keeps', async () => {
    const m = make({ token: 't' });
    made = m;
    m.hub.doc = snapshot([task('pub/alpha', { status: 'open' }), task('pub/alphabet', { status: 'open' }), task('lib/beta', { status: 'open' })]);
    await m.app.start(null);
    m.app.setLang('en');
    expect(m.app.can('estimate')).toBe(true);
    const target = document.createElement('div');
    document.body.append(target);
    mounted = mount(StatsView, { target, props: { app: m.app } });
    flushSync();
    await settle();
    // The view came: one question, at once, for every open task.
    expect(m.hub.estimates.length).toBe(1);
    expect(m.hub.estimates[0]?.ids).toHaveLength(3);
    await vi.waitFor(() => expect(target.querySelector('[data-figure="effort"]')).not.toBeNull());

    // A word typed letter by letter: the tasks change with every letter, the engine is not asked for each.
    for (const word of ['a', 'al', 'alp', 'alph', 'alpha']) {
      m.app.setQuery(word);
      await settle();
    }
    expect(m.app.shown.map((t) => t.id).sort()).toEqual(['pub/alpha', 'pub/alphabet']);
    expect(m.hub.estimates.length).toBe(1);
    // Once the typing stopped: one question, for the tasks the whole word keeps.
    await vi.waitFor(() => expect(m.hub.estimates.length).toBe(2), { timeout: 2000 });
    expect([...(m.hub.estimates[1]?.ids ?? [])].sort()).toEqual(['pub/alpha', 'pub/alphabet']);
    await vi.waitFor(() => expect(target.querySelector('[data-figure="effort"]')).not.toBeNull());
    // And no late one after it.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(m.hub.estimates.length).toBe(2);
  });
});
