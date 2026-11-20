// @vitest-environment jsdom
// The meetings on the timeline, in a DOM: a diamond on the day of a meeting on the row of each of its tasks (the same
// meeting on several rows lights up together), a row "Meetings" in the group of a meeting without a task, the status
// as the fill, a click opens the meeting. The engine's reading and the picture are the browser tests'.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import { addDays } from '../lib/calendar';
import type { MeetingEntry } from '../lib/contract';
import { task } from '../lib/fixtures';
import TimelineView from './TimelineView.svelte';

type Made = ReturnType<typeof make>;

const NOW = new Date('2026-11-20T10:00:00').getTime();
const TODAY = '2026-11-20';

function meeting(id: string, day: string, more: Partial<MeetingEntry> = {}): MeetingEntry {
  return {
    id,
    area: 'pub',
    title: `Meeting ${id}`,
    status: 'planned',
    date: day,
    time: '10:00',
    all_day: false,
    starts_at: `${day}T10:00`,
    ends_at: `${day}T11:00`,
    tasks: [],
    ...more,
  } as unknown as MeetingEntry;
}

let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await tick();
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
  }
}

async function show(items: MeetingEntry[], caps: string[] = ['meetings', 'meeting'], pageSize: number | null = null): Promise<HTMLElement> {
  const m = make({ token: 't', now: NOW });
  made = m;
  m.hub.capabilities = caps;
  m.hub.meetingPageSize = pageSize;
  m.hub.meetingItems = items;
  m.hub.doc = snapshot([
    task('pub/first', { title: 'First', start: TODAY, due: addDays(TODAY, 4), etag: 'e1' }),
    task('pub/second', { title: 'Second', due: addDays(TODAY, 2), etag: 'e1' }),
  ]);
  await m.app.start(null);
  const root = document.createElement('div');
  document.body.append(root);
  mounted = mount(TimelineView, { target: root, props: { app: m.app } });
  await settle();
  return root;
}

const diamonds = (root: HTMLElement, id: string): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(`.diamond[data-meeting="${id}"]`)];

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

describe('the meetings on the timeline', () => {
  it('says that only a part of the meetings is shown when the pages run out', async () => {
    // pages of one meeting: five pages hold five of six
    const six = [0, 1, 2, 3, 4, 5].map((i) => meeting(`pub/p${i}`, addDays(TODAY, i - 2), { tasks: ['pub/first'] }));
    const root = await show(six, ['meetings', 'meeting'], 1);
    expect(root.querySelector('[data-meetings-cut]')?.textContent).toBe('Nur die ersten 5 von 6 Meetings dieser Zeit sind zu sehen.');
    if (mounted) void unmount(mounted);
    made?.app.stop();
    document.body.replaceChildren();
    const all = await show(six.slice(0, 5), ['meetings', 'meeting'], 1);
    expect(all.querySelector('[data-meetings-cut]')).toBeNull();
  });

  it('puts the same diamond on the row of each task of a meeting, at its day', async () => {
    const root = await show([meeting('pub/m1', addDays(TODAY, 1), { tasks: ['pub/first', 'pub/second'] })]);
    const found = diamonds(root, 'pub/m1');
    expect(found).toHaveLength(2);
    const rows = found.map((d) => d.closest('.row')?.querySelector('[data-task]')?.getAttribute('data-task'));
    expect(rows.sort()).toEqual(['pub/first', 'pub/second']);
    // one meeting, one name for a screen reader, with its day and state
    expect(found[0]!.getAttribute('aria-label')).toContain('Meeting pub/m1');
    expect(found[0]!.dataset.fill).toBe('hollow');
  });

  it('lights up every diamond of a meeting together, and opens it on a click', async () => {
    const root = await show([meeting('pub/m1', addDays(TODAY, 1), { tasks: ['pub/first', 'pub/second'] })]);
    const [a, b] = diamonds(root, 'pub/m1');
    a!.dispatchEvent(new MouseEvent('mouseenter'));
    await settle();
    expect(b!.classList.contains('hot')).toBe(true);
    a!.dispatchEvent(new MouseEvent('mouseleave'));
    await settle();
    expect(b!.classList.contains('hot')).toBe(false);
    a!.click();
    expect(made!.app.meetingOpen).toBe('pub/m1');
  });

  it('shows the status as the fill', async () => {
    const root = await show([
      meeting('pub/planned', addDays(TODAY, 1), { tasks: ['pub/first'] }),
      meeting('pub/over', addDays(TODAY, -1), { tasks: ['pub/first'] }),
      meeting('pub/done', addDays(TODAY, 1), { tasks: ['pub/first'], status: 'done' }),
      meeting('pub/off', addDays(TODAY, 2), { tasks: ['pub/first'], status: 'cancelled' }),
    ]);
    const fill = (id: string) => diamonds(root, id)[0]?.dataset.fill;
    expect([fill('pub/planned'), fill('pub/over'), fill('pub/done'), fill('pub/off')]).toEqual(['hollow', 'half', 'full', 'cancelled']);
  });

  it('gives a meeting without a task of the group a row "Meetings" of its own', async () => {
    const root = await show([meeting('pub/own', addDays(TODAY, 1))]);
    const row = root.querySelector('[data-meetings-row]');
    expect(row).not.toBeNull();
    expect(row!.closest('.row')!.querySelector('.diamond[data-meeting="pub/own"]')).not.toBeNull();
  });

  it('lists the meetings under the table, where a key reaches them', async () => {
    const root = await show([meeting('pub/own', addDays(TODAY, 1))]);
    const item = root.querySelector('[data-timeline-meetings] button');
    expect(item?.textContent).toContain('Meeting pub/own');
  });

  it('shows no meeting where the engine has none', async () => {
    const root = await show([meeting('pub/m1', addDays(TODAY, 1), { tasks: ['pub/first'] })], ['reorder']);
    expect(root.querySelector('.diamond')).toBeNull();
    expect(root.querySelector('[data-meetings-row]')).toBeNull();
  });
});
