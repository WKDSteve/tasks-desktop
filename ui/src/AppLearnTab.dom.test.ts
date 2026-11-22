// @vitest-environment jsdom
// The tab Learning plans of the menu bar, in the whole page: where it stands, what it offers, the dot of the view that
// is shown, and that View no longer has the learning paths. Which views are offered is learnViews.ts (learnViews.test.ts).
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, expect, it, vi } from 'vitest';
import App from './App.svelte';

// The mark of the app lies outside the folder the test server serves; the page under test needs no picture.
vi.mock('./lib/logo', () => ({ logo: '' }));
import { make } from './lib/appDouble';

let page: ReturnType<typeof mount> | undefined;
let made: ReturnType<typeof make> | undefined;

afterEach(async () => {
  if (page) await unmount(page);
  made?.app.stop();
  page = undefined;
  made = undefined;
  document.body.innerHTML = '';
});

async function start(capabilities: string[] | null): Promise<ReturnType<typeof make>> {
  made = make({ token: 't' });
  made.hub.capabilities = capabilities;
  page = mount(App, { target: document.body, props: { app: made.app, code: null } });
  flushSync();
  for (let i = 0; i < 20 && made.app.phase !== 'ready'; i += 1) await new Promise((r) => setTimeout(r, 5));
  await tick();
  flushSync();
  return made;
}

const triggers = () => [...document.querySelectorAll<HTMLButtonElement>('button.mb-trigger')];
const trigger = (id: string) => document.querySelector<HTMLButtonElement>(`button.mb-trigger[data-for="${id}"]`);
const open = (id: string): HTMLElement => {
  trigger(id)!.click();
  flushSync();
  return document.querySelector<HTMLElement>(`[role="menu"][data-menu="${id}"]`)!;
};
const labels = (menu: HTMLElement) => [...menu.querySelectorAll('.mb-item .mb-text')].map((el) => el.textContent);

it('stands after View with its sections, and View has no learning paths any more', async () => {
  const { app } = await start(['paths', 'path']);
  expect(app.phase).toBe('ready');
  expect(triggers().map((b) => b.dataset.for)).toEqual(['tasks', 'project', 'view', 'learn', 'options', 'help']);
  expect(trigger('learn')!.textContent).toBe('Lernpläne');
  const learn = open('learn');
  expect(learn.getAttribute('aria-label')).toBe('Lernpläne');
  // Only the views the engine serves with the learning paths alone: the overview, the paths and the competence map, the
  // statistics; a section without a view (Wissen) is left out.
  expect([...learn.querySelectorAll('[role="group"]')].map((g) => g.getAttribute('aria-labelledby') !== null)).toEqual([true, true, true]);
  expect(learn.textContent).toContain('Überblick');
  expect(learn.textContent).toContain('Pfade');
  expect(learn.textContent).not.toContain('Wissen');
  expect(labels(learn)).toEqual(['Übersicht', 'Lernpfade', 'Kompetenzkarte', 'Lern-Statistik']);
  const item = learn.querySelector<HTMLAnchorElement>('.mb-item')!;
  expect(item.getAttribute('role')).toBe('menuitemradio');
  expect(item.getAttribute('href')).toContain('#view=learn');
  const inView = labels(open('view'));
  expect(inView).not.toContain('Lernpfade');
  expect(inView).not.toContain('Kompetenzkarte');
});

it('carries the dot and says the view shown, and View then has nothing checked among its views', async () => {
  const { app } = await start(['paths', 'path']);
  expect(trigger('learn')!.hasAttribute('aria-label')).toBe(false);
  expect(trigger('learn')!.querySelector('.mb-current')).toBeNull();
  [...open('learn').querySelectorAll<HTMLElement>('.mb-item')].find((el) => el.textContent?.includes('Lernpfade'))!.click();
  flushSync();
  expect(app.view).toBe('paths');
  expect(trigger('learn')!.getAttribute('aria-label')).toBe('Lernpläne, aktuell: Lernpfade');
  expect(trigger('learn')!.querySelector('.mb-current')?.textContent).toBe('●');
  const view = open('view');
  // The theme is a radio of its own; no view of the menu is checked.
  const viewSection = [...view.querySelectorAll('[role="group"]')][0]!;
  expect(viewSection.querySelectorAll('[aria-checked="true"]').length).toBe(0);
});

it('is missing without the learning paths of the engine (not greyed)', async () => {
  await start(['reorder']);
  expect(trigger('learn')).toBeNull();
  expect(triggers().map((b) => b.dataset.for)).toEqual(['tasks', 'project', 'view', 'options', 'help']);
});
