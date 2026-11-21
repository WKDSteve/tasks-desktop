// @vitest-environment jsdom
// Finished tasks whose CI is open or red (`ci: pending|red`): the overview names how many there are (the engine
// counts, capability `finished_ci`) and jumps to them in Done; Done narrows to them until it is taken off and writes the
// state on each row; the finished task's details show it beside its commits.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FinishedQuery } from '../lib/api';
import { make, snapshot } from '../lib/appDouble';
import type { Snapshot } from '../lib/contract';
import { task } from '../lib/fixtures';
import FinishedDialog from './FinishedDialog.svelte';
import FinishedView from './FinishedView.svelte';
import Today from './Today.svelte';

type Made = ReturnType<typeof make>;
let mounted: ReturnType<typeof mount>[] = [];
let made: Made | undefined;

afterEach(() => {
  for (const m of mounted) void unmount(m);
  mounted = [];
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

const item = (id: string, title: string, ci?: 'pending' | 'green' | 'red') => ({
  id,
  area: id.split('/')[0],
  slug: id.split('/')[1],
  title,
  done: '2026-11-20',
  tags: [],
  commits: ['tasks.nvim@abc1234'],
  ...(ci ? { ci } : {}),
  file: `${id}.md`,
});
const ITEMS = [item('pub/waits', 'Waits for its CI', 'pending'), item('pub/broke', 'Broke the CI', 'red'), item('pub/fine', 'All green', 'green'), item('pub/old', 'Before the field')];

/** The engine's `tasks.finished` for a question: the items whose state is one of `ci`, all of them without it. */
function finishedFor(query: FinishedQuery) {
  const keep = query.ci ? ITEMS.filter((i) => query.ci?.includes(i.ci ?? 'none')) : ITEMS;
  const page = keep.slice(0, query.limit ?? 100);
  return {
    kind: 'tasks.finished',
    total: keep.length,
    offset: 0,
    limit: query.limit ?? 100,
    items: page,
    undated: 0,
    incomplete: [],
    stats: { effort_days: 0, without_effort: keep.length, by_area: [], by_kind: [], by_prio: [], by_month: [], by_week: [] },
  };
}

async function started(capabilities: string[]): Promise<Made> {
  const m = make({ token: 't', now: new Date('2026-11-21T10:00:00').getTime() });
  made = m;
  m.hub.capabilities = capabilities;
  m.hub.finishedDoc = finishedFor;
  m.hub.doc = {
    ...snapshot([task('pub/open', { title: 'Open one' })]),
    plans: [],
    projects: [],
    plan: {
      summary: { tasks: 1, ready: 1, decision: 0, waiting: 0, stuck: 0, freed: 0, parked: 0 },
      critical_path: { days: 0, path: [], unknown_effort: 0 },
      stage_sizes: [],
      cycles: [],
      conflict_groups: [],
      warnings: [],
    },
    estimate: { tasks: 1, days: 0, n_with_effort: 0, n_without_effort: 1, value: 0, n_with_value: 0, quick_wins: [], unestimated: [] },
  } as unknown as Snapshot;
  await m.app.start(null);
  await vi.waitFor(() => expect(m.app.snapshot).not.toBeNull());
  return m;
}

function show(component: typeof Today | typeof FinishedView | typeof FinishedDialog, m: Made): HTMLElement {
  const target = document.createElement('div');
  document.body.append(target);
  mounted.push(mount(component, { target, props: { app: m.app } }));
  flushSync();
  return target;
}

describe('the overview', () => {
  it('names how many finished tasks have their CI open or red, and opens them in Done', async () => {
    const m = await started(['finished', 'finished_ci']);
    const root = show(Today, m);
    await vi.waitFor(() => expect(root.querySelector('[data-ci-open]')).not.toBeNull());
    const button = root.querySelector<HTMLButtonElement>('[data-ci-open]')!;
    expect(button.textContent).toContain('2');
    expect(m.hub.finishedQueries.some((q) => q.ci?.join() === 'pending,red' && q.limit === 1)).toBe(true);
    button.click();
    expect(m.app.view).toBe('done');
    expect(m.app.finishedStartCi).toBe(true);
  });

  it('says nothing without the capability, and nothing when there are none', async () => {
    const m = await started(['finished']);
    const root = show(Today, m);
    await tick();
    flushSync();
    expect(root.querySelector('[data-ci-open]')).toBeNull();
    // other tiles ask for the finished tasks of the day; none asks by the CI
    expect(m.hub.finishedQueries.filter((q) => q.ci !== undefined)).toEqual([]);

    const none = await started(['finished', 'finished_ci']);
    none.hub.finishedDoc = (q: FinishedQuery) => ({ ...finishedFor(q), total: 0, items: [] });
    const quiet = show(Today, none);
    await vi.waitFor(() => expect(none.app.ciOpen).toBe(0));
    flushSync();
    expect(quiet.querySelector('[data-ci-open]')).toBeNull();
  });
});

describe('Done', () => {
  it('opens with only the tasks whose CI is open or red when the overview sent it, until that is taken off', async () => {
    const m = await started(['finished', 'finished_ci']);
    m.app.showCiOpen();
    const root = show(FinishedView, m);
    await vi.waitFor(() => expect(root.textContent).toContain('Broke the CI'));
    expect(root.textContent).toContain('Waits for its CI');
    expect(root.textContent).not.toContain('All green');
    expect(m.hub.finishedQueries.at(-1)?.ci).toEqual(['pending', 'red']);
    // the narrowing is said in words, and taken off like the others
    expect(root.textContent).toContain('CI offen oder rot');
    const off = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Alles zeigen')!;
    off.click();
    await vi.waitFor(() => expect(root.textContent).toContain('All green'));
    expect(m.hub.finishedQueries.at(-1)?.ci).toBeUndefined();
  });

  it('writes the CI state on each row that has one, and opens the details from the title', async () => {
    const m = await started(['finished', 'finished_ci']);
    const root = show(FinishedView, m);
    await vi.waitFor(() => expect(root.textContent).toContain('All green'));
    const marks = Object.fromEntries([...root.querySelectorAll<HTMLElement>('[data-ci]')].map((el) => [el.dataset.ci, el.textContent]));
    expect(marks).toEqual({ pending: 'CI: offen', red: 'CI: rot', green: 'CI: grün' });
    expect(root.querySelectorAll('[data-ci]').length).toBe(3);
    const title = [...root.querySelectorAll<HTMLButtonElement>('button.title')].find((b) => b.textContent === 'Broke the CI')!;
    title.click();
    expect(m.app.finishedPeek?.id).toBe('pub/broke');
  });
});

describe('the details of a finished task', () => {
  it('show the CI state beside the commits, and nothing for a task without one', async () => {
    const m = await started(['finished', 'finished_ci']);
    // jsdom has no modal dialogs: the dialog is only drawn
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.open = true;
    };
    const root = show(FinishedDialog, m);
    m.app.finishedPeek = item('pub/broke', 'Broke the CI', 'red') as never;
    flushSync();
    const terms = [...root.querySelectorAll('dt')].map((dt) => dt.textContent);
    expect(terms.indexOf('CI')).toBe(terms.indexOf('Commits') + 1);
    expect(root.querySelector<HTMLElement>('dd[data-ci]')?.textContent).toBe('rot');
    m.app.finishedPeek = item('pub/old', 'Before the field') as never;
    flushSync();
    expect(root.querySelector('dd[data-ci]')).toBeNull();
  });
});

describe('a change only in the Backlog (`event: finished`)', () => {
  // `set ci=green` on a finished task moves no revision of the snapshot: the hub tells it as an event of its own.
  const tell = (m: Made, event: string) =>
    (m.app as unknown as { onMessage(message: { event: string; data: string }): void }).onMessage({ event, data: '{"seq":1}' });
  const greened = (q: FinishedQuery) => {
    const doc = finishedFor(q);
    const items = doc.items.filter((i) => i.id !== 'pub/broke');
    return { ...doc, items, total: q.ci ? items.length : doc.total };
  };

  it('makes the overview count again, without a focus or a new revision', async () => {
    const m = await started(['finished', 'finished_ci']);
    const root = show(Today, m);
    await vi.waitFor(() => expect(root.querySelector('[data-ci-open]')?.textContent).toContain('2'));
    const rev = m.app.snapshot?.rev;
    m.hub.finishedDoc = greened;
    tell(m, 'finished');
    await vi.waitFor(() => expect(m.app.ciOpen).toBe(1));
    flushSync();
    expect(root.querySelector('[data-ci-open]')?.textContent).toContain('1');
    expect(m.app.snapshot?.rev).toBe(rev);
  });

  it('makes Done read its page again', async () => {
    const m = await started(['finished', 'finished_ci']);
    m.app.showCiOpen();
    const root = show(FinishedView, m);
    await vi.waitFor(() => expect(root.textContent).toContain('Broke the CI'));
    m.hub.finishedDoc = greened;
    tell(m, 'finished');
    await vi.waitFor(() => expect(root.textContent).not.toContain('Broke the CI'));
    expect(root.textContent).toContain('Waits for its CI');
  });
});
