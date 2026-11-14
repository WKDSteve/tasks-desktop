// @vitest-environment jsdom
// The gesture that marks a task with the mouse, on a real element: what is marked, and that the click of the same
// gesture opens nothing.
import { afterEach, describe, expect, it } from 'vitest';
import { markGesture, shownMarkIds } from './markDom';

function page(ids: readonly string[]): HTMLElement[] {
  const main = document.createElement('main');
  document.body.append(main);
  return ids.map((id) => {
    const button = document.createElement('button');
    button.dataset['markId'] = id;
    main.append(button);
    return button;
  });
}

afterEach(() => document.body.replaceChildren());

describe('shownMarkIds', () => {
  it('reads the tasks of the main area in the order of the document, each once', () => {
    page(['a/1', 'a/2', 'a/1', 'b/3']);
    const outside = document.createElement('button');
    outside.dataset['markId'] = 'x/9';
    document.body.append(outside);
    expect(shownMarkIds()).toEqual(['a/1', 'a/2', 'b/3']);
  });
});

describe('markGesture', () => {
  const setup = () => {
    const [first, second] = page(['a/1', 'a/2']) as [HTMLElement, HTMLElement];
    const marked: { id: string; shift: boolean; order: readonly string[] }[] = [];
    let opened = 0;
    const action = markGesture(second, {
      markClick: (event, id, order) => {
        marked.push({ id, shift: event.shiftKey, order });
        return true;
      },
    });
    // The element's own click, as the component has it (it would open the task).
    second.addEventListener('click', () => (opened += 1));
    return { first, second, marked, opened: () => opened, action };
  };
  const mouse = (type: string, init: MouseEventInit = {}) => new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
  /** Press and release on `el` with `init`. */
  const press = (el: HTMLElement, init: MouseEventInit = {}) => {
    el.dispatchEvent(mouse('mousedown', init));
    el.dispatchEvent(mouse('mouseup', init));
  };

  it('leaves a plain click alone, and a click with Ctrl or Cmd (that one opens a new tab)', () => {
    const { second, marked, opened } = setup();
    press(second);
    second.dispatchEvent(mouse('click'));
    press(second, { ctrlKey: true });
    second.dispatchEvent(mouse('click', { ctrlKey: true }));
    second.dispatchEvent(mouse('click', { metaKey: true }));
    second.dispatchEvent(mouse('click', { shiftKey: true, ctrlKey: true }));
    expect(marked).toEqual([]);
    expect(opened()).toBe(4);
  });

  it('marks when the button is released with Shift, also when no click follows (a card that can be dragged)', () => {
    const { second, marked, opened } = setup();
    press(second, { shiftKey: true });
    expect(marked).toEqual([{ id: 'a/2', shift: true, order: ['a/1', 'a/2'] }]);
    expect(opened()).toBe(0);
  });

  it('marks once and opens nothing when the click of the gesture does come', () => {
    const { second, marked, opened } = setup();
    press(second, { shiftKey: true });
    const click = mouse('click', { shiftKey: true });
    second.dispatchEvent(click);
    expect(marked).toHaveLength(1);
    expect(opened()).toBe(0);
    expect(click.defaultPrevented).toBe(true);
    // The next plain click is a click again, also at once.
    press(second);
    second.dispatchEvent(mouse('click'));
    expect(opened()).toBe(1);
  });

  it('marks nothing for a release whose press was elsewhere (a press on another row, a drag that ended here)', () => {
    const { first, second, marked } = setup();
    first.dispatchEvent(mouse('mousedown', { shiftKey: true }));
    second.dispatchEvent(mouse('mouseup', { shiftKey: true }));
    expect(marked).toEqual([]);
  });

  it('marks on a click with Shift that had no release before it (a script, a key)', () => {
    const { second, marked, opened } = setup();
    second.dispatchEvent(mouse('click', { shiftKey: true }));
    expect(marked).toHaveLength(1);
    expect(opened()).toBe(0);
  });

  it('takes no other button, and nothing on the grip of a card: neither the release nor the click', () => {
    const { second, marked, opened } = setup();
    press(second, { shiftKey: true, button: 2 });
    const grip = document.createElement('span');
    grip.className = 'grip';
    second.append(grip);
    press(grip, { shiftKey: true });
    grip.dispatchEvent(mouse('click', { shiftKey: true }));
    expect(marked).toEqual([]);
    expect(opened()).toBe(1);
  });

  it('lets go of the element when it is destroyed', () => {
    const { second, marked, opened, action } = setup();
    action.destroy();
    press(second, { shiftKey: true });
    second.dispatchEvent(mouse('click', { shiftKey: true }));
    expect(marked).toEqual([]);
    expect(opened()).toBe(1);
  });
});
