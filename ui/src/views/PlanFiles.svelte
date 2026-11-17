<script lang="ts">
  // The links and attachments of a plan or a project file, as the engine reads them (capabilities `plan_links`,
  // `plan_assets`): the web addresses drawn as links (http/https only, whatever the file holds) and changed with
  // `plan_set`/`project_set`, the files of its folder listed, and the same buttons to attach as a task has
  // (`AttachBar`: the first asset makes the plain file a folder).
  import type { App } from '../lib/app.svelte';
  import { badLink, isWebLink, parseList, tagsText } from '../lib/fields';
  import { translate, type Key } from '../lib/i18n';
  import AttachBar from './AttachBar.svelte';

  let { app, kind, id }: { app: App; kind: 'plan' | 'project'; id: string } = $props();

  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  const file = $derived(
    (kind === 'plan' ? app.snapshot?.plans : app.snapshot?.projects)?.find((f) => f.id === id),
  );
  const links = $derived(file?.links ?? []);
  const webLinks = $derived(links.filter(isWebLink));
  const assets = $derived(file?.assets ?? []);
  const canLinks = $derived(app.can('plan_links'));
  const canEdit = $derived(canLinks && app.can(kind === 'plan' ? 'plan_set' : 'project_set') && !app.readOnly);
  const canAttach = $derived(app.canAttach && app.can('plan_assets'));

  async function changeLinks(input: HTMLInputElement): Promise<void> {
    const list = parseList(input.value);
    const notLink = badLink(list);
    if (notLink !== null) {
      app.tell('error', 'field.links_invalid', { link: notLink });
      input.value = tagsText(links);
      return;
    }
    if (tagsText(list) === tagsText(links)) return;
    // an empty list removes the key, as everywhere a field is emptied
    if (!(await app.setPlanFile(kind, id, { links: list.length > 0 ? list : null }))) input.value = tagsText(links);
  }
</script>

{#if file && (canLinks || app.can('plan_assets'))}
  <section class="files" aria-label={t('plan.files')}>
    <!-- The links are what is used most: always drawn. The rest is folded, so the head of the plan stays short. -->
    {#if webLinks.length > 0}
      <div class="weblinks" role="group" aria-label={t('plan.files.links')}>
        {#each webLinks as link (link)}<a href={link} target="_blank" rel="noopener noreferrer">{link}</a>{/each}
      </div>
    {/if}
    <details>
      <summary>{t('plan.files.more', { n: assets.length })}</summary>
      {#if canEdit}
        <label data-hint={t('hint.form.plan.links')}>
          <span>{t('plan.files.links')} <small>({t('field.tags_hint')})</small></span>
          <!-- {#key}: a value the engine refused, or one changed elsewhere, is drawn anew from the file -->
          {#key tagsText(links)}
            <input
              type="text"
              value={tagsText(links)}
              placeholder="https://"
              disabled={app.saving}
              onchange={(e) => void changeLinks(e.currentTarget)}
            />
          {/key}
        </label>
      {/if}
      {#if assets.length > 0}
        <div class="assets">
          <span class="label">{t('plan.files.assets')}</span>
          <ul>
            {#each assets as asset (asset)}<li>{asset}</li>{/each}
            {#if file.assets_truncated}<li class="muted">{t('plan.files.assets_more')}</li>{/if}
          </ul>
        </div>
      {/if}
      {#if webLinks.length === 0 && assets.length === 0 && !canEdit}
        <p class="muted">{t('plan.files.none')}</p>
      {/if}
      {#if canAttach}
        <p class="attach"><AttachBar {app} {id} /></p>
      {/if}
    </details>
  </section>
{/if}

<style>
  .files {
    display: grid;
    gap: 0.3rem;
    margin: 0.3rem 0;
  }
  details {
    display: grid;
    gap: 0.4rem;
  }
  details[open] > summary {
    margin-bottom: 0.4rem;
  }
  summary {
    cursor: pointer;
    color: var(--muted);
    font-size: 0.85rem;
  }
  label {
    display: grid;
    gap: 0.2rem;
  }
  input {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.3rem 0.5rem;
  }
  .weblinks {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 0.8rem;
    overflow-wrap: anywhere;
  }
  .label {
    color: var(--muted);
    font-size: 0.85rem;
  }
  ul {
    margin: 0.1rem 0 0;
    padding-left: 1.1rem;
    overflow-wrap: anywhere;
  }
  .muted {
    color: var(--muted);
    margin: 0;
  }
  .attach {
    margin: 0;
  }
</style>
