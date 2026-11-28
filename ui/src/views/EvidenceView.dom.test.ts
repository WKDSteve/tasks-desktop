// @vitest-environment jsdom
// The evidence in a DOM, with its effects running: asked with the finished paths, grouped by field (titles from the
// catalogue) with the points without one last, or by path; a row with state as symbol and word, the text as Markdown
// (untrusted), the stage it proves, the proof as a link only for a web address; a row opens its point in the path;
// filters by state and field; the empty view says how to begin. States and fields come from the fixtures (the engine).
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import EvidenceView from './EvidenceView.svelte';

type Made = ReturnType<typeof make>;

const ev = (path: string, title: string, index: number, state: string, over: Record<string, unknown> = {}) => ({
  path,
  area: 'lib',
  title,
  index,
  label: `Nachweis: point ${index}`,
  stage_index: 0,
  stage_label: 'S',
  state,
  ...over,
});

const EVIDENCE = {
  kind: 'tasks.learn_evidence',
  rev: 'e1',
  digest: 'd',
  items: [
    ev('lib/os', 'OS basics', 3, 'learned', { competence: ['ALL/os'], key: 'shell', label: 'Nachweis: [a shell](https://example.org/shell) <b>x</b>', link: 'https://example.org/shell', for: { axis: 'p', level: 3 } }),
    ev('lib/os', 'OS basics', 5, 'open', { competence: ['ALL/os'], link: 'javascript:alert(1)' }),
    ev('lib/old', 'Old', 2, 'learned', { competence: ['ALL/net'], path_done: true }),
    ev('lib/free', 'Free', 1, 'partial'),
  ],
  incomplete: [],
};

const COMPETENCES = {
  kind: 'tasks.competences',
  rev: 'c1',
  digest: 'd',
  lang: 'en',
  scale: ['Unknown', 'Heard of', 'Basics', 'Pro', 'Bachelor', 'Master', 'Expert', 'Luminary', 'Mastermind'].map((name, level) => ({ level, name })),
  items: [
    { id: 'ALL/os', area: 'ALL', slug: 'os', title: 'Operating systems', group: 'Core', body: '', paths: [], file: 'f', valid: true, problems: [] },
    { id: 'ALL/net', area: 'ALL', slug: 'net', title: 'Networks', group: 'Core', body: '', paths: [], file: 'f', valid: true, problems: [] },
  ],
  incomplete: [],
};

let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await tick();
    await Promise.resolve();
  }
  flushSync();
}

async function show(opts: { evidence?: unknown; caps?: string[] } = {}) {
  const m = make({ token: 't' });
  made = m;
  m.hub.capabilities = opts.caps ?? ['paths', 'path', 'competences', 'learn_evidence'];
  m.hub.doc = snapshot([], 'rev:1');
  m.hub.learnDocs = { learn_evidence: opts.evidence ?? EVIDENCE, competences: COMPETENCES };
  await m.app.start(null);
  m.app.setLang('en');
  const page = document.createElement('div');
  document.body.append(page);
  mounted = mount(EvidenceView, { target: page, props: { app: m.app } });
  await settle();
  return { m, page };
}

const headings = (page: HTMLElement) => [...page.querySelectorAll('h3')].map((h) => h.textContent);
const rows = (page: HTMLElement) => [...page.querySelectorAll<HTMLElement>('[data-evidence]')].map((r) => r.dataset.evidence);

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

describe('EvidenceView', () => {
  it('groups by field with the titles of the catalogue, those without a field last', async () => {
    const { m, page } = await show();
    await vi.waitFor(() => expect(rows(page)).toHaveLength(4));
    expect(new Map(m.hub.learnQueries).get('learn_evidence')).toEqual({ include_done: true });
    expect(headings(page)).toEqual(['Networks', 'Operating systems', 'Without a field']);
    expect(page.querySelector('[data-evidence-count]')!.textContent).toBe('2 given · 2 open');
    const shell = page.querySelector<HTMLElement>('[data-evidence="lib/os#3"]')!;
    expect(shell.dataset.evidenceState).toBe('given');
    expect(shell.textContent).toContain('✓ given');
    // the text as Markdown: its link drawn by the kit, its markup as text
    expect(shell.querySelector('.label a')!.getAttribute('href')).toBe('https://example.org/shell');
    expect(shell.querySelector('.label b')).toBeNull();
    expect(shell.textContent).toContain('P 3 Pro');
    expect(shell.querySelector('.for .sr')!.textContent).toBe('proves practice 3 Pro');
    expect(shell.querySelector('[data-evidence-proof]')!.textContent).toBe('Proof: example.org');
    // a link that is no web address is no link
    expect(page.querySelector('[data-evidence="lib/os#5"] [data-evidence-proof]')).toBeNull();
    expect(page.querySelector('[data-evidence="lib/old#2"]')!.textContent).toContain('Old (finished)');
  });

  it('opens a point in its path, by key or by index', async () => {
    const { m, page } = await show();
    await vi.waitFor(() => expect(rows(page)).toHaveLength(4));
    page.querySelector<HTMLButtonElement>('[data-evidence="lib/os#3"] [data-evidence-open]')!.click();
    expect([m.app.view, m.app.pathChoice, m.app.pathPoint]).toEqual(['paths', 'lib/os', 'shell']);
    page.querySelector<HTMLButtonElement>('[data-evidence="lib/os#5"] [data-evidence-open]')!.click();
    expect(m.app.pathPoint).toBe('#5');
  });

  it('filters by state and field, and groups by path', async () => {
    const { page } = await show();
    await vi.waitFor(() => expect(rows(page)).toHaveLength(4));
    page.querySelector<HTMLInputElement>('[data-evidence-filter="open"]')!.click();
    await settle();
    expect(rows(page)).toEqual(['lib/os#5', 'lib/free#1']);
    page.querySelector<HTMLInputElement>('[data-evidence-filter="all"]')!.click();
    const field = page.querySelector<HTMLSelectElement>('[data-evidence-competence]')!;
    field.value = 'ALL/os';
    field.dispatchEvent(new Event('change'));
    await settle();
    expect(rows(page)).toEqual(['lib/os#3', 'lib/os#5']);
    field.value = '';
    field.dispatchEvent(new Event('change'));
    page.querySelector<HTMLInputElement>('[data-evidence-group="path"]')!.click();
    await settle();
    expect(headings(page)).toEqual(['OS basics', 'Old', 'Free']);
  });

  it('groups by path without fields, says how to begin without evidence and why with an older engine', async () => {
    const plain = await show({ caps: ['paths', 'path', 'learn_evidence'] });
    await vi.waitFor(() => expect(rows(plain.page)).toHaveLength(4));
    expect(headings(plain.page)).toEqual(['OS basics', 'Old', 'Free']);
    void unmount(mounted!);
    mounted = undefined;
    made!.app.stop();
    document.body.replaceChildren();

    const empty = await show({ evidence: { ...EVIDENCE, items: [] } });
    await vi.waitFor(() => expect(empty.page.querySelector('[data-evidence-empty]')).not.toBeNull());
    expect(empty.page.textContent).toContain('Nachweis:');
    void unmount(mounted!);
    mounted = undefined;
    made!.app.stop();
    document.body.replaceChildren();

    const old = await show({ caps: ['paths', 'path'] });
    expect(old.page.textContent).toContain('capability learn_evidence');
    expect(old.m.hub.learnQueries).toEqual([]);
  });
  it('follows the area filter of the page: a filter of another area hides the evidence, said with a button that clears it', async () => {
    const { m, page } = await show();
    // names the vault knows (the hub's list of areas): only those are asked of the engine
    m.app.hubAreas = ['elsewhere', 'ops', 'lib'].map((name) => ({ name }) as never);
    m.app.filter = { ...m.app.filter, areas: ['elsewhere'] };
    await settle();
    await vi.waitFor(() => expect(page.querySelector('.scope-note p')?.textContent).toBe('The area filter (elsewhere) hides the learning paths here.'));
    // and below the note the way to a first proof, for a vault that has none at all
    expect(page.querySelector('.scope-note + [data-evidence-empty]')).not.toBeNull();
    expect(m.hub.learnQueries.filter(([name]) => name === 'learn_evidence').at(-1)).toEqual(['learn_evidence', { include_done: true, area: 'elsewhere' }]);
    // the fields only name what is proved: asked for all of them
    expect(m.hub.learnQueries.filter(([name]) => name === 'competences').every(([, q]) => JSON.stringify(q) === '{}')).toBe(true);
    const clear = page.querySelector<HTMLButtonElement>('.scope-note button')!;
    expect(clear.textContent).toBe('Clear filter');
    clear.click();
    await settle();
    expect(m.app.filter.areas).toEqual([]);
    await vi.waitFor(() => expect(page.querySelector('.scope-note')).toBeNull());
    expect(rows(page)).toContain('lib/os#3');
  });
});
