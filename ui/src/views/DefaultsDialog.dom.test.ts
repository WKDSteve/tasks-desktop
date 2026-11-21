// @vitest-environment jsdom
// The setting "Icons of the categories" in the defaults dialog, in a DOM: one character in a field is the icon of the
// category at once, a text that is not one character is said at the field and not taken, empty is none, the switch
// turns the last step of the icons off (and the fields with it), and the button puts the icons back as they came.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { make } from '../lib/appDouble';
import { CATEGORY_ICONS } from '../lib/icons';
import { translate } from '../lib/i18n';
import DefaultsDialog from './DefaultsDialog.svelte';

// jsdom has no modal dialog
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.removeAttribute('open');
};

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

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await tick();
    flushSync();
  }
}

async function dialog(): Promise<{ m: Made; root: HTMLElement }> {
  const m = make({ token: 't' });
  made = m;
  const root = document.createElement('div');
  document.body.append(root);
  mounted = mount(DefaultsDialog, { target: root, props: { app: m.app, open: true, onclose: () => undefined } });
  await settle();
  return { m, root };
}

function field(root: HTMLElement, category: string): HTMLInputElement {
  const input = root.querySelector<HTMLInputElement>(`input[data-category-icon="${category}"]`);
  expect(input, `the field of ${category}`).not.toBeNull();
  return input!;
}

async function type(input: HTMLInputElement, text: string): Promise<void> {
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
}

describe('the defaults dialog: icons of the categories', () => {
  it('offers a field per category with its label, the icons as they came, and the switch on', async () => {
    const { m, root } = await dialog();
    const section = root.querySelector('[data-testid="defaults-category-icons"]');
    expect(section?.querySelector('legend')?.textContent).toBe(translate(m.app.lang, 'defaults.sec.category_icons'));
    for (const [category, icon] of Object.entries(CATEGORY_ICONS)) {
      const input = field(root, category);
      expect(input.value).toBe(icon);
      expect(root.querySelector(`label[for="${input.id}"]`)?.textContent).toBe(category);
    }
    // the categories of the vault without an icon have an empty field
    expect(field(root, 'ruleset').value).toBe('');
    expect(root.querySelector<HTMLInputElement>('input[data-pref="category-icons"]')?.checked).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('[data-testid="defaults-category-icons-reset"]')?.disabled).toBe(true);
  });

  it('takes one character at once, says a wrong text at the field without taking it, and empty is none', async () => {
    const { m, root } = await dialog();
    await type(field(root, 'bug'), ' 🪲 ');
    expect(m.app.categoryIcons.bug).toBe('🪲');
    expect(m.prefs.get('tasks-desktop.category-icons')).toContain('🪲');

    const bug = field(root, 'bug');
    await type(bug, 'xy');
    expect(m.app.categoryIcons.bug).toBe('🪲');
    expect(bug.getAttribute('aria-invalid')).toBe('true');
    const word = root.querySelector(`#${bug.getAttribute('aria-describedby')}`);
    expect(word?.getAttribute('role')).toBe('alert');
    expect(word?.textContent).toBe(translate(m.app.lang, 'defaults.category_icons.invalid'));
    expect(bug.value).toBe('xy');

    await type(bug, '');
    expect(m.app.categoryIcons.bug).toBeUndefined();
    expect(bug.hasAttribute('aria-invalid')).toBe(false);
    expect(root.querySelector('[role="alert"]')).toBeNull();

    await type(field(root, 'ruleset'), '📏');
    expect(m.app.categoryIcons.ruleset).toBe('📏');

    const reset = root.querySelector<HTMLButtonElement>('[data-testid="defaults-category-icons-reset"]')!;
    expect(reset.disabled).toBe(false);
    reset.click();
    await settle();
    expect({ ...m.app.categoryIcons }).toEqual(CATEGORY_ICONS);
    expect(field(root, 'bug').value).toBe('🐞');
  });

  it('switches the last step of the icons off, and the fields with it', async () => {
    const { m, root } = await dialog();
    const on = root.querySelector<HTMLInputElement>('input[data-pref="category-icons"]')!;
    on.click();
    await settle();
    expect(m.app.categoryIconPrefs.on).toBe(false);
    expect(m.app.categoryIcons).toEqual({});
    expect(field(root, 'bug').disabled).toBe(true);
    // the icons chosen stay to be seen while the step is off
    expect(field(root, 'bug').value).toBe('🐞');
    on.click();
    await settle();
    expect(m.app.categoryIcons.bug).toBe('🐞');
    expect(field(root, 'bug').disabled).toBe(false);
  });

  it('takes a category named like a word of Object as a plain category: no icon, nothing wrong', async () => {
    const { m, root } = await dialog();
    m.app.ranges = { ...m.app.ranges, categories: [...m.app.ranges.categories, 'constructor', 'toString'] };
    await settle();
    for (const on of [true, false]) {
      m.app.setCategoryIcons({ ...m.app.categoryIconPrefs, on });
      await settle();
      expect(field(root, 'constructor').value).toBe('');
      expect(field(root, 'constructor').hasAttribute('aria-invalid')).toBe(false);
      expect(field(root, 'toString').value).toBe('');
    }
    m.app.setCategoryIcons({ ...m.app.categoryIconPrefs, on: true });
    await settle();
    await type(field(root, 'constructor'), '🏗');
    expect(m.app.categoryIcons.constructor).toBe('🏗');
    expect(field(root, 'constructor').value).toBe('🏗');
  });
});
