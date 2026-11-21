// @vitest-environment jsdom
// The icon of a task beside its title on the board, in the inbox, in Today, in the list of the tile Today, in the
// calendar and on the timeline: there by the inheritance of lib/icons.ts (here the category `bug`), never in the text
// of the title or in the accessible name of the card or button.
import { type Component, flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import type { Next, Snapshot, TaskEntry } from '../lib/contract';
import { task } from '../lib/fixtures';
import BoardView from './BoardView.svelte';
import CalendarView from './CalendarView.svelte';
import DailyList from './DailyList.svelte';
import InboxView from './InboxView.svelte';
import TimelineView from './TimelineView.svelte';
import Today from './Today.svelte';

// jsdom has no modal dialog: the list of the tile Today opens itself as one
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};

type Made = ReturnType<typeof make>;
let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

const BUG = '🐞';

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await tick();
    await Promise.resolve();
    flushSync();
  }
}

/** A vault with one bug (its category gives the icon) and one plain task. */
async function vault(tasks: (today: string) => TaskEntry[]): Promise<Made> {
  const m = make({ token: 't' });
  made = m;
  m.hub.doc = {
    ...snapshot(tasks(m.app.today)),
    // what Today draws its numbers from: the figures of the plan the engine gives with every list
    plans: [],
    projects: [],
    plan: {
      summary: { tasks: 0, ready: 0, decision: 0, waiting: 0, stuck: 0, freed: 0, parked: 0 },
      critical_path: { days: 0, path: [], unknown_effort: 0 },
      stage_sizes: [],
      cycles: [],
      conflict_groups: [],
      warnings: [],
    },
    estimate: { tasks: 0, days: 0, n_with_effort: 0, n_without_effort: 0, value: 0, n_with_value: 0, quick_wins: [], unestimated: [] },
  } as unknown as Snapshot;
  await m.app.start(null);
  return m;
}

function show<P extends Record<string, any>>(component: Component<P>, props: P): HTMLElement {
  const root = document.createElement('div');
  document.body.append(root);
  mounted = mount(component, { target: root, props });
  flushSync();
  return root;
}

/** The name a screen reader gives an element: its text without what is hidden from it (`aria-hidden`), or its label. */
function accessibleName(el: Element): string {
  const label = el.getAttribute('aria-label');
  if (label) return label;
  const copy = el.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** The element of a task (`[data-task]`, else the one whose text names it) holds the icon, its title and name do not. */
function expectIcon(scope: Element, title: string, iconHolder: Element | null, titleEl: Element | null, named: Element | null): void {
  expect(iconHolder, `an element for ${title}`).not.toBeNull();
  const icon = iconHolder!.querySelector('[data-icon]');
  expect(icon?.textContent, `the icon beside ${title}`).toBe(BUG);
  expect(icon?.getAttribute('aria-hidden')).toBe('true');
  expect(titleEl?.textContent ?? '', 'the title text').not.toContain(BUG);
  expect(titleEl?.textContent ?? '').toContain(title);
  if (named) expect(accessibleName(named), 'the accessible name').not.toContain(BUG);
  // the plain task has none
  expect(scope.textContent).not.toContain(`${BUG}Plain`);
}

describe('the icon of a task beside its title', () => {
  it('stands on a board card', async () => {
    const m = await vault(() => [task('pub/bug', { title: 'Broken thing', category: ['bug'], status: 'open' }), task('pub/plain', { title: 'Plain one', status: 'open' })]);
    const root = show(BoardView, { app: m.app });
    await settle();
    const card = root.querySelector<HTMLElement>('[data-card="pub/bug"], [data-task="pub/bug"]');
    expectIcon(root, 'Broken thing', card, card?.querySelector('.title') ?? null, card);
    const plain = root.querySelector('[data-card="pub/plain"], [data-task="pub/plain"]');
    expect(plain?.querySelector('[data-icon]')).toBeNull();
  });

  it('stands on a row of the inbox', async () => {
    // no prio: both are in the inbox
    const m = await vault(() => [task('pub/bug', { title: 'Broken thing', category: ['bug'], prio: undefined }), task('pub/plain', { title: 'Plain one', prio: undefined })]);
    const root = show(InboxView, { app: m.app });
    await settle();
    const row = [...root.querySelectorAll('.title')].find((el) => el.textContent?.includes('Broken thing'))?.parentElement ?? null;
    expectIcon(root, 'Broken thing', row, row?.querySelector('.title') ?? null, row);
  });

  it('stands beside the next task of Today and its alternatives, taken from the task of the list', async () => {
    const m = await vault(() => [task('pub/bug', { title: 'Broken thing', category: ['bug'] }), task('pub/alt', { title: 'Other bug', category: ['bug'] }), task('pub/plain', { title: 'Plain one' })]);
    // the engine's answer names the tasks briefly, without category or icon
    const brief = {
      task: { id: 'pub/bug', title: 'Broken thing', status: 'open', area: 'pub' },
      alternatives: [{ id: 'pub/alt', title: 'Other bug', status: 'open', area: 'pub' }],
      cdx: [],
    } as unknown as Next;
    m.app.next = brief;
    const root = show(Today, { app: m.app });
    await settle();
    // the start asked the hub of the tests for the next task: its answer replaced the one above
    m.app.next = brief;
    await settle();
    const big = root.querySelector('button.big');
    expectIcon(root, 'Broken thing', big, big?.querySelector('.title') ?? null, big);
    const alt = [...root.querySelectorAll('button.link')].find((b) => b.textContent?.includes('Other bug'));
    expectIcon(root, 'Other bug', alt?.parentElement ?? null, alt ?? null, alt ?? null);
  });

  it('stands beside a task in the list of the tile Today', async () => {
    const m = await vault(() => [task('pub/bug', { title: 'Broken thing', category: ['bug'] })]);
    const root = show(DailyList, {
      app: m.app,
      title: 'Created',
      groups: [{ key: 'created', heading: '1 created', cut: false, open: m.app.tasks }],
      onclose: () => undefined,
    });
    await settle();
    const row = root.querySelector('[data-task="pub/bug"]');
    const button = row?.querySelector('button.link') ?? null;
    expectIcon(root, 'Broken thing', row, button, button);
  });

  it('stands on a chip of the calendar, dated and loose', async () => {
    const m = await vault((today) => [
      task('pub/bug', { title: 'Broken thing', category: ['bug'], due: today }),
      task('pub/loose', { title: 'Loose bug', category: ['bug'] }),
      task('pub/plain', { title: 'Plain one', due: today }),
    ]);
    const root = show(CalendarView, { app: m.app });
    await settle();
    for (const [id, title] of [['pub/bug', 'Broken thing'], ['pub/loose', 'Loose bug']] as const) {
      const chip = [...root.querySelectorAll('.chip[data-task]')].find((el) => (el as HTMLElement).dataset.task === id) ?? null;
      expectIcon(root, title, chip, chip?.querySelector('.chip-title') ?? null, chip);
    }
  });

  it('stands on a bar of the timeline, its name and its row of the table', async () => {
    const m = await vault((today) => [
      task('pub/bug', { title: 'Broken thing', category: ['bug'], start: today, due: today.replace(/\d\d$/, (d) => String(Math.min(28, Number(d) + 2)).padStart(2, '0')) }),
      task('pub/plain', { title: 'Plain one' }),
    ]);
    const root = show(TimelineView, { app: m.app });
    await settle();
    const name = root.querySelector('[data-column="name"][data-task="pub/bug"]');
    expectIcon(root, 'Broken thing', name, name?.querySelector('.name-title') ?? null, name);
    const body = root.querySelector('[data-column="body"][data-task="pub/bug"]');
    expect(body?.querySelector('[data-icon]')?.textContent).toBe(BUG);
    expect(accessibleName(body!)).not.toContain(BUG);
  });
});
