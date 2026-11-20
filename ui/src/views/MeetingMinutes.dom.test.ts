// @vitest-environment jsdom
// The minutes of a meeting in a DOM, with their effects running: a typed line is one `meeting_capture` without
// `if_match` (a checklist several in one request), a line that reached no hub stays as a draft the page names and is
// written with its time once the hub answers a read again, a plain line is turned into a task afterwards, and the tab
// Result makes tasks of the follow-ups, saves the result and the link to the recording.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import { make, snapshot } from '../lib/appDouble';
import type { MeetingEntry, TaskEntry } from '../lib/contract';
import { task } from '../lib/fixtures';
import { MINUTES_DRAFTS_KEY } from '../lib/minutes';
import MeetingPage from './MeetingPage.svelte';

type Made = ReturnType<typeof make>;

const CAPS = ['meetings', 'meeting', 'meeting_ops', 'meeting_parse', 'attach'];
/** 2026-11-20 10:00 on the wall of this machine: the meeting `pub/now` is on. */
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
    has_protocol: true,
    file: `pub/MEETINGS/${id}.md`,
    etag: `sha256:${id}`,
    valid: true,
    problems: [],
    ...more,
  } as MeetingEntry;
}

// jsdom has no modal dialogs
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
};

let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;

async function ready(prefs?: Map<string, string>): Promise<Made> {
  const m = make({ token: 't', now: NOW, ...(prefs ? { prefs } : {}) });
  m.hub.capabilities = CAPS;
  m.hub.doc = snapshot([task('pub/a', { etag: 'e1', meetings: ['pub/now'] } as Partial<TaskEntry>)]);
  m.hub.meetingItems = [meeting('pub/now', '2026-11-20T09:30', '2026-11-20T10:30')];
  m.hub.meetingBodies.set('pub/now', { body: 'Kurz.\n\n## Protokoll\n\n- 09:40 Folie fehlt\n\n## Folgeaufgaben\n' });
  await m.app.start(null);
  m.app.stop();
  made = m;
  return m;
}

function showPage(app: Made['app']): HTMLElement {
  const target = document.createElement('div');
  document.body.append(target);
  mounted = mount(MeetingPage, { target, props: { app } });
  flushSync();
  return target;
}

async function typeAndSend(target: HTMLElement, text: string): Promise<void> {
  const input = target.querySelector('form.entry input') as HTMLInputElement;
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  (target.querySelector('form.entry') as HTMLFormElement).requestSubmit();
  await tick();
}

async function openOn(m: Made): Promise<HTMLElement> {
  const target = showPage(m.app);
  m.app.openMeeting('pub/now');
  await vi.waitFor(() => expect(target.querySelector('form.entry input')).not.toBeNull());
  return target;
}

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

describe('the minutes of a meeting', () => {
  it('shows the lines with their time and sends a typed line as one capture without if_match', async () => {
    const m = await ready();
    const target = await openOn(m);
    expect(target.querySelector('.lines')?.textContent).toContain('Folie fehlt');
    expect(target.querySelector('#minutes-help')?.textContent).toContain('A: Aufgabe');
    await typeAndSend(target, 'A: Folien an Kim');
    await vi.waitFor(() => expect(m.hub.sent).toHaveLength(1));
    expect(m.hub.sent[0]?.ops).toEqual([
      { op: 'meeting_capture', id: 'pub/now', entry: { kind: 'task', text: 'Folien an Kim', at: '10:00' } },
    ]);
    await vi.waitFor(() => expect((target.querySelector('form.entry input') as HTMLInputElement).value).toBe(''));
  });

  it('sends a checklist as several tasks in one request', async () => {
    const m = await ready();
    const target = await openOn(m);
    await typeAndSend(target, '[] Raum; Beamer');
    await vi.waitFor(() => expect(m.hub.sent).toHaveLength(1));
    expect(m.hub.sent[0]?.ops.map((op) => ('entry' in op ? op.entry : null))).toEqual([
      { kind: 'task', text: 'Raum', at: '10:00' },
      { kind: 'task', text: 'Beamer', at: '10:00' },
    ]);
  });

  it('keeps a line that reached no hub as a draft, says so, and writes it with its time once the hub answers a read', async () => {
    const prefs = new Map<string, string>();
    const m = await ready(prefs);
    const target = await openOn(m);
    // The write gets no answer, and the reads after it wait: the page shows the draft meanwhile.
    m.hub.next_ops = new ApiError(0, 'offline', 'no answer');
    let release!: () => void;
    m.hub.holdMeeting = new Promise<void>((r) => (release = r));
    await typeAndSend(target, 'B: Release Montag');
    await vi.waitFor(() => expect(target.querySelector('.drafts')?.textContent).toContain('1 Einträge'));
    expect(JSON.parse(prefs.get(MINUTES_DRAFTS_KEY) ?? '{}')).toEqual({ 'pub/now': [{ kind: 'decision', text: 'Release Montag', at: '10:00' }] });
    expect((target.querySelector('form.entry input') as HTMLInputElement).value).toBe('');
    // The hub answers again: the read comes, and the draft goes out as it was typed, with its time.
    m.hub.holdMeeting = null;
    release();
    await vi.waitFor(() => expect(m.hub.sent).toHaveLength(2));
    expect(m.hub.sent[1]?.ops).toEqual([
      { op: 'meeting_capture', id: 'pub/now', entry: { kind: 'decision', text: 'Release Montag', at: '10:00' } },
    ]);
    await vi.waitFor(() => expect(target.querySelector('.drafts')).toBeNull());
    expect(prefs.get(MINUTES_DRAFTS_KEY)).toBe('{}');
  });

  it('drops a line the engine refused instead of keeping it as a draft', async () => {
    const prefs = new Map<string, string>();
    const m = await ready(prefs);
    const target = await openOn(m);
    m.hub.next_ops = new ApiError(400, 'invalid_argument', 'entry.kind');
    await typeAndSend(target, 'Notiz');
    await vi.waitFor(() => expect(m.hub.sent).toHaveLength(1));
    await tick();
    expect(target.querySelector('.drafts')).toBeNull();
    expect(prefs.get(MINUTES_DRAFTS_KEY)).toBeUndefined();
  });

  it('turns a plain line into a task with its time, on the version read', async () => {
    const m = await ready();
    const target = await openOn(m);
    const turn = target.querySelector('button[aria-label="„Folie fehlt“ zu Aufgabe machen"]') as HTMLButtonElement;
    expect(turn).not.toBeNull();
    turn.click();
    await vi.waitFor(() => expect(m.hub.sent).toHaveLength(1));
    expect(m.hub.sent[0]?.ops).toEqual([
      { op: 'set_section', id: 'pub/now', heading: '## Protokoll', text: '', if_match: 'sha256:pub/now' },
      { op: 'meeting_capture', id: 'pub/now', entry: { kind: 'task', text: 'Folie fehlt', at: '09:40' } },
    ]);
  });
});

describe('the tab Result', () => {
  it('makes tasks of the follow-ups, one or all, and saves the result and the link to the recording', async () => {
    const m = await ready();
    m.hub.meetingBodies.set('pub/now', {
      body: '## Ergebnis\n\nAlt.\n',
      followups: [
        { n: 1, text: 'Mail an Kim', ticked: false },
        { n: 2, text: 'Raum buchen', ticked: false },
        { n: 3, text: 'Schon da', ticked: false, task: 'pub/made' },
      ],
    } as never);
    const target = showPage(m.app);
    m.app.openMeeting('pub/now');
    await vi.waitFor(() => expect(target.querySelector('#meeting-tab-result')).not.toBeNull());
    (target.querySelector('#meeting-tab-result') as HTMLButtonElement).click();
    flushSync();
    const buttons = () => [...target.querySelectorAll('button')];
    expect(buttons().filter((b) => b.textContent === 'Als Task anlegen')).toHaveLength(2);
    buttons().find((b) => b.textContent === 'Als Task anlegen')!.click();
    await vi.waitFor(() => expect(m.hub.sent).toHaveLength(1));
    expect(m.hub.sent[0]?.ops).toEqual([{ op: 'meeting_followups', id: 'pub/now', n: 1 }]);
    await vi.waitFor(() => expect(m.app.saving).toBe(false));
    await tick();
    buttons().find((b) => b.textContent === 'Alle als Tasks anlegen')!.click();
    await vi.waitFor(() => expect(m.hub.sent).toHaveLength(2));
    expect(m.hub.sent[1]?.ops).toEqual([{ op: 'meeting_followups', id: 'pub/now' }]);
    await vi.waitFor(() => expect(m.app.saving).toBe(false));
    await tick();

    const area = target.querySelector('textarea') as HTMLTextAreaElement;
    expect(area.value).toBe('Alt.');
    area.value = 'Neu beschlossen.';
    area.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    (area.closest('form') as HTMLFormElement).requestSubmit();
    await vi.waitFor(() => expect(m.hub.sent).toHaveLength(3));
    expect(m.hub.sent[2]?.ops).toEqual([
      { op: 'set_section', id: 'pub/now', heading: '## Ergebnis', text: 'Neu beschlossen.', if_match: 'sha256:pub/now' },
    ]);
    await vi.waitFor(() => expect(m.app.saving).toBe(false));
    await tick();

    const link = target.querySelector('input[type="url"]') as HTMLInputElement;
    link.value = 'https://example.org/rec';
    link.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    (link.closest('form') as HTMLFormElement).requestSubmit();
    await vi.waitFor(() => expect(m.hub.sent).toHaveLength(4));
    expect(m.hub.sent[3]?.ops).toEqual([
      { op: 'meeting_set', id: 'pub/now', patch: { recording: 'https://example.org/rec' }, if_match: 'sha256:pub/now' },
    ]);
  });
});
