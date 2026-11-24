// Help is in the same place in every view: the head of a dialog or a form has its title and, right beside it, the info
// button that explains the dialog (`Info`). These are the six dialogs and forms that had none. Each title sits in a
// `.dialog-head` together with an `Info` whose text exists in both languages.

import { describe, expect, it } from 'vitest';
import about from './views/AboutDialog.svelte?raw';
import capture from './views/Capture.svelte?raw';
import defaults from './views/DefaultsDialog.svelte?raw';
import meeting from './views/MeetingForm.svelte?raw';
import wizard from './views/PlanWizard.svelte?raw';
import setup from './views/SetupCard.svelte?raw';
import { translate } from './lib/i18n';

const HEADS: Record<string, { source: string; key: string }> = {
  AboutDialog: { source: about, key: 'about' },
  PlanWizard: { source: wizard, key: 'plan' },
  SetupCard: { source: setup, key: 'setup' },
  MeetingForm: { source: meeting, key: 'meeting' },
  Capture: { source: capture, key: 'capture' },
  DefaultsDialog: { source: defaults, key: 'defaults' },
};

describe('info button in the head of the dialogs and forms', () => {
  for (const [name, { source, key }] of Object.entries(HEADS)) {
    it(`${name}: every title is followed by the info button, in a .dialog-head`, () => {
      const titles = source.match(/<h2 id="[^"]+">/g) ?? [];
      const heads = source.match(/<div class="dialog-head">\s*<h2 id="[^"]+">[^\n]*<\/h2>\s*<Info hint=\{t\('hint\.dialog\.[a-z]+'\)\}/g) ?? [];
      expect(titles.length).toBeGreaterThan(0);
      expect(heads.length).toBe(titles.length);
      expect(source).toContain(`hint.dialog.${key}`);
    });

    it(`${name}: the explanation exists in both languages`, () => {
      for (const lang of ['de', 'en'] as const) {
        const text = translate(lang, `hint.dialog.${key}` as never);
        expect(text).not.toBe(`hint.dialog.${key}`);
        expect(text.length).toBeGreaterThan(20);
      }
    });
  }
});
