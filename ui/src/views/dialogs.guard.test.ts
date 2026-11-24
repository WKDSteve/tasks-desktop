// What every dialog of the page keeps (APG modal dialog), read from the source: jsdom knows nothing of the focus a
// native `showModal()` takes, so the browser tests have the behaviour itself (Esc, focus in, focus back); this keeps the
// shape that behaviour rests on, so that a new dialog cannot leave it out.
import { describe, expect, it } from 'vitest';

// Vite reads the sources of the views as text (the same way `dialogInfo.test.ts` reads three of them).
const raw = import.meta.glob<string>('./*.svelte', { query: '?raw', import: 'default', eager: true });
const sources = Object.entries(raw).map(([path, text]) => ({ file: path.replace('./', ''), text }));
const dialogs = sources.filter((s) => /<dialog\b/.test(s.text));

describe('the dialogs of the page', () => {
  it('are found (a guard that looks at nothing guards nothing)', () => {
    expect(dialogs.length).toBeGreaterThanOrEqual(29);
    expect(dialogs.map((d) => d.file)).toEqual(expect.arrayContaining(['DoneDialog.svelte', 'PrioDialog.svelte', 'AboutDialog.svelte']));
  });

  it('are native and modal: opened with showModal(), so the page behind is inert and Esc closes them', () => {
    for (const d of dialogs) expect(d.text, d.file).toMatch(/\.showModal\(\)/);
  });

  it('say what closes them: a handler for close or cancel, so Esc leaves the state the dialog shows', () => {
    for (const d of dialogs) expect(d.text, d.file).toMatch(/\b(?:onclose|oncancel)\b/);
  });

  it('have a name for a screen reader on the dialog itself', () => {
    for (const d of dialogs) {
      const tag = /<dialog\b(?:=>|[^>])*>/s.exec(d.text)?.[0] ?? '';
      expect(tag, d.file).toMatch(/aria-label(?:ledby)?=/);
    }
  });

  it('put Cancel before the confirming button where the answer changes a task, so the focus a modal takes is the safe one', () => {
    for (const file of ['DoneDialog.svelte', 'PrioDialog.svelte']) {
      const text = sources.find((s) => s.file === file)!.text;
      const firstButton = text.slice(text.indexOf('<button'));
      expect(firstButton.slice(0, 200), file).toContain("dialog.cancel");
    }
  });
});
