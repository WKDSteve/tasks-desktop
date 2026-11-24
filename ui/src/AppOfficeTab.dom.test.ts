// @vitest-environment jsdom
// The tab Office of the menu bar, in the whole page: after View and before the learning plans, with the sections Dates,
// Remind and Create, every entry with a hint, the views gone from View (and its submenu Time), the dot of the view
// shown, and the engine without meetings: no Meetings, no "New meeting", the rest stays.
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, expect, it, vi } from 'vitest';
import App from './App.svelte';

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

const trigger = (id: string) => document.querySelector<HTMLButtonElement>(`button.mb-trigger[data-for="${id}"]`);
const open = (id: string): HTMLElement => {
  trigger(id)!.click();
  flushSync();
  return document.querySelector<HTMLElement>(`[role="menu"][data-menu="${id}"]`)!;
};
const labels = (menu: HTMLElement) => [...menu.querySelectorAll('.mb-item .mb-text')].map((el) => el.textContent);

it('stands between View and the learning plans with its sections, and View has no Time submenu', async () => {
  await start(['paths', 'path', 'meetings', 'meeting', 'meeting_ops']);
  expect([...document.querySelectorAll<HTMLButtonElement>('button.mb-trigger')].map((b) => b.dataset.for)).toEqual(['tasks', 'project', 'view', 'office', 'learn', 'options', 'help']);
  const office = open('office');
  expect(trigger('office')!.textContent).toBe('Office');
  expect(labels(office)).toEqual(['Meetings', 'Kalender', 'Zeitleiste', 'Erinnerungen', 'Neues Meeting ...']);
  expect([...office.querySelectorAll('[role="group"]')].length).toBe(3);
  expect(office.textContent).toContain('Termine');
  expect(office.textContent).toContain('Erinnern');
  expect(office.textContent).toContain('Anlegen');
  expect(office.querySelector<HTMLAnchorElement>('[href*="#view=meetings"]')).not.toBeNull();
  // Every entry has its hint (the tooltip of the menu).
  for (const item of office.querySelectorAll('.mb-item')) expect((item.getAttribute('data-hint') ?? item.getAttribute('title') ?? '').length, item.textContent ?? '').toBeGreaterThan(10);
  const view = open('view');
  expect(labels(view)).not.toContain('Kalender');
  expect(labels(view)).not.toContain('Zeit');
  const project = open('project');
  expect(labels(project)).not.toContain('Neues Meeting ...');
});

it('carries the dot and the name of the view shown', async () => {
  const { app } = await start(['meetings', 'meeting', 'meeting_ops']);
  expect(trigger('office')!.hasAttribute('aria-label')).toBe(false);
  [...open('office').querySelectorAll<HTMLElement>('.mb-item')].find((el) => el.querySelector('.mb-text')?.textContent === 'Kalender')!.click();
  flushSync();
  expect(app.view).toBe('calendar');
  expect(trigger('office')!.getAttribute('aria-label')).toBe('Office, aktuell: Kalender');
  expect(trigger('view')!.hasAttribute('aria-label')).toBe(false);
});

it('leaves Meetings and the new meeting out without meetings in the engine, not greyed', async () => {
  await start([]);
  expect(labels(open('office'))).toEqual(['Kalender', 'Zeitleiste', 'Erinnerungen']);
});

it('greys the new meeting when the engine reads meetings but cannot make them', async () => {
  await start(['meetings', 'meeting']);
  const item = [...open('office').querySelectorAll<HTMLElement>('.mb-item')].find((el) => el.querySelector('.mb-text')?.textContent === 'Neues Meeting ...')!;
  expect(item.getAttribute('aria-disabled') === 'true' || item.hasAttribute('disabled')).toBe(true);
});

it('offers the contacts under People and "New contact ..." under Create when the engine reads contacts, and neither without', async () => {
  await start(['meetings', 'meeting', 'meeting_ops', 'contacts', 'contact']);
  const office = open('office');
  expect(labels(office)).toEqual(['Meetings', 'Kalender', 'Zeitleiste', 'Erinnerungen', 'Kontakte', 'Neues Meeting ...', 'Neuer Kontakt ...']);
  expect(office.textContent).toContain('Leute');
  expect(office.querySelector<HTMLAnchorElement>('[href*="#view=contacts"]')).not.toBeNull();
  for (const item of office.querySelectorAll('.mb-item')) expect((item.getAttribute('data-hint') ?? item.getAttribute('title') ?? '').length, item.textContent ?? '').toBeGreaterThan(10);
});

it('has no contacts without the capability', async () => {
  await start(['meetings', 'meeting', 'meeting_ops']);
  const office = open('office');
  expect(labels(office)).not.toContain('Kontakte');
  expect(labels(office)).not.toContain('Neuer Kontakt ...');
});
