// @vitest-environment jsdom
// The images of a meeting in a DOM: a section with an image below `assets/` of the meeting's folder is drawn with the
// image (a `blob:` address of the page), a section without one stays its text with its lines as written, and a meeting
// without a folder asks for nothing.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import type { MeetingEntry, TaskEntry } from '../lib/contract';
import { task } from '../lib/fixtures';
import MeetingPage from './MeetingPage.svelte';

type Made = ReturnType<typeof make>;

const NOW = new Date('2026-11-20T10:00:00').getTime();
let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;

beforeEach(() => {
  let n = 0;
  vi.stubGlobal(
    'URL',
    Object.assign(globalThis.URL, {
      createObjectURL: () => `blob:http://localhost/m${(n += 1)}`,
      revokeObjectURL: () => undefined,
    }),
  );
});

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await tick();
    flushSync();
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
  }
}

function meeting(folder: boolean): MeetingEntry {
  return {
    id: 'pub/old',
    area: 'pub',
    slug: 'old',
    title: 'Meeting with pictures',
    status: 'done',
    date: '2026-11-01',
    time: '10:00',
    all_day: false,
    starts_at: '2026-11-01T10:00',
    ends_at: '2026-11-01T11:00',
    tasks: ['pub/a'],
    notify: [],
    tags: [],
    summary: '',
    participants: { total: 0 },
    agenda: { total: 0 },
    followups: { total: 0 },
    has_result: true,
    has_decisions: true,
    has_protocol: false,
    ...(folder ? { folder: true } : {}),
    file: folder ? 'pub/MEETINGS/old/old.md' : 'pub/MEETINGS/old.md',
    etag: 'sha256:old',
    valid: true,
    problems: [],
  } as MeetingEntry;
}

const BODY = '## Beschlüsse\n\nFirst decision\nSecond decision\n\n## Ergebnis\n\nThe board: ![Board](assets/boards/b.svg)\n';

async function open(folder: boolean) {
  const m = make({ token: 't', now: NOW });
  made = m;
  m.hub.capabilities = ['meetings', 'meeting', 'meeting_ops'];
  m.hub.doc = snapshot([task('pub/a', { etag: 'e1', meetings: ['pub/old'] } as Partial<TaskEntry>)]);
  m.hub.meetingItems = [meeting(folder)];
  m.hub.meetingBodies.set('pub/old', { body: BODY } as never);
  m.hub.assetAnswers.set('assets/boards/b.svg', new Blob(['<svg/>'], { type: 'image/svg+xml' }));
  await m.app.start(null);
  const target = document.createElement('div');
  document.body.append(target);
  mounted = mount(MeetingPage, { target, props: { app: m.app } });
  m.app.openMeeting('pub/old');
  await settle();
  return { m, target };
}

describe('the images of a meeting', () => {
  // jsdom has no modal dialogs
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };

  it('draws the image of a section and keeps the lines of a section without one', async () => {
    const { m, target } = await open(true);
    const result = target.querySelector('section[aria-labelledby="meeting-result"]');
    expect(result?.querySelector('img')?.getAttribute('src')).toMatch(/^blob:/);
    expect(result?.querySelector('img')?.getAttribute('alt')).toBe('Board');
    const decisions = target.querySelector('section[aria-labelledby="meeting-decisions"]');
    expect(decisions?.querySelector('pre')?.textContent).toBe('First decision\nSecond decision');
    expect(m.hub.assetReads).toEqual(['meeting pub/old assets/boards/b.svg']);
  });

  it('asks for nothing for a meeting without a folder, and shows its text as written', async () => {
    const { m, target } = await open(false);
    expect(target.querySelector('img')).toBeNull();
    expect(m.hub.assetReads).toEqual([]);
    expect(target.querySelector('section[aria-labelledby="meeting-result"] pre')?.textContent).toContain('![Board](assets/boards/b.svg)');
  });
});
