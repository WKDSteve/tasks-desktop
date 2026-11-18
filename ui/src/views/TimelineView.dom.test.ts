// @vitest-environment jsdom
// The timeline in a DOM: its rows, its keys and its table. Shift with an arrow moves the part under the focus and
// writes once, when Shift is let go; Escape gives the move up. A group folds, an arrow joins a task to the one that
// waits for it, and the fields of the table write a date. Dragging and the real engine are the browser tests'.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import { addDays } from '../lib/calendar';
import type { TaskEntry } from '../lib/contract';
import { task } from '../lib/fixtures';
import TimelineView from './TimelineView.svelte';

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

/** The timeline on a vault: a bar of a plan, a task that waits for it (and begins before it ends), one without a date. */
async function show(overrides: Parameters<typeof make>[0] = {}, more: (today: string) => TaskEntry[] = () => []) {
  const m = make({ token: 't', ...overrides });
  made = m;
  const today = m.app.today;
  m.hub.doc = snapshot([
    task('pub/first', { title: 'First', plan: 'pub/app', start: today, due: addDays(today, 4), etag: 'e1' }),
    task('pub/second', { title: 'Second', plan: 'pub/app', due: addDays(today, 2), blocked_by: ['pub/first'], etag: 'e1' }),
    task('pub/loose', { title: 'Loose one', etag: 'e1' }),
    ...more(today),
  ]);
  await m.app.start(null);
  const root = document.createElement('div');
  document.body.append(root);
  mounted = mount(TimelineView, { target: root, props: { app: m.app } });
  flushSync();
  return { m, root, today };
}

const key = (el: Element, type: 'keydown' | 'keyup', name: string, init: KeyboardEventInit = {}): boolean =>
  el.dispatchEvent(new KeyboardEvent(type, { key: name, bubbles: true, cancelable: true, ...init }));
const control = (root: HTMLElement, id: string, column: string): HTMLElement =>
  [...root.querySelectorAll<HTMLElement>(`[data-column="${column}"]`)].find((el) => el.dataset.task === id)!;
const bar = (root: HTMLElement, id: string): HTMLElement =>
  [...root.querySelectorAll<HTMLElement>('[data-bar]')].find((el) => el.dataset.bar === id)!;
const sent = (m: Made): string[] =>
  m.hub.sent.flatMap((r) => r.ops.map((op) => (op.op === 'set' ? `${op.id} ${JSON.stringify(op.patch)}` : op.op)));

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

describe('TimelineView', () => {
  it('draws a bar from start to due and a mark for one date, under the head of their plan, and counts the rest', async () => {
    const { root, today } = await show();
    expect(bar(root, 'pub/first').dataset).toMatchObject({ from: today, to: addDays(today, 4) });
    expect(bar(root, 'pub/first').classList.contains('bar')).toBe(true);
    expect(bar(root, 'pub/second').classList.contains('due')).toBe(true);
    expect(root.querySelector('[data-group="plan:pub/app"]')?.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('[data-timeline-undated]')?.textContent).toContain('1');
    expect(root.querySelector('[data-timeline-today]')).not.toBeNull();
  });

  it('joins a task to the one that waits for it, and says when the arrow points back', async () => {
    const { root } = await show();
    const arrow = root.querySelector('[data-arrow="pub/first>pub/second"]');
    expect(arrow, 'the arrow').not.toBeNull();
    // First ends two days after Second is due.
    expect(arrow?.classList.contains('back')).toBe(true);
    const row = root.querySelector('[data-table-task="pub/second"]');
    expect(row?.textContent).toContain('First');
    expect(row?.querySelector('em')?.textContent).not.toBe('');
  });

  it('folds a group to its head, with the arrows of its tasks', async () => {
    const { root } = await show();
    const fold = root.querySelector<HTMLElement>('[data-group="plan:pub/app"]')!;
    fold.click();
    flushSync();
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelectorAll('[data-bar]')).toHaveLength(0);
    expect(root.querySelectorAll('[data-arrow]')).toHaveLength(0);
    expect(root.querySelector('[data-span="plan:pub/app"]')).not.toBeNull();
  });

  it('gives Tab to one control, and the arrows walk the parts of a bar and the tasks', async () => {
    const { root } = await show();
    const stops = () => [...root.querySelectorAll<HTMLElement>('[data-column]')].filter((el) => el.tabIndex === 0).map((el) => `${el.dataset.task}:${el.dataset.column}`);
    expect(stops()).toHaveLength(1);
    const name = control(root, 'pub/first', 'name');
    name.focus();
    expect(key(name, 'keydown', 'ArrowRight')).toBe(false);
    await settle();
    expect(document.activeElement).toBe(control(root, 'pub/first', 'start'));
    expect(stops()).toEqual(['pub/first:start']);
    key(control(root, 'pub/first', 'start'), 'keydown', 'l');
    await settle();
    expect(document.activeElement).toBe(control(root, 'pub/first', 'body'));
    // A mark has no ends: the focus goes to its one part.
    key(control(root, 'pub/first', 'body'), 'keydown', 'ArrowRight');
    await settle();
    expect(document.activeElement).toBe(control(root, 'pub/first', 'end'));
    const other = root.querySelectorAll('[data-bar]')[0] === bar(root, 'pub/first') ? 'ArrowDown' : 'ArrowUp';
    key(control(root, 'pub/first', 'end'), 'keydown', other);
    await settle();
    expect(document.activeElement).toBe(control(root, 'pub/second', 'body'));
  });

  it('moves an end with Shift and the arrows and writes once, when Shift is let go', async () => {
    const { m, root, today } = await show();
    const end = control(root, 'pub/first', 'end');
    end.focus();
    key(end, 'keydown', 'ArrowRight', { shiftKey: true });
    key(end, 'keydown', 'ArrowRight', { shiftKey: true });
    key(end, 'keydown', 'PageDown', { shiftKey: true });
    flushSync();
    expect(sent(m), 'nothing is written while Shift is held').toEqual([]);
    expect(bar(root, 'pub/first').dataset.to).toBe(addDays(today, 13));
    expect(root.querySelector('[data-timeline-moving]')?.textContent).toContain('First');
    key(end, 'keyup', 'Shift');
    await settle();
    expect(sent(m)).toEqual([`pub/first {"due":"${addDays(today, 13)}"}`]);
    expect(root.querySelector('[data-timeline-moving]')?.textContent).toBe('');
  });

  it('moves the whole bar from its name, both dates in one write, and gives a move up with Escape', async () => {
    const { m, root, today } = await show();
    const name = control(root, 'pub/first', 'name');
    name.focus();
    key(name, 'keydown', 'ArrowLeft', { shiftKey: true });
    expect(key(name, 'keydown', 'Escape', { shiftKey: true }), 'Escape is the timeline\'s while a bar is moved').toBe(false);
    key(name, 'keyup', 'Shift');
    await settle();
    expect(sent(m)).toEqual([]);
    key(name, 'keydown', 'h', { shiftKey: true });
    key(name, 'keyup', 'Shift');
    await settle();
    expect(sent(m)).toEqual([`pub/first {"start":"${addDays(today, -1)}","due":"${addDays(today, 3)}"}`]);
  });

  it('stops an end at the other end of its bar', async () => {
    const { m, root, today } = await show();
    const start = control(root, 'pub/first', 'start');
    start.focus();
    for (let i = 0; i < 9; i += 1) key(start, 'keydown', 'ArrowRight', { shiftKey: true });
    key(start, 'keyup', 'Shift');
    await settle();
    expect(sent(m)).toEqual([`pub/first {"start":"${addDays(today, 4)}"}`]);
  });

  it('writes a date field of the table when it is left or on Enter, not for the dates passed through while typing', async () => {
    const { m, root, today } = await show();
    const fields = root.querySelectorAll<HTMLInputElement>('[data-table-task="pub/loose"] input[type="date"]');
    expect(fields).toHaveLength(2);
    const due = fields[1]!;
    // The browser says `change` for every valid date on the way to the year meant: none of them is written.
    for (const typed of ['0002-11-20', '0020-11-20', '0202-11-20', addDays(today, 5)]) {
      due.value = typed;
      due.dispatchEvent(new Event('input', { bubbles: true }));
      due.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await settle();
    expect(sent(m), 'nothing is written while the date is typed').toEqual([]);
    due.dispatchEvent(new FocusEvent('blur'));
    await settle();
    expect(sent(m)).toEqual([`pub/loose {"due":"${addDays(today, 5)}"}`]);

    // Enter writes too; an empty field takes the date away; a field left as it was writes nothing.
    const start = root.querySelector<HTMLInputElement>('[data-table-task="pub/first"] input[type="date"]')!;
    start.dispatchEvent(new FocusEvent('blur'));
    await settle();
    expect(sent(m)).toHaveLength(1);
    start.value = '';
    expect(key(start, 'keydown', 'Enter')).toBe(false);
    await settle();
    expect(sent(m)).toEqual([`pub/loose {"due":"${addDays(today, 5)}"}`, 'pub/first {"start":null}']);
  });

  it('ends a drag where the pointer is let go, also off the bar: nothing stays held and no later click writes', async () => {
    const { m, root, today } = await show();
    const pointer = (type: string, x: number, on: EventTarget, id = 1): void => {
      const init = { bubbles: true, cancelable: true, clientX: x, clientY: 10, button: 0 };
      const event = typeof PointerEvent === 'function' ? new PointerEvent(type, { ...init, pointerId: id, pointerType: 'mouse' }) : new MouseEvent(type, init);
      if (!('pointerId' in event)) Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: 'mouse' } });
      on.dispatchEvent(event);
    };
    const first = bar(root, 'pub/first');
    // Down on the bar, away without a day's width, up somewhere else on the page: the bar is not held any more.
    pointer('pointerdown', 100, first);
    pointer('pointerup', 100, document.body);
    flushSync();
    expect(first.classList.contains('moving')).toBe(false);
    // A pointer that only passes over the picture moves nothing.
    pointer('pointermove', 400, first);
    flushSync();
    expect(bar(root, 'pub/first').dataset.from).toBe(today);
    // A click on another bar is a click: it writes nothing for the bar that was touched before.
    const second = bar(root, 'pub/second');
    pointer('pointerdown', 300, second);
    pointer('pointerup', 300, second);
    await settle();
    expect(sent(m)).toEqual([]);

    // A click that wobbles a few pixels is a click, in the narrowest zoom too (half a day is 2.5 pixels there).
    const zoom = root.querySelector<HTMLSelectElement>('select[data-timeline-zoom]')!;
    zoom.value = 'quarter';
    zoom.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    pointer('pointerdown', 100, bar(root, 'pub/first'));
    pointer('pointermove', 104, document.body);
    pointer('pointerup', 104, document.body);
    await settle();
    expect(sent(m), 'a wobble writes nothing').toEqual([]);
    zoom.value = 'month';
    zoom.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();

    // A real drag ends where the pointer is let go, off the bar too, and writes once.
    pointer('pointerdown', 100, first);
    pointer('pointermove', 100 + 28, document.body);
    flushSync();
    expect(bar(root, 'pub/first').dataset.from).toBe(addDays(today, 2));
    pointer('pointerup', 100 + 28, document.body);
    await settle();
    expect(sent(m)).toEqual([`pub/first {"start":"${addDays(today, 2)}","due":"${addDays(today, 6)}"}`]);

    // A pointer that is cancelled, or a window that loses the focus, gives the drag up.
    pointer('pointerdown', 100, first);
    pointer('pointermove', 100 + 56, document.body);
    pointer('pointercancel', 100 + 56, document.body);
    pointer('pointerdown', 100, first);
    pointer('pointermove', 100 + 56, document.body);
    window.dispatchEvent(new Event('blur'));
    flushSync();
    pointer('pointerup', 100 + 56, document.body);
    await settle();
    expect(sent(m)).toHaveLength(1);
    // The keys are free again (they are not while a pointer holds a bar).
    const end = control(root, 'pub/first', 'end');
    key(end, 'keydown', 'ArrowRight', { shiftKey: true });
    key(end, 'keyup', 'Shift');
    await settle();
    expect(sent(m)).toHaveLength(2);
  });

  it('keeps a bar in the page while its preview lies outside of the days shown, and writes where it was moved to', async () => {
    const { m, root, today } = await show();
    const name = control(root, 'pub/first', 'name');
    const body = control(root, 'pub/first', 'body');
    body.focus();
    // Far to the left of everything shown: the days start a week or two before today.
    for (let i = 0; i < 6; i += 1) key(body, 'keydown', 'PageUp', { shiftKey: true });
    flushSync();
    expect(bar(root, 'pub/first'), 'the bar is still there').toBeDefined();
    expect(document.activeElement, 'and still has the focus').toBe(control(root, 'pub/first', 'body'));
    key(control(root, 'pub/first', 'body'), 'keyup', 'Shift');
    await settle();
    expect(sent(m)).toEqual([`pub/first {"start":"${addDays(today, -42)}","due":"${addDays(today, -38)}"}`]);
    expect(name.isConnected).toBe(true);
  });

  it('leaves g and the key after it to the page: g h and g l are Today and the list, not steps', async () => {
    const { m, root } = await show();
    const body = control(root, 'pub/first', 'body');
    body.focus();
    expect(key(body, 'keydown', 'g'), 'g is the page\'s').toBe(true);
    expect(key(body, 'keydown', 'l'), 'and so is the key after it').toBe(true);
    await settle();
    expect(document.activeElement).toBe(body);
    // Without a g before it, l is a step to the next part.
    expect(key(body, 'keydown', 'l')).toBe(false);
    await settle();
    expect(document.activeElement).toBe(control(root, 'pub/first', 'end'));
    expect(sent(m)).toEqual([]);
  });

  it('gives a move by the keys up when the focus goes to the tools or the table', async () => {
    const { m, root } = await show();
    const end = control(root, 'pub/first', 'end');
    end.focus();
    key(end, 'keydown', 'ArrowRight', { shiftKey: true });
    flushSync();
    expect(root.querySelector('[data-timeline-moving]')?.textContent).not.toBe('');
    const zoom = root.querySelector<HTMLSelectElement>('select[data-timeline-zoom]')!;
    end.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: zoom }));
    flushSync();
    expect(root.querySelector('[data-timeline-moving]')?.textContent).toBe('');
    key(end, 'keyup', 'Shift');
    await settle();
    expect(sent(m)).toEqual([]);
  });

  it('walks over a task whose bar lies outside of the days shown: its name takes the focus and Tab', async () => {
    const { root } = await show({}, (today) => [task('pub/far', { title: 'Far away', plan: 'pub/app', due: addDays(today, 2000), etag: 'e1' })]);
    expect(root.querySelector('[data-bar="pub/far"]'), 'no bar outside of the days shown').toBeNull();
    const body = control(root, 'pub/second', 'body');
    body.focus();
    key(body, 'keydown', 'ArrowDown');
    await settle();
    const name = control(root, 'pub/far', 'name');
    expect(document.activeElement).toBe(name);
    expect([...root.querySelectorAll<HTMLElement>('[data-column]')].filter((el) => el.tabIndex === 0)).toEqual([name]);
    // And back up again.
    key(name, 'keydown', 'ArrowUp');
    await settle();
    expect(document.activeElement).toBe(control(root, 'pub/second', 'name'));
  });

  it('moves nothing and offers no grip in a vault that is read only', async () => {
    const { m, root } = await show({ readOnly: true });
    expect(root.querySelectorAll('.grip')).toHaveLength(0);
    const end = control(root, 'pub/first', 'end');
    end.focus();
    key(end, 'keydown', 'ArrowRight', { shiftKey: true });
    key(end, 'keyup', 'Shift');
    await settle();
    expect(sent(m)).toEqual([]);
    expect(root.querySelector<HTMLInputElement>('[data-table-task="pub/first"] input')?.disabled).toBe(true);
  });

  it('says so when no task has a date, and still offers the table', async () => {
    const m = make({ token: 't' });
    made = m;
    m.hub.doc = snapshot([task('pub/loose', { title: 'Loose one', etag: 'e1' })]);
    await m.app.start(null);
    const root = document.createElement('div');
    document.body.append(root);
    mounted = mount(TimelineView, { target: root, props: { app: m.app } });
    flushSync();
    expect(root.querySelector('.none')).not.toBeNull();
    expect(root.querySelector('.scroll')).toBeNull();
    expect(root.querySelectorAll('[data-table-task]')).toHaveLength(1);
  });
});
