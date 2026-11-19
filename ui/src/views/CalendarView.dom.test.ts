// @vitest-environment jsdom
// The calendar in a DOM: its keys. One day takes Tab and the arrows go over the days (into the next month too); a task
// is picked up with `m` and put on a day with Enter, Shift with an arrow moves its due date, Delete takes it away. What
// is written is read from the hub of the tests; the drag with a finger and the real engine are the browser tests'.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import { addDays, addMonths } from '../lib/calendar';
import { task } from '../lib/fixtures';
import CalendarView from './CalendarView.svelte';

type Made = ReturnType<typeof make>;

let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;

async function settle(): Promise<void> {
  // A write, the focus after it, and what both changed.
  for (let i = 0; i < 5; i += 1) {
    await tick();
    await Promise.resolve();
    flushSync();
  }
}

/** The calendar on a vault with one task without a date and one due today. */
async function show(overrides: Parameters<typeof make>[0] = {}): Promise<{ m: Made; root: HTMLElement; today: string }> {
  const m = make({ token: 't', ...overrides });
  made = m;
  const today = m.app.today;
  m.hub.doc = snapshot([task('pub/loose', { title: 'Loose one', etag: 'e1' }), task('pub/dated', { title: 'Dated one', due: today, etag: 'e1' })]);
  await m.app.start(null);
  const root = document.createElement('div');
  document.body.append(root);
  mounted = mount(CalendarView, { target: root, props: { app: m.app } });
  flushSync();
  return { m, root, today };
}

const press = (el: Element, key: string, init: KeyboardEventInit = {}): boolean =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
const cell = (root: HTMLElement, day: string): HTMLElement => root.querySelector<HTMLElement>(`td[data-day="${day}"]`)!;
const chipOf = (root: HTMLElement, id: string): HTMLElement =>
  [...root.querySelectorAll<HTMLElement>('.chip[data-task]')].find((el) => el.dataset.task === id)!;
/** The patches of the writes sent so far, as `id key=value`. */
const sent = (m: Made): string[] =>
  m.hub.sent.flatMap((r) => r.ops.map((op) => (op.op === 'set' ? `${op.id} ${JSON.stringify(op.patch)}` : op.op)));

// A day in the middle of a month: a week on and a week back are in the grid of that month. (With the clock of the
// machine the tests would turn red in a week at the end of a month, when a step leaves the grid.)
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 18, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

// Nothing here waits for real time: alone a case takes 10-30 ms (the first one 200 ms for the import). On 2026-11-18 one
// took 14.6 s in a full run while the runner and four sessions were building, so the default 5 s limit measured the
// load of the machine, not the calendar. The limit is raised for the whole file; a hang still ends in 30 s.
describe('CalendarView, the keys', { timeout: 30_000 }, () => {
  it('gives Tab to one day only, today at first, and the arrows move it', async () => {
    const { root, today } = await show();
    const tabbable = () => [...root.querySelectorAll<HTMLElement>('td[data-day]')].filter((td) => td.tabIndex === 0).map((td) => td.dataset.day);
    expect(tabbable()).toEqual([today]);
    cell(root, today).focus();
    expect(press(cell(root, today), 'ArrowRight'), 'the key is taken').toBe(false);
    await settle();
    const next = addDays(today, 1);
    expect(tabbable()).toEqual([next]);
    expect(document.activeElement).toBe(cell(root, next));
    // A key that is none of the calendar is left alone.
    expect(press(cell(root, next), 'x')).toBe(true);
  });

  it('follows the arrows into the next month', async () => {
    const { root, today } = await show();
    cell(root, today).focus();
    press(cell(root, today), 'PageDown');
    await settle();
    const day = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.day : undefined;
    expect(day?.slice(0, 7)).toBe(addMonths(today, 1).slice(0, 7));
    expect(root.querySelector('[data-calendar-heading]')?.textContent).not.toBe('');
  });

  it('picks a task without a date up with m and puts it on the day Enter is pressed on', async () => {
    const { m, root, today } = await show();
    const loose = chipOf(root, 'pub/loose');
    loose.focus();
    expect(press(loose, 'm')).toBe(false);
    await settle();
    expect(document.activeElement, 'the day the keys are on takes the focus').toBe(cell(root, today));
    expect(root.querySelector('[data-calendar-carry]')?.textContent).toContain('Loose one');
    press(cell(root, today), 'ArrowRight');
    await settle();
    const next = addDays(today, 1);
    press(cell(root, next), 'Enter');
    await settle();
    expect(sent(m)).toEqual([`pub/loose {"due":"${next}"}`]);
    expect(root.querySelector('[data-calendar-carry]')?.textContent?.trim()).toBe('');
  });

  it('gives a task picked up back with Escape, and writes nothing', async () => {
    const { m, root, today } = await show();
    const loose = chipOf(root, 'pub/loose');
    loose.focus();
    press(loose, 'm');
    await settle();
    expect(press(cell(root, today), 'Escape'), 'Escape is the calendar\'s while a task is carried').toBe(false);
    await settle();
    expect(sent(m)).toEqual([]);
    expect(document.activeElement).toBe(chipOf(root, 'pub/loose'));
    // With nothing carried, Escape is the page's again.
    expect(press(cell(root, today), 'Escape')).toBe(true);
  });

  it('moves the due date of the task under the focus with Shift and an arrow, and takes it away with Delete', async () => {
    const { m, root, today } = await show();
    const dated = chipOf(root, 'pub/dated');
    dated.focus();
    expect(press(dated, 'ArrowDown', { shiftKey: true })).toBe(false);
    await settle();
    press(chipOf(root, 'pub/dated'), 'Delete');
    await settle();
    expect(sent(m)).toEqual([`pub/dated {"due":"${addDays(today, 7)}"}`, 'pub/dated {"due":null}']);
  });

  it('leaves g and the key after it to the page: g h and g l are Today and the list, not steps over the days', async () => {
    const { root, today } = await show();
    const day = cell(root, today);
    day.focus();
    expect(press(day, 'g'), 'g is the page\'s').toBe(true);
    expect(press(day, 'l'), 'and so is the key after it').toBe(true);
    await settle();
    expect(document.activeElement).toBe(day);
    // Without a g before it, l is a step to the next day.
    expect(press(day, 'l')).toBe(false);
    await settle();
    expect(document.activeElement).toBe(cell(root, addDays(today, 1)));
  });

  it('stays on the month and gives the focus a place when a move is refused or the task cannot take the focus', async () => {
    const { m, root, today } = await show();
    expect(today).toBe('2026-11-18');
    const heading = () => root.querySelector('[data-calendar-heading]')?.textContent;
    const before = heading();
    // The hub of the tests writes nothing into its list: the task stays where it is, as after a refusal. A move
    // out of the month (three weeks on) must not turn the page to a month the task is not in.
    const dated = chipOf(root, 'pub/dated');
    dated.focus();
    press(dated, 'PageDown', { shiftKey: true });
    await settle();
    expect(sent(m)).toEqual([`pub/dated {"due":"2026-12-18"}`]);
    expect(heading(), 'the grid still shows the month of the task').toBe(before);
    expect(document.activeElement).toBe(chipOf(root, 'pub/dated'));
    expect(document.activeElement).not.toBe(document.body);
  });

  it('picks nothing up and offers no grip in a vault that is read only', async () => {
    const { m, root } = await show({ readOnly: true });
    expect(root.querySelectorAll('.grip')).toHaveLength(0);
    const loose = chipOf(root, 'pub/loose');
    loose.focus();
    press(loose, 'm');
    await settle();
    expect(root.querySelector('[data-calendar-carry]')?.textContent?.trim()).toBe('');
    expect(sent(m)).toEqual([]);
  });
});
