// @vitest-environment jsdom
// The extras of the meeting form (concept 4.4, 7.3): the meetings a new one would share its time with are named before
// it is saved, `overlap: ok` takes the warning away, and "preparation task" asks the engine for it in `meeting_new`.
// Without the capabilities the boxes are not offered. The meetings here have no zone: the machine's zone does not
// matter (the zones themselves are tested in zones.test.ts).
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import type { MeetingEntry } from '../lib/contract';
import { task } from '../lib/fixtures';
import MeetingForm from './MeetingForm.svelte';

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
  this.dispatchEvent(new Event('close'));
};

type Made = ReturnType<typeof make>;
const ALL = ['meetings', 'meeting', 'meeting_ops', 'meeting_prep', 'meeting_overlap_ok'];

function meeting(id: string, starts: string, ends: string, more: Partial<MeetingEntry> = {}): MeetingEntry {
  return {
    id,
    area: 'pub',
    slug: id.split('/')[1] ?? id,
    title: `Meeting ${id}`,
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
  for (let i = 0; i < 8; i += 1) {
    await tick();
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
  }
}

/** The form on 2026-11-25 from 11:00 for an hour (the next full hour of the clock of the double). */
async function open(caps = ALL, items: MeetingEntry[] = []): Promise<HTMLElement> {
  made = make({ token: 't', now: new Date('2026-11-24T10:00:00').getTime() });
  made.hub.capabilities = caps;
  made.hub.meetingItems = items;
  made.hub.doc = snapshot([task('pub/a')]);
  await made.app.start(null);
  made.app.openMeetingForm({ date: '2026-11-25', time: '11:00', duration: '60m' });
  const root = document.createElement('div');
  document.body.append(root);
  mounted = mount(MeetingForm, { target: root, props: { app: made.app } });
  await settle();
  return root;
}

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

describe('the conflicts of a new meeting', () => {
  const day = [
    meeting('pub/sync', '2026-11-25T11:30', '2026-11-25T12:30'),
    meeting('pub/gone', '2026-11-25T11:00', '2026-11-25T12:00', { status: 'cancelled' }),
    meeting('pub/free', '2026-11-25T11:00', '2026-11-25T12:00', { overlap: 'ok' }),
    meeting('pub/after', '2026-11-25T12:00', '2026-11-25T13:00'),
  ];

  it('names the meetings at the same time, and none with overlap: ok', async () => {
    const root = await open(ALL, day);
    await vi.waitFor(() => expect(root.querySelector('[data-meeting-conflicts]')).not.toBeNull());
    expect([...root.querySelectorAll('[data-conflict-id]')].map((li) => li.getAttribute('data-conflict-id'))).toEqual(['pub/sync']);
    expect(root.querySelector('[data-meeting-conflicts]')?.textContent).toContain('Gleichzeitig mit 1 Meeting(s):');
    const ok = root.querySelector<HTMLInputElement>('[data-meeting-overlap-ok]')!;
    ok.click();
    await settle();
    expect(root.querySelector('[data-meeting-conflicts]')).toBeNull();
  });

  it('asks the hub again only when the time changes, not for a key of the title', async () => {
    const root = await open(ALL, day);
    await vi.waitFor(() => expect(root.querySelector('[data-meeting-conflicts]')).not.toBeNull());
    const asked = made!.hub.meetingQueries.length;
    const title = root.querySelector<HTMLInputElement>('[data-meeting-title]')!;
    for (const text of ['S', 'Sy', 'Syn', 'Sync']) {
      title.value = text;
      title.dispatchEvent(new Event('input', { bubbles: true }));
      await settle();
      await new Promise((r) => setTimeout(r, 300));
    }
    expect(made!.hub.meetingQueries.length).toBe(asked);
    const time = root.querySelector<HTMLInputElement>('input[type="time"]')!;
    time.value = '12:30';
    time.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(made!.hub.meetingQueries.length).toBeGreaterThan(asked));
    await vi.waitFor(() => expect([...root.querySelectorAll('[data-conflict-id]')].map((li) => li.getAttribute('data-conflict-id'))).toEqual(['pub/after']));
  });

  it('says nothing for an all-day meeting', async () => {
    const root = await open(ALL, day);
    await vi.waitFor(() => expect(root.querySelector('[data-meeting-conflicts]')).not.toBeNull());
    const allDay = [...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((b) => b.parentElement?.textContent?.includes('Ganztägig'))!;
    allDay.click();
    await settle();
    expect(root.querySelector('[data-meeting-conflicts]')).toBeNull();
  });
});

describe('the preparation task and overlap: ok', () => {
  it('sends them with meeting_new', async () => {
    const root = await open();
    const title = root.querySelector<HTMLInputElement>('[data-meeting-title]')!;
    title.value = 'Workshop';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector<HTMLInputElement>('[data-meeting-prep]')!.click();
    root.querySelector<HTMLInputElement>('[data-meeting-overlap-ok]')!.click();
    await settle();
    root.querySelector<HTMLButtonElement>('[data-meeting-create]')!.click();
    await vi.waitFor(() => expect(made!.hub.sent.some((r) => !r.dry_run)).toBe(true));
    const op = made!.hub.sent.find((r) => !r.dry_run)?.ops[0];
    expect(op).toMatchObject({ op: 'meeting_new', title: 'Workshop', prep: true, fields: { date: '2026-11-25', time: '11:00', overlap: 'ok' } });
  });

  it('offers neither box without the capabilities', async () => {
    const root = await open(['meetings', 'meeting', 'meeting_ops']);
    expect(root.querySelector('[data-meeting-prep]')).toBeNull();
    expect(root.querySelector('[data-meeting-overlap-ok]')).toBeNull();
  });
});
