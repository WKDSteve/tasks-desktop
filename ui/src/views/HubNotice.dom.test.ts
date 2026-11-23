// @vitest-environment jsdom
// The page when its hub is gone, and when another one runs in its place: the state of the page (`App.hubState`) on a
// hub from memory, and the quiet line that says how to go on, drawn in a DOM. What the page shows and what was typed
// into it stay; a hub of the same instance is taken up again without a word, a new one needs the new link.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import { HUB_PROBE_MAX_MS, HUB_PROBE_MS } from '../lib/app.svelte';
import { make } from '../lib/appDouble';
import { translate, type Key } from '../lib/i18n';
import HubNotice from './HubNotice.svelte';

type Made = ReturnType<typeof make>;

let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;
/** The waits of the page (the probe of a hub that does not answer, the backoff of the stream): ended by the test. */
let waits: Array<() => void> = [];
const endWaits = (): void => {
  const due = waits;
  waits = [];
  for (const end of due) end();
};

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  await tick();
  flushSync();
}

/** A paired page with one task, one unsaved change of it, and the notice drawn. */
async function page(overrides: Parameters<typeof make>[0] = {}): Promise<Made> {
  const m = make({ token: 't', sleep: () => new Promise<void>((resolve) => waits.push(resolve)), ...overrides });
  made = m;
  await m.app.start(null);
  m.app.setSaveMode('manual');
  m.app.drafts = { 'pub/a': { prio: 1 } };
  const target = document.createElement('div');
  document.body.append(target);
  mounted = mount(HubNotice, { target, props: { app: m.app } });
  await settle();
  return m;
}

const region = (): HTMLElement => document.querySelector<HTMLElement>('[role="status"]')!;
const t = (m: Made, key: Key): string => translate(m.app.lang, key);
/** The hub ends: nothing answers any more. */
function end(m: Made): void {
  m.hub.hubDown = true;
  m.hub.snapshot = async () => {
    throw new TypeError('Failed to fetch');
  };
}

afterEach(async () => {
  made?.app.stop();
  endWaits();
  if (mounted) await unmount(mounted);
  mounted = undefined;
  made = undefined;
  document.body.innerHTML = '';
});

describe('a page whose hub is gone', () => {
  it('says nothing while the hub answers; the region is there for the moment it has to', async () => {
    const m = await page();
    expect(m.app.hubState).toBe('here');
    expect(region()).not.toBeNull();
    expect(region().textContent?.trim()).toBe('');
  });

  it('says that the hub ended and how to start it, keeps the list and what was typed, and shows no error', async () => {
    const m = await page();
    const snapshot = m.hub.snapshot.bind(m.hub);
    end(m);
    await m.app.refresh();
    await settle();
    expect(m.app.hubState).toBe('gone');
    expect(region().textContent).toContain(t(m, 'hub.gone'));
    expect(region().querySelector('code')?.textContent).toBe('tasks-desktop start --open');
    expect(region().textContent).toContain(t(m, 'hub.gone.then'));
    // What was typed stands, and is named as not saved.
    expect(m.app.drafts).toEqual({ 'pub/a': { prio: 1 } });
    expect(region().textContent).toContain(t(m, 'hub.unsaved'));
    expect(m.app.tasks.map((x) => x.id)).toEqual(['pub/a']);
    expect(m.app.phase).toBe('ready');
    expect(m.app.toast).toBeNull();
    // Asked again and again, quietly: still gone, still no toast.
    endWaits();
    await settle();
    expect(m.app.hubState).toBe('gone');
    expect(m.app.toast).toBeNull();

    // The same hub answers again (it was only out of reach): the page reads again by itself, and the line goes.
    m.hub.hubDown = false;
    m.hub.snapshot = snapshot;
    const reads = m.hub.snapshotCalls.length;
    endWaits();
    await vi.waitFor(() => expect(m.app.hubState).toBe('here'));
    await settle();
    expect(m.hub.snapshotCalls.length).toBeGreaterThan(reads);
    expect(region().textContent?.trim()).toBe('');
    expect(m.app.drafts).toEqual({ 'pub/a': { prio: 1 } });
    expect(m.hub.token).toBe('t');
  });

  it('a new hub answers: the page is not emptied, says that it needs the new link, and takes a pasted one where it stands', async () => {
    const m = await page();
    const snapshot = m.hub.snapshot.bind(m.hub);
    end(m);
    await m.app.refresh();
    await settle();
    // Started anew from the Start menu: another instance, which knows nothing of the session of this page.
    m.hub.hubDown = false;
    m.hub.instance = 'another';
    endWaits();
    await vi.waitFor(() => expect(m.app.hubState).toBe('replaced'));
    await settle();
    expect(region().textContent).toContain(t(m, 'hub.replaced'));
    expect(region().querySelector('code')?.textContent).toBe('tasks-desktop link');
    expect(region().textContent).toContain(t(m, 'hub.unsaved'));
    expect(m.app.tasks.map((x) => x.id)).toEqual(['pub/a']);
    expect(m.app.drafts).toEqual({ 'pub/a': { prio: 1 } });
    expect(m.app.phase).toBe('ready');
    // The session of the old hub is not used any more, and not kept.
    expect(m.hub.token).toBeNull();
    expect(m.session.has('tasks-desktop.session')).toBe(false);

    // The new link, pasted into this tab.
    m.hub.snapshot = snapshot;
    m.app.offerCode('fresh-code');
    await vi.waitFor(() => expect(m.app.hubState).toBe('here'));
    await settle();
    expect(m.hub.exchanged).toEqual(['fresh-code']);
    expect(m.hub.token).not.toBeNull();
    expect(m.app.drafts).toEqual({ 'pub/a': { prio: 1 } });
    expect(m.app.tasks.map((x) => x.id)).toEqual(['pub/a']);
    expect(region().textContent?.trim()).toBe('');
  });

  it('a refusal of a new hub (the tab came back before the page noticed) does not empty the page either', async () => {
    const m = await page();
    m.hub.instance = 'another';
    m.hub.onUnauthorized();
    await vi.waitFor(() => expect(m.app.hubState).toBe('replaced'));
    expect(m.app.tasks.map((x) => x.id)).toEqual(['pub/a']);
    expect(m.app.drafts).toEqual({ 'pub/a': { prio: 1 } });
    expect(m.app.phase).toBe('ready');
  });

  it('takes the session of the tab the new start opened when this tab gets the focus', async () => {
    // The page holds a session, so its start asks no other tab; the question is the one of the focus.
    const m = await page({ askSession: async () => 'session-of-the-new-tab' });
    m.hub.instance = 'another';
    m.hub.onUnauthorized();
    await vi.waitFor(() => expect(m.app.hubState).toBe('replaced'));
    await m.app.focused();
    await vi.waitFor(() => expect(m.app.hubState).toBe('here'));
    expect(m.hub.token).toBe('session-of-the-new-tab');
    expect(m.app.drafts).toEqual({ 'pub/a': { prio: 1 } });
    expect(m.hub.exchanged).toEqual([]);
  });

  it('asks a hub that does not answer less and less often, not at all from a hidden tab, and at once on the focus', async () => {
    const asked: number[] = [];
    let shown = true;
    const m = await page({
      // The stream waits for its answer: only the watcher of the hub asks and waits here.
      fetchFn: (() => new Promise<Response>(() => undefined)) as typeof fetch,
      sleep: (ms) => {
        asked.push(ms);
        return new Promise<void>((resolve) => waits.push(resolve));
      },
      visible: () => shown,
    });
    end(m);
    await m.app.refresh();
    await settle();
    expect(m.app.hubState).toBe('gone');
    for (let i = 0; i < 6; i += 1) {
      endWaits();
      await settle();
    }
    // The wait doubled from 3 s and stays at 30 s.
    expect(asked).toEqual([HUB_PROBE_MS, 6000, 12_000, 24_000, HUB_PROBE_MAX_MS, HUB_PROBE_MAX_MS, HUB_PROBE_MAX_MS]);

    // Hidden: the waits end, but the hub is not asked.
    shown = false;
    endWaits();
    await settle();
    const hidden = m.hub.helloCalls;
    for (let i = 0; i < 3; i += 1) {
      endWaits();
      await settle();
    }
    expect(m.hub.helloCalls).toBe(hidden);

    // Shown and focused again: the hub that is back is asked at once, not at the end of the wait.
    shown = true;
    m.hub.hubDown = false;
    await m.app.focused();
    await vi.waitFor(() => expect(m.app.hubState).toBe('here'));
  });

  it('a page that has the focus when it finds the new hub asks the other tabs at once, with one late listener', async () => {
    const lateAsked: boolean[] = [];
    const m = await page({
      hasFocus: () => true,
      askSession: async (onLate) => {
        lateAsked.push(onLate !== undefined);
        return null;
      },
    });
    m.hub.instance = 'another';
    m.hub.onUnauthorized();
    await vi.waitFor(() => expect(m.app.hubState).toBe('replaced'));
    // No focus event came: the question was asked anyway.
    await vi.waitFor(() => expect(lateAsked).toEqual([true]));
    // Every further focus asks again, but no question listens for a late answer beside the first.
    await m.app.focused();
    await m.app.focused();
    await settle();
    expect(lateAsked).toEqual([true, false, false]);
  });

  it('a question to the other tabs that could not be asked leaves no late listener behind', async () => {
    const lateAsked: boolean[] = [];
    let fail = true;
    const m = await page({
      askSession: async (onLate) => {
        lateAsked.push(onLate !== undefined);
        if (fail) throw new Error('no channel');
        return null;
      },
    });
    m.hub.instance = 'another';
    m.hub.onUnauthorized();
    await vi.waitFor(() => expect(m.app.hubState).toBe('replaced'));
    await m.app.focused();
    await settle();
    fail = false;
    await m.app.focused();
    await settle();
    // The question after the failed one listens for a late answer again.
    expect(lateAsked).toEqual([true, true]);
  });

  it('a session of another tab that the new hub refuses is not taken: the page stays as it was and says so', async () => {
    const m = await page({ askSession: async () => 'a-session-that-died' });
    m.hub.instance = 'another';
    m.hub.onUnauthorized();
    await vi.waitFor(() => expect(m.app.hubState).toBe('replaced'));
    // The new hub does not know that session.
    m.hub.snapshot = async () => {
      throw new ApiError(401, 'unauthorized', 'x');
    };
    await m.app.focused();
    await vi.waitFor(() => expect(m.app.toast?.text).toBe(t(m, 'hub.replaced.refused')));
    expect(m.app.hubState).toBe('replaced');
    expect(m.hub.token).toBeNull();
    expect(m.session.has('tasks-desktop.session')).toBe(false);
    // Not emptied: the list and what was typed are still there.
    expect(m.app.tasks.map((x) => x.id)).toEqual(['pub/a']);
    expect(m.app.drafts).toEqual({ 'pub/a': { prio: 1 } });
    expect(m.app.phase).toBe('ready');
  });

  it('a link pasted a moment before the page knew of the new hub is used once it knows', async () => {
    const m = await page();
    // The new hub runs, the page has not looked yet: it still holds its old session, and takes no code.
    m.hub.instance = 'another';
    m.app.offerCode('pasted-early');
    expect(m.hub.exchanged).toEqual([]);
    m.hub.onUnauthorized();
    await vi.waitFor(() => expect(m.hub.exchanged).toEqual(['pasted-early']));
    await vi.waitFor(() => expect(m.app.hubState).toBe('here'));
    expect(m.app.drafts).toEqual({ 'pub/a': { prio: 1 } });
    expect(m.app.tasks.map((x) => x.id)).toEqual(['pub/a']);
  });

  it('a session the same hub refuses is lost as before: the page is emptied and asks to pair', async () => {
    const m = await page();
    m.hub.onUnauthorized();
    await vi.waitFor(() => expect(m.app.phase).toBe('needs_pairing'));
    expect(m.app.hubState).toBe('here');
    expect(m.app.tasks).toEqual([]);
  });

  it('a code the new hub refuses leaves the page as it was and says so', async () => {
    const m = await page();
    m.hub.instance = 'another';
    m.hub.onUnauthorized();
    await vi.waitFor(() => expect(m.app.hubState).toBe('replaced'));
    m.hub.exchange = async () => {
      throw new Error('refused');
    };
    m.app.offerCode('old-code');
    await vi.waitFor(() => expect(m.app.toast?.text).toBe(t(m, 'hub.replaced.refused')));
    expect(m.app.hubState).toBe('replaced');
    expect(m.app.drafts).toEqual({ 'pub/a': { prio: 1 } });
  });
});
