// @vitest-environment jsdom
// The date fields of the detail in a DOM: they write once, when they are left or on Enter, not for every date the
// browser passes through while a year is typed; a `change` without a key (the browser's calendar) writes at once, and
// a date the engine refused does not stay in the field. The real browser and engine are the browser tests'.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '../lib/api';
import { make, snapshot } from '../lib/appDouble';
import { addDays } from '../lib/calendar';
import { task } from '../lib/fixtures';
import Detail from './Detail.svelte';

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

async function show() {
  const m = make({ token: 't' });
  made = m;
  m.hub.doc = snapshot([task('pub/a', { title: 'A task', etag: 'e1' })]);
  await m.app.start(null);
  m.app.selectedId = 'pub/a';
  const root = document.createElement('div');
  document.body.append(root);
  mounted = mount(Detail, { target: root, props: { app: m.app } });
  flushSync();
  const field = (key: string) => root.querySelector<HTMLInputElement>(`input[type="date"][data-field="${key}"]`)!;
  return { m, root, field, today: m.app.today };
}

const sent = (m: Made): string[] =>
  m.hub.sent.flatMap((r) => r.ops.map((op) => (op.op === 'set' ? `${op.id} ${JSON.stringify(op.patch)}` : op.op)));
const key = (el: Element, name: string): boolean =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
/** What the browser does for one digit typed into a date field: a key, then the date it now holds. */
function type(el: HTMLInputElement, digit: string, value: string): void {
  key(el, digit);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

describe('the date fields of the detail', () => {
  it('write a typed date once, when the field is left, not the dates passed through on the way', async () => {
    const { m, field, today } = await show();
    const due = field('due');
    due.dispatchEvent(new FocusEvent('focus'));
    const meant = addDays(today, 5);
    for (const [digit, value] of [['0', '0002-11-20'], ['2', '0020-11-20'], ['2', '0202-11-20'], ['7', meant]] as const) {
      type(due, digit, value);
    }
    await settle();
    expect(sent(m), 'nothing is written while the date is typed').toEqual([]);
    due.dispatchEvent(new FocusEvent('blur'));
    await settle();
    expect(sent(m)).toEqual([`pub/a {"due":"${meant}"}`]);
    // Left again as it is (the field is drawn anew after a write): nothing more.
    field('due').dispatchEvent(new FocusEvent('blur'));
    await settle();
    expect(sent(m)).toEqual([`pub/a {"due":"${meant}"}`]);
  });

  it('write on Enter, and a date picked in the calendar (a change without a key) at once', async () => {
    const { m, field, today } = await show();
    const start = field('start');
    start.dispatchEvent(new FocusEvent('focus'));
    type(start, '1', addDays(today, 1));
    expect(key(start, 'Enter'), 'Enter is taken').toBe(false);
    await settle();
    expect(sent(m)).toEqual([`pub/a {"start":"${addDays(today, 1)}"}`]);

    const due = field('due');
    due.dispatchEvent(new FocusEvent('focus'));
    due.value = addDays(today, 9);
    due.dispatchEvent(new Event('input', { bubbles: true }));
    due.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(sent(m)).toEqual([`pub/a {"start":"${addDays(today, 1)}"}`, `pub/a {"due":"${addDays(today, 9)}"}`]);
  });

  it('do not keep a date the engine refused', async () => {
    const { m, field, today } = await show();
    m.hub.next_ops = new ApiError(400, 'invalid_argument', 'start after due');
    const due = field('due');
    due.dispatchEvent(new FocusEvent('focus'));
    type(due, '3', addDays(today, 3));
    due.dispatchEvent(new FocusEvent('blur'));
    await settle();
    expect(sent(m)).toHaveLength(1);
    expect(field('due').value, 'the field shows the task again').toBe('');
  });
});
