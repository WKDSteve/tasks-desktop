// @vitest-environment jsdom
// The view Meetings in a DOM: the parts (today, this week, later, series, past), the mark on a past meeting with no
// minutes and no result, the filters, a click that opens the meeting and the key n that makes one. The engine's reading
// is the browser tests'.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import { addDays } from '../lib/calendar';
import type { MeetingEntry } from '../lib/contract';
import MeetingsView from './MeetingsView.svelte';

type Made = ReturnType<typeof make>;

const NOW = new Date('2026-11-24T10:00:00').getTime();
const TODAY = '2026-11-24';

function meeting(id: string, day: string, more: Partial<MeetingEntry> = {}): MeetingEntry {
  return {
    id,
    area: 'pub',
    title: `Meeting ${id}`,
    summary: '',
    tags: [],
    status: 'planned',
    date: day,
    time: '10:00',
    all_day: false,
    starts_at: `${day}T10:00`,
    ends_at: `${day}T11:00`,
    tasks: [],
    participants: { total: 0 },
    has_protocol: false,
    has_result: false,
    ...more,
  } as unknown as MeetingEntry;
}

let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await tick();
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
  }
}

async function show(items: MeetingEntry[], caps: string[] = ['meetings', 'meeting', 'meeting_ops']): Promise<HTMLElement> {
  const m = make({ token: 't', now: NOW });
  made = m;
  m.hub.capabilities = caps;
  m.hub.meetingItems = items;
  m.hub.doc = snapshot([]);
  await m.app.start(null);
  const root = document.createElement('div');
  document.body.append(root);
  mounted = mount(MeetingsView, { target: root, props: { app: m.app } });
  await settle();
  return root;
}

const idsIn = (root: HTMLElement, part: string): string[] =>
  [...root.querySelectorAll<HTMLElement>(`[data-part="${part}"] [data-meeting]`)].map((b) => b.dataset.meeting!);

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

describe('the view Meetings', () => {
  it('lays the meetings into the parts and marks a past one with no minutes and no result', async () => {
    const root = await show([
      meeting('pub/now', TODAY),
      meeting('pub/sun', '2026-11-29'),
      meeting('pub/later', addDays(TODAY, 20)),
      meeting('pub/bare', addDays(TODAY, -5)),
      meeting('pub/noted', addDays(TODAY, -6), { has_protocol: true }),
    ]);
    expect(idsIn(root, 'today')).toEqual(['pub/now']);
    expect(idsIn(root, 'week')).toEqual(['pub/sun']);
    expect(idsIn(root, 'later')).toEqual(['pub/later']);
    expect(idsIn(root, 'past')).toEqual(['pub/bare', 'pub/noted']);
    const marked = [...root.querySelectorAll<HTMLElement>('[data-followup]')].map((e) => e.closest('[data-meeting]')?.getAttribute('data-meeting'));
    expect(marked).toEqual(['pub/bare']);
  });

  it('lists a series once, with its next occurrence, and opens that', async () => {
    const root = await show([
      meeting('pub/s1', addDays(TODAY, 2), { series: 'pub/weekly', title: 'Weekly' }),
      meeting('pub/s2', addDays(TODAY, 9), { series: 'pub/weekly', title: 'Weekly' }),
    ]);
    const row = root.querySelector<HTMLElement>('[data-series="pub/weekly"]');
    expect(row).not.toBeNull();
    row!.click();
    expect(made!.app.meetingOpen).toBe('pub/s1');
  });

  it('filters by the search words and says so when nothing is left', async () => {
    const root = await show([meeting('pub/a', TODAY, { title: 'Budget' }), meeting('pub/b', TODAY, { title: 'Lunch' })]);
    const search = root.querySelector<HTMLInputElement>('[data-meetings-search]')!;
    search.value = 'budget';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(idsIn(root, 'today')).toEqual(['pub/a']);
    search.value = 'nothing like it';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(root.querySelector('[data-meetings-empty]')).not.toBeNull();
  });

  it('opens the meeting of a row on a click', async () => {
    const root = await show([meeting('pub/a', TODAY)]);
    root.querySelector<HTMLElement>('[data-part="today"] [data-meeting]')!.click();
    expect(made!.app.meetingOpen).toBe('pub/a');
  });

  it('makes a new meeting with n, not inside a field, and offers no button without meeting_ops', async () => {
    const root = await show([meeting('pub/a', TODAY)]);
    const section = root.querySelector('section')!;
    section.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    await settle();
    expect(made!.app.meetingDraft).not.toBeNull();
    made!.app.closeMeetingForm();
    const search = root.querySelector<HTMLInputElement>('[data-meetings-search]')!;
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    await settle();
    expect(made!.app.meetingDraft).toBeNull();
    if (mounted) void unmount(mounted);
    made?.app.stop();
    document.body.replaceChildren();
    const readOnly = await show([meeting('pub/a', TODAY)], ['meetings', 'meeting']);
    expect(readOnly.querySelector('[data-meetings-new]')).toBeNull();
  });
});
