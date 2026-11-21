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

const DOCUMENTS = [
  { n: 1, text: 'Whiteboard', kind: 'asset', href: 'assets/shot.png' },
  { n: 2, text: 'Old sketch', kind: 'asset', href: 'assets/gone.jpg' },
  { n: 3, text: 'Slides', kind: 'asset', href: 'assets/slides.pdf' },
  { n: 4, text: 'Tracker', kind: 'web', href: 'https://tracker.example/x' },
];

async function open(folder: boolean, extra: Record<string, unknown> = {}) {
  const m = make({ token: 't', now: NOW });
  made = m;
  m.hub.capabilities = ['meetings', 'meeting', 'meeting_ops'];
  m.hub.doc = snapshot([task('pub/a', { etag: 'e1', meetings: ['pub/old'] } as Partial<TaskEntry>)]);
  m.hub.meetingItems = [meeting(folder)];
  m.hub.meetingBodies.set('pub/old', { body: BODY, ...extra } as never);
  m.hub.assetAnswers.set('assets/boards/b.svg', new Blob(['<svg/>'], { type: 'image/svg+xml' }));
  m.hub.assetAnswers.set('assets/shot.png', new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }));
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

describe('the images among the documents of a meeting', () => {
  async function documents(folder: boolean) {
    const opened = await open(folder, { documents: DOCUMENTS });
    // The documents are on the tab of the preparation.
    (opened.target.querySelector('#meeting-tab-prep') as HTMLButtonElement).click();
    await settle();
    const list = opened.target.querySelector('section[aria-labelledby="meeting-documents"] ul') as HTMLElement;
    return { ...opened, list, items: [...list.querySelectorAll(':scope > li')] as HTMLElement[] };
  }

  it('shows an image as a small picture that opens large, and a missing one as missing', async () => {
    const { m, target, items } = await documents(true);
    const img = items[0]?.querySelector('[data-document-image="assets/shot.png"] img');
    expect(img?.getAttribute('src')).toMatch(/^blob:/);
    expect(img?.getAttribute('alt')).toBe('Whiteboard');
    expect(img?.getAttribute('width')).toBe('96');
    expect(img?.getAttribute('height')).toBe('96');
    expect(items[0]?.textContent).not.toContain('assets/shot.png');
    expect(items[1]?.querySelector('[data-asset-missing="assets/gone.jpg"]')?.textContent).toBe('Bild fehlt: Old sketch');
    expect(items[1]?.querySelector('img')).toBeNull();

    (img?.closest('button') as HTMLButtonElement).click();
    await settle();
    const large = target.querySelector('dialog.viewer img[data-viewer-image]');
    expect(large?.getAttribute('src')).toBe(img?.getAttribute('src'));
    expect(large?.getAttribute('alt')).toBe('Whiteboard');
    // Only the pictures are read; a PDF below `assets/` is no image.
    expect(m.hub.assetReads.filter((r) => !r.includes('boards/'))).toEqual(['meeting pub/old assets/shot.png', 'meeting pub/old assets/gone.jpg']);
  });

  it('leaves a PDF and a link as they were', async () => {
    const { items } = await documents(true);
    expect(items[2]?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Slides (assets/slides.pdf)');
    expect(items[2]?.querySelector('img, button')).toBeNull();
    const link = items[3]?.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://tracker.example/x');
    expect(link?.textContent).toBe('Tracker');
  });

  it('names the path of an image of a meeting without a folder and asks for nothing', async () => {
    const { m, items } = await documents(false);
    expect(items[0]?.querySelector('img')).toBeNull();
    expect(items[0]?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Whiteboard (assets/shot.png)');
    expect(m.hub.assetReads).toEqual([]);
  });

  it('keeps the space before the role and the address of a participant', async () => {
    const { target } = await open(true, {
      documents: DOCUMENTS,
      participants: [{ n: 1, name: 'Ann', role: 'Chair', email: 'ann@mail.example', present: false }],
    });
    (target.querySelector('#meeting-tab-prep') as HTMLButtonElement).click();
    await settle();
    const person = target.querySelector('section[aria-labelledby="meeting-people-prep"] li label > span');
    expect(person?.textContent).toBe('Ann (Chair) ann@mail.example');
  });
});
