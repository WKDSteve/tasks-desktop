import { describe, expect, it } from 'vitest';
import { DEFAULT_RANGES, badLink, badTag, bodyFromSections, categoriesShown, categoriesToWrite, categoryDerived, isWebLink, stepTitle, listEditable, oneLine, parseTags, rangesOf, scaffoldOf, scaffoldRows, severityApplies, splitOther, tagsChanged, tagsText } from './fields';

describe('a category that comes from the kind or a tag', () => {
  it('is bug for a bug and every tag spelled like the category', () => {
    expect(categoryDerived('bug', 'bug', [])).toBe(true);
    expect(categoryDerived('bug', 'task', [])).toBe(false);
    expect(categoryDerived('docs', 'task', ['docs'])).toBe(true);
    expect(categoryDerived('docs', 'task', ['ui'])).toBe(false);
  });
  it('stays in what the detail shows when a draft holds other categories or none', () => {
    expect(categoriesShown(['bug', 'docs', 'tests'], ['tests'], 'task', ['docs'])).toEqual(['docs', 'tests']);
    expect(categoriesShown(['bug', 'docs'], undefined, 'bug', [])).toEqual(['bug']);
    expect(categoriesShown(['bug', 'docs'], undefined, 'task', [])).toEqual([]);
  });
  it('is not written to the task: only what the box itself holds is', () => {
    expect(categoriesToWrite(['bug', 'docs', 'tests'], ['bug', 'docs', 'tests'], 'bug', ['docs'])).toEqual(['tests']);
  });
});

describe('the title of a task made from a step', () => {
  it('drops the number of the plan, not a number of the text', () => {
    expect(stepTitle('2. tidy up')).toBe('tidy up');
    expect(stepTitle('tidy up 2. rooms')).toBe('tidy up 2. rooms');
    expect(stepTitle('3 rooms')).toBe('3 rooms');
  });
});

describe('splitOther (the Other line under the scope list)', () => {
  const scopes = ['ui', 'api', 'multi-repo'];
  it('puts scope words with the ticks and the rest into the tags', () => {
    expect(splitOther('api, shiny new-thing', scopes, ['ui'])).toEqual({ scope: ['ui', 'api'], tags: ['shiny', 'new-thing'] });
  });
  it('recognises a scope word in any case and keeps a tag as typed', () => {
    expect(splitOther('UI, Api, Shiny', scopes, ['ui'])).toEqual({ scope: ['ui', 'api'], tags: ['Shiny'] });
  });
  it('counts a word ticked and typed once, and an empty line as nothing', () => {
    expect(splitOther('ui ui', scopes, ['ui'])).toEqual({ scope: ['ui'], tags: [] });
    expect(splitOther('  ', scopes, [])).toEqual({ scope: [], tags: [] });
  });
});

describe('the acceptance scaffold (the same join as model.scaffold of the engine)', () => {
  const row = (id: string) => ({ id, de: `${id} de`, en: `${id} en` });
  const scaffold = scaffoldOf({
    kind: { bug: [row('repro'), row('regression-test')] },
    category: { bug: [row('repro'), row('regression-test')], security: [row('proof-test')] },
    scope: { usercmd: [row('usercmd')], keymap: [row('keymap')], api: [row('api-types')], docs: [row('docs')] },
    implied: [{ kind: 'feature', category: ['ux', 'bindings'], scope: ['keymap', 'usercmd', 'docs'] }],
  });
  const order = { categories: ['bug', 'security', 'bindings', 'ux'], scopes: ['usercmd', 'keymap', 'api', 'docs'] };
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

  it('joins kind, category and scope, each id once', () => {
    expect(ids(scaffoldRows(scaffold, { kind: 'bug', categories: ['bug', 'security'], scopes: [] }, order, 'en'))).toEqual(['repro', 'regression-test', 'proof-test']);
    expect(scaffoldRows(scaffold, { kind: 'task', categories: [], scopes: [] }, order, 'en')).toEqual([]);
  });
  it('gives a feature with bindings the rows of its implied scopes, in the order of the scopes', () => {
    expect(ids(scaffoldRows(scaffold, { kind: 'feature', categories: ['bindings'], scopes: ['api'] }, order, 'en'))).toEqual(['usercmd', 'keymap', 'api-types', 'docs']);
    expect(scaffoldRows(scaffold, { kind: 'task', categories: ['bindings'], scopes: [] }, order, 'en')).toEqual([]);
  });
  it('writes the language of the task headings', () => {
    expect(scaffoldRows(scaffold, { kind: 'bug', categories: [], scopes: [] }, order, 'de')[0]?.text).toBe('repro de');
  });
  it('takes nothing that is not rows (an answer is data)', () => {
    expect(scaffoldOf(null)).toEqual({ kind: {}, category: {}, scope: {}, implied: [] });
    expect(scaffoldOf({ kind: { bug: [{ id: 1 }] }, implied: [{ kind: 3 }] })).toEqual({ kind: {}, category: {}, scope: {}, implied: [] });
  });
  it('lets a severity fit a bug or a security task only', () => {
    expect(severityApplies('bug', [])).toBe(true);
    expect(severityApplies('task', ['docs', 'security'])).toBe(true);
    expect(severityApplies('feature', ['ux'])).toBe(false);
  });
});

describe('a summary of several lines', () => {
  it('is kept as one line: each line break with the blanks around it is one space', () => {
    expect(oneLine('First line\nsecond line')).toBe('First line second line');
    expect(oneLine('a  \r\n\r\n  b\rc')).toBe('a b c');
    expect(oneLine(`a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c`)).toBe('a b c');
    // Blanks that are not around a line break stay as they were typed.
    expect(oneLine('one  two')).toBe('one  two');
    expect(oneLine('no break')).toBe('no break');
  });
});

describe('the ranges of the engine', () => {
  it('are taken from hello.enums, and the placeholder of the effort is not a size', () => {
    const ranges = rangesOf({
      kind: ['feature', 'bug', 'novelty'],
      effort: ['XS', 'M', '<n>d'],
      value: [1, 2, 3],
      status: ['open'],
    });
    expect(ranges.kinds).toEqual(['feature', 'bug', 'novelty']);
    expect(ranges.efforts).toEqual(['XS', 'M']);
    expect(ranges.values).toEqual([1, 2, 3]);
  });

  it('take the statuses, priorities, actors, categories and severities of the engine, each on its own', () => {
    const ranges = rangesOf({
      status: ['open', 'review'],
      prio: [1, 2, 3, 4],
      actor: ['me', 'bot'],
      category: ['docs', 'legal'],
      severity: ['low', 'blocker'],
    });
    expect(ranges.statuses).toEqual(['open', 'review']);
    expect(ranges.prios).toEqual([1, 2, 3, 4]);
    expect(ranges.actors).toEqual(['me', 'bot']);
    expect(ranges.categories).toEqual(['docs', 'legal']);
    expect(ranges.severities).toEqual(['low', 'blocker']);
    // A field that is not a list of words or numbers keeps the default, the others do not change it.
    // A word or a number named twice is one choice.
    expect(rangesOf({ status: ['open', 'open', 'doing'], prio: [1, 1, 2] })).toMatchObject({ statuses: ['open', 'doing'], prios: [1, 2] });
    const bad = rangesOf({ status: 'open', prio: ['1'], actor: [''], category: [7], severity: [] });
    expect(bad).toEqual(DEFAULT_RANGES);
  });

  it('keep the default for what is missing or not what it should be (an answer is data)', () => {
    for (const bad of [undefined, null, 'x', 5, [], {}, { kind: 'bug', effort: [1], value: ['1'] }, { kind: [], effort: ['<n>d'], value: [1.5] }]) {
      expect(rangesOf(bad), JSON.stringify(bad)).toEqual(DEFAULT_RANGES);
    }
    // One good field does not make the others good.
    expect(rangesOf({ kind: ['bug'], value: [-1] })).toEqual({ ...DEFAULT_RANGES, kinds: ['bug'] });
    // Not a long list, not a long word, not a huge number.
    expect(rangesOf({ kind: Array.from({ length: 51 }, (_, i) => `k${i}`) }).kinds).toEqual(DEFAULT_RANGES.kinds);
    expect(rangesOf({ kind: ['x'.repeat(41)] }).kinds).toEqual(DEFAULT_RANGES.kinds);
    expect(rangesOf({ value: [100000] }).values).toEqual(DEFAULT_RANGES.values);
  });
});

describe('a list as one line', () => {
  it('is editable unless an entry holds a comma, which would be cut in two', () => {
    expect(listEditable(undefined)).toBe(true);
    expect(listEditable([])).toBe(true);
    expect(listEditable(['docs/a.md', 'repo@abc1234'])).toBe(true);
    expect(listEditable(['docs/a,b.md'])).toBe(false);
  });

  it('is not editable when typing the line back would clean the list up (blanks, empty, repeated)', () => {
    expect(listEditable(['a.md', 'a.md'])).toBe(false);
    expect(listEditable([' a.md'])).toBe(false);
    expect(listEditable(['a.md '])).toBe(false);
    expect(listEditable(['a.md', ''])).toBe(false);
    expect(listEditable([' '])).toBe(false);
  });
});

describe('tags', () => {
  it('splits on commas, trims, drops empties and duplicates, keeps the order', () => {
    expect(parseTags(' ui,  docs ,, ui ,perf')).toEqual(['ui', 'docs', 'perf']);
    expect(parseTags('')).toEqual([]);
    expect(parseTags(' , ')).toEqual([]);
  });

  it('does not cut a tag: the engine says its limit, and nothing is lost silently', () => {
    expect(parseTags('x'.repeat(200))[0]).toHaveLength(200);
    expect(parseTags('\u{1F600}'.repeat(40))[0]).toBe('\u{1F600}'.repeat(40));
  });

  // The engine's rule, written out (ops.lua / mutate.lua): the characters of a list entry that break the file, and
  // every control character except the tab. Probed against the real engine for U+0000..U+01FF.
  it('refuses what the engine refuses and nothing else', () => {
    const refusedByEngine = (cp: number) =>
      cp <= 0x08 || (cp >= 0x0a && cp <= 0x1f) || (cp >= 0x7f && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029;
    const listBreakers = new Set([',', '[', ']', '"', "'", '#']);
    for (let cp = 0; cp <= 0x1ff; cp += 1) {
      const ch = String.fromCodePoint(cp);
      const expected = refusedByEngine(cp) || listBreakers.has(ch);
      expect(badTag([`a${ch}b`]) !== null, `U+${cp.toString(16)}`).toBe(expected);
    }
    for (const cp of [0x2028, 0x2029]) {
      expect(badTag([`a${String.fromCodePoint(cp)}b`])).not.toBeNull();
    }
    expect(badTag(['ok', 'a#b', 'c'])).toBe('a#b');
    expect(badTag(['fine: but-ok 1.2', 'ünï', 'tab\there'])).toBeNull();
  });

  it('shows the tags and notices a change only when there is one', () => {
    expect(tagsText(['a', 'b'])).toBe('a, b');
    expect(tagsText(undefined)).toBe('');
    expect(tagsChanged(['a', 'b'], 'a,b')).toBe(false);
    expect(tagsChanged(['a', 'b'], 'b, a')).toBe(true);
    expect(tagsChanged(undefined, '')).toBe(false);
    expect(tagsChanged(undefined, 'x')).toBe(true);
    expect(tagsChanged(['a'], '')).toBe(true);
  });
});

describe('the body of a new task from its sections', () => {
  it('is empty when nothing was typed, so the engine writes its own sections', () => {
    expect(bodyFromSections({ context: ' ', acceptance: '', notes: '\n' }, 'de')).toBe('');
  });

  it('keeps the hint of an empty section and gives a plain acceptance line a checkbox', () => {
    const body = bodyFromSections({ context: 'Why', acceptance: 'works\n- [x] kept\n\nlast', notes: '' }, 'en');
    expect(body).toBe(
      [
        '## Context',
        '',
        'Why',
        '',
        '## Acceptance',
        '',
        '- [ ] works',
        '- [x] kept',
        '',
        '- [ ] last',
        '',
        '## Notes',
        '',
        '<!-- Decisions, dead ends, references. -->',
        '',
      ].join('\n'),
    );
  });

  it('uses the German headings', () => {
    expect(bodyFromSections({ context: '', acceptance: '', notes: 'n' }, 'de')).toContain('## Notizen\n\nn');
  });
});

describe('web links', () => {
  it('accept http and https addresses with a host, nothing else', () => {
    expect(isWebLink('https://example.org/a#b')).toBe(true);
    expect(isWebLink('HTTP://example.org')).toBe(true);
    for (const bad of ['javascript:alert(1)', 'ftp://example.org', 'file:///c:/x', 'lua/x.lua', 'https://', 'https:// a', 'https://a\tb', 'data:text/html,x']) {
      expect(isWebLink(bad)).toBe(false);
    }
  });

  it('name the first entry that is none', () => {
    expect(badLink(['https://ok.org', 'javascript:x', 'ftp://y'])).toBe('javascript:x');
    expect(badLink(['https://ok.org'])).toBeNull();
    expect(badLink([])).toBeNull();
  });
});

describe('the sections of a new task, pinned against tasks.nvim', () => {
  // The same two samples and strings are in `TESTS/tasks_form_spec.lua` of tasks.nvim (`mutate.body_sections`): the
  // headings and hint comments are kept in two places, this is what makes one side name the other when it drifts.
  it('write the English headings and hint as the engine does', () => {
    expect(bodyFromSections({ context: 'Why', acceptance: 'works\n- [x] kept', notes: '' }, 'en')).toBe(
      [
        '## Context',
        '',
        'Why',
        '',
        '## Acceptance',
        '',
        '- [ ] works',
        '- [x] kept',
        '',
        '## Notes',
        '',
        '<!-- Decisions, dead ends, references. -->',
        '',
      ].join('\n'),
    );
  });

  it('write the German headings and hints as the engine does', () => {
    expect(bodyFromSections({ context: '', acceptance: '', notes: 'n' }, 'de')).toBe(
      [
        '## Kontext',
        '',
        '<!-- Warum, woher kam das. -->',
        '',
        '## Akzeptanz',
        '',
        '<!-- was am Ende wahr sein muss, als Checkliste -->',
        '',
        '## Notizen',
        '',
        'n',
        '',
      ].join('\n'),
    );
  });
});
