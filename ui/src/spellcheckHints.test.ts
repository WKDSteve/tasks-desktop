// A field that takes text says whether the browser checks its spelling: `spellcheck="false"` on a field for a path, an
// identifier, a command, an address, a tag or a time zone (red squiggles under `Europe/Vienna` are noise), and
// `spellcheck="true"` on a field for prose (titles, names, notes). A field with no `spellcheck` at all is a decision
// nobody made, so this test names it. Fields that are always read-only are exempt: the browser checks no read-only text.

import { parse } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

const COMPONENTS = import.meta.glob('./**/*.svelte', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Input types that take free text. Other types (checkbox, date, number, ...) have no spelling to check. */
const TEXT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel']);

interface Attr {
  type: string;
  name: string;
  value?: true | { type: string; data?: string }[] | { type: string };
}
interface Node {
  type: string;
  name?: string;
  start: number;
  attributes?: Attr[];
  [key: string]: unknown;
}

const attr = (n: Node, name: string): Attr | undefined => n.attributes?.find((a) => a.type === 'Attribute' && a.name === name);

function text(a: Attr | undefined): string | undefined {
  if (!a || !Array.isArray(a.value)) return undefined;
  const [only, ...more] = a.value;
  return only?.type === 'Text' && more.length === 0 ? only.data : undefined;
}

/** The text fields of one component that say nothing about spelling, as `line:element`. */
export function fieldsWithoutSpellcheck(source: string): string[] {
  const out: string[] = [];
  const lineOf = (pos: number) => source.slice(0, pos).split('\n').length;
  function walk(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const v of value) walk(v);
      return;
    }
    const n = value as Node;
    if (n.type === 'RegularElement' && (n.name === 'input' || n.name === 'textarea')) {
      const type = n.name === 'input' ? (attr(n, 'type') ? text(attr(n, 'type')) : 'text') : 'textarea';
      const typed = type === 'textarea' || (type !== undefined && TEXT_TYPES.has(type));
      const dynamicType = n.name === 'input' && attr(n, 'type') !== undefined && type === undefined;
      const readonly = attr(n, 'readonly')?.value === true;
      if ((typed || dynamicType) && !readonly && !attr(n, 'spellcheck')) out.push(`${lineOf(n.start)}:${n.name}`);
    }
    for (const [key, child] of Object.entries(n)) {
      if (key === 'attributes' || key === 'metadata' || key === 'parent') continue;
      walk(child);
    }
  }
  walk((parse(source, { modern: true }) as unknown as { fragment: unknown }).fragment);
  return out;
}

describe('every text field decides about spellcheck', () => {
  it('finds a text field without the attribute, and not one with it or a read-only one', () => {
    const src = [
      '<input type="text" />',
      '<input />',
      '<textarea></textarea>',
      '<input type="text" spellcheck="false" />',
      '<textarea spellcheck="true"></textarea>',
      '<input type="checkbox" /><input type="date" /><input type="text" readonly />',
      '<input type="email" />',
    ].join('\n');
    expect(fieldsWithoutSpellcheck(src)).toEqual(['1:input', '2:input', '3:textarea', '7:input']);
  });

  it('in every component of the page', () => {
    expect(Object.keys(COMPONENTS).length).toBeGreaterThan(30);
    const missing = Object.entries(COMPONENTS).flatMap(([file, source]) => fieldsWithoutSpellcheck(source).map((m) => `${file.slice(2)}:${m}`));
    expect(missing).toEqual([]);
  });
});
