// @vitest-environment jsdom
// The tile Follow-up of the overview: it reads the meetings of the last weeks and names those over and still planned, or
// done without a result; "Mark as done" closes one on the version read, "No result is fine" puts one away in this
// browser (nothing is written), and the tile goes when nothing is left. Without the meetings of the engine it reads
// nothing and is not there.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import type { MeetingEntry, Snapshot } from '../lib/contract';
import { task } from '../lib/fixtures';
import Today from './Today.svelte';

type Made = ReturnType<typeof make>;
let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

/** 2026-11-20 10:00 on the wall of this machine. */
const NOW = new Date('2026-11-20T10:00:00').getTime();

function meeting(id: string, day: string, status: 'planned' | 'done', more: Partial<MeetingEntry> = {}): MeetingEntry {
  return {
    id,
    area: 'pub',
    slug: id.split('/')[1] ?? id,
    title: `Meeting ${id}`,
    status,
    date: day,
    time: '09:00',
    all_day: false,
    starts_at: `${day}T09:00`,
    ends_at: `${day}T10:00`,
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

async function overview(caps: string[], prefs = new Map<string, string>()): Promise<{ m: Made; target: HTMLElement; prefs: Map<string, string> }> {
  const m = make({ token: 't', now: NOW, prefs });
  made = m;
  m.hub.capabilities = caps;
  m.hub.doc = {
    ...snapshot([task('pub/a', { title: 'A task' })]),
    plans: [],
    projects: [],
    plan: {
      summary: { tasks: 1, ready: 1, decision: 0, waiting: 0, stuck: 0, freed: 0, parked: 0 },
      critical_path: { days: 0, path: [], unknown_effort: 0 },
      stage_sizes: [],
      cycles: [],
      conflict_groups: [],
      warnings: [],
    },
    estimate: { tasks: 1, days: 0, n_with_effort: 0, n_without_effort: 1, value: 0, n_with_value: 0, quick_wins: [], unestimated: [] },
  } as unknown as Snapshot;
  m.hub.meetingItems = [
    meeting('pub/over', '2026-11-18', 'planned'),
    meeting('pub/empty', '2026-11-19', 'done'),
    meeting('pub/with-result', '2026-11-19', 'done', { has_result: true }),
    meeting('pub/coming', '2026-11-24', 'planned'),
  ];
  await m.app.start(null);
  const target = document.createElement('div');
  document.body.append(target);
  mounted = mount(Today, { target, props: { app: m.app } });
  await tick();
  flushSync();
  return { m, target, prefs };
}

const tile = (target: HTMLElement) => target.querySelector('[data-tile="review"]');
const buttons = (target: HTMLElement) => [...(tile(target)?.querySelectorAll('button') ?? [])];

describe('the tile Follow-up', () => {
  it('names the meetings over and still planned or done without a result, closes one and puts one away', async () => {
    const { m, target, prefs } = await overview(['meetings', 'meeting', 'meeting_ops']);
    await vi.waitFor(() => expect(tile(target)?.querySelectorAll('li')).toHaveLength(2));
    expect(tile(target)?.textContent).toContain('Nachbereitung (2)');
    expect(tile(target)?.textContent).toContain('Meeting pub/empty');
    expect(tile(target)?.textContent).toContain('erledigt, ohne Ergebnis');
    expect(tile(target)?.textContent).not.toContain('pub/with-result');
    expect(tile(target)?.textContent).not.toContain('pub/coming');

    // Only the planned one can be marked done here; the done one is opened to add its result.
    const close = buttons(target).filter((b) => b.textContent === 'Als erledigt markieren');
    expect(close).toHaveLength(1);
    // What the engine's close leaves in the vault, read by the tile after the write.
    m.hub.meetingItems = m.hub.meetingItems.map((x) => (x.id === 'pub/over' ? { ...x, status: 'done', has_result: true } : x));
    close[0]!.click();
    await vi.waitFor(() => expect(m.hub.sent).toHaveLength(1));
    expect(m.hub.sent[0]?.ops).toEqual([{ op: 'meeting_close', id: 'pub/over', if_match: 'sha256:pub/over' }]);
    await vi.waitFor(() => expect(tile(target)?.querySelectorAll('li')).toHaveLength(1));

    // Put away: nothing written, kept in this browser, and the tile goes once nothing is left.
    (buttons(target).find((b) => b.getAttribute('aria-label') === 'Ohne Ergebnis ok: Meeting pub/empty') as HTMLButtonElement).click();
    flushSync();
    expect(m.hub.sent).toHaveLength(1);
    expect(JSON.parse(prefs.get('tasks-desktop.review-dismissed') ?? '[]')).toEqual(['pub/empty']);
    await vi.waitFor(() => expect(tile(target)).toBeNull());
  });

  it('reads nothing and is not there without the meetings of the engine', async () => {
    const { m, target } = await overview([]);
    await tick();
    expect(tile(target)).toBeNull();
    expect(m.hub.meetingQueries).toEqual([]);
  });
});
