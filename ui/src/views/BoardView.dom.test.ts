// @vitest-environment jsdom
// The board without dragging (WCAG 2.5.7): the selected card moves with the buttons of the move bar, one column or one
// place at a time, and the toast (a status message, WCAG 4.1.3) says where it went.
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import type { TaskEntry } from '../lib/contract';
import { task } from '../lib/fixtures';
import { labelOf, translate } from '../lib/i18n';
import BoardView from './BoardView.svelte';

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

const card = (id: string, status: string, group: string, etag: string) =>
  task(id, { etag, status, group, title: `Card ${id}` } as Partial<TaskEntry>);

async function board(tasks: TaskEntry[]) {
  // jsdom has no layout: the selected card is "scrolled into view" by a stand-in (the board keeps it in view).
  Element.prototype.scrollIntoView = () => undefined;
  made = make({ token: 't' });
  made.hub.doc = snapshot(tasks);
  await made.app.start(null);
  const target = document.createElement('div');
  document.body.append(target);
  mounted = mount(BoardView, { target, props: { app: made.app } });
  flushSync();
  const bar = () => target.querySelector('[data-move-bar]') as HTMLElement;
  const button = (name: string) => bar().querySelector<HTMLButtonElement>(`[data-move="${name}"]`);
  return { m: made, bar, button, target };
}

describe('the move bar of the board', () => {
  it('says how to select a card while none is selected, and offers no move', async () => {
    const { bar, button } = await board([card('pub/a', 'open', 'open|1', 'e1')]);
    expect(bar().getAttribute('role')).toBe('group');
    expect(bar().getAttribute('aria-label')).toBeTruthy();
    expect(button('right')).toBeNull();
  });

  it('moves the selected card into the next column with a click, and says where it went', async () => {
    const { m, button } = await board([card('pub/a', 'open', 'open|1', 'e1')]);
    m.app.select('pub/a');
    flushSync();
    button('right')!.click();
    await vi.waitFor(() => expect(m.app.toast).not.toBeNull());
    expect(m.hub.sent[0]?.ops[0]).toMatchObject({ op: 'set', id: 'pub/a', patch: { status: 'parked' } });
    expect(m.app.toast?.text).toBe(translate(m.app.lang, 'board.moved_column', { title: 'Card pub/a', column: labelOf(m.app.lang, 'status', 'parked') }));
  });

  it('reorders by a click and offers no way left of the first column', async () => {
    const { m, button } = await board([
      card('pub/a', 'doing', 'doing|1', 'e1'),
      card('pub/b', 'doing', 'doing|1', 'e2'),
    ]);
    m.app.select('pub/a');
    flushSync();
    expect(button('left')).toBeNull();
    button('down')!.click();
    await vi.waitFor(() => expect(m.app.toast).not.toBeNull());
    expect(m.hub.sent[0]?.ops[0]).toMatchObject({ op: 'reorder', id: 'pub/a', after: 'pub/b' });
    expect(m.app.toast?.text).toBe(translate(m.app.lang, 'board.moved_down', { title: 'Card pub/a' }));
  });

  it('says where the card went also when the reorder renumbered its neighbours, and how many files', async () => {
    const { m, button } = await board([
      card('pub/a', 'doing', 'doing|1', 'e1'),
      card('pub/b', 'doing', 'doing|1', 'e2'),
    ]);
    m.app.select('pub/a');
    flushSync();
    // The engine numbered the cards around the spot: three files written by one reorder.
    m.hub.next_ops = { client_op_id: 'x', results: [{ ok: true, id: 'pub/a', writes: 3 }] } as unknown as typeof m.hub.next_ops;
    button('down')!.click();
    await vi.waitFor(() => expect(m.app.toast).not.toBeNull());
    expect(m.app.toast?.text).toBe(
      `${translate(m.app.lang, 'board.moved_down', { title: 'Card pub/a' })} ${translate(m.app.lang, 'write.renumbered', { n: 3 })}`,
    );
  });

  it('keeps the words of another write of several files, without the words of a reorder', async () => {
    const { m } = await board([card('pub/a', 'doing', 'doing|1', 'e1')]);
    m.hub.next_ops = { client_op_id: 'x', results: [{ ok: true, id: 'pub/a', writes: 2 }] } as unknown as typeof m.hub.next_ops;
    await m.app.write([{ op: 'set', id: 'pub/a', patch: { prio: 1 }, if_match: 'e1' }], {
      saidAs: () => 'board.moved',
      saidWith: { title: 'Card pub/a' },
    });
    expect(m.app.toast?.text).toBe(translate(m.app.lang, 'board.moved', { title: 'Card pub/a' }));
  });
});

describe('focus is selection on the board, when the keyboard moves it', () => {
  // jsdom has no focus modality: `:focus-visible` is what the stand-in says (the keyboard moved the focus, or a click did).
  const realMatches = Element.prototype.matches;
  let byKeyboard = true;
  const stub = function (this: Element, selector: string): boolean {
    return selector === ':focus-visible' ? byKeyboard : realMatches.call(this, selector);
  };
  afterEach(() => {
    Element.prototype.matches = realMatches;
    byKeyboard = true;
  });

  async function twoCards() {
    Element.prototype.matches = stub as typeof Element.prototype.matches;
    const made = await board([card('pub/a', 'doing', 'doing|1', 'e1'), card('pub/b', 'doing', 'doing|1', 'e2')]);
    const cardEl = (id: string) => made.target.querySelector<HTMLButtonElement>(`[data-card="${id}"]`)!;
    return { ...made, cardEl };
  }

  it('selects the card the keyboard moves the focus to, so the keys and the move bar act on it', async () => {
    const { m, cardEl } = await twoCards();
    expect(m.app.selectedId).toBeNull();
    cardEl('pub/a').focus();
    flushSync();
    expect(m.app.selectedId).toBe('pub/a');
    expect(cardEl('pub/a').getAttribute('aria-current')).toBe('true');
    cardEl('pub/b').focus();
    flushSync();
    expect(m.app.selectedId).toBe('pub/b');
    expect(cardEl('pub/a').getAttribute('aria-current')).toBeNull();
    expect(cardEl('pub/b').getAttribute('aria-current')).toBe('true');
  });

  it('does not select a card a click focuses (a mark with Shift, a new tab with Ctrl, the context menu)', async () => {
    const { m, cardEl } = await twoCards();
    byKeyboard = false;
    cardEl('pub/a').focus();
    flushSync();
    expect(m.app.selectedId).toBeNull();
    expect(cardEl('pub/a').getAttribute('aria-current')).toBeNull();
  });
});
