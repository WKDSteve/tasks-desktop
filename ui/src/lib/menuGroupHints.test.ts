// Every view of the tabs View and Office has a hint, in the part loaded after the start or in the page's words, in both
// languages; and the tab Office and each submenu have theirs.
import { describe, expect, it } from 'vitest';
import { groupHint } from './menuGroupHints';
import { translate, type Key } from './i18n';
import { OFFICE_SECTIONS } from './officeViews';
import { VIEW_GROUPS } from './viewTabMenu';

describe('menuGroupHints', () => {
  for (const lang of ['en', 'de'] as const) {
    it(`gives every view of View and Office a hint (${lang})`, () => {
      const ids = [...VIEW_GROUPS.flatMap((g) => g.views.map((v) => v.id)), ...OFFICE_SECTIONS.flatMap((s) => s.views.map((v) => v.id))];
      for (const id of ids) {
        const key = `hint.item.nav.${id}` as Key;
        const hint = groupHint(lang, `nav.${id}`) || translate(lang, key);
        expect(hint, id).not.toBe(key);
        expect(hint.length, id).toBeGreaterThan(20);
      }
    });

    it(`has a hint for the tab Office and the submenus (${lang})`, () => {
      for (const group of ['office', 'review', 'repos', 'export']) expect(groupHint(lang, group).length, group).toBeGreaterThan(20);
    });
  }
});
