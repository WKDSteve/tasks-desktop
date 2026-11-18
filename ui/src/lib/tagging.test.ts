import { describe, expect, it } from 'vitest';
import { make, snapshot } from './appDouble';
import { buildContextMenu } from 'appkit-ui/contextmenu';
import { createContextRegistry, tagTarget, taskTarget } from './context';
import type { Result, Snapshot } from './contract';
import { task } from './fixtures';
import { translate } from './i18n';
import { paletteActions } from './paletteActions';
import { addTagOptions, changedBy, newTags, ownTags, removeTagOptions, tagCounts, tagTargets, typedTag, type TagTexts } from './tagging';

const texts: TagTexts = { count: (n) => `on ${n}`, all: 'all', some: (n, of) => `${n}/${of}` };
const a = task('pub/a', { tags: ['ui', 'web'], etag: 'ea' });
const b = task('pub/b', { tags: ['ui'], etag: 'eb' });
const c = task('pub/c', { etag: 'ec' });
const d = task('ops/d', { tags: ['on-ohana', 'ui'], etag: 'ed' });

describe('the tags of the open tasks', () => {
  it('are counted, the most used first, then by name', () => {
    expect(tagCounts([a, b, c, d])).toEqual([
      { tag: 'ui', count: 3 },
      { tag: 'on-ohana', count: 1 },
      { tag: 'web', count: 1 },
    ]);
    expect(tagCounts([c])).toEqual([]);
  });

  it('a tag a file names twice is one tag of that task: shown once, counted once', () => {
    const twice = task('pub/twice', { tags: ['dup', 'ui', 'dup'] });
    expect(ownTags(twice)).toEqual(['dup', 'ui']);
    expect(tagCounts([twice, b])).toEqual([
      { tag: 'ui', count: 2 },
      { tag: 'dup', count: 1 },
    ]);
    expect(removeTagOptions([twice], texts).map((o) => o.value)).toEqual(['dup', 'ui']);
  });

  it('a menu works on the marked tasks when it was opened on one of them, else on that task alone', () => {
    const tasks = [a, b, c, d];
    expect(tagTargets('pub/a', ['pub/a', 'pub/c'], tasks)).toEqual(['pub/a', 'pub/c']);
    expect(tagTargets('pub/b', ['pub/a', 'pub/c'], tasks)).toEqual(['pub/b']);
    expect(tagTargets('pub/a', [], tasks)).toEqual(['pub/a']);
    // A mark on a task the list no longer holds is not written to; a task that is gone is no target.
    expect(tagTargets('pub/a', ['pub/a', 'pub/gone'], tasks)).toEqual(['pub/a']);
    expect(tagTargets('pub/gone', [], tasks)).toEqual([]);
    // The "+" of a detail says "this task": that task alone, whatever is marked.
    expect(tagTargets('pub/a', ['pub/a', 'pub/c'], tasks, true)).toEqual(['pub/a']);
  });

  it('a tag typed as new is listed as new only until a task carries it, and once', () => {
    const all = tagCounts([a, b]);
    expect(newTags(['zzz', 'zzz', 'ui'], all)).toEqual(['zzz']);
    // Written for some of the tasks: the vault names it now, the entry "new" goes (no value twice in the list).
    expect(newTags(['zzz'], tagCounts([a, task('pub/z', { tags: ['zzz'] })]))).toEqual([]);
  });
});

describe('the choice of tags', () => {
  it('offers every tag to add, with how many carry it; what the chosen tasks lack comes first, what all have says so', () => {
    const options = addTagOptions(tagCounts([a, b, c, d]), [a, b], texts);
    expect(options).toEqual([
      { value: 'ui', label: 'ui', detail: 'on 3', note: 'all' },
      { value: 'on-ohana', label: 'on-ohana', detail: 'on 1', near: true },
      { value: 'web', label: 'web', detail: 'on 1', note: '1/2', near: true },
    ]);
  });

  it('offers the tags of the chosen tasks to remove, with how many of them carry each', () => {
    expect(removeTagOptions([a, b, c], texts)).toEqual([
      { value: 'ui', label: 'ui', detail: '2/3' },
      { value: 'web', label: 'web', detail: '1/3' },
    ]);
    expect(removeTagOptions([b], texts)).toEqual([{ value: 'ui', label: 'ui', detail: '' }]);
    expect(removeTagOptions([c], texts)).toEqual([]);
  });

  it('takes a typed word as a new tag only when it is none of the listed ones', () => {
    expect(typedTag('  on-workstation ', ['ui'])).toBe('on-workstation');
    expect(typedTag('ui', ['ui'])).toBeNull();
    expect(typedTag('   ', ['ui'])).toBeNull();
  });

  it('counts the tasks a choice changes: one that has the tag already, or lacks the tag to remove, is not one', () => {
    const tasks = [a, b, c];
    const ids = ['pub/a', 'pub/b', 'pub/c'];
    expect(changedBy(tasks, ids, 'add', ['web'])).toEqual(['pub/b', 'pub/c']);
    expect(changedBy(tasks, ids, 'add', ['ui', 'web'])).toEqual(['pub/b', 'pub/c']);
    expect(changedBy(tasks, ids, 'remove', ['web'])).toEqual(['pub/a']);
    expect(changedBy(tasks, ids, 'remove', [])).toEqual([]);
  });
});

describe('the page gives tags', () => {
  async function ready(marks: string[] = []) {
    const m = make({ token: 't' });
    m.hub.capabilities = ['ops'];
    m.hub.doc = snapshot([a, b, c, d]) as Snapshot;
    await m.app.start(null);
    expect(m.app.phase).toBe('ready');
    m.app.stop();
    for (const id of marks) m.app.toggleMark(id);
    return m;
  }

  it('opens the choice for one task, and for all the marked ones when the task is one of them', async () => {
    const m = await ready(['pub/a', 'pub/c']);
    m.app.openTagging('pub/b', 'add');
    expect(m.app.tagging).toEqual({ ids: ['pub/b'], mode: 'add' });
    m.app.openTagging('pub/c', 'remove');
    expect(m.app.tagging).toEqual({ ids: ['pub/a', 'pub/c'], mode: 'remove' });
    m.app.closeTagging();
    expect(m.app.tagging).toBeNull();
    m.app.openTagging('pub/c', 'add', true);
    expect(m.app.tagging).toEqual({ ids: ['pub/c'], mode: 'add' });
  });

  it('writes one set per task that changes, each with the version shown and its own list, and offers the way back', async () => {
    const m = await ready();
    const answer = await m.app.editTags(['pub/a', 'pub/b', 'pub/c'], { add: ['web'], remove: [] });
    expect(m.hub.sent).toHaveLength(1);
    // pub/a has the tag already: it is left out.
    expect(m.hub.sent[0]?.ops).toEqual([
      { op: 'set', id: 'pub/b', patch: { tags: ['ui', 'web'] }, if_match: 'eb' },
      { op: 'set', id: 'pub/c', patch: { tags: ['web'] }, if_match: 'ec' },
    ]);
    expect(answer).toEqual({ changed: 2, failed: [] });
    expect(m.app.toast).toMatchObject({ kind: 'ok', text: translate(m.app.lang, 'bulk.saved', { n: 2 }) });
    expect(m.app.toast?.undo).toHaveLength(2);
  });

  it('takes a tag away, and the key with it when it was the last one', async () => {
    const m = await ready();
    await m.app.editTags(['pub/a', 'pub/b', 'pub/c'], { add: [], remove: ['ui'] });
    expect(m.hub.sent[0]?.ops).toEqual([
      { op: 'set', id: 'pub/a', patch: { tags: ['web'] }, if_match: 'ea' },
      { op: 'set', id: 'pub/b', patch: { tags: null }, if_match: 'eb' },
    ]);
  });

  it('sends nothing when every task has what was asked for, and says so', async () => {
    const m = await ready();
    expect(await m.app.editTags(['pub/a', 'pub/b'], { add: ['ui'], remove: [] })).toEqual({ changed: 0, failed: [] });
    expect(m.hub.sent).toHaveLength(0);
    expect(m.app.toast?.text).toBe(translate(m.app.lang, 'bulk.nothing'));
  });

  it('hands a tag the engine refuses back with the engine words, task by task; the rest stays written', async () => {
    const m = await ready();
    m.hub.next_ops = {
      kind: 'tasks.result',
      ok: false,
      dry_run: false,
      results: [
        { n: 1, op: 'set', id: 'pub/b', ok: true, outcome: 'changed', changed_ids: ['pub/b'], inverse: { op: 'set', id: 'pub/b', patch: { tags: ['ui'] } } },
        { n: 2, op: 'set', ok: false, outcome: 'failed', changed_ids: [], error: { code: 'invalid_argument', message: 'bad tag: "a b"', retryable: false } },
      ],
    } as unknown as Result;
    const answer = await m.app.editTags(['pub/b', 'pub/c'], { add: ['a b'], remove: [] });
    expect(answer).toEqual({ changed: 1, failed: [{ id: 'pub/c', message: 'bad tag: "a b"' }] });
    expect(m.app.toast).toMatchObject({ kind: 'error', text: translate(m.app.lang, 'tags.partial', { done: 1, failed: 1 }) });
    expect(m.app.toast?.undo).toHaveLength(1);
  });

  it('shows all with a tag: the list, filtered by that tag alone, with the float and the choice closed', async () => {
    const m = await ready();
    m.app.setView('board');
    m.app.peek('pub/a');
    m.app.openTagging('pub/a', 'add');
    m.app.showTag('ui');
    expect(m.app.view).toBe('list');
    expect(m.app.tagging).toBeNull();
    expect(m.app.taskFloatOpen).toBe(false);
    expect(m.app.filter.fields).toEqual({ tag: ['ui'] });
    expect(m.app.shown.map((x) => x.id).sort()).toEqual(['ops/d', 'pub/a', 'pub/b']);
  });

  it('offers the tags in the context menu of a task, the tag of a chip its list, and every tag in the palette', async () => {
    const m = await ready();
    const registry = createContextRegistry(m.app);
    const labels = (items: readonly object[]) => items.map((i) => (i as { label?: string }).label);
    const pick = (items: readonly object[], label: string) => (items as { label?: string; onselect?: () => void }[]).find((i) => i.label === label);
    const menu = buildContextMenu(registry, [taskTarget(a)]);
    const t = (key: Parameters<typeof translate>[1], params = {}) => translate(m.app.lang, key, params);
    expect(labels(menu)).toEqual(expect.arrayContaining([t('tags.add'), t('tags.remove')]));
    pick(menu, t('tags.remove'))?.onselect?.();
    expect(m.app.tagging).toEqual({ ids: ['pub/a'], mode: 'remove' });
    m.app.closeTagging();

    const chip = buildContextMenu(registry, [tagTarget('web')]);
    expect(labels(chip)).toEqual([t('tags.show', { tag: 'web' })]);
    pick(chip, t('tags.show', { tag: 'web' }))?.onselect?.();
    expect(m.app.filter.fields).toEqual({ tag: ['web'] });

    const palette = paletteActions(m.app).filter((x) => x.key.startsWith('tag.'));
    expect(palette.map((x) => x.key)).toEqual(['tag.ui', 'tag.on-ohana', 'tag.web']);
    // Last in the list: an empty palette shows its first entries, and those are the ways through the page.
    expect(paletteActions(m.app).slice(-3).map((x) => x.key)).toEqual(['tag.ui', 'tag.on-ohana', 'tag.web']);
    await palette[1]?.run();
    expect(m.app.shown.map((x) => x.id)).toEqual(['ops/d']);
  });
});
