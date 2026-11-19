// The meetings of the app on a hub in memory: the form opened for a task, the quick line read into it (nothing
// written), the meeting made with its participants and its cover, and the dry run that names it.
import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { make, snapshot } from './appDouble';
import type { Result } from './contract';
import { task } from './fixtures';
import { emptyMeetingForm } from './meetings';

const CAPS = ['meetings', 'meeting', 'meeting_ops', 'meeting_parse', 'attach'];

async function ready(capabilities: string[] = CAPS) {
  const m = make({ token: 't', now: Date.UTC(2026, 10, 19, 9, 40) });
  m.hub.capabilities = capabilities;
  m.hub.doc = snapshot([task('pub/a', { etag: 'e1' }), task('lib/b', { etag: 'e2' })]);
  await m.app.start(null);
  expect(m.app.phase).toBe('ready');
  m.app.stop();
  return m;
}

const uploaded = (id: string, asset: string) =>
  ({
    kind: 'tasks.result',
    ok: true,
    dry_run: false,
    results: [{ n: 1, op: 'attach', id, ok: true, outcome: 'attached', asset, link: `![x](${asset})`, changed_ids: [id] }],
  }) as unknown as Result;

describe('the form of a new meeting', () => {
  it('opens for a task, in the task area, and not without the engine making meetings', async () => {
    const m = await ready();
    m.app.openMeetingForm({ tasks: ['lib/b'] });
    expect(m.app.meetingDraft).toMatchObject({ area: 'lib', tasks: ['lib/b'], title: '' });
    m.app.closeMeetingForm();
    expect(m.app.meetingDraft).toBeNull();

    const reading = await ready(['meetings', 'meeting']);
    expect(reading.app.canMeetings).toBe(true);
    expect(reading.app.canMakeMeetings).toBe(false);
    reading.app.openMeetingForm({ tasks: ['pub/a'] });
    expect(reading.app.meetingDraft).toBeNull();
  });

  it('takes the quick line as the engine read it, writes nothing, and says what it could not read', async () => {
    const m = await ready();
    m.hub.parseAnswer = {
      title: 'Sync mit Rick',
      fields: { date: '2026-11-23', time: '14:00', end: '15:00', tasks: ['lib/b'], notify: ['-15m'] },
      all_day: false,
      assumed: [],
      problems: ['@@'],
    };
    await m.app.quickMeeting('Mo 14:00-15:00 Sync mit Rick #lib/b !-15m @@');
    expect(m.hub.meetingParses).toEqual(['Mo 14:00-15:00 Sync mit Rick #lib/b !-15m @@']);
    expect(m.hub.sent).toEqual([]);
    expect(m.app.meetingDraft).toMatchObject({ area: 'lib', title: 'Sync mit Rick', date: '2026-11-23', time: '14:00', endMode: 'end', end: '15:00', tasks: ['lib/b'], notify: ['-15m'] });
    expect(m.app.meetingNotes).toEqual({ problems: ['@@'], assumedDay: false });
  });

  it('tells a line the engine refuses, and opens no form', async () => {
    const m = await ready();
    m.hub.parseAnswer = new ApiError(400, 'invalid_argument', 'no meeting in this line');
    await m.app.quickMeeting('???');
    expect(m.app.meetingDraft).toBeNull();
    expect(m.app.toast?.kind).toBe('error');
    expect(m.app.toast?.text).toContain('no meeting in this line');
  });

  it('asks the engine for a dry run of the meeting, and for nothing while the title is empty', async () => {
    const m = await ready();
    const form = { ...emptyMeetingForm('pub', '2026-11-19T09:40'), title: 'Sync' };
    expect(await m.app.previewMeeting({ ...form, title: ' ' })).toEqual({ kind: 'unknown' });
    expect(m.hub.sent).toEqual([]);
    m.hub.next_ops = {
      kind: 'tasks.result',
      ok: true,
      dry_run: true,
      results: [{ n: 1, op: 'meeting_new', id: 'pub/sync-2026-11-19', ok: true, outcome: 'would_create', changed_ids: [] }],
    } as unknown as Result;
    expect(await m.app.previewMeeting(form)).toEqual({ kind: 'ok', id: 'pub/sync-2026-11-19' });
    expect(m.hub.sent[0]).toMatchObject({ dry_run: true, ops: [{ op: 'meeting_new', area: 'pub', title: 'Sync' }] });
    m.hub.next_ops = {
      kind: 'tasks.result',
      ok: false,
      dry_run: true,
      results: [{ n: 1, op: 'meeting_new', ok: false, outcome: 'failed', changed_ids: [], error: { code: 'invalid_argument', message: 'end before start', retryable: false } }],
    } as unknown as Result;
    expect(await m.app.previewMeeting(form)).toEqual({ kind: 'refused', message: 'end before start' });
  });
});

describe('making a meeting', () => {
  it('makes it, writes its participants, takes the first image as its cover, attaches the rest and opens its page', async () => {
    const m = await ready();
    const sent: [string, string, string | undefined][] = [];
    const hub = m.hub as unknown as { upload: (id: string, file: File, kind?: string) => Promise<Result> };
    hub.upload = async (id, file, kind) => {
      sent.push([id, file.name, kind]);
      return uploaded(id, `assets/${kind === 'image' ? 'images' : 'audio'}/${file.name}`);
    };
    m.app.openMeetingForm({ tasks: ['pub/a'] });
    const form = {
      ...emptyMeetingForm('pub', '2026-11-19T09:40', ['pub/a']),
      title: 'Sync',
      participants: [
        { name: 'Rick', email: 'rick@example.org', role: 'Organisator' },
        { name: '', email: '', role: '' },
      ],
    };
    const files = [new File(['a'], 'note.m4a', { type: 'audio/mp4' }), new File(['p'], 'cover.png', { type: 'image/png' })];
    expect(await m.app.createMeeting(form, files, false, true)).toBe('pub/made-meeting');
    const ops = m.hub.sent.map((r) => r.ops[0]);
    expect(ops[0]).toMatchObject({ op: 'meeting_new', area: 'pub', title: 'Sync', fields: { tasks: ['pub/a'] }, lang: 'de' });
    expect(ops[1]).toEqual({ op: 'set_section', id: 'pub/made-meeting', heading: '## Teilnehmer', text: '- [ ] Rick <rick@example.org> (Organisator)' });
    expect(ops[2]).toEqual({ op: 'meeting_set', id: 'pub/made-meeting', patch: { cover: 'assets/images/cover.png' } });
    // the image first (it becomes the cover), then the recording into its own folder
    expect(sent).toEqual([
      ['pub/made-meeting', 'cover.png', 'image'],
      ['pub/made-meeting', 'note.m4a', 'audio'],
    ]);
    expect(m.app.meetingDraft).toBeNull();
    expect(m.app.meetingOpen).toBe('pub/made-meeting');
  });

  it('keeps the form open when the engine refuses the meeting', async () => {
    const m = await ready();
    m.app.openMeetingForm();
    m.hub.next_ops = {
      kind: 'tasks.result',
      ok: false,
      dry_run: false,
      results: [{ n: 1, op: 'meeting_new', ok: false, outcome: 'failed', changed_ids: [], error: { code: 'invalid_argument', message: 'bad date', retryable: false } }],
    } as unknown as Result;
    expect(await m.app.createMeeting({ ...emptyMeetingForm('pub', '2026-11-19T09:40'), title: 'X' })).toBeUndefined();
    expect(m.hub.sent).toHaveLength(1);
    expect(m.app.meetingDraft).not.toBeNull();
    expect(m.app.meetingOpen).toBeNull();
  });
});
