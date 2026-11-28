// @vitest-environment jsdom
// The meetings of a task when the detail switches to another task: nothing of the task before is shown while the
// meetings of the new one are read.
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, expect, it, vi } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import type { MeetingEntry, TaskEntry } from '../lib/contract';
import { task } from '../lib/fixtures';
import TaskMeetings from './TaskMeetings.svelte';

const entry = (id: string, of: string): MeetingEntry =>
  ({
    id,
    area: 'pub',
    slug: id,
    title: `Meeting ${id}`,
    status: 'planned',
    date: '2026-11-24',
    time: '14:00',
    starts_at: '2026-11-24T14:00',
    ends_at: '2026-11-24T15:00',
    tasks: [of],
    notify: [],
    tags: [],
  }) as unknown as MeetingEntry;

let mounted: ReturnType<typeof mount> | undefined;
let stop: (() => void) | undefined;
afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  stop?.();
  document.body.replaceChildren();
});

it('shows nothing of the task before while the meetings of the new one are read', async () => {
  const m = make({ token: 't', now: new Date('2026-11-20T10:00:00').getTime() });
  stop = () => m.app.stop();
  m.hub.capabilities = ['meetings', 'meeting', 'meeting_ops'];
  const a = task('pub/a', { meetings: ['pub/ma'] } as Partial<TaskEntry>);
  const b = task('pub/b', { meetings: ['pub/mb'] } as Partial<TaskEntry>);
  m.hub.doc = snapshot([a, b]);
  m.hub.meetingItems = [entry('pub/ma', 'pub/a'), entry('pub/mb', 'pub/b')];
  await m.app.start(null);
  m.app.stop();

  const props = $state({ app: m.app, task: a });
  const target = document.createElement('div');
  document.body.append(target);
  mounted = mount(TaskMeetings, { target, props });
  await vi.waitFor(() => expect(target.textContent).toContain('Meeting pub/ma'));

  let release: () => void = () => undefined;
  m.hub.holdMeetings = new Promise<void>((resolve) => (release = resolve));
  props.task = b;
  flushSync();
  await vi.waitFor(() => expect(m.hub.meetingQueries).toHaveLength(2));
  expect(target.textContent).not.toContain('Meeting pub/ma');
  release();
  await vi.waitFor(() => expect(target.textContent).toContain('Meeting pub/mb'));
});

it('shows no failure of the task before while the meetings of the new one are read', async () => {
  const { ApiError } = await import('../lib/api');
  const m = make({ token: 't', now: new Date('2026-11-20T10:00:00').getTime() });
  stop = () => m.app.stop();
  m.hub.capabilities = ['meetings', 'meeting', 'meeting_ops'];
  const a = task('pub/a', { meetings: ['pub/ma'] } as Partial<TaskEntry>);
  const b = task('pub/b', { meetings: ['pub/mb'] } as Partial<TaskEntry>);
  m.hub.doc = snapshot([a, b]);
  m.hub.meetingItems = [entry('pub/ma', 'pub/a'), entry('pub/mb', 'pub/b')];
  await m.app.start(null);
  m.app.stop();

  m.hub.meetingsError = new ApiError(500, 'internal', 'broken');
  const props = $state({ app: m.app, task: a });
  const target = document.createElement('div');
  document.body.append(target);
  mounted = mount(TaskMeetings, { target, props });
  await vi.waitFor(() => expect(target.querySelector('[role="alert"]')).not.toBeNull());

  let release: () => void = () => undefined;
  m.hub.meetingsError = null;
  m.hub.holdMeetings = new Promise<void>((resolve) => (release = resolve));
  props.task = b;
  flushSync();
  await vi.waitFor(() => expect(m.hub.meetingQueries).toHaveLength(2));
  expect(target.querySelector('[role="alert"]')).toBeNull();
  release();
  await vi.waitFor(() => expect(target.textContent).toContain('Meeting pub/mb'));
});

it('shows of a long series its occurrences with a file and the next one, also when the first page is all past', async () => {
  const m = make({ token: 't', now: new Date('2026-11-20T10:00:00').getTime() });
  stop = () => m.app.stop();
  m.hub.capabilities = ['meetings', 'meeting', 'meeting_ops', 'meeting_series'];
  const a = task('pub/a', { meetings: ['pub/sync'] } as Partial<TaskEntry>);
  m.hub.doc = snapshot([a]);
  const occ = (day: string, virtual: boolean): MeetingEntry =>
    ({
      ...entry(`pub/sync-${day}`, 'pub/a'),
      date: day,
      starts_at: `${day}T14:00`,
      ends_at: `${day}T15:00`,
      series: 'pub/sync',
      occurrence: day,
      ...(virtual ? { virtual: true } : {}),
    }) as MeetingEntry;
  m.hub.meetingItems = [occ('2026-10-30', true), occ('2026-11-06', false), occ('2026-11-13', true), occ('2026-11-27', true), occ('2026-12-04', true)];
  // the engine's page of three holds only past occurrences
  m.hub.meetingPageSize = 3;
  await m.app.start(null);
  m.app.stop();

  const target = document.createElement('div');
  document.body.append(target);
  mounted = mount(TaskMeetings, { target, props: { app: m.app, task: a } });
  await vi.waitFor(() => expect(target.textContent).toContain('Meeting pub/sync-2026-11-27'));
  // the second page holds the rest; more than one page: the coming ones are read from yesterday on as well
  expect(m.hub.meetingQueries.map((q) => [q.since, q.offset])).toEqual([
    ['1900-01-01', undefined],
    ['1900-01-01', 3],
    ['2026-11-19', undefined],
  ]);
  expect(target.textContent).toContain('Meeting pub/sync-2026-11-06');
  expect(target.textContent).not.toContain('pub/sync-2026-10-30');
  expect(target.textContent).not.toContain('pub/sync-2026-11-13');
  expect(target.textContent).not.toContain('pub/sync-2026-12-04');
  expect(target.querySelectorAll('[data-series="pub/sync"]')).toHaveLength(2);
});

it('lists a past occurrence with a file beyond the first page, and reads the coming ones only when the pages run out', async () => {
  const m = make({ token: 't', now: new Date('2026-11-20T10:00:00').getTime() });
  stop = () => m.app.stop();
  m.hub.capabilities = ['meetings', 'meeting', 'meeting_ops', 'meeting_series'];
  const a = task('pub/a', { meetings: ['pub/sync'] } as Partial<TaskEntry>);
  m.hub.doc = snapshot([a]);
  const occ = (day: string, virtual: boolean): MeetingEntry =>
    ({
      ...entry(`pub/sync-${day}`, 'pub/a'),
      date: day,
      starts_at: `${day}T14:00`,
      ends_at: `${day}T15:00`,
      series: 'pub/sync',
      occurrence: day,
      ...(virtual ? { virtual: true } : {}),
    }) as MeetingEntry;
  // The minutes of 13 November lie on the second page, before yesterday: a read from yesterday on does not find them.
  m.hub.meetingItems = [
    occ('2026-10-30', true),
    occ('2026-11-02', true),
    occ('2026-11-06', true),
    occ('2026-11-13', false),
    occ('2026-11-27', true),
    occ('2026-12-04', true),
  ];
  m.hub.meetingPageSize = 3;
  await m.app.start(null);
  m.app.stop();

  const target = document.createElement('div');
  document.body.append(target);
  mounted = mount(TaskMeetings, { target, props: { app: m.app, task: a } });
  await vi.waitFor(() => expect(target.textContent).toContain('Meeting pub/sync-2026-11-27'));
  expect(target.textContent).toContain('Meeting pub/sync-2026-11-13');
  expect(m.hub.meetingQueries).toHaveLength(3);
  if (mounted) void unmount(mounted);
  mounted = undefined;

  // A page of one: the pages run out after MEETING_PAGES (5), and the coming ones are read from yesterday on.
  m.hub.meetingPageSize = 1;
  m.hub.meetingQueries = [];
  mounted = mount(TaskMeetings, { target, props: { app: m.app, task: a } });
  await vi.waitFor(() => expect(target.textContent).toContain('Meeting pub/sync-2026-11-27'));
  expect(m.hub.meetingQueries.map((q) => q.since)).toEqual([...Array(5).fill('1900-01-01'), '2026-11-19']);
});

it('lists the next occurrence of a series the engine cut at its start: the pages from 1900 hold past ones only', async () => {
  const m = make({ token: 't', now: new Date('2026-11-20T10:00:00').getTime() });
  stop = () => m.app.stop();
  m.hub.capabilities = ['meetings', 'meeting', 'meeting_ops', 'meeting_series'];
  const a = task('pub/a', { meetings: ['pub/sync'] } as Partial<TaskEntry>);
  m.hub.doc = snapshot([a]);
  const occ = (day: string): MeetingEntry =>
    ({
      ...entry(`pub/sync-${day}`, 'pub/a'),
      date: day,
      starts_at: `${day}T14:00`,
      ends_at: `${day}T15:00`,
      series: 'pub/sync',
      occurrence: day,
      virtual: true,
    }) as MeetingEntry;
  m.hub.meetingItems = ['2026-10-23', '2026-10-30', '2026-11-06', '2026-11-13', '2026-11-27'].map(occ);
  // as the engine with MAX_OCCURRENCES: four from 1900 on, the coming one beyond the cut; the pages run out before it
  m.hub.meetingCap = 4;
  m.hub.meetingPageSize = 2;
  await m.app.start(null);
  m.app.stop();

  const target = document.createElement('div');
  document.body.append(target);
  mounted = mount(TaskMeetings, { target, props: { app: m.app, task: a } });
  await vi.waitFor(() => expect(target.textContent).toContain('Meeting pub/sync-2026-11-27'));
  expect(m.hub.meetingQueries.map((q) => q.since)).toEqual(['1900-01-01', '1900-01-01', '2026-11-19']);
});
