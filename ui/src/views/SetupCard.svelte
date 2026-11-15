<script lang="ts">
  // The first start in the page: the step for what the hub misses (the vault, Neovim) and the installation it offers.
  // Every choice is made in the dialog of the system that the hub shows on its machine; the page names no path.
  import type { App } from '../lib/app.svelte';
  import { translate, type Key } from '../lib/i18n';

  // `only: 'install'`: the installation alone (the dialog of the Help menu of a hub that is set up).
  let { app, only }: { app: App; only?: 'install' } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  const setup = $derived(app.setupState);
  const program = $derived(setup.info?.program ?? 'nvim');
  let newVault = $state(false);
  let area = $state('');
  let autostart = $state(false);
  let shortcut = $state(true);
</script>

{#if setup.info}
  <div class="setup">
    {#if only === 'install'}
      <!-- the steps of what the hub misses are the card's, not the dialog's -->
    {:else if setup.vaultStep}
      <section aria-labelledby="setup-vault">
        <h2 id="setup-vault">{t('setup.page.vault_title')}</h2>
        <p>{t('setup.page.vault_body')}</p>
        <div class="row">
          <button type="button" class="primary" disabled={setup.busy} onclick={() => void setup.chooseVault(null)}
            >{t('setup.page.vault_choose')}</button
          >
          <label><input type="checkbox" bind:checked={newVault} /> {t('setup.page.vault_new')}</label>
        </div>
        {#if newVault}
          <div class="row">
            <label>{t('setup.page.vault_area')} <input type="text" bind:value={area} maxlength="128" /></label>
            <button
              type="button"
              disabled={setup.busy || area.trim() === ''}
              onclick={() => void setup.chooseVault(area.trim())}>{t('setup.page.vault_create')}</button
            >
          </div>
        {/if}
      </section>
    {:else if setup.nvimStep && setup.info.pickProgram}
      <section aria-labelledby="setup-nvim">
        <h2 id="setup-nvim">{t('setup.page.nvim_title')}</h2>
        <p>{t('setup.page.nvim_body', { program })}</p>
        <button type="button" class="primary" disabled={setup.busy} onclick={() => void setup.chooseNvim()}
          >{t('setup.page.nvim_choose', { program })}</button
        >
      </section>
    {/if}

    {#if setup.installing}
      <p role="status">{t('setup.page.installing')}</p>
    {:else if setup.installStep}
      <section aria-labelledby="setup-install">
        <h2 id="setup-install">{t('setup.page.install_title')}</h2>
        <p>{t(setup.info.install === 'replace' ? 'setup.page.replace_body' : 'setup.page.install_body')}</p>
        <label><input type="checkbox" bind:checked={autostart} /> {t('setup.page.install_autostart')}</label>
        <label><input type="checkbox" bind:checked={shortcut} /> {t('setup.page.install_shortcut')}</label>
        <div class="row">
          <button type="button" disabled={setup.busy} onclick={() => void setup.install(autostart, shortcut)}
            >{t('setup.page.install')}</button
          >
          <button type="button" disabled={setup.busy} onclick={() => void setup.decline()}
            >{t('setup.page.install_decline')}</button
          >
        </div>
      </section>
    {/if}

    {#if setup.busy}
      <p role="status" class="muted">{t('setup.page.busy')}</p>
    {:else if setup.closed}
      <p role="status" class="muted">{t('setup.page.closed')}</p>
    {/if}
    {#if setup.refusal}
      <p role="alert">
        {t(setup.refusal.key)}
        {#if setup.refusal.detail}<span class="muted">({setup.refusal.detail})</span>{/if}
      </p>
    {/if}
  </div>
{/if}

<style>
  .setup {
    display: grid;
    gap: 1rem;
    margin-top: 1rem;
    text-align: start;
  }
  section {
    display: grid;
    gap: 0.5rem;
  }
  h2 {
    margin: 0;
    font-size: 1.05rem;
  }
  p {
    margin: 0;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }
</style>
