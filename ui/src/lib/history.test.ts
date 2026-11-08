import { describe, expect, it } from 'vitest';
import { readRoute, routeHash } from 'appkit-ui/route';
import {
  FILTER_SETTLE_MS,
  installAppHistory,
  isPlace,
  placeAddress,
  placeRoute,
  routePlace,
  type HistoryApp,
  type Place,
} from './history';
import type { View } from './app.svelte';
import { filterText, freshFilter, type Filter } from './filter';

/** A tab: a list of entries and a position, like the real history. */
function tab() {
  const entries: unknown[] = [null];
  let at = 0;
  const listeners: ((e: { state: unknown }) => void)[] = [];
  return {
    entries,
    get at() {
      return at;
    },
    history: {
      pushState(data: unknown) {
        entries.splice(at + 1);
        entries.push(data);
        at += 1;
      },
      replaceState(data: unknown) {
        entries[at] = data;
      },
    },
    addEventListener(_t: 'popstate', l: (e: { state: unknown }) => void) {
      listeners.push(l);
    },
    removeEventListener() {},
    go(delta: number) {
      at += delta;
      for (const l of listeners) l({ state: entries[at] });
    },
  };
}

function fakeApp(ids: string[]) {
  const app: HistoryApp & { ids: string[] } = {
    ids,
    view: 'today',
    selectedId: null,
    peeking: false,
    filter: freshFilter(),
    get tasks() {
      return this.ids.map((id) => ({ id }));
    },
    setView(view: View) {
      this.view = view;
    },
    select(id) {
      this.selectedId = id;
    },
    peek(id) {
      this.selectedId = id;
      this.peeking = true;
    },
    closePeek() {
      this.peeking = false;
    },
  };
  return app;
}

describe('isPlace', () => {
  it('takes only a known view and a string or null', () => {
    expect(isPlace({ view: 'list', selectedId: null })).toBe(true);
    expect(isPlace({ view: 'nope', selectedId: null })).toBe(false);
    expect(isPlace({ view: 'list', selectedId: 3 })).toBe(false);
    expect(isPlace(null)).toBe(false);
    // The popup is a flag that is there only when it is on; a place from before it has none.
    expect(isPlace({ view: 'plan', selectedId: 'a/1', peek: true })).toBe(true);
    expect(isPlace({ view: 'plan', selectedId: 'a/1', peek: false })).toBe(false);
    expect(isPlace({ view: 'plan', selectedId: 'a/1', peek: 'yes' })).toBe(false);
  });
});

describe('installAppHistory', () => {
  // The places as the tests before the filter wrote them: a filter with nothing on is left out.
  const places = (t: ReturnType<typeof tab>) =>
    t.entries.map((e) => {
      const state = (e as { state: Place } | null)?.state ?? null;
      if (state === null || state.filter !== '{}') return state;
      const { filter: _filter, ...rest } = state;
      return rest;
    });

  it('makes an entry per place, and Back and Forward bring the page there', () => {
    const t = tab();
    const app = fakeApp(['a/1', 'a/2']);
    const h = installAppHistory(app, t);
    h.sync();
    app.view = 'list';
    h.sync();
    app.selectedId = 'a/2';
    h.sync();
    expect(places(t)).toEqual([
      { view: 'today', selectedId: null },
      { view: 'list', selectedId: null },
      { view: 'list', selectedId: 'a/2' },
    ]);
    t.go(-1);
    expect([app.view, app.selectedId]).toEqual(['list', null]);
    t.go(-1);
    expect([app.view, app.selectedId]).toEqual(['today', null]);
    t.go(2);
    expect([app.view, app.selectedId]).toEqual(['list', 'a/2']);
    // What the restore did is not a new place: nothing was pushed.
    h.sync();
    expect(t.entries.length).toBe(3);
  });

  it('opens the view alone when the task of the entry is gone, in the same entry', () => {
    const t = tab();
    const app = fakeApp(['a/1']);
    const h = installAppHistory(app, t);
    h.sync();
    app.selectedId = 'a/1';
    h.sync();
    app.view = 'board';
    h.sync();
    app.ids = [];
    t.go(-1);
    expect([app.view, app.selectedId]).toEqual(['today', null]);
    t.go(1);
    t.go(-1);
    // The entry that named the vanished task was rewritten, no new one was made.
    expect(t.entries.length).toBe(3);
    expect(places(t)[1]).toEqual({ view: 'today', selectedId: null });
  });

  it('takes the place of the entry when the open task vanishes by itself', () => {
    const t = tab();
    const app = fakeApp(['a/1']);
    const h = installAppHistory(app, t);
    h.sync();
    app.selectedId = 'a/1';
    h.sync();
    app.ids = [];
    app.selectedId = null;
    h.sync();
    expect(t.entries.length).toBe(2);
    expect(places(t)[1]).toEqual({ view: 'today', selectedId: null });
  });

  it('makes the popup a place: Back closes it, Forward opens it again, closing it by hand is a place of its own', () => {
    const tb = tab();
    const app = fakeApp(['a/1', 'a/2']);
    const h = installAppHistory(app, tb);
    h.sync();
    app.view = 'plan';
    h.sync();
    app.peek('a/2');
    h.sync();
    expect(places(tb).at(-1)).toEqual({ view: 'plan', selectedId: 'a/2', peek: true });
    // Closed by hand: the same task, no popup.
    app.closePeek();
    h.sync();
    expect(places(tb).at(-1)).toEqual({ view: 'plan', selectedId: 'a/2' });
    // Back: the place with the popup, so the popup is open again; once more: the plan without a task.
    tb.go(-1);
    expect([app.view, app.selectedId, app.peeking]).toEqual(['plan', 'a/2', true]);
    tb.go(-1);
    expect([app.view, app.selectedId, app.peeking]).toEqual(['plan', null, false]);
    tb.go(1);
    expect([app.view, app.selectedId, app.peeking]).toEqual(['plan', 'a/2', true]);
    // Nothing the restore did is a new place.
    h.sync();
    expect(tb.entries.length).toBe(4);
  });

  it('opens no popup for a task that is gone, and the place becomes the view alone', () => {
    const tb = tab();
    const app = fakeApp(['a/1']);
    const h = installAppHistory(app, tb);
    h.sync();
    app.view = 'plan';
    h.sync();
    app.peek('a/1');
    h.sync();
    app.ids = [];
    app.selectedId = null;
    app.peeking = false;
    h.sync();
    tb.go(-1);
    expect([app.view, app.selectedId, app.peeking]).toEqual(['plan', null, false]);
  });

  it('Back reaches every view of the page (abnahme, stats and views were skipped)', () => {
    const t = tab();
    const app = fakeApp([]);
    const h = installAppHistory(app, t);
    h.sync();
    for (const view of ['abnahme', 'stats', 'views', 'done'] as View[]) {
      app.view = view;
      h.sync();
    }
    t.go(-1);
    expect(app.view).toBe('views');
    t.go(-1);
    expect(app.view).toBe('stats');
    t.go(-1);
    expect(app.view).toBe('abnahme');
  });
});

describe('the place in the address', () => {
  /** A tab that also keeps the address each entry was given. */
  function addressedTab(hash = '') {
    const t = tab();
    const location = { pathname: '/', search: '', hash };
    const urls: unknown[] = [];
    const keep = (url: unknown) => {
      urls.push(url);
      if (typeof url === 'string') location.hash = url.includes('#') ? url.slice(url.indexOf('#')) : '';
    };
    const history = {
      pushState(data: unknown, unused: string, url?: unknown) {
        t.history.pushState(data);
        keep(url);
      },
      replaceState(data: unknown, unused: string, url?: unknown) {
        t.history.replaceState(data);
        keep(url);
      },
    };
    return { t, location, urls, win: { ...t, history } };
  }

  it('keeps the view and the open task in the fragment; the popup is not part of it', () => {
    const a = addressedTab();
    const app = fakeApp(['pub/a b']);
    const h = installAppHistory(app, a.win, placeAddress(a.location, () => false));
    h.sync();
    app.view = 'list';
    h.sync();
    app.peek('pub/a b');
    h.sync();
    expect(a.urls).toEqual(['/#view=today', '/#view=list', '/#view=list&open=pub%2Fa%20b']);
  });

  it('reads a place back from a route, and no place from a route without a view', () => {
    expect(routePlace(readRoute(routeHash(placeRoute({ view: 'board', selectedId: 'pub/x' }))))).toEqual({
      view: 'board',
      selectedId: 'pub/x',
    });
    expect(routePlace(readRoute('#view=stats'))).toEqual({ view: 'stats', selectedId: null });
    expect(routePlace(readRoute('#task=pub%2Fx'))).toBeNull();
    expect(routePlace(readRoute('#view=nope&open=pub%2Fx'))).toBeNull();
  });

  it('leaves the address of a window of one task to it', () => {
    const a = addressedTab('#task=pub%2Fa');
    const app = fakeApp(['pub/a']);
    let solo = true;
    const h = installAppHistory(app, a.win, placeAddress(a.location, () => solo));
    app.selectedId = 'pub/a';
    h.sync();
    expect(a.urls).toEqual([undefined]);
    expect(a.location.hash).toBe('#task=pub%2Fa');
    solo = false;
    app.view = 'list';
    h.sync();
    expect(a.location.hash).toBe('#view=list&open=pub%2Fa');
  });
});

describe('the filter of a place', () => {
  /** Timers that run when the test says so. */
  function clock() {
    let now = 0;
    const waiting = new Map<number, { at: number; run: () => void }>();
    let next = 1;
    return {
      setTimeout(run: () => void, ms: number) {
        waiting.set(next, { at: now + ms, run });
        return next++;
      },
      clearTimeout(handle: unknown) {
        waiting.delete(handle as number);
      },
      pass(ms: number) {
        now += ms;
        for (const [id, w] of [...waiting]) {
          if (w.at <= now) {
            waiting.delete(id);
            w.run();
          }
        }
      },
      get pending() {
        return waiting.size;
      },
    };
  }
  const filterOf = (t: ReturnType<typeof tab>, at: number) => ((t.entries[at] as { state: Place } | null)?.state ?? null)?.filter;
  const open: Filter = { ...freshFilter(), statuses: ['open'] };

  it('keeps the filter with its place: changing it writes no new entry, Back sets the one the place had, Forward the other', () => {
    const t = tab();
    const c = clock();
    const app = fakeApp(['a/1']);
    app.view = 'list';
    const h = installAppHistory(app, t, undefined, c);
    h.sync();
    app.filter = open;
    h.sync();
    // Not yet written: the filter waits a moment, then takes the entry of the place.
    expect(filterOf(t, 0)).toBe('{}');
    c.pass(FILTER_SETTLE_MS);
    expect(t.entries.length).toBe(1);
    expect(filterOf(t, 0)).toBe(filterText(open));
    // Another place with another filter.
    app.view = 'board';
    h.sync();
    app.filter = freshFilter();
    h.sync();
    c.pass(FILTER_SETTLE_MS);
    expect(t.entries.length).toBe(2);
    t.go(-1);
    expect(app.view).toBe('list');
    expect(app.filter.statuses).toEqual(['open']);
    t.go(1);
    expect(app.view).toBe('board');
    expect(app.filter.statuses).toEqual([]);
    // Setting the filter of a place is no change of it: nothing is pushed.
    h.sync();
    c.pass(FILTER_SETTLE_MS);
    expect(t.entries.length).toBe(2);
  });

  it('writes typing in the search box once, after the last key', () => {
    const t = tab();
    const c = clock();
    const app = fakeApp([]);
    let writes = 0;
    const counted = {
      ...t,
      history: {
        pushState: (d: unknown) => t.history.pushState(d),
        replaceState: (d: unknown) => {
          writes += 1;
          t.history.replaceState(d);
        },
      },
    };
    const h = installAppHistory(app, counted, undefined, c);
    h.sync();
    writes = 0;
    for (const query of ['b', 'bo', 'boa', 'boar', 'board']) {
      app.filter = { ...freshFilter(), query };
      h.sync();
      c.pass(50);
    }
    expect(writes).toBe(0);
    c.pass(FILTER_SETTLE_MS);
    expect(writes).toBe(1);
    expect(t.entries.length).toBe(1);
    expect(JSON.parse(filterOf(t, 0) ?? '')).toEqual({ query: 'board' });
  });

  it('gives a place left before its filter was written that filter, and the next place its own', () => {
    const t = tab();
    const c = clock();
    const app = fakeApp([]);
    app.view = 'list';
    const h = installAppHistory(app, t, undefined, c);
    h.sync();
    app.filter = open;
    h.sync();
    // Left at once (a click on a view while the filter is still waiting).
    app.view = 'board';
    h.sync();
    expect(c.pending).toBe(0);
    expect(filterOf(t, 0)).toBe(filterText(open));
    expect(filterOf(t, 1)).toBe(filterText(open));
    // A filter that changes with the place (a number opened in the list): the place left keeps the one it had.
    app.view = 'list';
    app.filter = { ...open, areas: ['a'] };
    h.sync();
    expect(filterOf(t, 1)).toBe(filterText(open));
    expect(filterOf(t, 2)).toBe(filterText({ ...open, areas: ['a'] }));
  });

  it('does not write a waiting filter into the entry Back comes to', () => {
    const t = tab();
    const c = clock();
    const app = fakeApp([]);
    const h = installAppHistory(app, t, undefined, c);
    h.sync();
    app.view = 'list';
    h.sync();
    app.filter = open;
    h.sync();
    t.go(-1);
    c.pass(FILTER_SETTLE_MS);
    expect(filterOf(t, 0)).toBe('{}');
    expect(app.filter.statuses).toEqual([]);
  });

  it('leaves the filter as it is for a place from before it was kept, and reads a broken or unknown one without a fault', () => {
    const t = tab();
    const app = fakeApp([]);
    app.filter = open;
    const h = installAppHistory(app, t);
    h.sync();
    t.entries.push({ appkitNav: 1, state: { view: 'list', selectedId: null } });
    t.go(1);
    expect(app.view).toBe('list');
    expect(app.filter.statuses).toEqual(['open']);
    t.entries.push({ appkitNav: 1, state: { view: 'board', selectedId: null, filter: '{"statuses":["open"],"nope":1,"tags":' } });
    t.go(1);
    expect(app.view).toBe('board');
    expect(app.filter).toEqual(freshFilter());
    // The entry takes the filter as it was read.
    expect(filterOf(t, 2)).toBe('{}');
  });

  it('puts a filter into the address and reads it back, and leaves one with nothing on out', () => {
    const place: Place = { view: 'list', selectedId: null, filter: filterText({ ...open, query: 'board' }) };
    const route = placeRoute(place);
    expect(Object.keys(route)).toEqual(['view', 'filter']);
    const back = routePlace(readRoute(routeHash(route)));
    expect(back).toEqual(place);
    expect(placeRoute({ view: 'list', selectedId: null, filter: '{}' })).toEqual({ view: 'list' });
    expect(routePlace(readRoute('#view=list'))).toEqual({ view: 'list', selectedId: null });
  });
});
