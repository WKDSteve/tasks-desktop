// @vitest-environment jsdom
// The catalogue of the competences in a DOM, with its effects running: a table per group with the ladders of theory and
// practice (a name for a screen reader with stage and targets, the rungs of the targets marked), the targets, the paths
// as chips (open the path), the evidence given and open; a row opens below it with the text of the file as Markdown
// (untrusted: no markup of its own) and the file; filters, search and the order by distance; the paths without a field
// last; the empty catalogue says how to begin. Stages, scale and paths come from the fixtures (the engine).
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { make, snapshot } from '../lib/appDouble';
import type { Competences, LearnEvidence, PathEntry } from '../lib/contract';
import CompetencesView from './CompetencesView.svelte';

type Made = ReturnType<typeof make>;

const SCALE = ['Unknown', 'Heard of', 'Basics', 'Pro', 'Bachelor', 'Master', 'Expert', 'Luminary', 'Mastermind'].map((name, level) => ({ level, name }));

const field = (slug: string, over: Partial<Competences['items'][number]> = {}): Competences['items'][number] => ({
  id: `ALL/${slug}`,
  area: 'ALL',
  slug,
  title: slug,
  body: '',
  paths: [],
  file: `ALL/ROADMAP/competences/${slug}.md`,
  valid: true,
  problems: [],
  ...over,
});

const COMPETENCES = {
  kind: 'tasks.competences',
  rev: 'c1',
  digest: 'd',
  lang: 'en',
  scale: SCALE,
  items: [
    field('os', {
      title: 'Operating systems',
      group: 'Core',
      t: 3,
      p: 1.5,
      target_12: { t: 4, p: 4 },
      target_24: { t: 4.5, p: 4.5 },
      assessed: '2026-10-29',
      body: 'Why: **processes** <script>alert(1)</script>',
      paths: ['lib/os'],
    }),
    field('net', { title: 'Networks', group: 'Core', t: 2, target_12: { t: 3 } }),
    field('ui', { title: 'Design', t: 1 }),
  ],
  incomplete: [],
};

const pathEntry = (slug: string, title: string, over: Partial<PathEntry> = {}): PathEntry => ({
  id: `lib/${slug}`,
  area: 'lib',
  slug,
  title,
  areas: ['lib'],
  summary: '',
  has_tree: true,
  points: 4,
  progress: { learned: 1, seen: 0, dropped: 0, open: 3, blocked: 0, total: 4 },
  file: `lib/ROADMAP/paths/${slug}.md`,
  valid: true,
  problems: [],
  stage: 'doing',
  ...over,
});

const EVIDENCE = {
  kind: 'tasks.learn_evidence',
  rev: 'e1',
  digest: 'd',
  items: [
    { path: 'lib/os', area: 'lib', title: 'OS', competence: ['ALL/os'], index: 3, label: 'Nachweis: a shell', stage_index: 0, stage_label: 'S', state: 'learned' },
    { path: 'lib/os', area: 'lib', title: 'OS', competence: ['ALL/os'], index: 5, label: 'Nachweis: a scheduler', stage_index: 0, stage_label: 'S', state: 'open' },
  ],
  incomplete: [],
} as unknown as LearnEvidence;

let mounted: ReturnType<typeof mount> | undefined;
let made: Made | undefined;

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await tick();
    await Promise.resolve();
  }
  flushSync();
}

async function show(opts: { competences?: unknown; caps?: string[] } = {}) {
  const m = make({ token: 't' });
  made = m;
  m.hub.capabilities = opts.caps ?? ['paths', 'path', 'requires', 'competences', 'learn_evidence'];
  m.hub.doc = snapshot([], 'rev:1');
  m.hub.pathsDoc = {
    kind: 'tasks.paths',
    rev: 'p1',
    digest: 'd',
    items: [pathEntry('os', 'OS basics', { competence: ['ALL/os'] }), pathEntry('free', 'Free path'), pathEntry('old', 'Old design', { stage: 'done', competence: ['ALL/ui'] })],
    incomplete: [],
  };
  m.hub.learnDocs = { competences: opts.competences ?? COMPETENCES, learn_evidence: EVIDENCE };
  await m.app.start(null);
  m.app.setLang('en');
  const page = document.createElement('div');
  document.body.append(page);
  mounted = mount(CompetencesView, { target: page, props: { app: m.app } });
  await settle();
  return { m, page };
}

const row = (page: HTMLElement, id: string) => page.querySelector<HTMLElement>(`[data-competence="${id}"]`);

afterEach(() => {
  if (mounted) void unmount(mounted);
  mounted = undefined;
  made?.app.stop();
  made = undefined;
  document.body.replaceChildren();
});

describe('CompetencesView', () => {
  it('draws a table per group with ladders, targets, paths and evidence', async () => {
    const { m, page } = await show();
    await vi.waitFor(() => expect(row(page, 'ALL/os')).not.toBeNull());
    // both asked at once: the fields, and the evidence of the finished paths too
    expect(new Map(m.hub.learnQueries)).toEqual(new Map([['competences', {}], ['learn_evidence', { include_done: true }]]));
    expect([...page.querySelectorAll('caption')].map((c) => c.textContent)).toEqual(['Core', 'Further fields']);
    const os = row(page, 'ALL/os')!;
    const theory = os.querySelector('[data-ladder="t"]')!;
    expect(theory.getAttribute('role')).toBe('img');
    expect(theory.getAttribute('aria-label')).toBe('Theory: 3 Pro, target in 12 months 4 Bachelor, target in 24 months 4.5 Bachelor');
    expect([...theory.querySelectorAll('.rung.full')]).toHaveLength(3);
    // the 12-month target framed on rung 4, the 24-month one dashed on rung 5
    expect([...theory.querySelectorAll('.rung')].findIndex((r) => r.classList.contains('t12'))).toBe(3);
    expect([...theory.querySelectorAll('.rung')].findIndex((r) => r.classList.contains('t24'))).toBe(4);
    // a half stage: half a rung, and the number with its name as text
    const practice = os.querySelector('[data-ladder="p"]')!;
    expect(practice.querySelectorAll('.rung.half')).toHaveLength(1);
    expect(os.textContent).toContain('1.5 Heard of');
    expect(os.textContent).toContain('12 months: T 4 Bachelor, P 4 Bachelor');
    expect(os.querySelector('[data-competence-evidence]')!.textContent).toContain('1 given · 1 open');
    // a finished path that names its field is a chip too; a chip opens its path
    expect(row(page, 'ALL/ui')!.querySelector('[data-competence-path="lib/old"]')!.getAttribute('aria-label')).toBe('Old design, finished, 1 of 4 learned');
    os.querySelector<HTMLButtonElement>('[data-competence-path="lib/os"]')!.click();
    expect([m.app.view, m.app.pathChoice]).toEqual(['paths', 'lib/os']);
  });

  it('opens a row below it with the text of the file as Markdown and the file', async () => {
    const { page } = await show();
    await vi.waitFor(() => expect(row(page, 'ALL/os')).not.toBeNull());
    const more = row(page, 'ALL/os')!.querySelector<HTMLButtonElement>('[data-competence-more]')!;
    expect(more.getAttribute('aria-expanded')).toBe('false');
    more.click();
    await settle();
    expect(more.getAttribute('aria-expanded')).toBe('true');
    const detail = page.querySelector<HTMLElement>('[data-competence-detail="ALL/os"]')!;
    expect(more.getAttribute('aria-controls')).toBe(detail.id);
    expect(detail.querySelector('strong')!.textContent).toBe('processes');
    expect(detail.querySelector('script')).toBeNull();
    expect(detail.textContent).toContain('Assessed on 29 October 2026');
    expect(detail.textContent).toContain('ALL/ROADMAP/competences/os.md');
    more.click();
    await settle();
    expect(page.querySelector('[data-competence-detail="ALL/os"]')).toBeNull();
  });

  it('filters by target, by path and by text, orders by distance, and lists the paths without a field last', async () => {
    const { page } = await show();
    await vi.waitFor(() => expect(row(page, 'ALL/os')).not.toBeNull());
    const ids = () => [...page.querySelectorAll<HTMLElement>('[data-competence]')].map((r) => r.dataset.competence);
    expect(page.querySelector('[data-competences-without]')!.textContent).toContain('Free path');
    page.querySelector<HTMLInputElement>('[data-competences-target]')!.click();
    await settle();
    expect(ids()).toEqual(['ALL/net', 'ALL/os']);
    // while a filter is on, the paths without a field are not shown
    expect(page.querySelector('[data-competences-without]')).toBeNull();
    const sort = page.querySelector<HTMLSelectElement>('[data-competences-sort]')!;
    sort.value = 'distance';
    sort.dispatchEvent(new Event('change'));
    await settle();
    // os is 2.5 from its target (practice 1.5 → 4), net 1
    expect(ids()).toEqual(['ALL/os', 'ALL/net']);
    page.querySelector<HTMLInputElement>('[data-competences-target]')!.click();
    page.querySelector<HTMLInputElement>('[data-competences-path]')!.click();
    await settle();
    expect(ids()).toEqual(['ALL/os', 'ALL/ui']);
    page.querySelector<HTMLInputElement>('[data-competences-path]')!.click();
    const search = page.querySelector<HTMLInputElement>('[data-competences-search]')!;
    search.value = 'netw';
    search.dispatchEvent(new Event('input'));
    await settle();
    expect(ids()).toEqual(['ALL/net']);
  });

  it('says how to begin without a field, and why with an engine without competences', async () => {
    const empty = await show({ competences: { ...COMPETENCES, items: [] } });
    await vi.waitFor(() => expect(empty.page.querySelector('[data-competences-empty]')).not.toBeNull());
    expect(empty.page.textContent).toContain('ALL/ROADMAP/competences/<field>.md');
    expect(empty.page.textContent).toContain('target_12: 4');
    void unmount(mounted!);
    mounted = undefined;
    made!.app.stop();
    document.body.replaceChildren();

    const old = await show({ caps: ['paths', 'path'] });
    expect(old.page.textContent).toContain('capability competences');
    expect(old.m.hub.learnQueries).toEqual([]);
  });
  it('follows the area filter of the page: a filter of another area hides the fields, said with a button that clears it', async () => {
    const { m, page } = await show();
    m.app.filter = { ...m.app.filter, areas: ['elsewhere'] };
    await settle();
    await vi.waitFor(() => expect(page.querySelector('.scope-note p')?.textContent).toBe('The area filter (elsewhere) hides the learning paths here.'));
    // the engine is asked for the fields and the evidence of that area (it scopes a field by the area of its file)
    expect(m.hub.learnQueries.filter(([name]) => name === 'competences').at(-1)).toEqual(['competences', { area: 'elsewhere' }]);
    expect(m.hub.learnQueries.filter(([name]) => name === 'learn_evidence').at(-1)).toEqual(['learn_evidence', { include_done: true, area: 'elsewhere' }]);
    const clear = page.querySelector<HTMLButtonElement>('.scope-note button')!;
    expect(clear.textContent).toBe('Clear filter');
    clear.click();
    await settle();
    expect(m.app.filter.areas).toEqual([]);
    await vi.waitFor(() => expect(page.querySelector('.scope-note')).toBeNull());
    expect(m.hub.learnQueries.filter(([name]) => name === 'competences').at(-1)).toEqual(['competences', {}]);
  });
});
