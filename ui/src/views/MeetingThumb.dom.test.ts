// @vitest-environment jsdom
// The small picture of a meeting is read under the id that has a folder: an occurrence of a series without a file has
// none of its own, so its picture is the series'.
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, expect, it, vi } from 'vitest';
import { make } from '../lib/appDouble';
import type { MeetingEntry } from '../lib/contract';
import MeetingThumb from './MeetingThumb.svelte';

let mounted: ReturnType<typeof mount>[] = [];
afterEach(() => {
  for (const m of mounted) void unmount(m);
  mounted = [];
  document.body.replaceChildren();
});

it('reads the picture of an occurrence without a file from its series, of one with a file from itself', async () => {
  const m = make({ token: 't' });
  const meeting = (id: string, extra: Partial<MeetingEntry>) => ({ id, image: 'assets/cover.png', updated: '2026-11-20', ...extra }) as MeetingEntry;
  for (const shown of [
    meeting('pub/sync-2026-11-27', { series: 'pub/sync', virtual: true }),
    meeting('pub/sync-2026-11-20', { series: 'pub/sync' }),
    meeting('pub/plain', {}),
  ]) {
    const target = document.createElement('div');
    document.body.append(target);
    mounted.push(mount(MeetingThumb, { target, props: { app: m.app, meeting: shown } }));
  }
  flushSync();
  await vi.waitFor(() => expect(m.hub.thumbReads).toHaveLength(3));
  expect(m.hub.thumbReads).toEqual(['pub/sync', 'pub/sync-2026-11-20', 'pub/plain']);
  m.app.stop();
});
