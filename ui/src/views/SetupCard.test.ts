// The first start in the page: the state of its steps through `App` on the hub of memory, and the card rendered on the
// server side of Svelte (what it offers for each thing the hub misses; the page of the tests speaks German).
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../lib/api';
import { make } from '../lib/appDouble';
import SetupCard from './SetupCard.svelte';

/** A page whose hub misses `problem`, with the setup read. */
async function page(problem: string | null, install: 'install' | 'replace' | 'installed' | 'declined' = 'install') {
  const made = make({ token: 'tok' });
  made.hub.setupInfo = { problem, install, pickProgram: true, program: 'nvim.exe' };
  await made.app.setupState.load();
  return made;
}

const html = (app: unknown) => render(SetupCard, { props: { app } as never }).body.replace(/<!--.*?-->/g, '');

describe('the first start in the page', () => {
  it('offers the folder dialog for a missing vault and loads the page again once one is chosen', async () => {
    const { app, hub, reloads } = await page('no_vault');
    expect(app.setupState.vaultStep).toBe(true);
    expect(app.setupState.nvimStep).toBe(false);
    await app.setupState.chooseVault(null);
    await app.setupState.chooseVault('work');
    expect(hub.setupCalls).toEqual(['setup', 'vault', 'vault work']);
    expect(reloads()).toBe(2);
  });

  it('a closed dialog changes nothing and says so; a refusal keeps the words of the hub beside its own', async () => {
    const { app, hub, reloads } = await page('no_vault');
    hub.setupNext = { chosen: false, problem: 'no_vault' };
    await app.setupState.chooseVault(null);
    expect(app.setupState.closed).toBe(true);
    expect(reloads()).toBe(0);
    hub.setupRefusal = new ApiError(400, 'vault_refused', 'there is no such folder');
    await app.setupState.chooseVault(null);
    expect(app.setupState.refusal).toEqual({ key: 'setup.page.vault_failed', detail: 'there is no such folder' });
    expect(app.setupState.closed).toBe(false);
    expect(reloads()).toBe(0);
  });

  it('offers the file dialog for Neovim once the vault is there', async () => {
    const { app, hub, reloads } = await page('nvim_not_found');
    expect(app.setupState.nvimStep).toBe(true);
    hub.setupNext = { chosen: true, problem: null };
    await app.setupState.chooseNvim();
    expect(hub.setupCalls).toEqual(['setup', 'nvim']);
    expect(reloads()).toBe(1);
  });

  it('installs with what was chosen, or is not offered again once declined', async () => {
    const { app, hub } = await page('no_vault');
    expect(app.setupState.installStep).toBe(true);
    await app.setupState.install(true, false);
    expect(app.setupState.installing).toBe(true);
    expect(app.setupState.installStep).toBe(false);
    const other = await page('no_vault', 'replace');
    await other.app.setupState.decline();
    expect(other.app.setupState.installStep).toBe(false);
    expect([...hub.setupCalls, ...other.hub.setupCalls]).toEqual([
      'setup',
      'install autostart=true shortcut=false',
      'setup',
      'decline',
    ]);
  });

  it('shows the step for what is missing, and nothing for what a person cannot choose here', async () => {
    const vault = html((await page('no_vault')).app);
    expect(vault).toContain('Ordner wählen…');
    expect(vault).toContain('Programm installieren');
    expect(vault).not.toContain('nvim.exe');
    const nvim = html((await page('nvim_too_old', 'installed')).app);
    expect(nvim).toContain('nvim.exe wählen…');
    expect(nvim).not.toContain('Programm installieren');
    expect(nvim).not.toContain('Ordner wählen…');
    // The engine is missing: nothing to choose in the page, the card stays empty.
    const engine = html((await page('engine_not_found', 'declined')).app);
    expect(engine).not.toContain('<section');
    const replace = html((await page('no_vault', 'replace')).app);
    expect(replace).toContain('Eine andere Version des Programms ist installiert');
  });

  it('is read only while the page waits for the hub, not in the web variant', async () => {
    const hubbed = make({ sleep: () => new Promise(() => undefined) });
    hubbed.hub.engineReady = false;
    void hubbed.app.start(null);
    await new Promise((r) => setTimeout(r, 0));
    expect(hubbed.hub.setupCalls).toEqual(['setup']);
    hubbed.app.stop();
    const web = make({ mode: 'web', sleep: () => new Promise(() => undefined) });
    web.hub.engineReady = false;
    void web.app.start(null);
    await new Promise((r) => setTimeout(r, 0));
    expect(web.hub.setupCalls).toEqual([]);
    web.app.stop();
  });
});
