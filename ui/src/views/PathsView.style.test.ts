// The style of the view of the paths: the mark of a safety point is a rule of its own, and the quiet texts (summary,
// figures, counts, sub lines, status) stay muted. A rule added in the middle of a selector list once gave them all the
// warning colour (review of f3b2f11).
import { describe, expect, it } from 'vitest';
import source from './PathsView.svelte?raw';

/** The selectors of each rule of the component's style, with its declarations. */
function rules(css: string): { selectors: string[]; body: string }[] {
  const style = css.slice(css.indexOf('<style>') + 7, css.indexOf('</style>'));
  return [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1]!.split(',').map((s) => s.trim()).filter((s) => s !== ''),
    body: m[2]!,
  }));
}

describe('the style of the view of the paths', () => {
  const all = rules(source);
  it('gives the mark of a safety point a rule of its own', () => {
    const safety = all.filter((r) => r.selectors.includes('.safety-point'));
    expect(safety).toHaveLength(1);
    expect(safety[0]!.selectors).toEqual(['.safety-point']);
    expect(safety[0]!.body).toContain('var(--warn)');
  });

  it('keeps the quiet texts muted', () => {
    for (const name of ['.none', '.summary', '.figures', '.count', '.sub', '.status']) {
      const rule = all.find((r) => r.selectors.includes(name) && /\bcolor:/.test(r.body));
      expect(rule?.body, name).toContain('var(--muted)');
    }
  });
});
