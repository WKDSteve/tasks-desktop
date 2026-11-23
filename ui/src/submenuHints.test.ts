import { describe, expect, it } from 'vitest';
import app from './App.svelte?raw';
import EN from './lib/i18n-en';
import DE from './lib/i18n-de';

// Every entry of a menu explains itself with a hint (the e2e test of the menus walks the bar in a browser): a submenu
// of the tab View is built from data in App.svelte, and each of its parents names a hint by its group. This reads the
// source, so a new submenu without a hint is red here and not only in the browser.
describe('the submenus of the tab View carry a hint', () => {
  it('every submenu literal of App.svelte has a hint line', () => {
    const lines = app.split('\n');
    const bare: number[] = [];
    lines.forEach((line, i) => {
      if (!/kind:\s*'submenu'/.test(line)) return;
      const near = lines.slice(i, i + 4).join('\n');
      if (!/\bhint:/.test(near)) bare.push(i + 1);
    });
    expect(bare).toEqual([]);
  });

  it('the hint of each group (time, review, repos, export) exists in English and German', () => {
    for (const group of ['time', 'review', 'repos', 'export']) {
      const key = `hint.item.menu.sub.${group}`;
      expect((EN as Record<string, string>)[key], `en ${key}`).toBeTruthy();
      expect((DE as Record<string, string>)[key], `de ${key}`).toBeTruthy();
    }
  });
});
