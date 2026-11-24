// Commands, identifiers, paths and shortcuts are not for the translation of the browser: translated, `tasks-desktop
// open` stops being a command and a task id stops being an id. Every `<code>`, `<kbd>` and `<pre>` of the page, and every
// element that shows an id (`class="id"`), says `translate="no"` (or `translate="yes"` where the text inside is prose,
// like the body of a task). A `<code>` straight inside a `<pre translate="no">` is covered by that `<pre>`.

import { describe, expect, it } from 'vitest';

const COMPONENTS = import.meta.glob('./**/*.svelte', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** The tags of one component that should carry a `translate` attribute and do not. */
export function unprotected(source: string): string[] {
  const bad: string[] = [];
  for (const m of source.matchAll(/<(code|pre|kbd)\b[^>]*>/g)) {
    const tag = m[0];
    if (/translate="(no|yes)"/.test(tag)) continue;
    const before = source.slice(Math.max(0, (m.index ?? 0) - 80), m.index);
    if (tag.startsWith('<code') && /<pre\b[^>]*translate="no"[^>]*>\s*$/.test(before)) continue;
    bad.push(tag);
  }
  for (const m of source.matchAll(/<[a-z]+\b[^>]*class="id"[^>]*>/g)) {
    if (!/translate="(no|yes)"/.test(m[0])) bad.push(m[0]);
  }
  return bad;
}

describe('translate attribute on code, ids and shortcuts', () => {
  it('finds an unprotected element, and not a protected one', () => {
    const src =
      '<code>a</code><code translate="no">b</code><pre translate="no"><code>c</code></pre><pre><code>d</code></pre>' +
      '<kbd>j</kbd><span class="id">x</span><span class="id" translate="no">y</span><pre translate="yes">prose</pre>';
    expect(unprotected(src)).toEqual(['<code>', '<pre>', '<code>', '<kbd>', '<span class="id">']);
  });

  it('in every component of the page', () => {
    expect(Object.keys(COMPONENTS).length).toBeGreaterThan(30);
    const bad = Object.entries(COMPONENTS).flatMap(([file, source]) => unprotected(source).map((tag) => `${file.slice(2)}: ${tag}`));
    expect(bad).toEqual([]);
  });
});
