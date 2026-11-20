// @vitest-environment jsdom
// The meetings in the calendar, in a DOM: chips in the month (before the tasks, "+n" from the fifth), the hour grid of
// the week and of the day (blocks, the sign of an overlap), the keys that move a meeting and change its length (what is
// written is read from the hub of the tests), the filters, m/w/d/n. Dragging with a pointer is the browser tests'.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import type { MeetingEntry } from '../lib/contract';
import { task } from '../lib/fixtures';
import CalendarView from './CalendarView.svelte';

type Made = ReturnType<typeof make>;

const CAPS = ['meetings', 'meeting', 'meeting_ops', 'meeting_parse', 'attach'];
/** Friday 2026-11-20, 10:00 on the wall of this machine. */
const NOW = new Date('2026-11-20T10:00:00').getTime();
const TODAY = '2026-11-20';

function meeting(id: string, starts: string, ends: string, more: Partial<MeetingEntry> = {}): MeetingEntry {
  return {
    id,
    area: 'pub',
    slug: id.split('/')[1] ?? id,
    title: `Meeting ${id.split('/')[1]}`,
    status: 'planned',
    date: starts.slice(0, 10),
    time: starts.slice(11, 16),
    all_day: false,
    starts_at: starts,
    ends_at: ends,
    tasks: [],
    notify: [],
    tags: [],
    summary: '',
    participants: { total: 0 },
    agenda: { total: 0 },
    followups: { total: 0 },
    has_result: false,
    has_decisions: false,
    has_protocol: false,
    file: `pub/MEETINGS/${id}.md`,
    etag: `sha256:${id}`,
    valid: true,
    problems: [],
    ...more,
  } as MeetingEntry;
}

let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await tick();
    flushSync();
    await new Promise((r) => setTimeout(r, 0));
  }
}
/** Waits until `ok` holds (a chunk that loads on the first need takes some turns). */
async function until(ok: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !ok(); i += 1) await settle();
  expect(ok()).toBe(true);
}

async function show(items: MeetingEntry[], caps: string[] = CAPS): Promise<{ m: Made; root: HTMLElement }> {
  const m = make({ token: 't', now: NOW });
  made = m;
  m.hub.capabilities = caps;
  m.hub.meetingItems = items;
  m.hub.doc = snapshot([task('pub/due', { title: 'Due today', due: TODAY, etag: 'e1' })]);
  await m.app.start(null);
  const root = document.createElement('div');
  document.body.append(root);
  mounted = mount(CalendarView, { target: root, props: { app: m.app } });
  await settle();
  return { m, root };
}

const press = (el: Element, key: string, init: KeyboardEventInit = {}): boolean =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
const cell = (root: HTMLElement, day: string): HTMLElement => root.querySelector<HTMLElement>(`td[data-day="${day}"]`)!;
const chips = (root: HTMLElement, day: string): HTMLElement[] => [...cell(root, day).querySelectorAll<HTMLElement>('.chip')];
const block = (root: HTMLElement, id: string): HTMLElement => root.querySelector<HTMLElement>(`.block[data-meeting="${id}"] .open`)!;
const sent = (m: Made) => m.hub.sent.flatMap((r) => r.ops).filter((op) => op.op === 'meeting_set');

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

describe('the month', () => {
  it('shows a meeting as a chip with its time, before the tasks of the day, and opens it on a click', async () => {
    const { m, root } = await show([meeting('pub/sync', `${TODAY}T14:00`, `${TODAY}T15:00`, { online: 'https://x.test/j', online_service: 'teams' })]);
    const [first, second] = chips(root, TODAY);
    expect(first!.dataset.meeting).toBe('pub/sync');
    expect(first!.textContent).toContain('14:00');
    expect(first!.textContent).toContain('⧉');
    expect(second!.dataset.task).toBe('pub/due');
    first!.click();
    expect(m.app.meetingOpen).toBe('pub/sync');
  });

  it('shows four entries and "+n" for the rest, counting meetings and tasks together', async () => {
    const items = ['a', 'b', 'c', 'd'].map((x, i) => meeting(`pub/${x}`, `${TODAY}T${String(i + 8).padStart(2, "0")}:00`, `${TODAY}T${String(i + 8).padStart(2, "0")}:30`));
    const { root } = await show(items);
    expect(chips(root, TODAY)).toHaveLength(4);
    expect(cell(root, TODAY).querySelector('.more')?.textContent).toContain('+1');
  });

  it('leaves a meeting out when the switch is off, and when the place filter does not keep it', async () => {
    const { root } = await show([
      meeting('pub/on', `${TODAY}T09:00`, `${TODAY}T10:00`, { online: 'https://x.test/j' }),
      meeting('pub/room', `${TODAY}T11:00`, `${TODAY}T12:00`, { location: 'Room 4' }),
    ]);
    const ids = () => chips(root, TODAY).flatMap((c) => (c.dataset.meeting ? [c.dataset.meeting] : []));
    expect(ids()).toEqual(['pub/on', 'pub/room']);
    const place = root.querySelector<HTMLSelectElement>('[data-calendar-place]')!;
    place.value = 'online';
    place.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(ids()).toEqual(['pub/on']);
    const toggle = root.querySelector<HTMLInputElement>('[data-calendar-meetings]')!;
    toggle.click();
    await settle();
    expect(ids()).toEqual([]);
  });

  it('offers no meetings where the engine has none', async () => {
    const { root } = await show([meeting('pub/x', `${TODAY}T09:00`, `${TODAY}T10:00`)], ['reorder']);
    expect(chips(root, TODAY).map((c) => c.dataset.meeting)).toEqual([undefined]);
    expect(root.querySelector('[data-calendar-meetings]')).toBeNull();
  });

  it('opens the form on a double click on a day, and with n', async () => {
    const { m, root } = await show([]);
    cell(root, '2026-11-24').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(m.app.meetingDraft?.date).toBe('2026-11-24');
    m.app.closeMeetingForm();
    press(cell(root, TODAY), 'n');
    expect(m.app.meetingDraft?.date).toBe(TODAY);
  });
});

describe('the hour grid', () => {
  const two = [
    meeting('pub/one', `${TODAY}T10:00`, `${TODAY}T11:00`, { location: 'Room 4', participants: { total: 3 } }),
    meeting('pub/two', `${TODAY}T10:30`, `${TODAY}T11:30`),
    meeting('pub/free', `${TODAY}T14:00`, `${TODAY}T15:00`),
    meeting('pub/all', TODAY, TODAY, { all_day: true, time: undefined, starts_at: TODAY, ends_at: TODAY }),
  ];
  async function week(items = two) {
    const shown = await show(items);
    press(cell(shown.root, TODAY), 'w');
    await until(() => shown.root.querySelector('[data-timegrid]') !== null);
    await settle();
    return shown;
  }

  it('is loaded with the key w: seven columns, blocks with the sign of an overlap, the all-day meeting and the task above', async () => {
    const { root } = await week();
    expect(root.querySelector('[data-timegrid]')?.getAttribute('data-timegrid')).toBe('week');
    expect(root.querySelectorAll('[data-col]')).toHaveLength(7);
    expect(root.querySelectorAll('.block[data-meeting]')).toHaveLength(3);
    expect(block(root, 'pub/one').querySelector('[data-conflict]')).not.toBeNull();
    expect(block(root, 'pub/free').querySelector('[data-conflict]')).toBeNull();
    const bar = root.querySelector(`[data-allday="${TODAY}"]`)!;
    expect(bar.querySelector('[data-meeting="pub/all"]')).not.toBeNull();
    expect(bar.querySelector('[data-task="pub/due"]')).not.toBeNull();
    expect(root.querySelector('[data-now]')).not.toBeNull();
    // the table of the month is gone
    expect(root.querySelector('td[data-day]')).toBeNull();
  });

  it('puts overlapping blocks side by side', async () => {
    const { root } = await week();
    const left = (id: string) => (root.querySelector<HTMLElement>(`.block[data-meeting="${id}"]`)!.style.left);
    expect(left('pub/one')).toContain('0%');
    expect(left('pub/two')).toContain('50%');
  });

  it('moves a meeting by a quarter hour with Shift+arrow, on the version it showed', async () => {
    const { m, root } = await week();
    press(block(root, 'pub/free'), 'ArrowDown', { shiftKey: true });
    await settle();
    expect(sent(m)).toEqual([
      { op: 'meeting_set', id: 'pub/free', patch: { date: TODAY, time: '14:15', duration: '1h', end: null }, if_match: 'sha256:pub/free' },
    ]);
  });

  it('moves it to the next day with Shift+Right and changes the length with Ctrl+Shift+Down', async () => {
    const { m, root } = await week();
    press(block(root, 'pub/free'), 'ArrowRight', { shiftKey: true });
    await settle();
    press(block(root, 'pub/free'), 'ArrowDown', { shiftKey: true, ctrlKey: true });
    await settle();
    expect(sent(m).map((op) => (op.op === 'meeting_set' ? op.patch : null))).toEqual([
      { date: '2026-11-21', time: '14:00', duration: '1h', end: null },
      { date: TODAY, time: '14:00', duration: '1h15m', end: null },
    ]);
  });

  it('writes nothing where the engine cannot write meetings, or the page is read only', async () => {
    const shown = await show(two, ['meetings', 'meeting']);
    press(cell(shown.root, TODAY), 'w');
    await until(() => shown.root.querySelector('[data-timegrid]') !== null);
    press(block(shown.root, 'pub/free'), 'ArrowDown', { shiftKey: true });
    await settle();
    expect(sent(shown.m)).toEqual([]);
    expect(shown.root.querySelector('[data-resize]')).toBeNull();
  });

  it('opens a meeting with Enter, and the keys d and m switch to the day and back to the month', async () => {
    const { m, root } = await week();
    block(root, 'pub/free').click();
    expect(m.app.meetingOpen).toBe('pub/free');
    press(root.querySelector('[data-head]')!, 'd');
    await settle();
    expect(root.querySelector('[data-timegrid]')?.getAttribute('data-timegrid')).toBe('day');
    expect(root.querySelectorAll('[data-col]')).toHaveLength(1);
    // more room in the block of a day: the place and the participants
    expect(block(root, 'pub/one').textContent).toContain('Room 4');
    expect(block(root, 'pub/one').textContent).toContain('3');
    press(root.querySelector('[data-head]')!, 'm');
    await settle();
    expect(root.querySelector('[data-timegrid]')).toBeNull();
    expect(root.querySelector('td[data-day]')).not.toBeNull();
  });

  it('does not read m, w, d or n as a mode where the person types', async () => {
    const { root } = await week();
    const place = root.querySelector<HTMLSelectElement>('[data-calendar-place]')!;
    press(place, 'm');
    await settle();
    expect(root.querySelector('[data-timegrid]')).not.toBeNull();
  });
});
