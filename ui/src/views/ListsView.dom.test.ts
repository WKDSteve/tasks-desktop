// @vitest-environment jsdom
// The tab Lists in a DOM: the lists and their entries, a line typed and sent (also into a vault without a list: the
// first list comes in the same request), a tick, the filter asked of the engine, a picture pasted into the line, the
// export as Markdown, an entry opened and changed, the delete of an entry with attachments asked first. The engine's
// reading (the #tags, the filter itself) is the browser tests'.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import type { ChecklistEntry } from '../lib/contract';
import ListsView from './ListsView.svelte';

type Made = ReturnType<typeof make>;

function entry(slug: string, more: Partial<ChecklistEntry> = {}): ChecklistEntry {
  return {
    id: `_list-support/${slug}`,
    slug,
    title: `Eintrag ${slug}`,
    created: '2026-11-20T09:00:00Z',
    tags: [],
    text: '',
    file: `_list-support/${slug}.md`,
    etag: `sha256:${slug}`,
    ...more,
  } as ChecklistEntry;
}

const SUPPORT = { id: '_list-support', title: 'Support', created: '2026-11-01T08:00:00Z', total: 2, open: 1, etag: 'sha256:l1' };
const AHA = { id: '_list-aha', title: 'Aha', created: '2026-11-02T08:00:00Z', total: 0, open: 0, etag: 'sha256:l2' };

let mounted: ReturnType<typeof mount>[] = [];
let made: Made | undefined;

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await tick();
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
  }
}

async function boot(lists = [SUPPORT, AHA], entries: ChecklistEntry[] = [entry('a', { tags: ['sap'] }), entry('b', { done: '2026-11-21' })]): Promise<{ m: Made; root: HTMLElement }> {
  const m = make({ token: 't', now: new Date('2026-11-25T10:00:00').getTime() });
  made = m;
  m.hub.capabilities = ['checklists', 'checklist'];
  m.hub.checklistLists = lists;
  m.hub.checklistEntries.set('_list-support', entries);
  m.hub.doc = snapshot([]);
  await m.app.start(null);
  const root = document.createElement('div');
  document.body.append(root);
  mounted.push(mount(ListsView, { target: root, props: { app: m.app } }));
  await settle();
  return { m, root };
}

const sent = (m: Made) => m.hub.sent.flatMap((r) => r.ops);

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

afterEach(() => {
  for (const x of mounted) void unmount(x);
  mounted = [];
  made?.app.stop();
  made = undefined;
  document.body.innerHTML = '';
});

describe('the tab Lists', () => {
  it('shows the first list with its entries, their tags and which are done', async () => {
    const { m, root } = await boot();
    const choose = root.querySelector<HTMLSelectElement>('[data-lists-choose]');
    expect(choose?.value).toBe('_list-support');
    expect([...(choose?.options ?? [])].map((o) => o.textContent)).toEqual(['Support (1 offen)', 'Aha (0 offen)']);
    const rows = [...root.querySelectorAll('[data-entry]')];
    expect(rows.map((r) => r.getAttribute('data-entry'))).toEqual(['_list-support/a', '_list-support/b']);
    expect(rows[0]?.querySelector('[data-entry-tag]')?.textContent).toBe('#sap');
    expect(rows[1]?.querySelector<HTMLInputElement>('[data-entry-done]')?.checked).toBe(true);
    expect(m.hub.checklistQueries.at(-1)).toEqual({ id: '_list-support' });
  });

  it('sends the typed line to the list shown, as typed (the engine makes the #words tags)', async () => {
    const { m, root } = await boot();
    type(root.querySelector<HTMLInputElement>('[data-lists-line]')!, 'Ticket #sap anlegen');
    root.querySelector<HTMLFormElement>('[data-lists-add]')!.requestSubmit();
    await settle();
    expect(sent(m)).toEqual([{ op: 'entry_add', list: '_list-support', title: 'Ticket #sap anlegen' }]);
    expect(root.querySelector<HTMLInputElement>('[data-lists-line]')?.value).toBe('');
  });

  it('makes the first list with the first line in a vault without one', async () => {
    const { m, root } = await boot([], []);
    expect(root.querySelector('[data-lists-none]')).not.toBeNull();
    type(root.querySelector<HTMLInputElement>('[data-lists-line]')!, 'Erstes');
    root.querySelector<HTMLFormElement>('[data-lists-add]')!.requestSubmit();
    await settle();
    expect(sent(m)).toEqual([
      { op: 'checklist_new', title: 'Schnellliste', id: '_list-schnellliste' },
      { op: 'entry_add', list: '_list-schnellliste', title: 'Erstes' },
    ]);
    expect(m.app.checklistOpen).toBe('_list-schnellliste');
  });

  it('ticks an entry on the version shown', async () => {
    const { m, root } = await boot();
    root.querySelector<HTMLInputElement>('[data-entry="_list-support/a"] [data-entry-done]')!.click();
    await settle();
    expect(sent(m)).toEqual([{ op: 'entry_set', id: '_list-support/a', done: true, if_match: 'sha256:a' }]);
  });

  it('asks the engine for the filter: the state and a tag', async () => {
    const { m, root } = await boot();
    const state = root.querySelector<HTMLSelectElement>('[data-lists-state]')!;
    state.value = 'open';
    state.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    const tag = root.querySelector<HTMLSelectElement>('[data-lists-tag]')!;
    expect([...tag.options].map((o) => o.value)).toEqual(['', 'sap']);
    tag.value = 'sap';
    tag.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(m.hub.checklistQueries.at(-1)).toEqual({ id: '_list-support', state: 'open', tag: 'sap' });
    expect(root.querySelector('[data-lists-reset]')).not.toBeNull();
  });

  it('makes an entry of a picture pasted into the line, with the picture attached', async () => {
    const { m, root } = await boot();
    const line = root.querySelector<HTMLInputElement>('[data-lists-line]')!;
    type(line, 'Fehlerbild');
    const picture = new File(['png'], 'image.png', { type: 'image/png' });
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, 'clipboardData', { value: { files: [picture] } });
    line.dispatchEvent(paste);
    await settle();
    expect(paste.defaultPrevented).toBe(true);
    expect(sent(m)).toEqual([{ op: 'entry_add', list: '_list-support', title: 'Fehlerbild' }]);
    expect(m.hub.uploads).toHaveLength(1);
    expect(m.hub.uploads[0]).toMatchObject({ id: '_list-support/made-entry', kind: 'image' });
    expect(m.hub.uploads[0]?.name).toMatch(/^pasted-\d{8}-\d{6}\.png$/);
  });

  it('exports what the filter shows as Markdown', async () => {
    const { m, root } = await boot();
    root.querySelector<HTMLButtonElement>('[data-export="markdown"]')!.click();
    await settle();
    expect(m.files).toHaveLength(1);
    expect(m.files[0]?.name).toBe('list-support-2026-11-25.md');
    expect(m.files[0]?.text).toContain('# Support');
    expect(m.files[0]?.text).toContain('## Eintrag a');
    expect(m.files[0]?.text).toContain('## ~~Eintrag b~~');
    expect(root.querySelector('[data-lists-note]')?.textContent).toBe('2 Einträge gespeichert.');
  });

  it('opens an entry and sends what changed of it', async () => {
    const { m, root } = await boot();
    root.querySelector<HTMLButtonElement>('[data-entry="_list-support/a"] [data-entry-open]')!.click();
    await settle();
    const detail = root.querySelector('[data-entry="_list-support/a"] [data-entry-detail]')!;
    expect(detail).not.toBeNull();
    type(detail.querySelector<HTMLInputElement>('[data-entry-tags]')!, 'sap, #Hiva');
    type(detail.querySelector<HTMLTextAreaElement>('[data-entry-body]')!, 'Mit **Text**');
    detail.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await settle();
    expect(sent(m)).toEqual([{ op: 'entry_set', id: '_list-support/a', if_match: 'sha256:a', tags: ['sap', 'hiva'], body: 'Mit **Text**' }]);
  });

  it('asks before an entry goes with its attachments', async () => {
    const { m, root } = await boot(undefined, [entry('a', { folder: true, assets: ['assets/notes.txt'] })]);
    root.querySelector<HTMLButtonElement>('[data-entry-open]')!.click();
    await settle();
    root.querySelector<HTMLButtonElement>('[data-entry-delete]')!.click();
    await settle();
    expect(sent(m)).toEqual([]);
    expect(root.querySelector('[data-entry-file="assets/notes.txt"]')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('[data-entry-delete-yes]')!.click();
    await settle();
    expect(sent(m)).toEqual([{ op: 'entry_delete', id: '_list-support/a', if_match: 'sha256:a' }]);
  });

  it('opens its form of a new list when the menu asks for one', async () => {
    const { m, root } = await boot();
    m.app.askNewChecklist();
    await settle();
    expect(m.app.view).toBe('lists');
    expect(root.querySelector('[data-lists-form="new"]')).not.toBeNull();
  });

  it('keeps what was typed into an open entry when a new version of it comes', async () => {
    const { m, root } = await boot();
    root.querySelector<HTMLButtonElement>('[data-entry="_list-support/a"] [data-entry-open]')!.click();
    await settle();
    const body = root.querySelector<HTMLTextAreaElement>('[data-entry-body]')!;
    type(body, 'Noch nicht gespeichert');
    // another device (or a tick of this page) wrote the entry: a new version is read
    m.hub.checklistEntries.set('_list-support', [entry('a', { tags: ['sap'], etag: 'sha256:a2', text: 'Von anderswo' }), entry('b')]);
    m.app.writes += 1;
    await settle();
    expect(root.querySelector<HTMLTextAreaElement>('[data-entry-body]')!.value).toBe('Noch nicht gespeichert');
    root.querySelector<HTMLFormElement>('[data-entry-detail] form')!.requestSubmit();
    await settle();
    expect(sent(m)).toEqual([{ op: 'entry_set', id: '_list-support/a', if_match: 'sha256:a2', body: 'Noch nicht gespeichert' }]);
  });

  it('reads the next page once, and drops one that comes after the filter changed', async () => {
    const { m, root } = await boot(undefined, [entry('a'), entry('b'), entry('c')]);
    m.hub.checklistPageSize = 1;
    m.app.writes += 1;
    await settle();
    expect(root.querySelectorAll('[data-entry]')).toHaveLength(1);
    const more = root.querySelector<HTMLButtonElement>('[data-lists-more]')!;
    more.click();
    more.click();
    await settle();
    expect([...root.querySelectorAll('[data-entry]')].map((e) => e.getAttribute('data-entry'))).toEqual(['_list-support/a', '_list-support/b']);
    // a page on its way while the filter changes is not put under the new filter's entries
    let release: () => void = () => undefined;
    m.hub.holdChecklist = new Promise((r) => (release = r));
    root.querySelector<HTMLButtonElement>('[data-lists-more]')!.click();
    const state = root.querySelector<HTMLSelectElement>('[data-lists-state]')!;
    state.value = 'open';
    state.dispatchEvent(new Event('change', { bubbles: true }));
    m.hub.holdChecklist = null;
    release();
    await settle();
    expect([...root.querySelectorAll('[data-entry]')].map((e) => e.getAttribute('data-entry'))).toEqual(['_list-support/a']);
  });

  it('asks for the words of the search after a pause in typing, not at each key', async () => {
    const { m, root } = await boot();
    const asked = m.hub.checklistQueries.length;
    const search = root.querySelector<HTMLInputElement>('[data-lists-search]')!;
    type(search, 's');
    type(search, 'sa');
    type(search, 'sap');
    await settle();
    expect(m.hub.checklistQueries.length).toBe(asked);
    await new Promise((r) => setTimeout(r, 300));
    await settle();
    expect(m.hub.checklistQueries.slice(asked)).toEqual([{ id: '_list-support', q: 'sap' }]);
  });

  it('reads the list again when a change on disk the snapshot does not hold is told', async () => {
    const { m } = await boot();
    const asked = m.hub.checklistQueries.length;
    (m.app as unknown as { onMessage(message: { event: string; data: string }): void }).onMessage({ event: 'finished', data: '{}' });
    await settle();
    expect(m.app.outsideTick).toBe(1);
    expect(m.hub.checklistQueries.length).toBe(asked + 1);
  });
});
