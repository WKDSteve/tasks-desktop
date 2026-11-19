// @vitest-environment jsdom
// The meetings in a DOM, with their effects running: the section of a task reads its meetings and splits them into
// the coming and the past ones, its button opens the form with the task; the page of a meeting opens on the tab of
// its time, goes round its tabs with the arrows, and writes a tick and a cover on the version it read.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import type { MeetingEntry, TaskEntry } from '../lib/contract';
import { task } from '../lib/fixtures';
import MeetingPage from './MeetingPage.svelte';
import TaskMeetings from './TaskMeetings.svelte';

type Made = ReturnType<typeof make>;

const CAPS = ['meetings', 'meeting', 'meeting_ops', 'meeting_parse', 'attach'];
/** 2026-11-20 10:00 on the wall of this machine. */
const NOW = new Date('2026-11-20T10:00:00').getTime();

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
    tasks: ['pub/a'],
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
  await tick();
  flushSync();
  await new Promise((r) => setTimeout(r, 0));
  flushSync();
}

async function ready(): Promise<Made> {
  const m = make({ token: 't', now: NOW });
  m.hub.capabilities = CAPS;
  m.hub.doc = snapshot([task('pub/a', { etag: 'e1', meetings: ['pub/old', 'pub/next', 'pub/now', 'pub/far'] } as Partial<TaskEntry>)]);
  m.hub.meetingItems = [
    meeting('pub/old', '2026-11-01T10:00', '2026-11-01T11:00'),
    meeting('pub/next', '2026-11-24T14:00', '2026-11-24T15:00', { online: 'https://teams.microsoft.com/l/x', online_service: 'teams' }),
    meeting('pub/now', '2026-11-20T09:30', '2026-11-20T10:30'),
    // years ahead: still one of the task's
    meeting('pub/far', '2031-03-01T09:00', '2031-03-01T10:00'),
  ];
  await m.app.start(null);
  m.app.stop();
  made = m;
  return m;
}

function place(): HTMLElement {
  const target = document.createElement('div');
  document.body.append(target);
  return target;
}

function showTask(app: Made['app'], entry: TaskEntry): HTMLElement {
  const target = place();
  mounted = mount(TaskMeetings, { target, props: { app, task: entry } });
  flushSync();
  return target;
}

function showPage(app: Made['app']): HTMLElement {
  const target = place();
  mounted = mount(MeetingPage, { target, props: { app } });
  flushSync();
  return target;
}

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

describe('the meetings of a task', () => {
  it('reads them, shows the coming ones before the past ones, and opens the form with the task', async () => {
    const m = await ready();
    const entry = m.app.tasks.find((x) => x.id === 'pub/a');
    const target = showTask(m.app, entry as TaskEntry);
    await vi.waitFor(() => expect(target.querySelectorAll('li')).toHaveLength(4));
    expect(m.hub.meetingQueries[0]).toMatchObject({ task: 'pub/a' });
    const headings = [...target.querySelectorAll('h4')].map((h) => h.textContent);
    expect(headings).toHaveLength(2);
    const titles = [...target.querySelectorAll('li .link')].map((b) => b.textContent);
    expect(titles).toEqual(['Meeting pub/now', 'Meeting pub/next', 'Meeting pub/far', 'Meeting pub/old']);
    expect(target.textContent).toContain('Teams');

    (target.querySelector('li .link') as HTMLButtonElement).click();
    expect(m.app.meetingOpen).toBe('pub/now');
    const make = [...target.querySelectorAll('button')].find((b) => !b.classList.contains('link')) as HTMLButtonElement;
    make.click();
    expect(m.app.meetingDraft).toMatchObject({ tasks: ['pub/a'], area: 'pub' });
  });

  it('asks nothing for a task without meetings', async () => {
    const m = await ready();
    const target = showTask(m.app, task('pub/z', {}));
    await settle();
    expect(m.hub.meetingQueries).toEqual([]);
    expect(target.querySelectorAll('li')).toHaveLength(0);
  });
});

describe('the page of a meeting', () => {
  // jsdom has no modal dialogs
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };

  const selected = (target: HTMLElement) => target.querySelector('[role="tab"][aria-selected="true"]')?.id;

  it('opens on the tab of its time, and the arrows go round the tabs', async () => {
    const m = await ready();
    const target = showPage(m.app);
    m.app.openMeeting('pub/now');
    await vi.waitFor(() => expect(selected(target)).toBe('meeting-tab-during'));
    // the meeting is on: the big button to join is there only with an https address
    expect(target.querySelector('.join')).toBeNull();
    const list = target.querySelector('[role="tablist"]') as HTMLElement;
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    flushSync();
    expect(selected(target)).toBe('meeting-tab-result');
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    flushSync();
    expect(selected(target)).toBe('meeting-tab-prep');
    expect(document.activeElement?.id).toBe('meeting-tab-prep');
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    flushSync();
    expect(selected(target)).toBe('meeting-tab-result');

    m.app.closeMeeting();
    await settle();
    m.app.openMeeting('pub/next');
    await vi.waitFor(() => expect(selected(target)).toBe('meeting-tab-prep'));
    const join = target.querySelector('a.join') as HTMLAnchorElement;
    expect(join.href).toBe('https://teams.microsoft.com/l/x');
    expect(join.rel).toContain('noopener');

    m.app.closeMeeting();
    await settle();
    m.app.openMeeting('pub/old');
    await vi.waitFor(() => expect(selected(target)).toBe('meeting-tab-result'));
  });

  it('ticks an agenda item and sets the cover on the version it read', async () => {
    const m = await ready();
    // the files of its folder as the engine lists them: relative to the folder
    m.hub.meetingItems.push(meeting('pub/prep', '2026-11-24T14:00', '2026-11-24T15:00', { folder: true, assets: ['assets/audio/n.m4a', 'assets/images/a.png'] }));
    m.hub.meetingBodies.set('pub/prep', { agenda: [{ n: 1, text: 'Stand', ticked: false }] as never });
    const target = showPage(m.app);
    m.app.openMeeting('pub/prep');
    await vi.waitFor(() => expect(target.querySelector('input[type="checkbox"]')).not.toBeNull());
    const box = target.querySelector('input[type="checkbox"]') as HTMLInputElement;
    box.click();
    await vi.waitFor(() => expect(m.hub.sent).toHaveLength(1));
    expect(m.hub.sent[0]?.ops[0]).toEqual({ op: 'tick_step', id: 'pub/prep', n: 1, done: true, section: 'agenda', if_match: 'sha256:pub/prep' });
    await settle();
    const use = [...target.querySelectorAll('button')].find((b) => b.textContent === 'Als Titelbild verwenden') as HTMLButtonElement;
    expect(use).toBeDefined();
    use.click();
    await vi.waitFor(() => expect(m.hub.sent).toHaveLength(2));
    expect(m.hub.sent[1]?.ops[0]).toEqual({ op: 'meeting_set', id: 'pub/prep', patch: { cover: 'assets/images/a.png' }, if_match: 'sha256:pub/prep' });
  });
});

describe('the documents of a meeting', () => {
  it('adds a link as a line of its section, under the heading the engine wrote', async () => {
    const m = await ready();
    m.hub.meetingBodies.set('pub/next', { body: 'Kurz.\n\n## Unterlagen\n\n- https://example.org/a\n\n## Protokoll\n' });
    const target = showPage(m.app);
    m.app.openMeeting('pub/next');
    await vi.waitFor(() => expect(target.querySelector('form.row input')).not.toBeNull());
    const input = target.querySelector('form.row input') as HTMLInputElement;
    input.value = 'https://example.org/b';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    (target.querySelector('form.row') as HTMLFormElement).requestSubmit();
    await vi.waitFor(() => expect(m.hub.sent).toHaveLength(1));
    expect(m.hub.sent[0]?.ops[0]).toEqual({
      op: 'set_section',
      id: 'pub/next',
      heading: '## Unterlagen',
      text: '- https://example.org/a\n- https://example.org/b',
      if_match: 'sha256:pub/next',
    });
  });
});
