// @vitest-environment jsdom
// The view of all reminders in a DOM: the list by day with its mark on the due ones, the choice, and the mail of the
// hub: asked for with the chosen ids and the address, shown word for word with what was left out, sent only from the
// preview, and not at all on a hub without a mail account or in the web variant.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '../lib/api';
import { make, snapshot } from '../lib/appDouble';
import { addDays } from '../lib/calendar';
import type { Snapshot } from '../lib/contract';
import { task } from '../lib/fixtures';
import RemindersView from './RemindersView.svelte';

type Made = ReturnType<typeof make>;

let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await tick();
    await Promise.resolve();
    flushSync();
  }
}

/** The view on a vault with a due reminder, a later one and a finished task's. */
async function show(overrides: Parameters<typeof make>[0] = {}) {
  const m = make({ token: 't', ...overrides });
  made = m;
  const today = m.app.today;
  m.hub.doc = {
    ...snapshot([
      task('pub/later', { title: 'Later one', remind: addDays(today, 3), remind_at: '09:30' }),
      task('pub/due', { title: 'Due one', remind: addDays(today, -1), remind_to: ['team@example.org'] }),
      task('pub/plain', { title: 'No reminder' }),
    ]),
    reminders: [{ id: 'pub/old', area: 'pub', title: 'Finished one', remind: addDays(today, -9) }],
  } as unknown as Snapshot;
  await m.app.start(null);
  const root = document.createElement('div');
  document.body.append(root);
  mounted = mount(RemindersView, { target: root, props: { app: m.app } });
  flushSync();
  return { m, root, today };
}

const rowsOf = (root: HTMLElement): string[] => [...root.querySelectorAll<HTMLElement>('[data-reminder]')].map((r) => r.dataset.reminder!);
const box = (root: HTMLElement, id: string): HTMLInputElement =>
  [...root.querySelectorAll<HTMLElement>('[data-reminder]')].find((r) => r.dataset.reminder === id)!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
function tick_(el: HTMLInputElement, on: boolean): void {
  el.checked = on;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}
function type(root: HTMLElement, text: string): void {
  const field = root.querySelector<HTMLInputElement>('input[type="email"]')!;
  field.value = text;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}
const button = (root: HTMLElement, name: string): HTMLButtonElement => root.querySelector<HTMLButtonElement>(`[data-${name}]`)!;

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

describe('RemindersView', () => {
  it('lists every reminder by day, the finished ones too, and marks the due ones', async () => {
    const { root } = await show();
    expect(rowsOf(root)).toEqual(['pub/old', 'pub/due', 'pub/later']);
    const due = [...root.querySelectorAll<HTMLElement>('[data-reminder]')].filter((r) => r.querySelector('[data-due]')).map((r) => r.dataset.reminder);
    expect(due).toEqual(['pub/old', 'pub/due']);
    // A finished task cannot be opened from here; an open one can.
    expect(root.querySelector('[data-reminder="pub/old"] button.link')).toBeNull();
    expect(root.querySelector('[data-reminder="pub/due"] button.link')).not.toBeNull();
    expect(root.querySelector('[data-reminder="pub/due"]')?.textContent).toContain('team@example.org');
    expect(root.querySelector('[data-reminder="pub/later"]')?.textContent).toContain('09:30');
  });

  it('asks the hub for the mail only with a choice and an address, and shows its answer word for word', async () => {
    const { m, root } = await show();
    const preview = () => button(root, 'preview');
    expect(preview().disabled).toBe(true);
    button(root, 'pick="due"').click();
    flushSync();
    expect(box(root, 'pub/due').checked && box(root, 'pub/old').checked && !box(root, 'pub/later').checked).toBe(true);
    expect(preview().disabled, 'no address yet').toBe(true);
    type(root, 'me@example');
    expect(preview().disabled, 'not an address').toBe(true);
    type(root, 'me@example.org');
    expect(preview().disabled).toBe(false);
    m.hub.mailAnswer = {
      account: true,
      sent: false,
      to: 'me@example.org',
      subject: 'Reminders: 1 task',
      text: 'Reminders from tasks-desktop:\n\nthe line of the hub\n',
      included: ['pub/due'],
      leftOut: [{ id: 'pub/old', reason: 'private' }],
      digest: 'sha256:shown',
    };
    preview().click();
    await settle();
    expect(m.hub.mailAsked).toEqual([{ to: 'me@example.org', ids: ['pub/old', 'pub/due'], lang: 'de', send: false }]);
    const shown = root.querySelector('[data-reminders-preview]')!;
    expect(shown.querySelector('pre')?.textContent).toBe('Reminders from tasks-desktop:\n\nthe line of the hub\n');
    expect(shown.textContent).toContain('Reminders: 1 task');
    expect(shown.querySelector('[data-left-out="pub/old"]')?.textContent).toContain('Finished one');
    expect(button(root, 'send').disabled).toBe(false);

    // What is sent is the mail that was shown: its address, its ids and its digest, whatever the hub left out.
    button(root, 'send').click();
    await settle();
    expect(m.hub.mailAsked[1]).toEqual({ to: 'me@example.org', ids: ['pub/due'], lang: 'de', send: true, digest: 'sha256:shown' });
  });

  it('drops an answer that comes after the choice changed: the preview is never the mail of another choice', async () => {
    const { m, root } = await show();
    tick_(box(root, 'pub/due'), true);
    type(root, 'me@example.org');
    let release: () => void = () => undefined;
    m.hub.mailHold = new Promise<void>((resolve) => (release = resolve));
    button(root, 'preview').click();
    await settle();
    // The answer is on its way; another box is ticked meanwhile.
    tick_(box(root, 'pub/later'), true);
    release();
    m.hub.mailHold = null;
    await settle();
    expect(root.querySelector('[data-reminders-preview]'), 'the late answer is not shown').toBeNull();
    expect(root.querySelector('[data-send]')).toBeNull();
    // Asked again, the preview is the one of both.
    button(root, 'preview').click();
    await settle();
    expect(m.hub.mailAsked.map((a) => a.ids)).toEqual([['pub/due'], ['pub/due', 'pub/later']]);
    expect(root.querySelector('[data-reminders-preview] pre')?.textContent).toBe('pub/due\npub/later');
  });

  it('forgets the preview when the list changes under it, and says so when the hub would send another mail', async () => {
    const { m, root, today } = await show();
    tick_(box(root, 'pub/due'), true);
    type(root, 'me@example.org');
    button(root, 'preview').click();
    await settle();
    expect(root.querySelector('[data-reminders-preview]')).not.toBeNull();
    // The vault moves on (a task was renamed): what is shown is not the mail of the list any more.
    m.hub.doc = {
      ...snapshot([task('pub/due', { title: 'Renamed', remind: addDays(today, -1) })], 'rev:2'),
      reminders: [],
    } as unknown as Snapshot;
    await m.app.refresh();
    await settle();
    expect(root.querySelector('[data-reminders-preview]')).toBeNull();

    // The hub refuses a send whose mail is not the one shown: said in words, and the stale preview goes.
    button(root, 'preview').click();
    await settle();
    m.hub.mailAnswer = new ApiError(409, 'mail_changed', 'the mail would not be the one that was shown');
    button(root, 'send').click();
    await settle();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('nichts gesendet');
    expect(root.querySelector('[data-reminders-preview]')).toBeNull();
  });

  it('sends from the preview, and forgets the preview when the choice or the address changes', async () => {
    const { m, root } = await show();
    tick_(box(root, 'pub/later'), true);
    type(root, 'me@example.org');
    button(root, 'preview').click();
    await settle();
    button(root, 'send').click();
    await settle();
    expect(m.hub.mailAsked.map((a) => a.send)).toEqual([false, true]);
    expect(m.hub.mailAsked[1]?.digest).toBe('digest of me@example.org pub/later');
    expect(root.querySelector('[data-reminders-sent]')?.textContent).toContain('me@example.org');
    expect(root.querySelector('[data-send]'), 'a mail that went out is not sent twice').toBeNull();
    // Another choice: what was shown is not the mail of this choice any more.
    tick_(box(root, 'pub/due'), true);
    expect(root.querySelector('[data-reminders-preview]')).toBeNull();
    expect(root.querySelector('[data-reminders-sent]')?.textContent).toBe('');
    button(root, 'preview').click();
    await settle();
    expect(root.querySelector('[data-reminders-preview]')).not.toBeNull();
    type(root, 'you@example.org');
    expect(root.querySelector('[data-reminders-preview]')).toBeNull();
  });

  it('shows the mail of a hub without a mail account, says so, and offers no sending', async () => {
    const { m, root } = await show();
    tick_(box(root, 'pub/due'), true);
    type(root, 'me@example.org');
    m.hub.mailAnswer = { account: false, sent: false, to: 'me@example.org', subject: 'S', text: 'T\n', included: ['pub/due'], leftOut: [], digest: 'sha256:x' };
    button(root, 'preview').click();
    await settle();
    expect(root.querySelector('[data-no-account]')).not.toBeNull();
    expect(button(root, 'send').disabled).toBe(true);
    expect(m.hub.mailAsked).toHaveLength(1);
  });

  it('says in words what the hub refused', async () => {
    const { m, root } = await show();
    tick_(box(root, 'pub/due'), true);
    type(root, 'me@example.org');
    m.hub.mailAnswer = new ApiError(502, 'mail_failed', 'the server did not answer');
    button(root, 'preview').click();
    await settle();
    const alert = root.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('the server did not answer');
    expect(root.querySelector('[data-reminders-preview]')).toBeNull();
    m.hub.mailAnswer = new ApiError(400, 'nothing_to_send', 'x');
    button(root, 'preview').click();
    await settle();
    expect(alert?.textContent).not.toContain('x');
    expect(alert?.textContent).not.toBe('');
  });

  it('lists in the web variant, and says that sending needs the desktop app', async () => {
    const { m, root } = await show({ mode: 'web' });
    expect(rowsOf(root)).toHaveLength(3);
    expect(root.querySelector('[data-reminders-web]')).not.toBeNull();
    expect(root.querySelector('input[type="email"]')).toBeNull();
    expect(m.hub.mailAsked).toEqual([]);
  });

  it('says so when no task has a reminder', async () => {
    const m = make({ token: 't' });
    made = m;
    m.hub.doc = snapshot([task('pub/plain', { title: 'No reminder' })]);
    await m.app.start(null);
    const root = document.createElement('div');
    document.body.append(root);
    mounted = mount(RemindersView, { target: root, props: { app: m.app } });
    flushSync();
    expect(root.querySelector('.none')).not.toBeNull();
    expect(root.querySelector('table')).toBeNull();
  });
});
