import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { make } from './appDouble';
import { fillOfFinding, INTENT_MAX_BYTES, parseIntentAnswer, readIntent } from './intent';
import { translate } from './i18n';

/** The golden example of the schema (appkit `schemas/wkd-intent/1/examples/tasks.new.json`). */
const NEW = {
  schema: 'wkd-intent/1',
  action: 'tasks.new',
  mode: 'form',
  source: { app: 'testing', finding: '0123456789abcdef' },
  finding: {
    schema: 'testing-finding/1',
    fp: '0123456789abcdef',
    kind: 'case',
    repo: 'example.nvim',
    area: 'pub',
    sha: '0123456789abcdef0123456789abcdef01234567',
    class: 'public',
    where: { file: 'TESTS/parse_spec.lua', line: 12 },
    run: { source: 'ci', id: '1234', os: 'linux', url: 'https://github.com/example/example.nvim/actions/runs/1234' },
    title: 'parse_spec: an empty line ends the list',
    excerpt: 'expected 2 items, got 1 (<REPO>/TESTS/parse_spec.lua:12)\nsecond line with ``` in it',
    repro: 'scripts/test.sh --file parse_spec',
    rule: null,
  },
  target: null,
};
const SHOW = { schema: 'wkd-intent/1', action: 'tasks.show', mode: 'form', source: { app: 'testing' }, finding: null, target: { id: 'pub/a' } };

describe('an intent as text', () => {
  it('is measured before it is parsed, and is one JSON object or nothing', () => {
    expect(readIntent(JSON.stringify(NEW))).toEqual({ doc: NEW });
    expect(readIntent('  \n')).toEqual({ problem: 'empty' });
    for (const bad of ['not json', '[1]', '"text"', '7', 'null', '{"a":']) expect(readIntent(bad)).toEqual({ problem: 'not_json' });
    // Too large is told as that even when it is no JSON at all: nothing of it was parsed.
    expect(readIntent('x'.repeat(INTENT_MAX_BYTES + 1))).toEqual({ problem: 'too_large' });
    // Bytes, not characters: a text of two-byte letters is over the limit at half its length.
    expect(readIntent(`"${'ä'.repeat(INTENT_MAX_BYTES / 2)}"`)).toEqual({ problem: 'too_large' });
    expect(readIntent(JSON.stringify({ pad: 'x'.repeat(INTENT_MAX_BYTES - 20) }))).toHaveProperty('doc');
  });

  it('takes only an answer of the engine to an intent', () => {
    expect(parseIntentAnswer({ kind: 'tasks.intent', action: 'tasks.new', outcome: 'would_create', area: 'pub', title: 'T', extra: 1 })).toEqual({
      action: 'tasks.new',
      outcome: 'would_create',
      area: 'pub',
      title: 'T',
    });
    for (const none of [null, 'x', {}, { kind: 'tasks.list', action: 'tasks.new', outcome: 'would_create' }, { kind: 'tasks.intent', action: 'tasks.new', outcome: 'deleted' }]) {
      expect(parseIntentAnswer(none)).toBeNull();
    }
  });

  it('fills the form from the finding: a bug with the key of the finding, its place, its commit, its run and its excerpt', () => {
    expect(fillOfFinding(NEW, 'en')).toEqual({
      title: 'parse_spec: an empty line ends the list',
      area: 'pub',
      kind: 'bug',
      tags: 'testing',
      refs: 'testing-finding:0123456789abcdef, TESTS/parse_spec.lua:12, example.nvim@0123456789abcdef0123456789abcdef01234567',
      links: 'https://github.com/example/example.nvim/actions/runs/1234',
      summary: 'expected 2 items, got 1 (<REPO>/TESTS/parse_spec.lua:12)',
      context:
        "A finding of testing.nvim (`0123456789abcdef`):\n\n```\nexpected 2 items, got 1 (<REPO>/TESTS/parse_spec.lua:12)\nsecond line with ''' in it\n```\n\nReproduce: `scripts/test.sh --file parse_spec`",
    });
    expect(fillOfFinding(NEW, 'de').context).toContain('Ein Befund von testing.nvim');
    // What is not there, or not of the form the engine gives a ref, is left out: nothing is made up.
    const bare = fillOfFinding({ finding: { fp: 'ab', title: 'T', repo: 'a b', sha: 'zz', where: { file: 'x.lua', line: 0 }, run: { url: 'http://elsewhere/' } } }, 'en');
    expect(bare).toEqual({ title: 'T', kind: 'bug', tags: 'testing', refs: 'testing-finding:ab, x.lua', links: '', summary: '', context: 'A finding of testing.nvim (`ab`):' });
    expect(fillOfFinding({}, 'en').title).toBe('');
  });
});

describe('taking an intent on the page', () => {
  async function page() {
    const m = make({ token: 't' });
    await m.app.start(null);
    m.app.stop();
    m.app.openIntent();
    return m;
  }

  it('a finding opens the new-task form filled in, and nothing is written', async () => {
    const m = await page();
    const text = JSON.stringify(NEW);
    expect(await m.app.takeIntent(text)).toEqual({ kind: 'form' });
    // The engine was asked with the text as it came, once.
    expect(m.hub.intents).toEqual([text]);
    expect(m.app.intentOpen).toBe(false);
    expect(m.app.capturing).toBe(true);
    expect(m.app.captureTitle).toBe('parse_spec: an empty line ends the list');
    expect(m.app.captureArea).toBe('pub');
    expect(m.app.captureFill).toMatchObject({ kind: 'bug', tags: 'testing', links: 'https://github.com/example/example.nvim/actions/runs/1234' });
    expect(m.app.captureFill.refs).toContain('testing-finding:0123456789abcdef');
    expect(m.hub.sent).toEqual([]);
  });

  it('an area the page does not know is not chosen for the person', async () => {
    const m = await page();
    await m.app.takeIntent(JSON.stringify({ ...NEW, finding: { ...NEW.finding, area: 'elsewhere' } }));
    expect(m.app.capturing).toBe(true);
    expect(m.app.captureArea).toBeUndefined();
  });

  it('a finding a task holds already is told with that task, which can be opened; no second form', async () => {
    const m = await page();
    m.hub.intentAnswer = { action: 'tasks.new', outcome: 'exists', id: 'pub/a' };
    expect(await m.app.takeIntent(JSON.stringify(NEW))).toEqual({ kind: 'exists', id: 'pub/a' });
    expect(m.app.capturing).toBe(false);
    expect(m.app.intentOpen).toBe(true);
    m.app.openIntentTask('pub/a');
    expect([m.app.selectedId, m.app.peeking, m.app.intentOpen]).toEqual(['pub/a', true, false]);
  });

  it('tasks.show shows the task; one that is not there is said', async () => {
    const m = await page();
    m.hub.intentAnswer = { action: 'tasks.show', outcome: 'shown', id: 'pub/a' };
    expect(await m.app.takeIntent(JSON.stringify(SHOW))).toEqual({ kind: 'shown', id: 'pub/a' });
    expect([m.app.selectedId, m.app.peeking, m.app.intentOpen]).toEqual(['pub/a', true, false]);
    const other = await page();
    other.hub.intentAnswer = { action: 'tasks.show', outcome: 'not_found', id: 'pub/gone' };
    expect(await other.app.takeIntent(JSON.stringify(SHOW))).toEqual({ kind: 'not_found', id: 'pub/gone' });
    expect(other.app.peeking).toBe(false);
  });

  it('what is no intent never reaches the hub; what the engine refuses is told in its words', async () => {
    const m = await page();
    expect(await m.app.takeIntent('')).toEqual({ kind: 'refused', problem: 'empty' });
    expect(await m.app.takeIntent('x'.repeat(INTENT_MAX_BYTES + 1))).toEqual({ kind: 'refused', problem: 'too_large' });
    expect(await m.app.takeIntent('[]')).toEqual({ kind: 'refused', problem: 'not_json' });
    expect(m.hub.intents).toEqual([]);
    m.hub.intentAnswer = new ApiError(400, 'invalid_argument', "intent refused: finding.class 'private' is not public or internal");
    expect(await m.app.takeIntent(JSON.stringify(NEW))).toEqual({
      kind: 'refused',
      why: "intent refused: finding.class 'private' is not public or internal",
    });
    expect(m.app.capturing).toBe(false);
    // An answer the page does not know (an engine that carried it out) opens nothing either.
    m.hub.intentAnswer = { action: 'tasks.new', outcome: 'created', id: 'pub/x' };
    expect(await m.app.takeIntent(JSON.stringify(NEW))).toEqual({ kind: 'refused', why: 'created' });
    expect(m.app.capturing).toBe(false);
  });

  it('a vault that is read only makes no form, and says so', async () => {
    const m = make({ token: 't', mode: 'web', readOnly: true });
    await m.app.start(null);
    m.app.stop();
    expect(await m.app.takeIntent(JSON.stringify(NEW))).toEqual({ kind: 'refused', why: translate(m.app.lang, 'write.read_only') });
    expect(m.app.capturing).toBe(false);
  });
});
