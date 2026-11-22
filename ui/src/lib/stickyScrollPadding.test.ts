import { describe, expect, test } from 'vitest';

// Guard for WCAG 2.4.11 (rule ACC-05): a sticky bar must not hide the element the keyboard focus moves to. The browser
// scrolls a focused element into view, but only as far as the scrollport edge, which is under the sticky bar. So each
// scroll container that holds a sticky bar carries `scroll-padding` (top / left) of the bar's size.
// The test reads the CSS (and the `style:` directives) of the views; every `position: sticky` of a view must be listed
// here, so a new sticky bar fails until it is listed with its container.

// The views as text (Vite reads them; no node types needed in the checked sources).
const SOURCES = import.meta.glob('../views/*.svelte', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
function sourceOf(file: string): string {
  const text = SOURCES[`../views/${file}`];
  if (text === undefined) throw new Error(`no view ${file}`);
  return text;
}

interface Sticky {
  /** The selector of the sticky rule. */
  sticky: string;
  /** The scroll container that must carry the padding: a CSS selector of the file, or `inline` for a `style:` directive. */
  container: string | { inline: string };
  /** The property the container must carry (the edge the bar sits on). */
  property: 'scroll-padding-top' | 'scroll-padding-left';
}

/** Sticky rules that need nothing, each with the reason (a different column, or not reachable by the keyboard). */
const EXEMPT: Record<string, Record<string, string>> = {
  'Today.svelte': {
    '.overview': 'sidebar in its own grid column (grid-area overview), never over the main column; static below 52rem',
  },
  'TimelineView.svelte': {
    '.month-name': 'inside the aria-hidden month scale, holds no focusable element',
  },
};

const STICKY: Record<string, Sticky[]> = {
  'ListView.svelte': [{ sticky: '.area-head', container: ".rows[data-areas='groups']", property: 'scroll-padding-top' }],
  'Matrix.svelte': [{ sticky: 'thead th', container: '.scroll', property: 'scroll-padding-top' }],
  'InboxView.svelte': [{ sticky: '.area', container: '.rows', property: 'scroll-padding-top' }],
  'FinishedDialog.svelte': [{ sticky: '.bar', container: 'dialog', property: 'scroll-padding-top' }],
  'TimelineView.svelte': [
    { sticky: '.row.top', container: { inline: 'scroll-padding-top' }, property: 'scroll-padding-top' },
    { sticky: '.label', container: { inline: 'scroll-padding-left' }, property: 'scroll-padding-left' },
  ],
  'Today.svelte': [],
};

interface Rule {
  selector: string;
  body: string;
}

/** The rules of the `<style>` block, flat (a rule inside `@media` counts as a rule). */
function rulesOf(source: string): Rule[] {
  const style = /<style[^>]*>([\s\S]*?)<\/style>/.exec(source)?.[1] ?? '';
  const css = style.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({ selector: (m[1] ?? '').trim().replace(/\s+/g, ' '), body: m[2] ?? '' });
  }
  return rules;
}

const isSticky = (r: Rule): boolean => /position:\s*sticky/.test(r.body);
const norm = (s: string): string => s.replace(/\s+/g, ' ').replace(/"/g, "'").trim();

describe('sticky bars and scroll-padding (ACC-05)', () => {
  for (const [file, entries] of Object.entries(STICKY)) {
    const source = sourceOf(file);
    const rules = rulesOf(source);

    test(`${file}: every sticky rule is listed`, () => {
      const listed = new Set([...entries.map((e) => e.sticky), ...Object.keys(EXEMPT[file] ?? {})]);
      const found = rules.filter(isSticky).map((r) => r.selector);
      expect(found.filter((s) => !listed.has(s))).toEqual([]);
      for (const s of listed) expect(found, `${s} is not sticky in ${file} any more: drop it from the list`).toContain(s);
    });

    for (const e of entries) {
      test(`${file}: the container of ${e.sticky} carries ${e.property}`, () => {
        if (typeof e.container === 'string') {
          const wanted = norm(e.container);
          const container = rules.filter((r) => norm(r.selector) === wanted);
          expect(container.length, `no rule ${e.container} in ${file}`).toBeGreaterThan(0);
          const has = container.some((r) => new RegExp(`${e.property}:\\s*[^;]*\\S`).test(r.body));
          // `scroll-padding-block-start` is the logical spelling of the same edge.
          const logical = e.property === 'scroll-padding-top' && container.some((r) => /scroll-padding-block-start:\s*\S/.test(r.body));
          expect(has || logical, `${e.container} in ${file} has no ${e.property}`).toBe(true);
        } else {
          const re = new RegExp(`<div[^>]*class="scroll"[^>]*style:${e.container.inline}=`);
          expect(re.test(source), `the scroll container in ${file} has no style:${e.container.inline}`).toBe(true);
        }
      });
    }
  }

  test('Today: the overview stays in its own grid column', () => {
    const rules = rulesOf(sourceOf('Today.svelte'));
    const all = rules.filter((r) => r.selector === '.overview').map((r) => r.body).join(';');
    expect(all).toMatch(/grid-area:\s*overview/);
    expect(rules.some((r) => /grid-template-areas:\s*'main overview'/.test(r.body))).toBe(true);
  });
});
