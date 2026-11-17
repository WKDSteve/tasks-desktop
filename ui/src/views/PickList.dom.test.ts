// @vitest-environment jsdom
// The searchable choice in a DOM: the keys stay in the field to type in (arrows, Enter, Space, Escape), a press works
// as well, the actions stand first while nothing is typed, and a field opens its list and closes it on a choice.
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import PickList from './PickList.svelte';
import PickField from './PickField.svelte';

const options = [
  { value: 'pub/one', label: 'Release train', detail: 'pub/one · pub' },
  { value: 'pub/two', label: 'Mobile app', detail: 'pub/two · pub' },
  { value: 'ops/three', label: 'Release notes', detail: 'ops/three · ops' },
];
const actions = [
  { id: 'none', label: 'No plan' },
  { id: 'new-plan', label: 'Create a plan …' },
];

let mounted: Record<string, unknown> | null = null;
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = null;
  document.body.innerHTML = '';
});

function key(el: Element, k: string): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  flushSync();
}
function type(input: HTMLInputElement, text: string): void {
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}
const shown = () => [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim().split(/\s+/)[0] ?? '');

describe('PickList', () => {
  it('moves with the arrows and chooses with Enter; the actions stand first and go while a word is typed', () => {
    const picked: string[] = [];
    const acted: string[] = [];
    mounted = mount(PickList, {
      target: document.body,
      props: { options, actions, searchLabel: 'Search plans', emptyLabel: 'Nothing', onpick: (v: string) => picked.push(v), onaction: (a: string) => acted.push(a) },
    });
    flushSync();
    const input = document.querySelector('input[role="combobox"]') as HTMLInputElement;
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(5);
    key(input, 'Enter');
    expect(acted).toEqual(['none']);
    key(input, 'ArrowDown');
    key(input, 'ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe(document.querySelectorAll('[role="option"]')[2]?.id);
    key(input, 'Enter');
    expect(picked).toEqual(['pub/one']);
    type(input, 'release ops');
    expect(shown()).toEqual(['Release']);
    expect(document.querySelector('[data-action]')).toBeNull();
    key(input, 'Enter');
    expect(picked).toEqual(['pub/one', 'ops/three']);
    type(input, 'nothing here');
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Nothing');
    // Escape empties the words first, then gives up.
    let gaveUp = 0;
    unmount(mounted);
    mounted = mount(PickList, {
      target: document.body,
      props: { options, searchLabel: 'S', emptyLabel: 'N', onpick: () => undefined, onescape: () => (gaveUp += 1) },
    });
    flushSync();
    const again = document.querySelector('input[role="combobox"]') as HTMLInputElement;
    type(again, 'x');
    key(again, 'Escape');
    expect(again.value).toBe('');
    expect(gaveUp).toBe(0);
    key(again, 'Escape');
    expect(gaveUp).toBe(1);
  });

  it('ticks several with Space or a press, and marks what is chosen', () => {
    const toggled: string[] = [];
    mounted = mount(PickList, {
      target: document.body,
      props: { options, multiple: true, selected: ['pub/two'], searchLabel: 'S', emptyLabel: 'N', onpick: (v: string) => toggled.push(v) },
    });
    flushSync();
    const input = document.querySelector('input[role="combobox"]') as HTMLInputElement;
    expect(document.querySelector('[role="listbox"]')?.getAttribute('aria-multiselectable')).toBe('true');
    expect(document.querySelector('[data-value="pub/two"]')?.getAttribute('aria-selected')).toBe('true');
    key(input, ' ');
    expect(toggled).toEqual(['pub/one']);
    (document.querySelector('[data-value="ops/three"]') as HTMLElement).click();
    flushSync();
    expect(toggled).toEqual(['pub/one', 'ops/three']);
  });
});

describe('PickField', () => {
  it('shows the chosen entry by its label, opens the list on a press and closes it on a choice', () => {
    const picked: string[] = [];
    mounted = mount(PickField, {
      target: document.body,
      props: {
        label: 'Plan',
        name: 'plan',
        value: 'pub/two',
        options,
        actions,
        placeholder: 'No plan',
        searchLabel: 'Search plans',
        emptyLabel: 'Nothing',
        onpick: (v: string) => picked.push(v),
      },
    });
    flushSync();
    const button = document.querySelector('button[data-field="plan"]') as HTMLButtonElement;
    expect(button.textContent).toContain('Mobile app');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    button.click();
    flushSync();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement?.getAttribute('role')).toBe('combobox');
    (document.querySelector('[data-value="ops/three"]') as HTMLElement).click();
    flushSync();
    expect(picked).toEqual(['ops/three']);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it('shows a value that is not among the entries as written', () => {
    mounted = mount(PickField, {
      target: document.body,
      props: { label: 'Plan', name: 'plan', value: 'pub/closed', options, placeholder: 'No plan', searchLabel: 'S', emptyLabel: 'N', onpick: () => undefined },
    });
    flushSync();
    expect(document.querySelector('button[data-field="plan"]')?.textContent).toContain('pub/closed');
  });
});
