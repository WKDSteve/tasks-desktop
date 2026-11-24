// A field is at least 16 px: below that iOS Safari zooms into the page when a field takes the focus, and zoom is not
// locked here. The kit (`appkit-ui/base.css`) sets `max(1rem, --font-size)` on every input, select and textarea; a
// rule of a component that names the element and sets a smaller `font-size` would win over it by specificity.
// This test reads the style of every component and names such a rule.

import { describe, expect, it } from 'vitest';

const COMPONENTS = import.meta.glob(['./**/*.svelte', './**/*.css'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Rules that name an input, select or textarea (not as an attribute value) and set a font size under 1rem or 16px. */
export function smallFieldRules(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (m[1] ?? '').trim();
    if (!/\b(input|select|textarea)\b/.test(selector.replace(/\[[^\]]*\]/g, ''))) continue;
    const size = /font-size:\s*([\d.]+)(rem|em|px)\s*;/.exec(m[2] ?? '');
    if (!size) continue;
    const value = Number(size[1]);
    if ((size[2] === 'px' && value < 16) || (size[2] !== 'px' && value < 1)) out.push(`${selector.replace(/\s+/g, ' ')} { font-size: ${size[1]}${size[2]} }`);
  }
  return out;
}

describe('no field is set below 16 px', () => {
  it('finds a small field rule, and not a large one or a rule for a button', () => {
    const css = 'select { font-size: 0.8rem; } .a input { font-size: 14px; } textarea { font-size: 1.1rem; } button { font-size: 0.8rem; } input[type="text"] { color: red; }';
    expect(smallFieldRules(css)).toEqual(['select { font-size: 0.8rem }', '.a input { font-size: 14px }']);
  });

  it('in every component and style sheet of the page', () => {
    const bad = Object.entries(COMPONENTS).flatMap(([file, source]) => smallFieldRules(source).map((r) => `${file}: ${r}`));
    expect(bad).toEqual([]);
  });
});
