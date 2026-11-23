// @vitest-environment jsdom
// The task float of a learning point in the view of the paths: a click on the title opens it over the list with the task,
// "done when" and the proof of the exercise block under the point; the result is written into the note and then the
// point is learned (two writes, the second on the version of the first); a point whose proof is missing is not ticked
// without it; a point without a block says so. The texts are the plan's and are never put in as HTML.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import type { PathDocument, PathNode, PathProgress, Result } from '../lib/contract';
import { task } from '../lib/fixtures';
import PathsView from './PathsView.svelte';

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
  this.dispatchEvent(new Event('close'));
};

type Made = ReturnType<typeof make>;
const progress = (p: Partial<PathProgress> = {}): PathProgress => ({ learned: 0, seen: 0, dropped: 0, open: 0, blocked: 0, total: 0, ...p });
function node(index: number, n: Partial<PathNode>): PathNode {
  return { index, line: index + 10, depth: 0, children: 0, mark: '[ ]', state: 'open', derived: 'open', closed: false, label: `point ${index}`, progress: progress({ open: 1, total: 1 }), ...n };
}
const BLOCK = [
  '**Aufgabe:** Lege drei Dateien an und liste sie mit `ls -l`. <img src=x onerror=alert(1)>',
  '**Fertig, wenn:** Du nennst die Spalten.',
  '**Nachweis:** Füge die Ausgabe ein.',
  '**Ergebnis:**',
].join('\n');
const ENTRY = {
  id: 'all/cli', area: 'all', slug: 'cli', title: 'CLI', areas: [], summary: '', has_tree: true, points: 3,
  progress: progress({ open: 3, total: 3 }), file: 'all/ROADMAP/paths/cli.md', etag: 'e1', valid: true, problems: [],
};
function doc(): PathDocument {
  return {
    kind: 'tasks.path', rev: 'r', digest: 'd', path: ENTRY, body: '', body_truncated: false,
    nodes: [
      node(1, { key: 'ls', label: 'Üben: ls', note: BLOCK }),
      node(2, { key: 'plain', label: 'Lesen' }),
      node(3, { key: 'noproof', label: 'Üben: ohne Beleg', note: '**Aufgabe:** Mach es.' }),
    ],
    progress: progress({ open: 3, total: 3 }),
    tree_problems: [],
  } as unknown as PathDocument;
}
const answer = (results: object[], ok = true): Result => ({ kind: 'tasks.result', ok, dry_run: false, results }) as unknown as Result;

let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await tick();
    await Promise.resolve();
  }
  flushSync();
}
async function show(): Promise<{ m: Made; page: HTMLElement }> {
  const m = make({ token: 't' });
  made = m;
  m.hub.capabilities = null;
  m.hub.doc = snapshot([task('all/x', { status: 'doing' })], 'rev:1');
  m.hub.pathsDoc = { kind: 'tasks.paths', rev: 'p1', digest: 'd', items: [ENTRY], incomplete: [] };
  m.hub.pathDocs.set('all/cli', doc());
  await m.app.start(null);
  const page = document.createElement('div');
  document.body.append(page);
  mounted = mount(PathsView, { target: page, props: { app: m.app } });
  await settle();
  await vi.waitFor(() => expect(page.querySelector('[data-point="ls"]')).not.toBeNull());
  return { m, page };
}
const point = (page: HTMLElement, key: string) => page.querySelector<HTMLElement>(`[data-point="${key}"]`)!;
const sentOps = (m: Made) => m.hub.sent.flatMap((r) => r.ops);
async function openFloat(page: HTMLElement, key: string): Promise<HTMLElement> {
  point(page, key).querySelector<HTMLButtonElement>('button.title-open')!.click();
  await vi.waitFor(() => expect(page.querySelector('dialog[data-exercise]')).not.toBeNull());
  await settle();
  return page.querySelector<HTMLElement>('dialog[data-exercise]')!;
}
function type(float: HTMLElement, text: string): void {
  const area = float.querySelector<HTMLTextAreaElement>('textarea')!;
  area.value = text;
  area.dispatchEvent(new Event('input', { bubbles: true }));
}
const button = (float: HTMLElement, attr: string) => float.querySelector<HTMLButtonElement>(`[${attr}]`)!;

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

describe('task float of a learning point', () => {
  it('opens on the title with the three parts, shows the plan text as text and keeps the block out of the list', async () => {
    const { page } = await show();
    expect(point(page, 'ls').querySelector('.note')).toBeNull();
    const float = await openFloat(page, 'ls');
    expect(float.querySelector('[data-part="aufgabe"]')?.textContent).toContain('Lege drei Dateien an');
    expect(float.querySelector('[data-part="fertig"]')?.textContent).toContain('Du nennst die Spalten.');
    expect(float.querySelector('[data-part="nachweis"]')?.textContent).toContain('Füge die Ausgabe ein.');
    expect(float.querySelector('[data-part="aufgabe"] code')?.textContent).toBe('ls -l');
    expect(float.querySelector('img')).toBeNull();
    expect(page.querySelector('[data-point="ls"]')).not.toBeNull();
  });

  it('does not tick without a result: it says so and sends nothing', async () => {
    const { m, page } = await show();
    const float = await openFloat(page, 'ls');
    button(float, 'data-exercise-learned').click();
    await settle();
    expect(float.querySelector('#exercise-missing')).not.toBeNull();
    expect(sentOps(m)).toEqual([]);
  });

  it('writes the result and the state in one node_set on the version read', async () => {
    const { m, page } = await show();
    const float = await openFloat(page, 'ls');
    type(float, 'total 12');
    button(float, 'data-exercise-learned').click();
    await vi.waitFor(() => expect(sentOps(m)).toHaveLength(1));
    expect(sentOps(m)).toEqual([{ op: 'node_set', id: 'all/cli', point: 'ls', state: 'learned', result: 'total 12', if_match: 'e1' }]);
  });

  it('Save result writes the result alone, and leaves the float open', async () => {
    const { m, page } = await show();
    const float = await openFloat(page, 'ls');
    type(float, 'halb fertig');
    float.querySelector<HTMLButtonElement>('.actions button:not(.primary)')!.click();
    await vi.waitFor(() => expect(sentOps(m)).toEqual([{ op: 'node_set', id: 'all/cli', point: 'ls', result: 'halb fertig', if_match: 'e1' }]));
    expect((float as HTMLDialogElement).open).toBe(true);
  });

  it('says the refusal of the engine in words and stays open', async () => {
    const { m, page } = await show();
    m.hub.ops_queue.push(
      answer(
        [{ n: 1, op: 'node_set', ok: false, error: { code: 'invalid_argument', message: 'learned needs a result: write the **Ergebnis:** line under the point (LP-04)' } }],
        false,
      ),
    );
    const float = await openFloat(page, 'ls');
    type(float, 'x');
    button(float, 'data-exercise-learned').click();
    await vi.waitFor(() => expect(float.querySelector('[data-exercise-refusal]')).not.toBeNull());
    expect(float.querySelector('[data-exercise-refusal]')?.textContent).toContain('Ergebnis');
    expect(float.querySelector('[data-exercise-refusal]')?.textContent).not.toContain('LP-04');
    expect((float as HTMLDialogElement).open).toBe(true);
  });

  it('a point without a proof line is learned from the float without a result', async () => {
    const { m, page } = await show();
    const float = await openFloat(page, 'noproof');
    expect(float.querySelector('[data-part="nachweis"]')).toBeNull();
    button(float, 'data-exercise-learned').click();
    await vi.waitFor(() => expect(sentOps(m)).toEqual([{ op: 'node_set', id: 'all/cli', point: 'noproof', state: 'learned', if_match: 'e1' }]));
  });

  it('a point without a task text shows a hint instead of an empty float', async () => {
    const { page } = await show();
    const float = await openFloat(page, 'plain');
    expect(float.querySelector('[data-part]')).toBeNull();
    expect(float.querySelector('.none')?.textContent).toContain('keinen Aufgabentext');
  });

  it('a tick on the mark of a point that needs its proof opens the float and sends nothing', async () => {
    const { m, page } = await show();
    point(page, 'ls').querySelector<HTMLButtonElement>('button.mark')!.click();
    await vi.waitFor(() => expect(page.querySelector('dialog[data-exercise]')).not.toBeNull());
    expect(sentOps(m)).toEqual([]);
  });

  it('closes with its button and gives the focus back to the point', async () => {
    const { page } = await show();
    const float = await openFloat(page, 'ls');
    button(float, 'data-exercise-close').click();
    await vi.waitFor(() => expect(page.querySelector('dialog[data-exercise]')).toBeNull());
    await settle();
    expect(point(page, 'ls').contains(document.activeElement)).toBe(true);
  });
});
