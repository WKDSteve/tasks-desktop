// @vitest-environment jsdom
// The acceptance view in a DOM, with its effects running. A tick changes the task's file, the list of the hub brings
// the new etag, and the view reads the task again: while it is read, the card keeps the points it showed (their boxes
// held still) instead of folding up into "Reading the task ...", which drew the eye away at every tick.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import { make, snapshot } from '../lib/appDouble';
import type { TaskDocument } from '../lib/contract';
import { task } from '../lib/fixtures';
import AbnahmeView from './AbnahmeView.svelte';

type Made = ReturnType<typeof make>;

let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;

async function settle(): Promise<void> {
  await tick();
  flushSync();
}

function show(m: Made): HTMLElement {
  made = m;
  const target = document.createElement('div');
  document.body.append(target);
  mounted = mount(AbnahmeView, { target, props: { app: m.app } });
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

const live = (etag: string) => task('pub/a', { etag, tags: ['needs-live-test'], status: 'open' });
const bodyWith = (mark: ' ' | 'x') => `Summary\n\n## Akzeptanz\n\n- [${mark}] The border is drawn\n- [ ] The text is readable\n`;

describe('AbnahmeView, reading a task again', () => {
  it('keeps the card with its points while the changed task is read again, then shows the new state', async () => {
    const m = make({ token: 't' });
    m.hub.doc = snapshot([live('e1')], 'rev:1');
    let body = bodyWith(' ');
    let hold: Promise<void> | null = null;
    m.hub.task = async (id: string): Promise<TaskDocument> => {
      if (hold) await hold;
      return { task: m.hub.doc.tasks.find((t) => t.id === id), body, steps: [] } as never;
    };
    await m.app.start(null);
    const page = show(m);
    await vi.waitFor(() => expect(page.querySelector('fieldset.points')).not.toBeNull());
    const boxes = () => [...page.querySelectorAll<HTMLInputElement>('fieldset.points input[type="checkbox"]')];
    expect(boxes()).toHaveLength(2);
    const first = boxes()[0];

    // The file changed (a tick written): the list brings the new etag, and the read of the task does not answer yet.
    let answer: () => void = () => undefined;
    hold = new Promise<void>((resolve) => (answer = resolve));
    body = bodyWith('x');
    m.hub.doc = snapshot([live('e2')], 'rev:2');
    await m.app.refresh();
    await settle();
    // The card does not fold up: the same boxes are there, held still until the task is read.
    expect(page.textContent).not.toContain('Task wird gelesen');
    expect(boxes()).toHaveLength(2);
    expect(boxes()[0]).toBe(first);
    expect(boxes().every((b) => b.disabled)).toBe(true);

    answer();
    hold = null;
    await vi.waitFor(() => expect(boxes()[0]?.checked).toBe(true));
    expect(boxes()[0]).toBe(first);
    expect(boxes().some((b) => b.disabled)).toBe(false);
  });

  it('a tick the hub refuses leaves the box as the task says, though the card is not drawn anew', async () => {
    const m = make({ token: 't' });
    m.hub.doc = snapshot([live('e1')], 'rev:1');
    m.hub.task = async (id: string): Promise<TaskDocument> =>
      ({ task: m.hub.doc.tasks.find((t) => t.id === id), body: bodyWith(' '), steps: [] }) as never;
    m.hub.next_ops = new ApiError(500, 'engine_failed', 'no');
    await m.app.start(null);
    const page = show(m);
    await vi.waitFor(() => expect(page.querySelector('fieldset.points')).not.toBeNull());
    const box = page.querySelector<HTMLInputElement>('fieldset.points input[type="checkbox"]');
    if (!box) throw new Error('no box');
    box.click();
    expect(box.checked).toBe(true);
    await vi.waitFor(() => expect(m.hub.sent).toHaveLength(1));
    await vi.waitFor(() => expect(box.disabled).toBe(false));
    await settle();
    expect(box.checked).toBe(false);
  });

  it('says it reads a task it never showed', async () => {
    const m = make({ token: 't' });
    m.hub.doc = snapshot([live('e1')], 'rev:1');
    m.hub.task = () => new Promise<TaskDocument>(() => undefined);
    await m.app.start(null);
    const page = show(m);
    await settle();
    expect(page.textContent).toContain('Task wird gelesen');
  });
});
